import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Alta de usuarios del expediente escolar.
//
// Vive en el servidor porque crear una cuenta de acceso exige la llave de
// servicio, que nunca debe llegar al navegador.
//
// Tres comprobaciones, en este orden:
//   1. Quien llama tiene sesión.
//   2. Su rol escolar es `direccion`. Se lee de la base con SU sesión, no de
//      lo que mande el cliente.
//   3. El correo corresponde al dominio del rol. Esto además lo impone un
//      disparador en la base; aquí se adelanta para devolver un mensaje útil
//      en vez de un error de Postgres.

export const dynamic = "force-dynamic";

const ROLES = [
  "direccion",
  "control_escolar",
  "finanzas",
  "coordinacion",
  "docente",
  "alumno",
] as const;
type Rol = (typeof ROLES)[number];

interface Cuerpo {
  rol?: string;
  nombre?: string;
  /** Para personal: el correo completo. Para alumnos: la matrícula. */
  identificador?: string;
  password?: string;
  correoPersonal?: string;
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
  if (!user) {
    return NextResponse.json({ error: "Inicia sesión." }, { status: 401 });
  }

  // El rol se lee con la sesión de quien llama, sujeto a RLS. Confiar en un
  // rol enviado por el cliente sería confiar en el navegador.
  const { data: yo } = await db
    .schema("academico")
    .from("usuarios")
    .select("rol")
    .eq("id", user.id)
    .eq("activo", true)
    .maybeSingle();

  if (yo?.rol !== "direccion") {
    return NextResponse.json(
      { error: "Sólo dirección puede dar de alta usuarios." },
      { status: 403 },
    );
  }

  const cuerpo = (await request.json().catch(() => ({}))) as Cuerpo;
  const rol = cuerpo.rol as Rol | undefined;
  const nombre = cuerpo.nombre?.trim();
  const identificador = cuerpo.identificador?.trim().toLowerCase();
  const password = cuerpo.password;

  if (!rol || !ROLES.includes(rol)) {
    return NextResponse.json({ error: "Elige un rol válido." }, { status: 400 });
  }
  if (!nombre) {
    return NextResponse.json({ error: "El nombre es obligatorio." }, { status: 400 });
  }
  if (!identificador) {
    return NextResponse.json(
      { error: rol === "alumno" ? "Falta la matrícula." : "Falta el correo." },
      { status: 400 },
    );
  }
  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 8 caracteres." },
      { status: 400 },
    );
  }

  const admin = servicio();

  const { data: dom } = await admin
    .schema("academico")
    .from("dominios_permitidos")
    .select("dominio")
    .eq("rol", rol)
    .maybeSingle();
  const dominio = dom?.dominio as string | undefined;

  // Para el alumno se arma el correo sintético a partir de la matrícula; para
  // el personal se exige que el correo ya venga con el dominio institucional.
  let correo: string;
  if (rol === "alumno") {
    if (!/^[a-z0-9._-]+$/.test(identificador)) {
      return NextResponse.json(
        { error: "La matrícula sólo admite letras, números, punto, guion y guion bajo." },
        { status: 400 },
      );
    }
    correo = `${identificador}@${dominio ?? "alumnos.inacime.com"}`;
  } else {
    correo = identificador;
    if (dominio && !correo.endsWith(`@${dominio}`)) {
      return NextResponse.json(
        { error: `El personal entra con un correo @${dominio}. Recibido: ${correo}` },
        { status: 400 },
      );
    }
  }

  // Se crea confirmado: el alta la hace dirección en persona, así que no hay
  // a quién mandarle un correo de verificación — y el buzón sintético del
  // alumno no existe.
  const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
    email: correo,
    password,
    email_confirm: true,
    user_metadata: { full_name: nombre },
  });

  if (errCrear || !creado?.user) {
    const dup = errCrear?.message?.toLowerCase().includes("already");
    return NextResponse.json(
      {
        error: dup
          ? `Ya existe una cuenta con ${correo}.`
          : (errCrear?.message ?? "No se pudo crear la cuenta."),
      },
      { status: dup ? 409 : 400 },
    );
  }

  const uid = creado.user.id;

  const { error: errRol } = await admin
    .schema("academico")
    .from("usuarios")
    .insert({ id: uid, nombre, rol });

  if (errRol) {
    // El disparador de dominio pudo rechazarlo. Se deshace la cuenta de
    // acceso para no dejar un usuario que puede iniciar sesión pero no
    // existe en el expediente — un fantasma difícil de diagnosticar después.
    await admin.auth.admin.deleteUser(uid);
    return NextResponse.json({ error: errRol.message }, { status: 400 });
  }

  return NextResponse.json({ id: uid, correo, rol, nombre }, { status: 201 });
}
