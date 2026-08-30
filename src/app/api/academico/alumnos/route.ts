import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Alta de alumno: convierte a un aspirante ganado en expediente.
//
// Son cuatro escrituras que deben ocurrir juntas:
//   1. cuenta de acceso  (<matricula>@alumnos.inacime.com)
//   2. academico.usuarios con rol alumno
//   3. academico.alumnos con su plan y el vínculo al aspirante del CRM
//   4. inscripciones a los grupos elegidos
//
// PostgREST no da transacciones entre llamadas, así que si algo falla a mitad
// se deshace lo ya creado. Sin eso quedarían fantasmas: una cuenta que puede
// iniciar sesión sin expediente, o un alumno sin acceso. Ambos son difíciles
// de diagnosticar semanas después, cuando nadie recuerda el alta.

export const dynamic = "force-dynamic";

const DOMINIO_ALUMNOS = "alumnos.inacime.com";

interface Cuerpo {
  matricula?: string;
  nombre?: string;
  planId?: string;
  password?: string;
  correoPersonal?: string;
  telefono?: string;
  curp?: string;
  /** `public.contacts.id` del aspirante que se convierte. */
  contactId?: string;
  /** Grupos del ciclo activo a los que queda inscrito. */
  grupoIds?: string[];
}

function servicio() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(request: Request) {
  const db = await createServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Inicia sesión." }, { status: 401 });

  const { data: yo } = await db
    .schema("academico")
    .from("usuarios")
    .select("rol")
    .eq("id", user.id)
    .eq("activo", true)
    .maybeSingle();

  if (!yo || !["direccion", "control_escolar"].includes(yo.rol as string)) {
    return NextResponse.json(
      { error: "Sólo dirección y control escolar dan de alta alumnos." },
      { status: 403 },
    );
  }

  const c = (await request.json().catch(() => ({}))) as Cuerpo;
  const matricula = c.matricula?.trim().toLowerCase();
  const nombre = c.nombre?.trim();
  const planId = c.planId;
  const password = c.password;

  if (!matricula || !/^[a-z0-9._-]+$/.test(matricula)) {
    return NextResponse.json(
      { error: "La matrícula sólo admite letras, números, punto, guion y guion bajo." },
      { status: 400 },
    );
  }
  if (!nombre) return NextResponse.json({ error: "Falta el nombre." }, { status: 400 });
  if (!planId) return NextResponse.json({ error: "Elige el plan de estudios." }, { status: 400 });
  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 8 caracteres." },
      { status: 400 },
    );
  }

  const admin = servicio();
  const academico = admin.schema("academico");
  const correo = `${matricula}@${DOMINIO_ALUMNOS}`;

  // Se comprueba antes de crear la cuenta: si la matrícula ya existe, no tiene
  // caso dejar una cuenta huérfana que luego hay que borrar.
  const { data: repetida } = await academico
    .from("alumnos")
    .select("id")
    .eq("matricula", matricula)
    .maybeSingle();
  if (repetida) {
    return NextResponse.json(
      { error: `Ya hay un alumno con la matrícula ${matricula}.` },
      { status: 409 },
    );
  }

  // --- 1. cuenta de acceso ---
  const { data: creado, error: errAuth } = await admin.auth.admin.createUser({
    email: correo,
    password,
    email_confirm: true,
    user_metadata: { full_name: nombre },
  });
  if (errAuth || !creado?.user) {
    const dup = errAuth?.message?.toLowerCase().includes("already");
    return NextResponse.json(
      { error: dup ? `Ya existe una cuenta con ${correo}.` : (errAuth?.message ?? "No se pudo crear la cuenta.") },
      { status: dup ? 409 : 400 },
    );
  }
  const uid = creado.user.id;

  // A partir de aquí, cualquier fallo deshace lo anterior.
  const deshacer = async () => {
    await academico.from("alumnos").delete().eq("usuario_id", uid);
    await academico.from("usuarios").delete().eq("id", uid);
    await admin.auth.admin.deleteUser(uid);
  };

  // --- 2. rol escolar ---
  const { error: errRol } = await academico
    .from("usuarios")
    .insert({ id: uid, nombre, rol: "alumno" });
  if (errRol) {
    await deshacer();
    return NextResponse.json({ error: errRol.message }, { status: 400 });
  }

  // --- 3. expediente ---
  const { data: alumno, error: errAlumno } = await academico
    .from("alumnos")
    .insert({
      usuario_id: uid,
      matricula,
      nombre,
      plan_id: planId,
      curp: c.curp?.trim().toUpperCase() || null,
      correo_personal: c.correoPersonal?.trim().toLowerCase() || null,
      telefono: c.telefono?.trim() || null,
      crm_contact_id: c.contactId ?? null,
    })
    .select("id")
    .single();
  if (errAlumno || !alumno) {
    await deshacer();
    return NextResponse.json(
      { error: errAlumno?.message ?? "No se pudo crear el expediente." },
      { status: 400 },
    );
  }

  // --- 4. inscripciones ---
  const grupos = (c.grupoIds ?? []).filter(Boolean);
  if (grupos.length > 0) {
    const { error: errIns } = await academico
      .from("inscripciones")
      .insert(grupos.map((g) => ({ grupo_id: g, alumno_id: alumno.id })));
    if (errIns) {
      await deshacer();
      return NextResponse.json(
        { error: `El alumno no se dio de alta: ${errIns.message}` },
        { status: 400 },
      );
    }
  }

  return NextResponse.json(
    { id: alumno.id, matricula, correo, inscritoEn: grupos.length },
    { status: 201 },
  );
}
