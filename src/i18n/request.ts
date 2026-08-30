import { getRequestConfig } from 'next-intl/server';

// El panel está en español y ése es el único diccionario que existe:
// `messages/es.json`. Antes el archivo se llamaba `en.json` pero contenía
// español, y la app pedía locale `es` — así que cargaba siempre por el
// respaldo. Funcionaba de casualidad, y la primera persona en agregar un
// `es.json` de verdad se habría preguntado por qué no cambiaba nada.
//
// Si algún día INACIME necesita otro idioma, se agrega su archivo y esto
// vuelve a resolver por locale sin más cambios.
const RESPALDO = 'es';

export default getRequestConfig(async () => {
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || RESPALDO;

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    messages = (await import(`../../messages/${RESPALDO}.json`)).default;
  }

  return { locale, messages };
});
