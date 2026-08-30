-- ============================================================================
-- INACIME · Núcleo académico
-- 001 — ciclos, plan de estudios, grupos, asistencias y calificaciones
--
-- Vive en el esquema `academico`. WACRM se queda intacto en `public`, así que
-- los rebases del upstream nunca chocan con esto. Por eso también el archivo
-- va en supabase/academico/ y no en supabase/migrations/: si el upstream
-- publica un 036, no hay colisión de numeración.
--
-- DESPUÉS DE CORRER ESTO hay un paso en el tablero de Supabase:
--   Settings -> API -> Exposed schemas -> agregar `academico`.
-- Sin eso PostgREST no ve el esquema y la aplicación recibe 404 en cada
-- consulta, aunque las tablas existan y los permisos estén bien.
--
-- PARQUEADO a propósito, hasta tener el reglamento de evaluación de INACIME:
--   el CÁLCULO de la calificación definitiva (redondeo, mínimo aprobatorio,
--   recursamiento, extraordinario). Aquí sólo se ALMACENA el dato crudo; la
--   regla vive en una capa aparte para no migrar tablas cuando llegue el
--   documento.
-- ============================================================================

begin;

create schema if not exists academico;

comment on schema academico is
  'Expediente escolar: ciclos, planes, grupos, asistencias, calificaciones y actas.';

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

-- `updated_at` automático. Se cuelga de cada tabla que lo tenga.
create or replace function academico.toca_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Identidad y roles
--
-- Tabla propia a propósito: `public.profiles` es de WACRM y su columna `role`
-- significa otra cosa (owner/admin/agent/viewer, permisos del CRM). Mezclarlas
-- obligaría a que un docente fuera "agent" de admisiones, que no es cierto.
-- ---------------------------------------------------------------------------

create type academico.rol as enum (
  'direccion',        -- acceso total, incluida la configuración del ciclo
  'control_escolar',  -- alumnos, grupos, actas, reportes
  'finanzas',         -- cobranza; sólo lectura en lo académico
  'coordinacion',     -- docentes, grupos, reapertura de actas
  'docente',          -- sólo sus grupos
  'alumno'            -- sólo su propio expediente
);

