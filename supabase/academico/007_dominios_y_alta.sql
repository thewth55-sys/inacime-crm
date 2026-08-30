-- ============================================================================
-- INACIME · Núcleo académico
-- 007 — dominio obligatorio por rol y datos de contacto del alumno
--
-- Regla institucional: el personal entra con @inacime.com y los alumnos con
-- su matrícula, que por debajo es <matricula>@alumnos.inacime.com.
--
-- La restricción se impone AQUÍ y no en la pantalla de alta. Una validación
-- en el formulario evita el error honesto; ésta evita el alta por API, por
-- el tablero de Supabase, o por una pantalla futura que se olvide de validar.
--
-- Los dominios son configuración, no constantes: si INACIME cambia de
-- dominio o abre uno para posgrado, se edita una fila.
-- ============================================================================

begin;

create table academico.dominios_permitidos (
  rol      academico.rol primary key,
  dominio  text not null check (dominio = lower(btrim(dominio))),
  nota     text
);

comment on table academico.dominios_permitidos is
  'Dominio de correo obligatorio para cada rol. Editable por dirección.';

insert into academico.dominios_permitidos (rol, dominio, nota) values
  ('direccion',       'inacime.com',          'Correo institucional del personal.'),
  ('control_escolar', 'inacime.com',          'Correo institucional del personal.'),
  ('finanzas',        'inacime.com',          'Correo institucional del personal.'),
  ('coordinacion',    'inacime.com',          'Correo institucional del personal.'),
  ('docente',         'inacime.com',          'Correo institucional del personal.'),
  ('alumno',          'alumnos.inacime.com',  'Sintético: <matricula>@alumnos.inacime.com. El alumno teclea sólo su matrícula.');

-- ---------------------------------------------------------------------------
-- La comprobación
-- ---------------------------------------------------------------------------

create or replace function academico.valida_dominio_por_rol()
returns trigger
language plpgsql security definer set search_path = academico, pg_catalog, auth as $$
declare
  v_correo   text;
  v_dominio  text;
begin
  select lower(email) into v_correo from auth.users where id = new.id;
  if v_correo is null then
    raise exception 'No existe una cuenta de acceso para este usuario.';
  end if;

  select dominio into v_dominio
  from academico.dominios_permitidos where rol = new.rol;

  -- Un rol sin dominio configurado no se bloquea: se asume que se agregó un
  -- rol nuevo y todavía no se decide su dominio. Fallar aquí dejaría el alta
  -- rota sin decir por qué.
  if v_dominio is null then
    return new;
  end if;

  if v_correo not like ('%@' || v_dominio) then
    raise exception
      'El rol % exige un correo @%. Recibido: %.',
      new.rol, v_dominio, v_correo
      using hint = 'Los alumnos entran con <matricula>@alumnos.inacime.com; el personal con su correo institucional.';
  end if;

  return new;
end $$;

create trigger usuarios_dominio_por_rol
  before insert or update of rol on academico.usuarios
  for each row execute function academico.valida_dominio_por_rol();

-- ---------------------------------------------------------------------------
-- Contacto real del alumno
--
-- El correo sintético no recibe nada. Para restablecer contraseña o mandar
-- avisos hace falta uno de verdad, que además puede ser del padre o tutor
-- cuando el alumno es menor.
-- ---------------------------------------------------------------------------

alter table academico.alumnos
  add column if not exists correo_personal text
    check (correo_personal is null or correo_personal ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  add column if not exists telefono text;

comment on column academico.alumnos.correo_personal is
  'Correo real del alumno o su tutor. El de acceso (<matricula>@alumnos.inacime.com) es sintético y no recibe correo, así que el restablecimiento de contraseña sale hacia acá.';

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------

grant select on academico.dominios_permitidos to authenticated, service_role;
grant insert, update, delete on academico.dominios_permitidos to service_role;

alter table academico.dominios_permitidos enable row level security;

-- Todos lo leen: la pantalla de alta necesita saber qué dominio exigir, y el
-- alumno merece saber con qué correo entra.
create policy dominios_lectura on academico.dominios_permitidos
  for select to authenticated using (true);

create policy dominios_escritura on academico.dominios_permitidos
  for all to authenticated
  using (academico.rol_actual() = 'direccion')
  with check (academico.rol_actual() = 'direccion');

commit;
