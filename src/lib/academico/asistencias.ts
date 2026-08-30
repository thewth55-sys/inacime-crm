import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EstadoAsistencia,
  FilaAsistencia,
  GrupoDocente,
  ResumenAsistencia,
} from "./tipos";

// Capa de datos de la captura de asistencia.
//
// Todo pasa por `.schema('academico')`: el cliente apunta a `public` por
// omisión, que es donde vive WACRM. Sin esta llamada las consultas irían a
// las tablas equivocadas o devolverían 404.
//
// Las políticas de RLS ya limitan al docente a sus propios grupos, así que
// aquí no se filtra por docente a mano. Duplicar ese filtro daría una falsa
// sensación de seguridad: si la política estuviera mal, el filtro del cliente
// no salvaría nada porque se puede quitar desde el navegador.

const DIAS = ["", "lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function hhmm(t: string): string {
  return t.slice(0, 5);
}

export function iniciales(nombre: string): string {
  // Los nombres vienen como "Apellido Apellido, Nombre". Tomar las dos
  // primeras palabras da las iniciales del apellido, que es como los
  // identifica un docente al pasar lista.
  const partes = nombre.replace(",", "").trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "?") + (partes[1]?.[0] ?? "")).toUpperCase();
}

interface FilaGrupo {
  id: string;
  clave: string;
  aula: string | null;
  materias: { clave: string; nombre: string } | null;
  ciclos: { clave: string; estado: string } | null;
  grupo_horarios: { dia: number; inicia: string; termina: string }[] | null;
  inscripciones: { count: number }[] | null;
}

/** Grupos del ciclo activo que el docente puede capturar. */
export async function cargarMisGrupos(db: SupabaseClient): Promise<GrupoDocente[]> {
  const { data, error } = await db
    .schema("academico")
    .from("grupos")
    .select(
      `id, clave, aula,
       materias!inner ( clave, nombre ),
       ciclos!inner ( clave, estado ),
       grupo_horarios ( dia, inicia, termina ),
       inscripciones ( count )`,
    )
    .eq("ciclos.estado", "activo")
    .order("clave");

  if (error) throw error;

  return ((data ?? []) as unknown as FilaGrupo[]).map((g) => ({
    id: g.id,
    clave: g.clave,
    aula: g.aula,
    materia: g.materias?.nombre ?? "",
    materiaClave: g.materias?.clave ?? "",
    cicloClave: g.ciclos?.clave ?? "",
    horario:
      (g.grupo_horarios ?? [])
        .sort((a, b) => a.dia - b.dia)
        .map((h) => `${DIAS[h.dia]} ${hhmm(h.inicia)}–${hhmm(h.termina)}`)
        .join(" · ") || "Sin horario",
    inscritos: g.inscripciones?.[0]?.count ?? 0,
  }));
}

/**
 * Abre (o recupera) la sesión de un grupo en una fecha. Es idempotente por la
 * llave única (grupo_id, fecha): si el docente entra dos veces el mismo día
 * —o desde dos dispositivos— obtiene la misma sesión en vez de duplicarla.
 */
export async function abrirSesion(
  db: SupabaseClient,
  grupoId: string,
  fecha: string,
): Promise<string> {
  const { data, error } = await db
    .schema("academico")
    .from("sesiones")
    .upsert({ grupo_id: grupoId, fecha }, { onConflict: "grupo_id,fecha" })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

interface FilaInscripcion {
  id: string;
  alumno_id: string;
  alumnos: { matricula: string; nombre: string } | null;
}

/**
 * Lista de la sesión: quién está inscrito, qué se marcó hoy, y cómo venían
 * de asistencia hasta antes de hoy.
 */
export async function cargarLista(
  db: SupabaseClient,
  grupoId: string,
  sesionId: string,
): Promise<FilaAsistencia[]> {
  const academico = db.schema("academico");

  const [inscripciones, deHoy, historial] = await Promise.all([
    academico
      .from("inscripciones")
      .select("id, alumno_id, alumnos!inner ( matricula, nombre )")
      .eq("grupo_id", grupoId)
      .eq("estatus", "activa"),
    academico
      .from("asistencias")
      .select("inscripcion_id, estado")
      .eq("sesion_id", sesionId),
    // Todo el historial del grupo, la sesión de hoy incluida; se descuenta
    // abajo. Traerlo de una vez evita una consulta por alumno.
    academico
      .from("asistencias")
      .select("inscripcion_id, estado, sesiones!inner ( grupo_id )")
      .eq("sesiones.grupo_id", grupoId)
      .neq("sesion_id", sesionId),
  ]);

  if (inscripciones.error) throw inscripciones.error;
  if (deHoy.error) throw deHoy.error;
  if (historial.error) throw historial.error;

  const marcadoHoy = new Map<string, EstadoAsistencia>(
    (deHoy.data ?? []).map((a) => [
      a.inscripcion_id as string,
      a.estado as EstadoAsistencia,
    ]),
  );

  // Retardo cuenta como asistencia; justificada no penaliza pero tampoco
  // suma presencia, así que se deja fuera del denominador.
  const acumulado = new Map<string, { presente: number; total: number }>();
  for (const fila of historial.data ?? []) {
    const id = fila.inscripcion_id as string;
    const estado = fila.estado as EstadoAsistencia;
    if (estado === "J") continue;
    const actual = acumulado.get(id) ?? { presente: 0, total: 0 };
    actual.total += 1;
    if (estado === "P" || estado === "R") actual.presente += 1;
    acumulado.set(id, actual);
  }

  return ((inscripciones.data ?? []) as unknown as FilaInscripcion[])
    .map((i) => {
      const previo = acumulado.get(i.id);
      return {
        inscripcionId: i.id,
        alumnoId: i.alumno_id,
        matricula: i.alumnos?.matricula ?? "",
        nombre: i.alumnos?.nombre ?? "",
        iniciales: iniciales(i.alumnos?.nombre ?? ""),
        estado: marcadoHoy.get(i.id) ?? null,
        porcentajePrevio:
          previo && previo.total > 0
            ? Math.round((previo.presente / previo.total) * 100)
            : null,
        sesionesPrevias: previo?.total ?? 0,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/**
 * Guarda la lista completa de una sesión.
 *
 * Va como un solo upsert y no fila por fila: pasar lista con mala señal en la
 * clínica es justo el escenario donde media lista se guardaría y la otra
 * media no. Así, o entra todo o no entra nada, y el docente vuelve a intentar
 * sin quedarse a medias.
 */
export async function guardarAsistencia(
  db: SupabaseClient,
  sesionId: string,
  usuarioId: string,
  filas: FilaAsistencia[],
): Promise<number> {
  const marcadas = filas.filter((f) => f.estado !== null);
  if (marcadas.length === 0) return 0;

  const { error } = await db
    .schema("academico")
    .from("asistencias")
    .upsert(
      marcadas.map((f) => ({
        sesion_id: sesionId,
        inscripcion_id: f.inscripcionId,
        estado: f.estado,
        registrado_por: usuarioId,
      })),
      { onConflict: "sesion_id,inscripcion_id" },
    );

  if (error) throw error;
  return marcadas.length;
}

export function resumir(filas: FilaAsistencia[]): ResumenAsistencia {
  const cuenta = (e: EstadoAsistencia) => filas.filter((f) => f.estado === e).length;
  return {
    presentes: cuenta("P"),
    retardos: cuenta("R"),
    ausentes: cuenta("A"),
    justificadas: cuenta("J"),
    sinMarcar: filas.filter((f) => f.estado === null).length,
  };
}
