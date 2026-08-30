-- ============================================================================
-- INACIME · Núcleo académico
-- 004 — cerrar la bitácora también para service_role
--
-- Al probarlo contra la base salió que `academico.auditoria` se podía EDITAR
-- y BORRAR con la llave de servicio. El 003 concedió privilegios sobre TODAS
-- las tablas del esquema a `service_role`, y ahí se coló la bitácora.
--
-- Importa más de lo que parece. Toda la defensa del expediente ante una
-- supervisión se apoya en que el registro de quién cambió qué calificación no
-- se puede alterar después. Si basta con la llave de servicio —la que vive en
-- las variables de entorno de Easypanel y en cada tarea de n8n— entonces la
-- bitácora no prueba nada.
--
-- `service_role` salta RLS, pero NO salta los permisos de tabla: es un rol
-- normal con el atributo BYPASSRLS, no un superusuario. Por eso revocar aquí
-- sí surte efecto.
--
-- Las inserciones siguen funcionando porque no las hace nadie a mano: las
-- hace el disparador `registra_auditoria`, que es SECURITY DEFINER y corre
-- con los privilegios del dueño.
-- ============================================================================

begin;

revoke insert, update, delete on academico.auditoria from service_role;
revoke insert, update, delete on academico.auditoria from authenticated;
revoke insert, update, delete on academico.auditoria from anon;

-- Que un GRANT futuro no la vuelva a abrir por descuido: los privilegios por
-- omisión de este esquema no deben alcanzar a la bitácora. Se conceden tabla
-- por tabla cuando haga falta, en vez de con ALL TABLES.
alter default privileges in schema academico
  revoke insert, update, delete on tables from service_role;
alter default privileges in schema academico
  revoke insert, update, delete on tables from authenticated;

-- Y se devuelven explícitamente sobre las tablas que sí se escriben.
do $$
declare t text;
begin
  foreach t in array array[
    'usuarios','programas','planes_estudio','materias','seriacion','ciclos',
    'periodos','docentes','alumnos','grupos','grupo_horarios','inscripciones',
    'sesiones','asistencias','actas','calificaciones'
  ] loop
    execute format(
      'grant insert, update, delete on academico.%I to authenticated, service_role', t);
  end loop;
end $$;

commit;
