-- ============================================================
-- 036_agenda_entrevistas.sql — Agenda de entrevistas de admisión
--
-- Portado del módulo de agenda de zentro-med (037_clinic_scheduling_core)
-- y adaptado al dominio de admisiones: donde la clínica agenda un
-- paciente con un doctor en un consultorio, aquí se agenda un aspirante
-- con un entrevistador en una sala.
--
-- Numeración
--   El upstream (thewth55-sys/wacrm) va en 035. Todo lo que sea vertical
--   de INACIME arranca en 036, igual que zuhma-med, para que un merge de
--   upstream no colisione con estas migraciones.
--
-- Convención de nombres
--   Las columnas propias del módulo van en español, como el resto de lo
--   que se ha construido para INACIME. Las que apuntan a tablas del CRM
--   heredado conservan su nombre de origen (`account_id`, `deal_id`,
--   `contact_id`): renombrarlas sólo escondería a qué apuntan.
--
-- Por qué estas tablas y no `profiles` directo
--   Un entrevistador no siempre tiene cuenta en el panel: un coordinador
--   invitado a entrevistar por un ciclo, o un docente que aún no se da de
--   alta, debe poder aparecer en la agenda desde el primer día. Por eso
--   `entrevistadores` es una entidad propia con `user_id` NULLABLE, y el
--   vínculo con la cuenta se hace después. Es el mismo razonamiento que
--   en zentro-med separaba `doctors` de `account_role_enum`.
--
-- Campus
--   `salas_entrevista.campus` es texto libre, no un ENUM. INACIME opera
--   hoy Coacalco y Tecámac, pero abrir una sede no debería exigir una
--   migración. Misma razón por la que el reglamento de evaluación se
--   configura desde la pantalla y no desde el código.
--
-- RLS
--   Lectura: cualquier miembro de la cuenta (admisiones necesita ver la
--   agenda completa para colocar a un aspirante donde quepa).
--   Escritura de entrevistas: 'agent' o superior — agendar es trabajo
--   diario de admisiones, no de administradores.
--   Catálogos (entrevistadores/salas/tipos): 'admin' o superior.
--   Disponibilidad: la declara cada entrevistador sobre sí mismo, SIN
--   atajo de administrador. Si el personal la transcribe por él, deja de
--   ser un dato en el que se pueda confiar para agendar.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================

-- ------------------------------------------------------------
-- entrevistadores
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entrevistadores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nombre      text NOT NULL,
  cargo       text,
  correo      text,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entrevistadores_account ON entrevistadores(account_id);
-- Un usuario no puede estar ligado a dos entrevistadores dentro de la
-- misma cuenta: si lo estuviera, "mi disponibilidad" no sabría cuál es.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entrevistadores_user
  ON entrevistadores(account_id, user_id) WHERE user_id IS NOT NULL;

ALTER TABLE entrevistadores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entrevistadores_select ON entrevistadores;
CREATE POLICY entrevistadores_select ON entrevistadores FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS entrevistadores_insert ON entrevistadores;
CREATE POLICY entrevistadores_insert ON entrevistadores FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS entrevistadores_update ON entrevistadores;
CREATE POLICY entrevistadores_update ON entrevistadores FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS entrevistadores_delete ON entrevistadores;
CREATE POLICY entrevistadores_delete ON entrevistadores FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON entrevistadores;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON entrevistadores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- salas_entrevista
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salas_entrevista (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  campus      text,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salas_account ON salas_entrevista(account_id);

ALTER TABLE salas_entrevista ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salas_entrevista_select ON salas_entrevista;
CREATE POLICY salas_entrevista_select ON salas_entrevista FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS salas_entrevista_insert ON salas_entrevista;
CREATE POLICY salas_entrevista_insert ON salas_entrevista FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS salas_entrevista_update ON salas_entrevista;
CREATE POLICY salas_entrevista_update ON salas_entrevista FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS salas_entrevista_delete ON salas_entrevista;
CREATE POLICY salas_entrevista_delete ON salas_entrevista FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON salas_entrevista;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON salas_entrevista
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- tipos_entrevista — qué se agenda y cuánto dura por defecto
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tipos_entrevista (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  nombre       text NOT NULL,
  duracion_min integer NOT NULL DEFAULT 30 CHECK (duracion_min > 0),
  color        text,
  activo       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tipos_entrevista_account ON tipos_entrevista(account_id);

ALTER TABLE tipos_entrevista ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tipos_entrevista_select ON tipos_entrevista;
CREATE POLICY tipos_entrevista_select ON tipos_entrevista FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS tipos_entrevista_insert ON tipos_entrevista;
CREATE POLICY tipos_entrevista_insert ON tipos_entrevista FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS tipos_entrevista_update ON tipos_entrevista;
CREATE POLICY tipos_entrevista_update ON tipos_entrevista FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS tipos_entrevista_delete ON tipos_entrevista;
CREATE POLICY tipos_entrevista_delete ON tipos_entrevista FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON tipos_entrevista;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tipos_entrevista
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- entrevistador_disponibilidad — franjas que cada quien declara
--
-- No es un horario semanal recurrente a propósito. Los coordinadores
-- reparten su tiempo entre clases, campus y periodos de admisión: la
-- disponibilidad se negocia por temporada, no se deriva de una plantilla.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entrevistador_disponibilidad (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entrevistador_id uuid NOT NULL REFERENCES entrevistadores(id) ON DELETE CASCADE,
  inicia_en        timestamptz NOT NULL,
  termina_en       timestamptz NOT NULL,
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (termina_en > inicia_en)
);

CREATE INDEX IF NOT EXISTS idx_disponibilidad_rango
  ON entrevistador_disponibilidad(entrevistador_id, inicia_en, termina_en);
CREATE INDEX IF NOT EXISTS idx_disponibilidad_account
  ON entrevistador_disponibilidad(account_id);

ALTER TABLE entrevistador_disponibilidad ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS disponibilidad_select ON entrevistador_disponibilidad;
CREATE POLICY disponibilidad_select ON entrevistador_disponibilidad FOR SELECT
  USING (is_account_member(account_id));

-- Sólo el propio entrevistador, sin atajo de administrador.
DROP POLICY IF EXISTS disponibilidad_insert ON entrevistador_disponibilidad;
CREATE POLICY disponibilidad_insert ON entrevistador_disponibilidad FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM entrevistadores e
    WHERE e.id = entrevistador_disponibilidad.entrevistador_id
      AND e.user_id = auth.uid()
      AND e.account_id = entrevistador_disponibilidad.account_id
  ));

