import type { SupabaseClient } from "@supabase/supabase-js";

// Puente entre el CRM y el expediente escolar.
//
// Un aspirante que gana su negocio en el embudo todavía no es alumno: alguien
// tiene que asignarle matrícula, plan y cuenta de acceso. Antes eso dependía
// de que admisiones se acordara de avisar. Aquí el sistema lo empuja: la
// pantalla lista los ganados que aún no tienen expediente.
//
// El cruce se hace por `academico.alumnos.crm_contact_id`, que apunta a
// `public.contacts.id` SIN llave foránea — los dos esquemas se versionan por
// separado y una llave los ataría.

export interface AspiranteGanado {
  dealId: string;
  contactId: string;
  nombre: string;
  telefono: string;
  correo: string | null;
  /** El campo `company` del CRM guarda el programa de interés. */
  programa: string | null;
  valor: number | null;
  ganadoEn: string;
}

/**
 * Aspirantes con negocio ganado que todavía no existen como alumno.
 *
 * Son dos consultas y un descarte en memoria en vez de un `not.in` con
 * subconsulta: PostgREST no cruza esquemas, y el volumen de un ciclo —
 * decenas, no miles — no justifica una vista.
 */
export async function cargarPendientesDeAlta(
  db: SupabaseClient,
): Promise<AspiranteGanado[]> {
  const [deals, alumnos, config] = await Promise.all([
    db
      .from("deals")
      .select(
        `id, value, updated_at, contact_id, status, stage_id,
         contacts!inner ( id, name, phone, email, company )`,
      )
      .order("updated_at", { ascending: false }),
    db.schema("academico").from("alumnos").select("crm_contact_id"),
    db.schema("academico").from("config_admisiones").select("stage_inscrito_id"),
  ]);

  if (deals.error) throw deals.error;
  if (alumnos.error) throw alumnos.error;

  // Un aspirante cuenta como inscrito por CUALQUIERA de dos caminos: que
  // alguien lo marcara como ganado, o que su tarjeta esté en la columna que
  // la institución designó como inscripción.
  //
  // Hacen falta los dos porque en WACRM son independientes: arrastrar una
  // tarjeta no cambia el estado del negocio. Mirar sólo el estado perdería a
  // quien admisiones movió de columna sin abrir la ficha — y ese alumno no se
  // notaría hasta que llame preguntando por qué no puede entrar.
  const etapasInscrito = new Set(
    (config.data ?? []).map((c) => c.stage_inscrito_id as string),
  );

  const yaSonAlumnos = new Set(
    (alumnos.data ?? [])
      .map((a) => a.crm_contact_id as string | null)
      .filter(Boolean) as string[],
  );

  interface Fila {
    id: string;
    value: number | null;
    updated_at: string;
    contact_id: string;
    status: string;
    stage_id: string;
    contacts: {
      id: string;
      name: string | null;
      phone: string;
      email: string | null;
      company: string | null;
    } | null;
  }

  return ((deals.data ?? []) as unknown as Fila[])
    .filter(
      (d) =>
        d.contacts &&
        (d.status === "won" || etapasInscrito.has(d.stage_id)) &&
        !yaSonAlumnos.has(d.contacts.id),
    )
    .map((d) => ({
      dealId: d.id,
      contactId: d.contacts!.id,
      nombre: d.contacts!.name ?? "Sin nombre",
      telefono: d.contacts!.phone,
      correo: d.contacts!.email,
      programa: d.contacts!.company,
      valor: d.value,
      ganadoEn: d.updated_at,
    }));
}

/** Cuántos esperan alta. Alimenta la insignia del menú. */
export async function contarPendientesDeAlta(db: SupabaseClient): Promise<number> {
  try {
    return (await cargarPendientesDeAlta(db)).length;
  } catch {
    // La insignia no vale una pantalla rota: si falla, no se muestra.
    return 0;
  }
}

export interface Plan {
  id: string;
  clave: string;
  programa: string;
}

export async function cargarPlanes(db: SupabaseClient): Promise<Plan[]> {
  const { data, error } = await db
    .schema("academico")
    .from("planes_estudio")
    .select("id, clave, programas!inner ( nombre )")
    .order("clave");
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id as string,
    clave: p.clave as string,
    programa: (p.programas as unknown as { nombre: string })?.nombre ?? "",
  }));
}

export interface EtapaEmbudo {
  id: string;
  nombre: string;
  pipelineId: string;
  pipelineNombre: string;
}

/** Etapas de todos los embudos, para elegir cuál significa inscripción. */
export async function cargarEtapas(db: SupabaseClient): Promise<EtapaEmbudo[]> {
  const { data, error } = await db
    .from("pipeline_stages")
    .select("id, name, pipeline_id, pipelines!inner ( name )")
    .order("position");
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id as string,
    nombre: s.name as string,
    pipelineId: s.pipeline_id as string,
    pipelineNombre:
      (s.pipelines as unknown as { name: string })?.name ?? "",
  }));
}

export async function cargarConfigInscrito(
  db: SupabaseClient,
): Promise<Record<string, string>> {
  const { data } = await db
    .schema("academico")
    .from("config_admisiones")
    .select("pipeline_id, stage_inscrito_id");
  return Object.fromEntries(
    (data ?? []).map((c) => [
      c.pipeline_id as string,
      c.stage_inscrito_id as string,
    ]),
  );
}

export async function guardarConfigInscrito(
  db: SupabaseClient,
  pipelineId: string,
  stageId: string,
): Promise<void> {
  const { error } = await db
    .schema("academico")
    .from("config_admisiones")
    .upsert(
      { pipeline_id: pipelineId, stage_inscrito_id: stageId, actualizado_en: new Date().toISOString() },
      { onConflict: "pipeline_id" },
    );
  if (error) throw error;
}
