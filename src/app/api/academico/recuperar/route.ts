import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enviarCorreo, correoConfigurado } from "@/lib/correo/enviar";
import { plantillaRecuperacion } from "@/lib/correo/plantillas";

// Restablecimiento de contraseña.
//
// Por qué no se usa el de Supabase tal cual: la cuenta de un alumno es
// <matricula>@alumnos.inacime.com, un buzón que no existe. Mandarle ahí el
// enlace es mandarlo al vacío. Aquí se genera el enlace con la API de
// administración y se envía por Resend al correo REAL que Servicios Escolares
// tiene registrado — el del alumno o el de su tutor.
//
// Para el personal el correo institucional sí recibe, pero se usa el mismo
// camino a propósito: una sola plantilla, un solo registro de envíos, y nada
// que dependa de la configuración de correo de Supabase.
//
// Contra la enumeración: la respuesta es SIEMPRE la misma, exista o no la
// cuenta y tenga o no correo de contacto. Sin eso, este endpoint se vuelve un
// verificador de matrículas para cualquiera.

export const dynamic = "force-dynamic";

const VIGENCIA_HORAS = 24;
const DOMINIO_ALUMNOS = "alumnos.inacime.com";

// La misma para todos los casos, incluido el error. Nunca se le dice a quien
// llama si acertó.
const RESPUESTA = {
  mensaje:
    "Si la cuenta existe y tiene un correo de contacto registrado, te enviamos las instrucciones. Revisa tu bandeja y la carpeta de correo no deseado.",
};

function servicio() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(request: Request) {
  const { identificador } = (await request
    .json()
    .catch(() => ({}))) as { identificador?: string };

  const entrada = identificador?.trim().toLowerCase();
  if (!entrada) {
    return NextResponse.json({ error: "Escribe tu matrícula o correo." }, { status: 400 });
  }

  if (!correoConfigurado()) {
    // Único caso en que sí se distingue: es un problema de configuración, no
    // un dato del usuario, y callarlo dejaría a soporte adivinando.
    console.error("[recuperar] falta RESEND_API_KEY");
    return NextResponse.json(
      { error: "El envío de correo no está configurado. Avisa a sistemas." },
      { status: 503 },
    );
  }

  // Todo lo que sigue puede fallar sin que se note desde fuera.
  void procesar(entrada).catch((e) =>
    console.error("[recuperar] falló para una solicitud:", (e as Error).message),
  );

  return NextResponse.json(RESPUESTA);
}

async function procesar(entrada: string) {
  const admin = servicio();

  const correoAcceso = entrada.includes("@")
    ? entrada
    : `${entrada}@${DOMINIO_ALUMNOS}`;

  // A dónde se manda de verdad. Para el personal, su mismo correo; para el
  // alumno, el personal que tenga registrado.
  let destino = correoAcceso;
  let nombre = "";

  if (correoAcceso.endsWith(`@${DOMINIO_ALUMNOS}`)) {
    const matricula = correoAcceso.split("@")[0];
    const { data } = await admin
      .schema("academico")
      .from("alumnos")
      .select("nombre, correo_personal")
      .eq("matricula", matricula)
      .maybeSingle();

    if (!data?.correo_personal) {
      // Sin correo de contacto no hay a dónde mandar. El alumno tiene que
      // pasar por Servicios Escolares — que es el control de identidad que
      // corresponde cuando no hay otro canal.
      console.warn(`[recuperar] ${matricula} sin correo_personal registrado`);
      return;
    }
    destino = data.correo_personal as string;
    nombre = (data.nombre as string) ?? "";
  } else {
    const { data } = await admin
      .schema("academico")
      .from("usuarios")
      .select("nombre, id")
      .limit(1);
    nombre = (data?.[0]?.nombre as string) ?? "";
  }

  const sitio =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

  const { data: enlace, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: correoAcceso,
    options: { redirectTo: `${sitio}/reset-password` },
  });

  if (error || !enlace?.properties?.action_link) {
    // Cuenta inexistente incluida. No se distingue desde fuera.
    console.warn(`[recuperar] sin enlace para ${correoAcceso}: ${error?.message}`);
    return;
  }

  const { asunto, html, texto } = plantillaRecuperacion({
    nombre: nombre || "estudiante",
    identificador: entrada,
    url: enlace.properties.action_link,
    vigencia: VIGENCIA_HORAS,
  });

  await enviarCorreo({ para: destino, asunto, html, texto });
  console.info(`[recuperar] enviado para ${correoAcceso}`);
}