DROP POLICY IF EXISTS disponibilidad_update ON entrevistador_disponibilidad;
CREATE POLICY disponibilidad_update ON entrevistador_disponibilidad FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM entrevistadores e
    WHERE e.id = entrevistador_disponibilidad.entrevistador_id
      AND e.user_id = auth.uid()
      AND e.account_id = entrevistador_disponibilidad.account_id
  ));

DROP POLICY IF EXISTS disponibilidad_delete ON entrevistador_disponibilidad;
CREATE POLICY disponibilidad_delete ON entrevistador_disponibilidad FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM entrevistadores e
    WHERE e.id = entrevistador_disponibilidad.entrevistador_id
      AND e.user_id = auth.uid()
      AND e.account_id = entrevistador_disponibilidad.account_id
  ));

DROP TRIGGER IF EXISTS set_updated_at ON entrevistador_disponibilidad;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON entrevistador_disponibilidad
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- entrevistas
--
-- `deal_id` y `contact_id` son nullables: una entrevista puede existir
-- sin negocio en el embudo (alguien que llega sin cita al campus). Son
-- entidades propias con su fecha, no un campo del negocio, porque un
-- mismo aspirante puede tener varias —entrevista, examen, cita con
-- padres— a lo largo del proceso.
--
-- `entrevistador_id` / `sala_id` / `tipo_id` también son nullables: se
-- agenda primero el hueco y se asigna quién y dónde después.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entrevistas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id          uuid REFERENCES deals(id) ON DELETE SET NULL,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  entrevistador_id uuid REFERENCES entrevistadores(id) ON DELETE SET NULL,
  sala_id          uuid REFERENCES salas_entrevista(id) ON DELETE SET NULL,
  tipo_id          uuid REFERENCES tipos_entrevista(id) ON DELETE SET NULL,
  inicia_en        timestamptz NOT NULL,
  termina_en       timestamptz NOT NULL,
  estado           text NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente','confirmada','realizada','cancelada','no_asistio')),
  notas            text,
  creada_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (termina_en > inicia_en)
);

CREATE INDEX IF NOT EXISTS idx_entrevistas_account_inicio
  ON entrevistas(account_id, inicia_en);
CREATE INDEX IF NOT EXISTS idx_entrevistas_entrevistador
  ON entrevistas(entrevistador_id, inicia_en) WHERE entrevistador_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entrevistas_sala
  ON entrevistas(sala_id, inicia_en) WHERE sala_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entrevistas_deal
  ON entrevistas(deal_id) WHERE deal_id IS NOT NULL;

ALTER TABLE entrevistas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entrevistas_select ON entrevistas;
CREATE POLICY entrevistas_select ON entrevistas FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS entrevistas_insert ON entrevistas;
CREATE POLICY entrevistas_insert ON entrevistas FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS entrevistas_update ON entrevistas;
CREATE POLICY entrevistas_update ON entrevistas FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS entrevistas_delete ON entrevistas;
CREATE POLICY entrevistas_delete ON entrevistas FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON entrevistas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON entrevistas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
