-- ============================================================================
-- INACIME · Núcleo académico
-- 008 — qué etapa del embudo significa "inscrito"
--
-- El problema que resuelve: en WACRM, `pipeline_stages` no sabe nada de
-- ganado ni perdido, y arrastrar una tarjeta sólo cambia `stage_id` — nunca
-- toca `status`. Así que admisiones puede mover a alguien a la columna
-- "Inscrito" y el alta nunca se entera, porque la cola mira `status = won`.
--
-- Un alumno perdido en silencio es peor que un error ruidoso: nadie lo nota
-- hasta que llama preguntando por qué no puede entrar al portal.
--
-- La configuración vive en `academico` y NO en las tablas de WACRM a
-- propósito: tocar su esquema complicaría cada rebase del upstream.
-- ============================================================================

begin;

create table academico.config_admisiones (
  -- public.pipelines.id — sin llave foránea, igual que crm_contact_id: los
  -- dos esquemas se versionan por separado.
  pipeline_id        uuid primary key,
  stage_inscrito_id  uuid not null,
  actualizado_en     timestamptz not null default now()
);

comment on table academico.config_admisiones is
  'Qué etapa de cada embudo significa que el aspirante ya se inscribió. Es lo que dispara su alta como alumno.';

grant select on academico.config_admisiones to authenticated, service_role;
grant insert, update, delete on academico.config_admisiones to authenticated, service_role;

alter table academico.config_admisiones enable row level security;

-- La lee cualquiera con sesión: el tablero la necesita para saber qué columna
-- marca como ganado. La cambian quienes dan de alta.
create policy config_admisiones_lectura on academico.config_admisiones
  for select to authenticated using (true);

create policy config_admisiones_escritura on academico.config_admisiones
  for all to authenticated
  using (academico.rol_actual() in ('direccion','control_escolar'))
  with check (academico.rol_actual() in ('direccion','control_escolar'));

commit;
