import { describe, expect, it } from "vitest";
import { aValorLocal, hayChoque, seTraslapan, siguienteMediaHora } from "./rangos";

const r = (inicia_en: string, termina_en: string) => ({ inicia_en, termina_en });

describe("seTraslapan", () => {
  it("detecta traslape parcial", () => {
    expect(
      seTraslapan(
        r("2026-09-01T10:00:00Z", "2026-09-01T11:00:00Z"),
        r("2026-09-01T10:30:00Z", "2026-09-01T11:30:00Z"),
      ),
    ).toBe(true);
  });

  it("no cuenta como traslape que uno termine donde el otro empieza", () => {
    // El rango es [inicio, fin): dos entrevistas seguidas de 10 a 11 y de
    // 11 a 12 no chocan, que es justo como se agenda una tras otra.
    expect(
      seTraslapan(
        r("2026-09-01T10:00:00Z", "2026-09-01T11:00:00Z"),
        r("2026-09-01T11:00:00Z", "2026-09-01T12:00:00Z"),
      ),
    ).toBe(false);
  });

  it("detecta contención completa", () => {
    expect(
      seTraslapan(
        r("2026-09-01T09:00:00Z", "2026-09-01T13:00:00Z"),
        r("2026-09-01T10:00:00Z", "2026-09-01T10:30:00Z"),
      ),
    ).toBe(true);
  });
});

describe("hayChoque", () => {
  it("es falso con la lista vacía", () => {
    expect(hayChoque([], r("2026-09-01T10:00:00Z", "2026-09-01T11:00:00Z"))).toBe(false);
  });

  it("basta con que choque uno", () => {
    const existentes = [
      r("2026-09-01T08:00:00Z", "2026-09-01T09:00:00Z"),
      r("2026-09-01T10:30:00Z", "2026-09-01T11:00:00Z"),
    ];
    expect(hayChoque(existentes, r("2026-09-01T10:00:00Z", "2026-09-01T11:00:00Z"))).toBe(true);
  });
});

describe("siguienteMediaHora", () => {
  it("deja en paz una hora en punto", () => {
    expect(siguienteMediaHora(new Date("2026-09-01T10:00:00")).getMinutes()).toBe(0);
  });

  it("sube a :30", () => {
    expect(siguienteMediaHora(new Date("2026-09-01T10:07:00")).getMinutes()).toBe(30);
  });

  it("sube a la hora siguiente", () => {
    const d = siguienteMediaHora(new Date("2026-09-01T10:41:00"));
    expect(d.getHours()).toBe(11);
    expect(d.getMinutes()).toBe(0);
  });

  it("limpia segundos y milisegundos", () => {
    const d = siguienteMediaHora(new Date("2026-09-01T10:07:45.123"));
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });
});

describe("aValorLocal", () => {
  it("rellena con ceros a la izquierda", () => {
    // Se construye en hora local a propósito: el <input datetime-local>
    // muestra hora local, y convertir a UTC aquí correría la cita.
    const iso = new Date(2026, 8, 3, 9, 5).toISOString();
    expect(aValorLocal(iso)).toBe("2026-09-03T09:05");
  });
});
