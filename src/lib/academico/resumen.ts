import type { SupabaseClient } from "@supabase/supabase-js";
import { contarPendientesDeAlta } from "@/lib/academico/inscripcion";

// Cifras del panel de dirección y control escolar.
//
// El grueso viene de una sola llamada a `academico.resumen_operativo()`:
// contar 842 alumnos y sus inscripciones desde el navegador significaría
// traerse esas 850 filas en cada carga sólo para sumarlas.
//
// Las otras dos cifras cruzan al CRM —aspirantes y entrevistas— y ésas sí
// se piden aparte: son tablas de `public`, con su propia RLS por cuenta,
// y meterlas en la función SQL ataría los dos esquemas.

export interface Ciclo {
  id: string;
  clave: string;
  nombre: string;
  inicia: string;
  termina: string;
}

export interface ProgramaConteo {
  nombre: string;
  alumnos: number;
}

export interface ResumenOperativo {
  ciclo: Ciclo | null;
  alumnos_activos: number;
  alumnos_total: number;
  alumnos_riesgo: number;
  docentes: number;
  grupos: number;
  lugares: number;
  ocupados: number;
  actas: {
    faltan: number;
    docentes: number;
    vence: string | null;
    periodo: string | null;
  };
  programas: ProgramaConteo[];
}

export interface ResumenCompleto extends ResumenOperativo {
  /** Aspirantes ganados en el embudo que aún no tienen matrícula. */
  pendientesDeAlta: number;
  /** Entrevistas futuras sin entrevistador o sin sala asignada. */
  entrevistasSinAsignar: number;
}

export async function cargarResumen(db: SupabaseClient): Promise<ResumenCompleto> {
  const [rpc, altas, entrevistas] = await Promise.all([
    db.schema("academico").rpc("resumen_operativo"),
    // Ninguna de las dos debe tumbar el panel: si el CRM falla, el
    // resumen académico sigue siendo útil y la tarjeta correspondiente
    // simplemente no aparece.
    contarPendientesDeAlta(db).catch(() => 0),
    contarEntrevistasSinAsignar(db).catch(() => 0),
  ]);

  if (rpc.error) throw rpc.error;

  const base = rpc.data as ResumenOperativo;
  return {
    ...base,
    actas: base.actas ?? { faltan: 0, docentes: 0, vence: null, periodo: null },
    programas: base.programas ?? [],
    pendientesDeAlta: altas,
    entrevistasSinAsignar: entrevistas,
  };
}

/**
 * Entrevistas de aquí en adelante a las que todavía les falta quién
 * recibe o dónde. Son las que no se le pueden confirmar al aspirante.
 */
export async function contarEntrevistasSinAsignar(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from("entrevistas")
    .select("id", { count: "exact", head: true })
    .gte("inicia_en", new Date().toISOString())
    .neq("estado", "cancelada")
    .or("entrevistador_id.is.null,sala_id.is.null");
  if (error) throw error;
  return count ?? 0;
}

/** Ocupación de los grupos del ciclo, 0–100. Sin lugares, no hay dato. */
export function porcentajeOcupacion(r: Pick<ResumenOperativo, "lugares" | "ocupados">): number | null {
  if (!r.lugares) return null;
  return Math.round((r.ocupados / r.lugares) * 100);
}

/**
 * Barras relativas al programa más grande, no al total.
 *
 * Con seis programas y uno que concentra el 37%, medir contra el total
 * deja cinco barras casi invisibles y la comparación —que es para lo
 * que sirve la gráfica— se pierde. El número exacto va al lado.
 */
export function anchoBarra(alumnos: number, programas: ProgramaConteo[]): string {
  const mayor = programas.reduce((m, p) => Math.max(m, p.alumnos), 0);
  if (!mayor) return "0%";
  return `${Math.max(2, Math.round((alumnos / mayor) * 100))}%`;
}

/**
 * Fecha legible, sin correrla un día.
 *
 * `ciclos.inicia` es un `date` de Postgres y llega como "2026-08-17".
 * `new Date()` lo interpreta como medianoche UTC, y al pintarlo en hora
 * de México —seis horas atrás— sale el 16. Por eso una cadena de sólo
 * fecha se arma con sus tres números en hora local; los timestamptz, que
 * sí traen zona, pasan tal cual.
 */
export function fechaLegible(iso: string): string {
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = soloFecha
    ? new Date(Number(soloFecha[1]), Number(soloFecha[2]) - 1, Number(soloFecha[3]))
    : new Date(iso);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}
