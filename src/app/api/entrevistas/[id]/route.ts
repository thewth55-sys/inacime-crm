import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

const CAMPOS_EDITABLES = [
  "entrevistador_id",
  "sala_id",
  "tipo_id",
  "inicia_en",
  "termina_en",
  "estado",
  "notas",
] as const;

const SELECCION =
  "*, entrevistador:entrevistadores(*), sala:salas_entrevista(*), tipo:tipos_entrevista(*), contact:contacts(*), deal:deals(id, title)";

/**
 * PATCH /api/entrevistas/[id] — el único punto por donde se confirma,
 * reprograma o cancela. Arrastrar en el calendario, cambiar la hora en
 * el editor y marcar "no asistió" pasan todos por aquí, para que la
 * regla de auto-confirmación no dependa de qué pantalla se usó.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const cambios: Record<string, unknown> = {};
    for (const campo of CAMPOS_EDITABLES) {
      if (campo in body) cambios[campo] = body[campo] ?? null;
    }
    if (Object.keys(cambios).length === 0) {
      return NextResponse.json({ error: "No hay nada que actualizar." }, { status: 400 });
    }

    const { data: actual, error: errLectura } = await supabase
      .from("entrevistas")
      .select("entrevistador_id, sala_id, inicia_en, termina_en, estado")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (errLectura || !actual) {
      return NextResponse.json({ error: "Esa entrevista no existe." }, { status: 404 });
    }

    // El rango se valida contra la mezcla de lo que ya había y lo que
    // llega: arrastrar en el calendario manda las dos horas, pero editar
    // sólo el inicio manda una, y sin esto se podría dejar guardada una
    // entrevista que termina antes de empezar.
    const inicia = (cambios.inicia_en as string) ?? actual.inicia_en;
    const termina = (cambios.termina_en as string) ?? actual.termina_en;
    if (new Date(termina) <= new Date(inicia)) {
      return NextResponse.json(
        { error: "La entrevista no puede terminar antes de empezar." },
        { status: 400 },
      );
    }

    // Se confirma sola en cuanto ya hay entrevistador y sala, salvo que
    // quien edita haya elegido explícitamente otro estado.
    if (!("estado" in cambios)) {
      const ent = "entrevistador_id" in cambios ? cambios.entrevistador_id : actual.entrevistador_id;
      const sala = "sala_id" in cambios ? cambios.sala_id : actual.sala_id;
      if (ent && sala && actual.estado === "pendiente") cambios.estado = "confirmada";
    }

    const { data, error } = await supabase
      .from("entrevistas")
      .update(cambios)
      .eq("id", id)
      .eq("account_id", accountId)
      .select(SELECCION)
      .single();

    if (error) {
      console.error("[entrevistas PATCH]", error);
      return NextResponse.json({ error: "No se pudo actualizar." }, { status: 500 });
    }
    return NextResponse.json({ entrevista: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { id } = await params;

    const { error } = await supabase
      .from("entrevistas")
      .delete()
      .eq("id", id)
      .eq("account_id", accountId);

    if (error) {
      console.error("[entrevistas DELETE]", error);
      return NextResponse.json({ error: "No se pudo borrar." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
