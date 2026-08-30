import type { SupabaseClient } from "@supabase/supabase-js";

// Ciclos y sus periodos de evaluación.
//
// Cuántos parciales tiene un ciclo es una decisión de cada coordinación,
// no del código: hay planes con dos parciales y examen, otros con tres,
// y alguno con un diagnóstico que se captura pero no cuenta. Todo eso se
// define aquí.
//
// La ponderación NO vive en el periodo: vive en el reglamento de
// evaluación, que puede diferir por plan. El ciclo dice qué periodos hay
// y cuándo se captura; el reglamento dice cuánto pesa cada uno.

export type EstadoCiclo = "planeacion" | "activo" | "cerrado";

export const ETIQUETA_ESTADO_CICLO: Record<EstadoCiclo, string> = {
  planeacion: "En planeación",
  activo: "Activo",
  cerrado: "Cerrado",
};

export interface Ciclo {
  id: string;
  clave: string;
  nombre: string;
  inicia: string;
  termina: string;
  estado: EstadoCiclo;
}

export interface Periodo {
  id: string;
  ciclo_id: string;
  clave: string;
  nombre: string;
  orden: number;
  captura_abre: string | null;
  captura_cierra: string | null;
}

export async function cargarCiclos(db: SupabaseClient): Promise<Ciclo[]> {
  const { data, error } = await db
    .schema("academico")
    .from("ciclos")
    .select("id, clave, nombre, inicia, termina, estado")
    .order("inicia", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Ciclo[];
}

export async function cargarPeriodos(db: SupabaseClient, cicloId: string): Promise<Periodo[]> {
  const { data, error } = await db
    .schema("academico")
    .from("periodos")
    .select("id, ciclo_id, clave, nombre, orden, captura_abre, captura_cierra")
    .eq("ciclo_id", cicloId)
    .order("orden");
  if (error) throw error;
  return (data ?? []) as Periodo[];
}

/**
 * Cuántas calificaciones hay capturadas por periodo del ciclo.
 *
 * La pantalla lo necesita para no ofrecer borrar un periodo que ya tiene
 * capturas: el trigger lo impediría de todos modos, pero enterarse al
 * apretar el botón es peor que ver el botón deshabilitado.
 */
export async function contarCapturas(
  db: SupabaseClient,
  periodos: Periodo[],
): Promise<Record<string, number>> {
  if (periodos.length === 0) return {};
  const conteos = await Promise.all(
    periodos.map(async (p) => {
      const { count } = await db
        .schema("academico")
        .from("calificaciones")
        .select("id", { count: "exact", head: true })
        .eq("periodo_id", p.id);
      return [p.id, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(conteos);
}

/**
 * Sugiere la clave del siguiente periodo a partir de los que ya hay.
 *
 * Sigue el patrón que la coordinación ya venía usando —P1, P2, P3— en
 * vez de imponer uno. Si las claves no son numeradas, se sale del paso
 * con el orden, y la persona la corrige antes de guardar.
 */
export function siguienteClave(periodos: Periodo[]): string {
  const numeradas = periodos
    .map((p) => /^([A-Za-z]+)(\d+)$/.exec(p.clave))
    .filter((m): m is RegExpExecArray => m !== null);
  if (numeradas.length === 0) return `P${periodos.length + 1}`;
  const prefijo = numeradas[numeradas.length - 1][1];
  const mayor = numeradas.reduce((m, x) => Math.max(m, Number(x[2])), 0);
  return `${prefijo}${mayor + 1}`;
}

/** El siguiente `orden` libre. Los periodos se listan por este campo. */
export function siguienteOrden(periodos: Periodo[]): number {
  return periodos.reduce((m, p) => Math.max(m, p.orden), 0) + 1;
}

/**
 * Valida un ciclo antes de guardarlo. Devuelve el problema, o null.
 *
 * Se comprueba aquí y no sólo en la base porque el mensaje de un CHECK
 * de Postgres no le dice a nadie qué corregir.
 */
export function problemaDelCiclo(c: Pick<Ciclo, "clave" | "nombre" | "inicia" | "termina">): string | null {
  if (!c.clave.trim()) return "El ciclo necesita una clave, como 2026-3.";
  if (!c.nombre.trim()) return "El ciclo necesita un nombre.";
  if (!c.inicia || !c.termina) return "Faltan las fechas de inicio y fin.";
  if (new Date(c.termina) <= new Date(c.inicia)) {
    return "El ciclo no puede terminar antes de empezar.";
  }
  return null;
}

/**
 * Valida la ventana de captura de un periodo contra el ciclo.
 *
 * Una captura que cierra después de que acabó el ciclo es casi siempre
 * un error de dedo, pero no se bloquea: hay periodos de regularización
 * que legítimamente se capturan tarde. Se avisa y se deja pasar.
 */
export function avisoDeVentana(p: Periodo, ciclo: Ciclo): string | null {
  if (p.captura_abre && p.captura_cierra && new Date(p.captura_cierra) <= new Date(p.captura_abre)) {
    return "La captura cierra antes de abrir.";
  }
  if (p.captura_cierra && new Date(p.captura_cierra) > new Date(`${ciclo.termina}T23:59:59`)) {
    return "La captura cierra después de que termina el ciclo.";
  }
  return null;
}
