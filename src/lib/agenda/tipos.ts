// Tipos del módulo de agenda de entrevistas.
//
// Las columnas propias van en español; las que apuntan al CRM heredado
// conservan su nombre de origen (`account_id`, `deal_id`, `contact_id`),
// para que se vea a qué tabla apuntan sin tener que traducir mentalmente.

import type { Contact, Deal } from "@/types";

export type EstadoEntrevista =
  | "pendiente"
  | "confirmada"
  | "realizada"
  | "cancelada"
  | "no_asistio";

export const ESTADOS: EstadoEntrevista[] = [
  "pendiente",
  "confirmada",
  "realizada",
  "cancelada",
  "no_asistio",
];

export const ETIQUETA_ESTADO: Record<EstadoEntrevista, string> = {
  pendiente: "Por confirmar",
  confirmada: "Confirmada",
  realizada: "Realizada",
  cancelada: "Cancelada",
  no_asistio: "No asistió",
};

export interface Entrevistador {
  id: string;
  account_id: string;
  user_id: string | null;
  nombre: string;
  cargo: string | null;
  correo: string | null;
  activo: boolean;
}

export interface SalaEntrevista {
  id: string;
  account_id: string;
  nombre: string;
  campus: string | null;
  activo: boolean;
}

export interface TipoEntrevista {
  id: string;
  account_id: string;
  nombre: string;
  duracion_min: number;
  color: string | null;
  activo: boolean;
}

export interface FranjaDisponibilidad {
  id: string;
  account_id: string;
  entrevistador_id: string;
  inicia_en: string;
  termina_en: string;
  notas: string | null;
}

export interface Entrevista {
  id: string;
  account_id: string;
  deal_id: string | null;
  contact_id: string | null;
  entrevistador_id: string | null;
  sala_id: string | null;
  tipo_id: string | null;
  inicia_en: string;
  termina_en: string;
  estado: EstadoEntrevista;
  notas: string | null;
  creada_por: string | null;
  entrevistador?: Entrevistador | null;
  sala?: SalaEntrevista | null;
  tipo?: TipoEntrevista | null;
  contact?: Contact | null;
  deal?: Pick<Deal, "id" | "title"> | null;
}

/** Lo que se elige al agendar: un aspirante del embudo. */
export interface AspiranteAgendable {
  dealId: string | null;
  contactId: string;
  nombre: string;
  telefono: string;
  programa: string | null;
}
