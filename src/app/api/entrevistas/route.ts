import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

// GET  /api/entrevistas — lista por rango, para el calendario y para
//      avisar de empalmes antes de guardar.
// POST /api/entrevistas — agenda una entrevista con un aspirante.
//
// Va por API y no por PostgREST directo porque el estado se deriva en
// el servidor (ver más abajo) y no quiero esa regla repetida en cada
// pantalla que agende: si mañana cambia, cambia en un solo lugar.

const SELECCION =
  "*, entrevistador:entrevistadores(*), sala:salas_entrevista(*), tipo:tipos_entrevista(*), contact:contacts(*), deal:deals(id, title)";

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole("viewer");
    const url = new URL(request.url);
    const dealId = url.searchParams.get("deal_id");
    const contactId = url.searchParams.get("contact_id");
    const entrevistadorId = url.searchParams.get("entrevistador_id");
    const salaId = url.searchParams.get("sala_id");
    const desde = url.searchParams.get("desde");
    const hasta = url.searchParams.get("hasta");

    let q = supabase
      .from("entrevistas")
      .select(SELECCION)
      .eq("account_id", accountId)
      .order("inicia_en", { ascending: true });

    if (dealId) q = q.eq("deal_id", dealId);
    if (contactId) q = q.eq("contact_id", contactId);
    if (entrevistadorId) q = q.eq("entrevistador_id", entrevistadorId);
    if (salaId) q = q.eq("sala_id", salaId);
    if (desde) q = q.gte("termina_en", desde);
    if (hasta) q = q.lte("inicia_en", hasta);
    // Una entrevista cancelada libera el hueco: no cuenta para empalmes.
    if (entrevistadorId || salaId) q = q.neq("estado", "cancelada");

    const { data, error } = await q;
    if (error) {
      console.error("[entrevistas GET]", error);
      return NextResponse.json({ error: "No se pudo cargar la agenda." }, { status: 500 });
    }
    return NextResponse.json({ entrevistas: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const body = await request.json().catch(() => ({}));

    if (!body.inicia_en || !body.termina_en) {
      return NextResponse.json(
        { error: "Faltan la hora de inicio y la de fin." },
        { status: 400 },
      );
    }
    if (new Date(body.termina_en) <= new Date(body.inicia_en)) {
      return NextResponse.json(
        { error: "La entrevista no puede terminar antes de empezar." },
        { status: 400 },
      );
    }

    // Una entrevista está confirmada cuando el aspirante ya sabe con
    // quién y dónde se presenta. Mientras falte cualquiera de las dos
    // cosas queda pendiente, y así se ve distinta en el calendario:
    // el hueco existe, pero todavía nadie puede avisarle.
    const entrevistadorId = body.entrevistador_id || null;
    const salaId = body.sala_id || null;
    const estado = entrevistadorId && salaId ? "confirmada" : "pendiente";

    const { data, error } = await supabase
      .from("entrevistas")
      .insert({
        account_id: accountId,
        deal_id: body.deal_id || null,
        contact_id: body.contact_id || null,
        entrevistador_id: entrevistadorId,
        sala_id: salaId,
        tipo_id: body.tipo_id || null,
        inicia_en: body.inicia_en,
        termina_en: body.termina_en,
        estado,
        notas: body.notas || null,
        creada_por: userId,
      })
      .select(SELECCION)
      .single();

    if (error) {
      console.error("[entrevistas POST]", error);
      return NextResponse.json({ error: "No se pudo agendar." }, { status: 500 });
    }
    return NextResponse.json({ entrevista: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
