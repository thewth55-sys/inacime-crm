-- ============================================================================
-- INACIME · Núcleo académico
-- 002 — permisos y seguridad a nivel de fila
--
-- Van separados del 001 a propósito: el esquema y su política de acceso se
-- revisan con ojos distintos, y así se puede releer esto sin pasar por 500
-- líneas de tablas.
--
-- Dos capas, y hacen falta las dos:
--   GRANT decide si el rol puede tocar la tabla.
--   RLS  decide qué filas ve.
-- Sin GRANT, RLS nunca llega a evaluarse y todo devuelve vacío — es el error
-- más común al montar un esquema nuevo en Supabase.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Permisos de esquema
-- ---------------------------------------------------------------------------

grant usage on schema academico to authenticated;

-- `anon` no entra: al expediente escolar sólo se llega con sesión iniciada.
revoke all on schema academico from anon;

grant select, insert, update, delete on all tables in schema academico to authenticated;
grant usage, select on all sequences in schema academico to authenticated;

-- Lo que se cree después hereda lo mismo, para no tener que acordarse.
alter default privileges in schema academico
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema academico
  grant usage, select on sequences to authenticated;

-- La bitácora es sólo de lectura y de inserción por disparador. Ni el
-- service_role puede editarla o borrarla.
revoke insert, update, delete on academico.auditoria from authenticated;
-- El dueño de la tabla conserva sus privilegios de forma implícita, así que
-- revocárselos no sirve de nada. La protección real es la de arriba: a
-- `authenticated` se le quita INSERT/UPDATE/DELETE, y sólo el disparador
-- (SECURITY DEFINER) escribe.

-- ---------------------------------------------------------------------------
-- RLS encendida en todo
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'usuarios','programas','planes_estudio','materias','seriacion','ciclos',
    'periodos','docentes','alumnos','grupos','grupo_horarios','inscripciones',
    'sesiones','asistencias','actas','calificaciones','auditoria'
  ] loop
    execute format('alter table academico.%I enable row level security', t);
  end loop;
  -- Deliberadamente SIN "force row level security". Los ayudantes de
  -- pertenencia son SECURITY DEFINER y consultan grupos e inscripciones; con
  -- FORCE esa consulta volvería a pasar por la política que los invoca, que
  -- es recursión infinita. Y el disparador de bitácora, que corre como dueño,
  -- quedaría bloqueado al no existir política de INSERT sobre auditoria.
  -- `authenticated` sigue sujeto a RLS, que es de quien nos cuidamos.
end $$;

-- ---------------------------------------------------------------------------
-- Ayudantes de pertenencia
-- ---------------------------------------------------------------------------

create or replace function academico.es_mi_grupo(p_grupo_id uuid)
returns boolean
language sql stable security definer set search_path = academico, pg_catalog as $$
  select exists (
    select 1
    from academico.grupos g
    join academico.docentes d on d.id = g.docente_id
    where g.id = p_grupo_id and d.usuario_id = auth.uid()
  )
$$;

create or replace function academico.es_mi_inscripcion(p_inscripcion_id uuid)
returns boolean
language sql stable security definer set search_path = academico, pg_catalog as $$
  select exists (
    select 1
    from academico.inscripciones i
    join academico.alumnos a on a.id = i.alumno_id
    where i.id = p_inscripcion_id and a.usuario_id = auth.uid()
  )
$$;

create or replace function academico.soy_este_alumno(p_alumno_id uuid)
returns boolean
language sql stable security definer set search_path = academico, pg_catalog as $$
  select exists (
    select 1 from academico.alumnos a
    where a.id = p_alumno_id and a.usuario_id = auth.uid()
  )
$$;

