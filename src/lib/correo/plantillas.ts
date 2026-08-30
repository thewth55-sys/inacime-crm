// Plantillas de correo transaccional.
//
// HTML a mano, con estilos en línea y tablas: los clientes de correo no
// entienden hojas de estilo externas, y Outlook ignora buena parte de flexbox.
// Es feo comparado con la aplicación, y es lo que llega bien a todos lados.
//
// Sin imágenes remotas: la mayoría de los clientes las bloquea por omisión, y
// un correo que llega sin logotipo se ve peor que uno que nunca lo tuvo.

const AZUL = "#27348B";
const CIAN = "#00C1F4";
const GRIS = "#6b7089";

function envoltura(contenido: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#eef0f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <tr><td style="background:${AZUL};padding:22px 28px;">
    <div style="font-size:19px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">INACIME</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.65);margin-top:2px;">Portal académico</div>
  </td></tr>
  <tr><td style="padding:28px;">${contenido}</td></tr>
  <tr><td style="padding:18px 28px;background:#f8f9fd;border-top:1px solid #e6e9f3;">
    <div style="font-size:11.5px;color:#a3a8bd;line-height:1.6;">
      Este mensaje se envió de forma automática desde el Portal académico de
      INACIME. No respondas a esta dirección.
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function boton(url: string, texto: string): string {
  // Botón como tabla, no como <a> con padding: Outlook recorta el relleno de
  // los enlaces y el botón sale del tamaño del texto.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td style="background:${CIAN};border-radius:12px;">
      <a href="${url}" style="display:inline-block;padding:15px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${texto}</a>
    </td></tr></table>`;
}

export interface DatosRecuperacion {
  nombre: string;
  /** Con lo que la persona entra: matrícula o correo institucional. */
  identificador: string;
  url: string;
  /** Horas que dura el enlace. */
  vigencia: number;
}

export function plantillaRecuperacion(d: DatosRecuperacion) {
  const html = envoltura(`
    <div style="font-size:21px;font-weight:700;color:${AZUL};line-height:1.3;">
      Restablece tu contraseña
    </div>
    <p style="font-size:15px;color:#2B2B3A;line-height:1.6;margin:14px 0 0;">
      Hola ${escapar(d.nombre)}: recibimos una solicitud para cambiar la
      contraseña de tu acceso al Portal académico.
    </p>
    <p style="font-size:15px;color:#2B2B3A;line-height:1.6;margin:14px 0 0;">
      Entras con <strong style="color:${AZUL};">${escapar(d.identificador)}</strong>.
    </p>
    ${boton(d.url, "Elegir contraseña nueva")}
    <p style="font-size:13px;color:${GRIS};line-height:1.6;margin:0;">
      El enlace vence en ${d.vigencia} horas y sirve una sola vez.
    </p>
    <p style="font-size:13px;color:${GRIS};line-height:1.6;margin:14px 0 0;">
      Si no pediste el cambio, ignora este mensaje: tu contraseña sigue igual.
      Si esto se repite, avisa a Servicios Escolares.
    </p>
    <p style="font-size:12px;color:#a3a8bd;line-height:1.6;margin:20px 0 0;word-break:break-all;">
      ¿No funciona el botón? Copia esta dirección en tu navegador:<br>${escapar(d.url)}
    </p>
  `);

  const texto = [
    `Hola ${d.nombre}:`,
    "",
    "Recibimos una solicitud para cambiar la contraseña de tu acceso al Portal académico de INACIME.",
    `Entras con ${d.identificador}.`,
    "",
    "Elige una contraseña nueva aquí:",
    d.url,
    "",
    `El enlace vence en ${d.vigencia} horas y sirve una sola vez.`,
    "",
    "Si no pediste el cambio, ignora este mensaje: tu contraseña sigue igual.",
  ].join("\n");

  return { asunto: "Restablece tu contraseña · INACIME", html, texto };
}

/** El nombre viene de la base y puede traer caracteres que rompan el HTML. */
function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
