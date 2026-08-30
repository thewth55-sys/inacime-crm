import { Resend } from "resend";

// Correo transaccional por Resend.
//
// Se usa en vez del correo integrado de Supabase por dos razones: las
// plantillas de Supabase son genéricas y no se pueden marcar como INACIME, y
// su envío está limitado por hora — suficiente para probar, no para una
// institución que manda avisos a cientos de alumnos.
//
// Sólo servidor: la llave de Resend nunca debe llegar al navegador.

let cliente: Resend | null = null;

function resend(): Resend {
  if (!process.env.RESEND_API_KEY) {
    throw new Error(
      "Falta RESEND_API_KEY. El correo transaccional no está configurado.",
    );
  }
  cliente ??= new Resend(process.env.RESEND_API_KEY);
  return cliente;
}

/** Remitente. Su dominio debe estar verificado en Resend o los envíos rebotan. */
function remitente(): string {
  return process.env.CORREO_REMITENTE ?? "INACIME <no-responder@inacime.com>";
}

export interface Envio {
  para: string;
  asunto: string;
  html: string;
  /** Alternativa en texto plano. Sin ella, varios filtros suben el puntaje de spam. */
  texto: string;
}

export async function enviarCorreo({ para, asunto, html, texto }: Envio) {
  const { data, error } = await resend().emails.send({
    from: remitente(),
    to: [para],
    subject: asunto,
    html,
    text: texto,
  });
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/** ¿Está configurado el correo? Sirve para avisar en vez de fallar al enviar. */
export function correoConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}
