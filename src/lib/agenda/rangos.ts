// Aritmética de rangos de tiempo. Sin I/O: se prueba directo.

export interface Rango {
  inicia_en: string;
  termina_en: string;
}

/** ¿Se traslapan dos rangos [inicio, fin)? */
export function seTraslapan(a: Rango, b: Rango): boolean {
  return (
    new Date(a.inicia_en) < new Date(b.termina_en) &&
    new Date(b.inicia_en) < new Date(a.termina_en)
  );
}

/**
 * ¿El rango candidato choca con alguno de los existentes?
 *
 * Es una advertencia, no una restricción de base de datos: empalmar dos
 * entrevistas a veces es deliberado —un entrevistador que recibe a dos
 * hermanos juntos— y bloquearlo obligaría a pelearse con el sistema.
 * Lo que no puede pasar es que nadie se entere.
 */
export function hayChoque(existentes: Rango[], candidato: Rango): boolean {
  return existentes.some((r) => seTraslapan(r, candidato));
}

/** Redondea al siguiente múltiplo de media hora. */
export function siguienteMediaHora(d: Date): Date {
  const r = new Date(d);
  r.setSeconds(0, 0);
  const m = r.getMinutes();
  r.setMinutes(m + (m === 0 ? 0 : m <= 30 ? 30 - m : 60 - m));
  return r;
}

/** ISO → valor de un <input type="datetime-local"> en hora local. */
export function aValorLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
