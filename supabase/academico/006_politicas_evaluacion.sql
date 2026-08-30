-- ============================================================================
-- INACIME · Núcleo académico
-- 006 — el reglamento de evaluación como datos, no como código
--
-- Regla de diseño: ninguna política de evaluación se codifica. Coordinación
-- las define y las cambia sin que nadie despliegue nada. Si el mínimo
-- aprobatorio pasa de 6 a 7, o Enfermería decide ponderar distinto que
-- Odontología, es una fila — no un release.
--
-- Tres niveles, del más grueso al más fino:
--
--   politicas_evaluacion   escala, mínimo, redondeo, asistencia mínima
--   politica_periodos      cuánto pesa cada parcial (deben sumar 1)
--   politica_rubros        cuánto pesa cada rubro DENTRO de un parcial
--                          (examen, prácticas, tareas). Opcional: si un
--                          plan no define rubros, el docente captura la
--                          calificación del parcial directamente.
--
-- La política se resuelve por plan de estudios. Una con `plan_id` nulo es la
-- institucional, que aplica a lo que no tenga la suya.
--
-- Esto reemplaza a `periodos.ponderacion`, que forzaba una sola ponderación
-- para todos los programas del ciclo. Esa columna se conserva por
-- compatibilidad pero deja de mandar; el 007 la retirará cuando la interfaz
-- de coordinación esté en pie.
-- ============================================================================

begin;

create type academico.redondeo as enum (
  'ninguno',      -- 8.47 se queda en 8.47
  'un_decimal',   -- 8.47 -> 8.5
  'medio_punto',  -- 8.47 -> 8.5 ; 8.20 -> 8.0
  'entero'        -- 8.47 -> 8
);

create table academico.politicas_evaluacion (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  -- Nulo = política institucional, la que aplica cuando el plan no tiene una.
  plan_id       uuid references academico.planes_estudio(id) on delete cascade,
  vigente_desde date not null default current_date,
  vigente_hasta date,
  escala_min        numeric(5,2) not null default 0,
  escala_max        numeric(5,2) not null default 10,
  minimo_aprobatorio numeric(5,2) not null default 6,
  redondeo          academico.redondeo not null default 'un_decimal',
  -- Porcentaje de asistencia necesario para tener derecho a calificación.
  -- Nulo = no se condiciona.
  asistencia_minima numeric(5,2) check (asistencia_minima is null
                                        or (asistencia_minima >= 0 and asistencia_minima <= 100)),
  permite_recurse        boolean not null default true,
  permite_extraordinario boolean not null default true,
  notas         text,
  creado_en     timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint politica_escala check (escala_max > escala_min),
  constraint politica_minimo check (minimo_aprobatorio between escala_min and escala_max),
  constraint politica_vigencia check (vigente_hasta is null or vigente_hasta > vigente_desde)
);

comment on table academico.politicas_evaluacion is
  'Reglamento de evaluación, editable por coordinación. Nunca codificar estos valores.';

