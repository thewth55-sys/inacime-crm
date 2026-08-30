-- ============================================================================
-- INACIME · Núcleo académico
-- 005 — romper la recursión entre políticas
--
-- Al entrar con un docente real, PostgREST devolvió:
--   "infinite recursion detected in policy for relation grupos"
--
-- El ciclo: la política de `grupos` traía un EXISTS sobre `alumnos`, y la de
-- `alumnos` traía otro EXISTS sobre `grupos`. Cada una dispara la evaluación
-- de la otra y no hay fondo. No lo cazó el typecheck ni la prueba con la
-- llave de servicio, porque `service_role` salta RLS: sólo aparece cuando
-- consulta alguien con sesión normal.
--
-- La regla que se sigue de aquí en adelante:
--   una política NUNCA lee otra tabla protegida directamente.
--   Todo cruce pasa por una función SECURITY DEFINER, que corre con los
--   privilegios del dueño y por lo tanto no vuelve a entrar en RLS.
--
-- Es también más barato: la función se evalúa una vez por fila en vez de
-- expandir un EXISTS anidado dentro de cada política encadenada.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Ayudantes nuevos. Los tres cruces que antes vivían dentro de las políticas.
-- ---------------------------------------------------------------------------

-- ¿Este alumno está en alguno de MIS grupos, siendo yo docente?
create or replace function academico.es_mi_alumno(p_alumno_id uuid)
returns boolean
language sql stable security definer set search_path = academico, pg_catalog as $$
  select exists (
    select 1
    from academico.inscripciones i
    join academico.grupos g   on g.id = i.grupo_id
    join academico.docentes d on d.id = g.docente_id
    where i.alumno_id = p_alumno_id and d.usuario_id = auth.uid()
  )
$$;

-- ¿Estoy inscrito en este grupo, siendo yo alumno?
create or replace function academico.estoy_inscrito_en(p_grupo_id uuid)
returns boolean
language sql stable security definer set search_path = academico, pg_catalog as $$
  select exists (
    select 1
    from academico.inscripciones i
    join academico.alumnos a on a.id = i.alumno_id
    where i.grupo_id = p_grupo_id and a.usuario_id = auth.uid()
  )
$$;

-- ¿Esta sesión es de un grupo mío?
create or replace function academico.es_mi_sesion(p_sesion_id uuid)
returns boolean
language sql stable security definer set search_path = academico, pg_catalog as $$
  select exists (
    select 1
    from academico.sesiones s
    join academico.grupos g   on g.id = s.grupo_id
    join academico.docentes d on d.id = g.docente_id
    where s.id = p_sesion_id and d.usuario_id = auth.uid()
  )
$$;

-- ¿El grupo de esta inscripción es mío?
create or replace function academico.es_mi_grupo_de_inscripcion(p_inscripcion_id uuid)
returns boolean
language sql stable security definer set search_path = academico, pg_catalog as $$
  select exists (
    select 1
    from academico.inscripciones i
    join academico.grupos g   on g.id = i.grupo_id
    join academico.docentes d on d.id = g.docente_id
    where i.id = p_inscripcion_id and d.usuario_id = auth.uid()
  )
$$;

-- ¿El acta de este periodo y esta inscripción ya está cerrada?
-- Es lo que decide si el alumno puede ver su calificación.
create or replace function academico.acta_cerrada(p_inscripcion_id uuid, p_periodo_id uuid)
returns boolean
language sql stable security definer set search_path = academico, pg_catalog as $$
  select exists (
    select 1
    from academico.actas ac
    join academico.inscripciones i on i.grupo_id = ac.grupo_id
    where i.id = p_inscripcion_id
      and ac.periodo_id = p_periodo_id
      and ac.estado = 'cerrada'
  )
$$;

grant execute on all functions in schema academico to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Políticas reescritas: sólo llamadas a función, cero lecturas cruzadas.
-- ---------------------------------------------------------------------------

drop policy if exists alumnos_lectura on academico.alumnos;
create policy alumnos_lectura on academico.alumnos
  for select to authenticated
  using (
    academico.es_staff()
    or academico.rol_actual() = 'finanzas'
    or usuario_id = auth.uid()
    or academico.es_mi_alumno(id)
  );

drop policy if exists grupos_lectura on academico.grupos;
create policy grupos_lectura on academico.grupos
  for select to authenticated
  using (
    academico.es_staff()
    or academico.es_mi_grupo(id)
    or academico.estoy_inscrito_en(id)
  );

drop policy if exists asistencias_lectura on academico.asistencias;
create policy asistencias_lectura on academico.asistencias
  for select to authenticated
  using (
    academico.es_staff()
    or academico.es_mi_inscripcion(inscripcion_id)
    or academico.es_mi_sesion(sesion_id)
  );

drop policy if exists asistencias_escritura on academico.asistencias;
create policy asistencias_escritura on academico.asistencias
  for all to authenticated
  using (academico.es_staff() or academico.es_mi_sesion(sesion_id))
  with check (academico.es_staff() or academico.es_mi_sesion(sesion_id));

drop policy if exists calificaciones_lectura on academico.calificaciones;
create policy calificaciones_lectura on academico.calificaciones
  for select to authenticated
  using (
    academico.es_staff()
    or academico.es_mi_grupo_de_inscripcion(inscripcion_id)
    -- El alumno ve su calificación SÓLO con el acta cerrada. La regla vive
    -- aquí y no en la interfaz, para que no dependa de que una pantalla se
    -- acuerde de ocultarla.
    or (academico.es_mi_inscripcion(inscripcion_id)
        and academico.acta_cerrada(inscripcion_id, periodo_id))
  );

drop policy if exists calificaciones_escritura on academico.calificaciones;
create policy calificaciones_escritura on academico.calificaciones
  for all to authenticated
  using (academico.es_staff() or academico.es_mi_grupo_de_inscripcion(inscripcion_id))
  with check (academico.es_staff() or academico.es_mi_grupo_de_inscripcion(inscripcion_id));

-- `horarios_lectura` era `using (true)`: cualquiera con sesión veía el
-- horario de todos los grupos de la institución. Se acota al grupo propio.
drop policy if exists horarios_lectura on academico.grupo_horarios;
create policy horarios_lectura on academico.grupo_horarios
  for select to authenticated
  using (
    academico.es_staff()
    or academico.es_mi_grupo(grupo_id)
    or academico.estoy_inscrito_en(grupo_id)
  );

commit;
