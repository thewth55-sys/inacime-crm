import type { SupabaseClient } from "@supabase/supabase-js";

// Capa de datos de la captura de calificaciones.
//
// La definitiva NO se calcula aquí. Se pide a `academico.calcula_definitiva`,
// que aplica la política del plan. Si el cálculo viviera en el navegador,
// cambiar el reglamento obligaría a desplegar — que es justo lo que se quiso
// evitar al hacerlo configuración.

export interface Periodo {
  id: string;
  clave: string;
  nombre: string;
  orden: number;
  ponderacion: number | null;
}

export interface Politica {
  id: string;
  nombre: string;
  minimoAprobatorio: number;
  escalaMin: number;
  escalaMax: number;
  redondeo: string;
  esInstitucional: boolean;
}

export interface FilaCaptura {
  inscripcionId: string;
  matricula: string;
  nombre: string;
  iniciales: string;
  tipo: string;
  /** Lo capturado por periodo, indexado por clave del periodo. */
  valores: Record<string, number | null>;
  /** La que calcula la base con la política vigente. Null si falta capturar. */
  definitiva: number | null;
}

export interface EstadoActa {
  id: string | null;
  estado: "abierta" | "cerrada";
  firmadaEn: string | null;
}

export async function cargarPeriodos(
  db: SupabaseClient,
  cicloClave: string,
): Promise<Periodo[]> {
  const { data, error } = await db
    .schema("academico")
    .from("periodos")
    .select("id, clave, nombre, orden, ponderacion, ciclos!inner ( clave )")
    .eq("ciclos.clave", cicloClave)
    .order("orden");
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id as string,
    clave: p.clave as string,
    nombre: p.nombre as string,
    orden: p.orden as number,
    ponderacion: p.ponderacion as number | null,
  }));
}

/** Política vigente del plan al que pertenece el grupo. */
export async function cargarPolitica(
  db: SupabaseClient,
  inscripcionId: string,
): Promise<Politica | null> {
  const { data, error } = await db
    .schema("academico")
    .rpc("politica_de", { p_inscripcion_id: inscripcionId });
  if (error) throw error;
  const p = Array.isArray(data) ? data[0] : data;
  if (!p?.id) return null;
  return {
    id: p.id,
    nombre: p.nombre,
    minimoAprobatorio: Number(p.minimo_aprobatorio),
    escalaMin: Number(p.escala_min),
    escalaMax: Number(p.escala_max),
    redondeo: p.redondeo,
    esInstitucional: p.plan_id === null,
  };
}

export async function cargarActa(
  db: SupabaseClient,
  grupoId: string,
  periodoId: string,
): Promise<EstadoActa> {
  const { data, error } = await db
    .schema("academico")
    .from("actas")
    .select("id, estado, firmada_en")
    .eq("grupo_id", grupoId)
    .eq("periodo_id", periodoId)
    .maybeSingle();
  if (error) throw error;
  return {
    id: (data?.id as string) ?? null,
    estado: ((data?.estado as string) ?? "abierta") as "abierta" | "cerrada",
    firmadaEn: (data?.firmada_en as string) ?? null,
  };
}

function iniciales(nombre: string): string {
  const p = nombre.replace(",", "").trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}

interface FilaIns {
  id: string;
  tipo: string;
  alumnos: { matricula: string; nombre: string } | null;
}

export async function cargarCaptura(
  db: SupabaseClient,
  grupoId: string,
  periodos: Periodo[],
): Promise<FilaCaptura[]> {
  const academico = db.schema("academico");

  const [ins, cal] = await Promise.all([
    academico
      .from("inscripciones")
      .select("id, tipo, alumnos!inner ( matricula, nombre )")
      .eq("grupo_id", grupoId)
      .eq("estatus", "activa"),
    academico
      .from("calificaciones")
      .select("inscripcion_id, periodo_id, valor")
      .in("periodo_id", periodos.map((p) => p.id)),
  ]);
  if (ins.error) throw ins.error;
  if (cal.error) throw cal.error;

  const porPeriodo = new Map(periodos.map((p) => [p.id, p.clave]));
  const capturado = new Map<string, Record<string, number | null>>();
  for (const c of cal.data ?? []) {
    const clave = porPeriodo.get(c.periodo_id as string);
    if (!clave) continue;
    const fila = capturado.get(c.inscripcion_id as string) ?? {};
    fila[clave] = c.valor === null ? null : Number(c.valor);
    capturado.set(c.inscripcion_id as string, fila);
  }

  const filas = (ins.data ?? []) as unknown as FilaIns[];

  // La definitiva se pide una por alumno. Con grupos de 20-30 es aceptable;
  // si un grupo creciera a cientos, esto se mueve a una función que devuelva
  // el grupo entero de una vez.
  // `.then()` de PostgREST devuelve un PromiseLike sin `.catch`, así que el
  // error se maneja dentro del propio then: si una definitiva falla, esa fila
  // se queda en null en vez de tumbar la tabla completa.
  const definitivas = await Promise.all(
    filas.map((f) =>
      academico
        .rpc("calcula_definitiva", { p_inscripcion_id: f.id })
        .then(({ data, error }) => (error || data === null ? null : Number(data))),
    ),
  );

  return filas
    .map((f, i) => ({
      inscripcionId: f.id,
      matricula: f.alumnos?.matricula ?? "",
      nombre: f.alumnos?.nombre ?? "",
      iniciales: iniciales(f.alumnos?.nombre ?? ""),
      tipo: f.tipo,
      valores: capturado.get(f.id) ?? {},
      definitiva: definitivas[i],
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * Guarda las calificaciones de un periodo. Como en asistencias, va en un solo
 * upsert: media captura guardada deja al grupo en un estado que nadie puede
 * interpretar después.
 */
export async function guardarCalificaciones(
  db: SupabaseClient,
  periodoId: string,
  usuarioId: string,
  filas: { inscripcionId: string; valor: number | null }[],
): Promise<number> {
  const conValor = filas.filter((f) => f.valor !== null);
  if (conValor.length === 0) return 0;

  const { error } = await db
    .schema("academico")
    .from("calificaciones")
    .upsert(
      conValor.map((f) => ({
        inscripcion_id: f.inscripcionId,
        periodo_id: periodoId,
        valor: f.valor,
        capturada_por: usuarioId,
      })),
      { onConflict: "inscripcion_id,periodo_id" },
    );
  if (error) throw error;
  return conValor.length;
}

/**
 * Cierra y firma el acta. A partir de aquí la base rechaza cualquier cambio
 * a esas calificaciones, y el alumno empieza a verlas — ambas cosas las
 * impone RLS, no esta pantalla.
 */
export async function cerrarActa(
  db: SupabaseClient,
  grupoId: string,
  periodoId: string,
  usuarioId: string,
): Promise<void> {
  const { error } = await db
    .schema("academico")
    .from("actas")
    .upsert(
      {
        grupo_id: grupoId,
        periodo_id: periodoId,
        estado: "cerrada",
        firmada_por: usuarioId,
        firmada_en: new Date().toISOString(),
      },
      { onConflict: "grupo_id,periodo_id" },
    );
  if (error) throw error;
}

/** Reabrir exige motivo: la base lo rechaza sin él, y con razón. */
export async function reabrirActa(
  db: SupabaseClient,
  actaId: string,
  motivo: string,
): Promise<void> {
  const { error } = await db
    .schema("academico")
    .from("actas")
    .update({
      estado: "abierta",
      firmada_por: null,
      firmada_en: null,
      reabierta_motivo: motivo,
    })
    .eq("id", actaId);
  if (error) throw error;
}