-- Una sola política vigente por plan a la vez, y una sola institucional.
create unique index politicas_vigente_por_plan
  on academico.politicas_evaluacion (coalesce(plan_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where vigente_hasta is null;

create index politicas_plan_idx on academico.politicas_evaluacion (plan_id);

-- ---------------------------------------------------------------------------
-- Ponderación de periodos
--
-- Se referencia el periodo por CLAVE ('P1', 'P2', 'FINAL') y no por id: así
-- la política sobrevive al cambio de ciclo. Un reglamento es del plan, no de
-- un ciclo en particular.
-- ---------------------------------------------------------------------------

create table academico.politica_periodos (
  politica_id   uuid not null references academico.politicas_evaluacion(id) on delete cascade,
  periodo_clave text not null,
  ponderacion   numeric(5,4) not null check (ponderacion > 0 and ponderacion <= 1),
  orden         smallint not null default 0,
  primary key (politica_id, periodo_clave)
);

create or replace function academico.valida_suma_periodos()
returns trigger language plpgsql as $$
declare v_pol uuid; v_suma numeric;
begin
  v_pol := coalesce(new.politica_id, old.politica_id);
  select coalesce(sum(ponderacion), 0) into v_suma
  from academico.politica_periodos where politica_id = v_pol;
  if v_suma <> 0 and abs(v_suma - 1) > 0.0001 then
    raise exception 'Las ponderaciones de los periodos deben sumar 1. Suman %.', v_suma;
  end if;
  return null;
end $$;

-- Diferido: permite cargar los tres parciales en una transacción sin reventar
-- en el primero por sumar 0.3333.
create constraint trigger politica_periodos_suma
  after insert or update or delete on academico.politica_periodos
  deferrable initially deferred
  for each row execute function academico.valida_suma_periodos();

-- ---------------------------------------------------------------------------
-- Rubros dentro de un periodo
--
-- Opcional. Si un plan no define rubros, el docente captura la calificación
-- del parcial de una vez. Si los define, la del parcial se calcula con ellos.
-- ---------------------------------------------------------------------------

create table academico.politica_rubros (
  id            uuid primary key default gen_random_uuid(),
  politica_id   uuid not null references academico.politicas_evaluacion(id) on delete cascade,
  -- Nulo = el rubro aplica a TODOS los periodos de la política.
  periodo_clave text,
  clave         text not null,
  nombre        text not null,
  ponderacion   numeric(5,4) not null check (ponderacion > 0 and ponderacion <= 1),
  orden         smallint not null default 0,
  unique (politica_id, periodo_clave, clave)
);

create index politica_rubros_politica_idx on academico.politica_rubros (politica_id);

create or replace function academico.valida_suma_rubros()
returns trigger language plpgsql as $$
declare v_pol uuid; v_per text; v_suma numeric;
begin
  v_pol := coalesce(new.politica_id, old.politica_id);
  v_per := coalesce(new.periodo_clave, old.periodo_clave);
  select coalesce(sum(ponderacion), 0) into v_suma
  from academico.politica_rubros
  where politica_id = v_pol and periodo_clave is not distinct from v_per;
  if v_suma <> 0 and abs(v_suma - 1) > 0.0001 then
    raise exception 'Los rubros de % deben sumar 1. Suman %.',
      coalesce(v_per, 'todos los periodos'), v_suma;
  end if;
  return null;
end $$;

create constraint trigger politica_rubros_suma
  after insert or update or delete on academico.politica_rubros
  deferrable initially deferred
  for each row execute function academico.valida_suma_rubros();

-- Calificación por rubro. Sólo se usa cuando la política define rubros.
create table academico.calificaciones_rubro (
  id             uuid primary key default gen_random_uuid(),
  inscripcion_id uuid not null references academico.inscripciones(id) on delete cascade,
  periodo_id     uuid not null references academico.periodos(id) on delete restrict,
  rubro_id       uuid not null references academico.politica_rubros(id) on delete restrict,
  valor          numeric(5,2) not null,
  capturada_por  uuid not null references academico.usuarios(id) on delete restrict,
  capturada_en   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (inscripcion_id, periodo_id, rubro_id)
);

create index calif_rubro_inscripcion_idx on academico.calificaciones_rubro (inscripcion_id);

-- ---------------------------------------------------------------------------
-- Resolución y cálculo
-- ---------------------------------------------------------------------------

/** Política que le toca a una inscripción: la de su plan; si no, la institucional. */
create or replace function academico.politica_de(p_inscripcion_id uuid)
returns academico.politicas_evaluacion
language sql stable security definer set search_path = academico, pg_catalog as $$
  select p.*
  from academico.inscripciones i
  join academico.alumnos a on a.id = i.alumno_id
  join academico.politicas_evaluacion p
    on (p.plan_id = a.plan_id or p.plan_id is null)
   and p.vigente_hasta is null
  where i.id = p_inscripcion_id
  -- La del plan gana sobre la institucional.
  order by p.plan_id nulls last
  limit 1
$$;

/** Aplica la regla de redondeo de una política a un valor crudo. */
create or replace function academico.aplica_redondeo(p_valor numeric, p_regla academico.redondeo)
returns numeric language sql immutable as $$
  select case p_regla
    when 'ninguno'     then p_valor
    when 'un_decimal'  then round(p_valor, 1)
    when 'medio_punto' then round(p_valor * 2) / 2
    when 'entero'      then round(p_valor, 0)
  end
$$;

/**
 * Calificación definitiva de una inscripción.
 *
 * Suma cada periodo por su ponderación y aplica el redondeo de la política.
 * Devuelve null si falta capturar algún periodo: una definitiva parcial es
 * peor que ninguna, porque parece un reprobado cuando en realidad es un
 * pendiente.
 */
create or replace function academico.calcula_definitiva(p_inscripcion_id uuid)
returns numeric
language plpgsql stable security definer set search_path = academico, pg_catalog as $$
declare
  pol academico.politicas_evaluacion;
  v_esperados int;
  v_capturados int;
  v_suma numeric;
begin
  pol := academico.politica_de(p_inscripcion_id);
  if pol.id is null then
    return null;   -- sin política vigente no se inventa una regla
  end if;

  select count(*) into v_esperados
  from academico.politica_periodos where politica_id = pol.id;
  if v_esperados = 0 then
    return null;
  end if;

  select count(*), coalesce(sum(c.valor * pp.ponderacion), 0)
    into v_capturados, v_suma
  from academico.calificaciones c
  join academico.periodos per on per.id = c.periodo_id
  join academico.politica_periodos pp
    on pp.politica_id = pol.id and pp.periodo_clave = per.clave
  where c.inscripcion_id = p_inscripcion_id and c.valor is not null;

  if v_capturados < v_esperados then
    return null;
  end if;

  return academico.aplica_redondeo(v_suma, pol.redondeo);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos y RLS
-- ---------------------------------------------------------------------------

grant select, insert, update, delete
  on academico.politicas_evaluacion, academico.politica_periodos,
     academico.politica_rubros, academico.calificaciones_rubro
  to authenticated, service_role;
grant execute on all functions in schema academico to authenticated, service_role;

alter table academico.politicas_evaluacion  enable row level security;
alter table academico.politica_periodos     enable row level security;
alter table academico.politica_rubros       enable row level security;
alter table academico.calificaciones_rubro  enable row level security;

-- El reglamento lo lee cualquiera: el alumno tiene derecho a saber con qué
-- regla se le califica. Sólo dirección y coordinación lo cambian.
create policy politicas_lectura on academico.politicas_evaluacion
  for select to authenticated using (true);
create policy politicas_escritura on academico.politicas_evaluacion
  for all to authenticated
  using (academico.rol_actual() in ('direccion','coordinacion'))
  with check (academico.rol_actual() in ('direccion','coordinacion'));

create policy politica_periodos_lectura on academico.politica_periodos
  for select to authenticated using (true);
create policy politica_periodos_escritura on academico.politica_periodos
  for all to authenticated
  using (academico.rol_actual() in ('direccion','coordinacion'))
  with check (academico.rol_actual() in ('direccion','coordinacion'));

create policy politica_rubros_lectura on academico.politica_rubros
  for select to authenticated using (true);
create policy politica_rubros_escritura on academico.politica_rubros
  for all to authenticated
  using (academico.rol_actual() in ('direccion','coordinacion'))
  with check (academico.rol_actual() in ('direccion','coordinacion'));

-- Los rubros siguen la misma regla que las calificaciones: el docente
-- captura los de sus grupos.
create policy calif_rubro_lectura on academico.calificaciones_rubro
  for select to authenticated
  using (
    academico.es_staff()
    or academico.es_mi_grupo_de_inscripcion(inscripcion_id)
    or (academico.es_mi_inscripcion(inscripcion_id)
        and academico.acta_cerrada(inscripcion_id, periodo_id))
  );
create policy calif_rubro_escritura on academico.calificaciones_rubro
  for all to authenticated
  using (academico.es_staff() or academico.es_mi_grupo_de_inscripcion(inscripcion_id))
  with check (academico.es_staff() or academico.es_mi_grupo_de_inscripcion(inscripcion_id));

create trigger politicas_evaluacion_updated_at before update
  on academico.politicas_evaluacion
  for each row execute function academico.toca_updated_at();
create trigger calificaciones_rubro_updated_at before update
  on academico.calificaciones_rubro
  for each row execute function academico.toca_updated_at();

create trigger audita_politicas after insert or update or delete
  on academico.politicas_evaluacion
  for each row execute function academico.registra_auditoria();

-- ---------------------------------------------------------------------------
-- Semilla: la política institucional de arranque.
--
-- Son valores de partida para que el sistema funcione desde el día uno, NO el
-- reglamento de INACIME. Coordinación los ajusta en cuanto tenga el documento
-- oficial, y ése es justamente el punto de que vivan aquí y no en el código.
-- ---------------------------------------------------------------------------

do $$
declare v_pol uuid;
begin
  insert into academico.politicas_evaluacion
    (nombre, plan_id, minimo_aprobatorio, redondeo, asistencia_minima, notas)
  values (
    'Institucional (provisional)', null, 6, 'un_decimal', 80,
    'Valores de arranque, pendientes de confirmar contra el reglamento de evaluación de INACIME.')
  returning id into v_pol;

  insert into academico.politica_periodos (politica_id, periodo_clave, ponderacion, orden)
  values (v_pol, 'P1', 0.3333, 1),
         (v_pol, 'P2', 0.3333, 2),
         (v_pol, 'FINAL', 0.3334, 3);
end $$;

commit;
