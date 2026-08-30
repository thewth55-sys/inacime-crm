-- ============================================================================
-- INACIME · Núcleo académico
-- 003 — permisos que faltaron para service_role
--
-- El 002 sólo concedió permisos a `authenticated`, y eso dejó fuera al rol
-- del servidor. En Supabase, `service_role` NO hereda permisos sobre un
-- esquema nuevo: salta RLS, sí, pero primero necesita USAGE sobre el esquema
-- y privilegios sobre las tablas. Sin esto, toda consulta desde el servidor
-- —rutas de API, tareas de n8n, la conciliación con Odoo— falla con
-- "permission denied for schema academico" (42501).
--
-- El síntoma engaña: parece que las tablas no existen, cuando el problema es
-- que quien pregunta no puede ni mirar el esquema.
-- ============================================================================

begin;

grant usage on schema academico to service_role;
grant select, insert, update, delete on all tables in schema academico to service_role;
grant usage, select on all sequences in schema academico to service_role;
grant execute on all functions in schema academico to service_role;

alter default privileges in schema academico
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema academico
  grant usage, select on sequences to service_role;
alter default privileges in schema academico
  grant execute on functions to service_role;

-- `authenticated` necesita poder EJECUTAR los ayudantes de pertenencia: las
-- políticas los invocan en cada consulta. Sin esto, RLS revienta al evaluar.
grant execute on all functions in schema academico to authenticated;
alter default privileges in schema academico
  grant execute on functions to authenticated;

-- La bitácora sigue siendo de sólo lectura para todo el mundo salvo el
-- disparador, que corre como dueño.
revoke insert, update, delete on academico.auditoria from authenticated;

-- `anon` no entra al expediente escolar bajo ninguna circunstancia.
revoke all on schema academico from anon;
revoke all on all tables in schema academico from anon;

commit;