create table academico.usuarios (
  id          uuid primary key references auth.users(id) on delete restrict,
  nombre      text not null check (length(btrim(nombre)) > 0),
  rol         academico.rol not null,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table academico.usuarios is
  'Rol escolar de cada persona. Separado de public.profiles, que es del CRM.';

create index usuarios_rol_idx on academico.usuarios (rol) where activo;

-- SECURITY DEFINER + search_path fijo: las políticas de RLS llaman a estas
-- funciones, y sin el search_path anclado un esquema malicioso en el camino
-- podría suplantar las tablas que consultan.
create or replace function academico.rol_actual()
returns academico.rol
language sql stable security definer set search_path = academico, pg_catalog as $$
  select rol from academico.usuarios where id = auth.uid() and activo
$$;

create or replace function academico.es_staff()
returns boolean
language sql stable security definer set search_path = academico, pg_catalog as $$
  select coalesce(
    academico.rol_actual() in ('direccion','control_escolar','coordinacion'),
    false)
$$;

-- ---------------------------------------------------------------------------
-- Oferta educativa
--
-- Las materias cuelgan del PLAN, no del programa. Un plan es una versión con
-- su propio RVOE: cuando la SEP autoriza uno nuevo, los alumnos que ya iban
-- siguen en el anterior. Colgar las materias del programa haría imposible
-- decir bajo qué plan se acreditó una materia — y eso es justo lo que pide
-- un kardex oficial.
-- ---------------------------------------------------------------------------

create table academico.programas (
  id          uuid primary key default gen_random_uuid(),
  clave       text not null unique check (clave = upper(btrim(clave))),
  nombre      text not null,
  nivel       text not null default 'licenciatura'
                check (nivel in ('bachillerato','tecnico','licenciatura','especialidad','maestria')),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column academico.programas.nivel is
  'Determina si aplica el complemento IEDU al facturar: sólo bachillerato y técnico.';

create table academico.planes_estudio (
  id             uuid primary key default gen_random_uuid(),
  programa_id    uuid not null references academico.programas(id) on delete restrict,
  clave          text not null,
  rvoe           text,
  vigente_desde  date not null,
  vigente_hasta  date,
  creditos_total smallint not null check (creditos_total > 0),
  creado_en      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (programa_id, clave),
  constraint plan_vigencia check (vigente_hasta is null or vigente_hasta > vigente_desde)
);

create index planes_programa_idx on academico.planes_estudio (programa_id);

create table academico.materias (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references academico.planes_estudio(id) on delete restrict,
  clave       text not null,
  nombre      text not null,
  creditos    smallint not null default 0 check (creditos >= 0),
  cuatrimestre smallint check (cuatrimestre between 1 and 20),
  creado_en   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (plan_id, clave)
);

create index materias_plan_idx on academico.materias (plan_id);

-- Seriación. Una fila por pareja: para cursar `materia_id` hay que haber
-- acreditado `requiere_id`. Ambas deben ser del mismo plan — lo valida el
-- disparador de abajo, porque una llave foránea no puede expresarlo.
create table academico.seriacion (
  materia_id  uuid not null references academico.materias(id) on delete cascade,
  requiere_id uuid not null references academico.materias(id) on delete restrict,
  primary key (materia_id, requiere_id),
  constraint seriacion_no_circular_directa check (materia_id <> requiere_id)
);

create index seriacion_requiere_idx on academico.seriacion (requiere_id);

create or replace function academico.valida_seriacion_mismo_plan()
returns trigger language plpgsql as $$
declare v_plan_a uuid; v_plan_b uuid;
begin
  select plan_id into v_plan_a from academico.materias where id = new.materia_id;
  select plan_id into v_plan_b from academico.materias where id = new.requiere_id;
  if v_plan_a is distinct from v_plan_b then
    raise exception 'La seriación sólo puede ligar materias del mismo plan de estudios.';
  end if;
  return new;
end $$;

create trigger seriacion_mismo_plan
  before insert or update on academico.seriacion
  for each row execute function academico.valida_seriacion_mismo_plan();

-- ---------------------------------------------------------------------------
-- Ciclos y periodos de evaluación
--
-- El estado es un enum y no un booleano `activo`: un ciclo pasa por
-- planeación (se arman grupos, nadie captura), activo (se captura) y cerrado
-- (queda inmutable). Con un booleano no se puede distinguir "todavía no
-- empieza" de "ya terminó", y ambas cosas bloquean cosas distintas.
-- ---------------------------------------------------------------------------

create type academico.estado_ciclo as enum ('planeacion','activo','cerrado');

create table academico.ciclos (
  id          uuid primary key default gen_random_uuid(),
  clave       text not null unique,            -- '2026-3'
  nombre      text not null,
  inicia      date not null,
  termina     date not null,
  estado      academico.estado_ciclo not null default 'planeacion',
  creado_en   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ciclo_fechas check (termina > inicia)
);

-- Un solo ciclo activo a la vez. Índice parcial: los de planeación y los
-- cerrados pueden ser muchos.
create unique index ciclos_uno_activo on academico.ciclos (estado) where estado = 'activo';

create table academico.periodos (
  id             uuid primary key default gen_random_uuid(),
  ciclo_id       uuid not null references academico.ciclos(id) on delete cascade,
  clave          text not null,                -- 'P1', 'P2', 'FINAL'
  nombre         text not null,
  orden          smallint not null,
  ponderacion    numeric(5,4) not null check (ponderacion > 0 and ponderacion <= 1),
  captura_abre   timestamptz,
  captura_cierra timestamptz,
  creado_en      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ciclo_id, clave),
  unique (ciclo_id, orden),
  constraint periodo_ventana check (
    captura_cierra is null or captura_abre is null or captura_cierra > captura_abre)
);

create index periodos_ciclo_idx on academico.periodos (ciclo_id);

-- Las ponderaciones de un ciclo deben sumar 1. No se puede expresar con un
-- CHECK de fila, así que va como disparador de restricción DIFERIBLE: permite
-- insertar los tres parciales en una sola transacción y valida al final, en
-- vez de reventar en el primero por sumar sólo 0.3333.
create or replace function academico.valida_ponderaciones()
returns trigger language plpgsql as $$
declare v_ciclo uuid; v_suma numeric;
begin
  v_ciclo := coalesce(new.ciclo_id, old.ciclo_id);
  select coalesce(sum(ponderacion), 0) into v_suma
  from academico.periodos where ciclo_id = v_ciclo;

  -- Cero es válido: el ciclo todavía no tiene periodos definidos.
  if v_suma <> 0 and abs(v_suma - 1) > 0.0001 then
    raise exception 'Las ponderaciones del ciclo deben sumar 1. Suman %.', v_suma;
  end if;
  return null;
end $$;

create constraint trigger periodos_ponderacion_suma
  after insert or update or delete on academico.periodos
  deferrable initially deferred
  for each row execute function academico.valida_ponderaciones();

-- ---------------------------------------------------------------------------
-- Personas
-- ---------------------------------------------------------------------------

create table academico.docentes (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid unique references academico.usuarios(id) on delete set null,
  num_empleado text not null unique,
  nombre       text not null,
  grado        text,
  activo       boolean not null default true,
  creado_en    timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table academico.alumnos (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid unique references academico.usuarios(id) on delete set null,
  matricula   text not null unique,
  nombre      text not null,
  curp        text unique check (curp is null or curp ~ '^[A-Z0-9]{18}$'),
  plan_id     uuid not null references academico.planes_estudio(id) on delete restrict,
  estatus     text not null default 'activo'
                check (estatus in ('activo','baja_temporal','baja_definitiva','egresado','titulado')),
  -- De dónde vino. Liga con el CRM sin que `academico` dependa de `public`:
  -- si el aspirante se borra allá, aquí queda el rastro en nulo y el alumno
  -- sigue existiendo.
  crm_contact_id uuid,
  creado_en   timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column academico.alumnos.curp is
  'Obligatoria para el complemento IEDU cuando el programa es de nivel deducible.';
comment on column academico.alumnos.crm_contact_id is
  'public.contacts.id del aspirante que se convirtió en este alumno. Sin llave foránea a propósito: los dos esquemas se versionan por separado.';

create index alumnos_plan_idx on academico.alumnos (plan_id);
create index alumnos_estatus_idx on academico.alumnos (estatus);
create index alumnos_crm_idx on academico.alumnos (crm_contact_id) where crm_contact_id is not null;

-- ---------------------------------------------------------------------------
-- Grupos e inscripciones
-- ---------------------------------------------------------------------------

create table academico.grupos (
  id          uuid primary key default gen_random_uuid(),
  ciclo_id    uuid not null references academico.ciclos(id) on delete restrict,
  materia_id  uuid not null references academico.materias(id) on delete restrict,
  docente_id  uuid references academico.docentes(id) on delete set null,
  clave       text not null,
  aula        text,
  cupo        smallint not null default 30 check (cupo > 0),
  creado_en   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (ciclo_id, clave, materia_id)
);

create index grupos_ciclo_idx on academico.grupos (ciclo_id);
create index grupos_docente_idx on academico.grupos (docente_id);
create index grupos_materia_idx on academico.grupos (materia_id);

-- Un grupo puede tener varias sesiones semanales (Mar 07–12, Jue 09–11).
create table academico.grupo_horarios (
  id        uuid primary key default gen_random_uuid(),
  grupo_id  uuid not null references academico.grupos(id) on delete cascade,
  dia       smallint not null check (dia between 1 and 7),   -- 1 = lunes, ISO
  inicia    time not null,
  termina   time not null,
  constraint horario_rango check (termina > inicia)
);

create index grupo_horarios_grupo_idx on academico.grupo_horarios (grupo_id);

create table academico.inscripciones (
  id         uuid primary key default gen_random_uuid(),
  grupo_id   uuid not null references academico.grupos(id) on delete restrict,
  alumno_id  uuid not null references academico.alumnos(id) on delete restrict,
  tipo       text not null default 'regular' check (tipo in ('regular','recurse','extraordinario')),
  estatus    text not null default 'activa' check (estatus in ('activa','baja')),
  creado_en  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grupo_id, alumno_id)
);

create index inscripciones_grupo_idx on academico.inscripciones (grupo_id);
create index inscripciones_alumno_idx on academico.inscripciones (alumno_id);

-- ---------------------------------------------------------------------------
-- Asistencias
-- ---------------------------------------------------------------------------

create type academico.estado_asistencia as enum ('P','R','A','J');
comment on type academico.estado_asistencia is 'Presente, Retardo, Ausente, Justificada.';

create table academico.sesiones (
  id         uuid primary key default gen_random_uuid(),
  grupo_id   uuid not null references academico.grupos(id) on delete cascade,
  fecha      date not null,
  creado_en  timestamptz not null default now(),
  unique (grupo_id, fecha)
);

create index sesiones_grupo_fecha_idx on academico.sesiones (grupo_id, fecha desc);

create table academico.asistencias (
  id              uuid primary key default gen_random_uuid(),
  sesion_id       uuid not null references academico.sesiones(id) on delete cascade,
  inscripcion_id  uuid not null references academico.inscripciones(id) on delete cascade,
  estado          academico.estado_asistencia not null,
  registrado_por  uuid not null references academico.usuarios(id) on delete restrict,
  registrado_en   timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (sesion_id, inscripcion_id)
);

create index asistencias_inscripcion_idx on academico.asistencias (inscripcion_id);

-- ---------------------------------------------------------------------------
-- Actas y calificaciones
-- ---------------------------------------------------------------------------

create table academico.actas (
  id           uuid primary key default gen_random_uuid(),
  grupo_id     uuid not null references academico.grupos(id) on delete restrict,
  periodo_id   uuid not null references academico.periodos(id) on delete restrict,
  estado       text not null default 'abierta' check (estado in ('abierta','cerrada')),
  firmada_por  uuid references academico.usuarios(id) on delete restrict,
  firmada_en   timestamptz,
  -- Motivo de la última reapertura. Obligarlo evita el "se reabrió y nadie
  -- se acuerda por qué" que es justo lo que pregunta una supervisión.
  reabierta_motivo text,
  creado_en    timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (grupo_id, periodo_id),
  constraint acta_firma_completa check (
    (estado = 'abierta' and firmada_por is null and firmada_en is null) or
    (estado = 'cerrada' and firmada_por is not null and firmada_en is not null)
  )
);

create index actas_periodo_idx on academico.actas (periodo_id);

create table academico.calificaciones (
  id              uuid primary key default gen_random_uuid(),
  inscripcion_id  uuid not null references academico.inscripciones(id) on delete cascade,
  periodo_id      uuid not null references academico.periodos(id) on delete restrict,
  valor           numeric(4,2) check (valor >= 0 and valor <= 10),
  capturada_por   uuid not null references academico.usuarios(id) on delete restrict,
  capturada_en    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (inscripcion_id, periodo_id)
);

comment on column academico.calificaciones.valor is
  'Dato crudo, 0 a 10. La definitiva NO se guarda aquí: se calcula en la capa de reglas con las ponderaciones del ciclo, y esa regla todavía depende del reglamento de evaluación de INACIME.';

create index calificaciones_periodo_idx on academico.calificaciones (periodo_id);

-- Un acta cerrada congela sus calificaciones. Reabrirla es un acto explícito
-- de coordinación que queda en la bitácora — no algo que pase "de paso" al
-- guardar un formulario.
create or replace function academico.bloquea_acta_cerrada()
returns trigger language plpgsql security definer set search_path = academico, pg_catalog as $$
declare v_estado text;
begin
  select a.estado into v_estado
  from academico.actas a
  join academico.inscripciones i on i.grupo_id = a.grupo_id
  where i.id = coalesce(new.inscripcion_id, old.inscripcion_id)
    and a.periodo_id = coalesce(new.periodo_id, old.periodo_id);

  if v_estado = 'cerrada' then
    raise exception 'El acta de este grupo y periodo está cerrada. Debe reabrirse desde coordinación.';
  end if;
  return coalesce(new, old);
end $$;

create trigger calificaciones_acta_cerrada
  before insert or update or delete on academico.calificaciones
  for each row execute function academico.bloquea_acta_cerrada();

-- Reabrir exige motivo.
create or replace function academico.exige_motivo_reapertura()
returns trigger language plpgsql as $$
begin
  if old.estado = 'cerrada' and new.estado = 'abierta'
     and coalesce(btrim(new.reabierta_motivo), '') = '' then
    raise exception 'Para reabrir un acta hay que registrar el motivo.';
  end if;
  return new;
end $$;

create trigger actas_motivo_reapertura
  before update on academico.actas
  for each row execute function academico.exige_motivo_reapertura();

-- ---------------------------------------------------------------------------
-- Bitácora — append-only de verdad
--
-- La inmutabilidad se hace con permisos, no con disciplina de la aplicación:
-- aunque alguien tome el service_role, no puede editar ni borrar filas.
-- ---------------------------------------------------------------------------

create table academico.auditoria (
  id          bigint generated always as identity primary key,
  ocurrio_en  timestamptz not null default now(),
  usuario_id  uuid references academico.usuarios(id) on delete set null,
  accion      text not null,
  entidad     text not null,
  entidad_id  uuid,
  antes       jsonb,
  despues     jsonb,
  sensible    boolean not null default false
);

create index auditoria_reciente_idx on academico.auditoria (ocurrio_en desc);
create index auditoria_entidad_idx on academico.auditoria (entidad, entidad_id);
create index auditoria_sensible_idx on academico.auditoria (ocurrio_en desc) where sensible;

create or replace function academico.registra_auditoria()
returns trigger language plpgsql security definer set search_path = academico, pg_catalog as $$
begin
  insert into academico.auditoria (
    usuario_id, accion, entidad, entidad_id, antes, despues, sensible)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    tg_table_name in ('calificaciones','actas','inscripciones','alumnos')
  );
  return coalesce(new, old);
end $$;

create trigger audita_calificaciones after insert or update or delete
  on academico.calificaciones for each row execute function academico.registra_auditoria();
create trigger audita_actas after insert or update or delete
  on academico.actas for each row execute function academico.registra_auditoria();
create trigger audita_inscripciones after insert or update or delete
  on academico.inscripciones for each row execute function academico.registra_auditoria();
create trigger audita_alumnos after insert or update or delete
  on academico.alumnos for each row execute function academico.registra_auditoria();

-- ---------------------------------------------------------------------------
-- updated_at en todas las tablas que lo tienen
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'usuarios','programas','planes_estudio','materias','ciclos','periodos',
    'docentes','alumnos','grupos','inscripciones','asistencias','actas',
    'calificaciones'
  ] loop
    -- El nombre del disparador se arma ANTES de pasarlo a %I: format('%I_x')
    -- citaría sólo el identificador y dejaría el sufijo fuera de las comillas.
    execute format(
      'create trigger %I before update on academico.%I
         for each row execute function academico.toca_updated_at()',
      t || '_updated_at', t);
  end loop;
end $$;

commit;