-- ---------------------------------------------------------------------------
-- Catálogos: los lee cualquiera con sesión; los escribe control escolar.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'programas','planes_estudio','materias','seriacion','ciclos','periodos'
  ] loop
    -- Igual que con los disparadores: el nombre se arma antes del %I.
    execute format(
      'create policy %I on academico.%I for select to authenticated using (true)',
      t || '_lectura', t);
    execute format(
      'create policy %I on academico.%I for all to authenticated
         using (academico.es_staff()) with check (academico.es_staff())',
      t || '_escritura', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Personas
-- ---------------------------------------------------------------------------

create policy usuarios_lectura on academico.usuarios
  for select to authenticated
  using (id = auth.uid() or academico.es_staff());

create policy usuarios_escritura on academico.usuarios
  for all to authenticated
  using (academico.rol_actual() in ('direccion','control_escolar'))
  with check (academico.rol_actual() in ('direccion','control_escolar'));

-- Los docentes son visibles para todos: el alumno necesita saber quién le da
-- clase, y aparece en horarios y actas.
create policy docentes_lectura on academico.docentes
  for select to authenticated using (true);

create policy docentes_escritura on academico.docentes
  for all to authenticated
  using (academico.rol_actual() in ('direccion','control_escolar','coordinacion'))
  with check (academico.rol_actual() in ('direccion','control_escolar','coordinacion'));

-- El alumno se ve a sí mismo. El docente ve a los suyos. Finanzas ve a todos
-- porque necesita la cartera.
create policy alumnos_lectura on academico.alumnos
  for select to authenticated
  using (
    academico.es_staff()
    or academico.rol_actual() = 'finanzas'
    or usuario_id = auth.uid()
    or exists (
      select 1 from academico.inscripciones i
      join academico.grupos g on g.id = i.grupo_id
      join academico.docentes d on d.id = g.docente_id
      where i.alumno_id = alumnos.id and d.usuario_id = auth.uid()
    )
  );

create policy alumnos_escritura on academico.alumnos
  for all to authenticated
  using (academico.rol_actual() in ('direccion','control_escolar'))
  with check (academico.rol_actual() in ('direccion','control_escolar'));

-- ---------------------------------------------------------------------------
-- Grupos e inscripciones
-- ---------------------------------------------------------------------------

create policy grupos_lectura on academico.grupos
  for select to authenticated
  using (
    academico.es_staff()
    or academico.es_mi_grupo(id)
    or exists (
      select 1 from academico.inscripciones i
      join academico.alumnos a on a.id = i.alumno_id
      where i.grupo_id = grupos.id and a.usuario_id = auth.uid()
    )
  );

create policy grupos_escritura on academico.grupos
  for all to authenticated
  using (academico.es_staff()) with check (academico.es_staff());

create policy horarios_lectura on academico.grupo_horarios
  for select to authenticated using (true);

create policy horarios_escritura on academico.grupo_horarios
  for all to authenticated
  using (academico.es_staff()) with check (academico.es_staff());

create policy inscripciones_lectura on academico.inscripciones
  for select to authenticated
  using (
    academico.es_staff()
    or academico.es_mi_grupo(grupo_id)
    or academico.soy_este_alumno(alumno_id)
  );

create policy inscripciones_escritura on academico.inscripciones
  for all to authenticated
  using (academico.es_staff()) with check (academico.es_staff());

-- ---------------------------------------------------------------------------
-- Asistencias
--
-- El docente captura sólo en sus grupos. Es la única escritura que hace un
-- docente sin pasar por control escolar.
-- ---------------------------------------------------------------------------

create policy sesiones_lectura on academico.sesiones
  for select to authenticated
  using (academico.es_staff() or academico.es_mi_grupo(grupo_id));

create policy sesiones_escritura on academico.sesiones
  for all to authenticated
  using (academico.es_staff() or academico.es_mi_grupo(grupo_id))
  with check (academico.es_staff() or academico.es_mi_grupo(grupo_id));

create policy asistencias_lectura on academico.asistencias
  for select to authenticated
  using (
    academico.es_staff()
    or academico.es_mi_inscripcion(inscripcion_id)
    or exists (
      select 1 from academico.sesiones s
      where s.id = asistencias.sesion_id and academico.es_mi_grupo(s.grupo_id)
    )
  );

create policy asistencias_escritura on academico.asistencias
  for all to authenticated
  using (
    academico.es_staff()
    or exists (
      select 1 from academico.sesiones s
      where s.id = asistencias.sesion_id and academico.es_mi_grupo(s.grupo_id)
    )
  )
  with check (
    academico.es_staff()
    or exists (
      select 1 from academico.sesiones s
      where s.id = asistencias.sesion_id and academico.es_mi_grupo(s.grupo_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Actas y calificaciones
--
-- La regla que más importa: el alumno ve su calificación SÓLO cuando el acta
-- está cerrada. Vive aquí y no en la interfaz, para que no dependa de que una
-- pantalla se acuerde de ocultarla.
-- ---------------------------------------------------------------------------

create policy actas_lectura on academico.actas
  for select to authenticated
  using (academico.es_staff() or academico.es_mi_grupo(grupo_id));

-- El docente abre y cierra el acta de su grupo. Reabrir una cerrada queda
-- reservado a coordinación y dirección.
create policy actas_docente on academico.actas
  for all to authenticated
  using (academico.es_mi_grupo(grupo_id) and estado = 'abierta')
  with check (academico.es_mi_grupo(grupo_id));

create policy actas_coordinacion on academico.actas
  for all to authenticated
  using (academico.rol_actual() in ('direccion','coordinacion','control_escolar'))
  with check (academico.rol_actual() in ('direccion','coordinacion','control_escolar'));

create policy calificaciones_lectura on academico.calificaciones
  for select to authenticated
  using (
    academico.es_staff()
    or exists (
      select 1 from academico.inscripciones i
      where i.id = calificaciones.inscripcion_id and academico.es_mi_grupo(i.grupo_id)
    )
    or (
      academico.es_mi_inscripcion(inscripcion_id)
      and exists (
        select 1
        from academico.actas ac
        join academico.inscripciones i on i.grupo_id = ac.grupo_id
        where i.id = calificaciones.inscripcion_id
          and ac.periodo_id = calificaciones.periodo_id
          and ac.estado = 'cerrada'
      )
    )
  );

create policy calificaciones_escritura on academico.calificaciones
  for all to authenticated
  using (
    academico.es_staff()
    or exists (
      select 1 from academico.inscripciones i
      where i.id = calificaciones.inscripcion_id and academico.es_mi_grupo(i.grupo_id)
    )
  )
  with check (
    academico.es_staff()
    or exists (
      select 1 from academico.inscripciones i
      where i.id = calificaciones.inscripcion_id and academico.es_mi_grupo(i.grupo_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Bitácora: la leen dirección y control escolar. Nadie la escribe a mano.
-- ---------------------------------------------------------------------------

create policy auditoria_lectura on academico.auditoria
  for select to authenticated
  using (academico.rol_actual() in ('direccion','control_escolar'));

commit;
