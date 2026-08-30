import { describe, expect, it } from "vitest";
import { anchoBarra, fechaLegible, porcentajeOcupacion } from "./resumen";

describe("porcentajeOcupacion", () => {
  it("redondea a entero", () => {
    expect(porcentajeOcupacion({ lugares: 3, ocupados: 2 })).toBe(67);
  });

  it("devuelve null sin lugares en vez de dividir entre cero", () => {
    // Pasa al arrancar un ciclo, antes de abrir grupos. Un NaN pintado
    // como "NaN%" en el panel de dirección se lee como sistema roto.
    expect(porcentajeOcupacion({ lugares: 0, ocupados: 0 })).toBeNull();
  });

  it("no recorta por encima de 100 — sobrecupo es un dato real", () => {
    expect(porcentajeOcupacion({ lugares: 10, ocupados: 12 })).toBe(120);
  });
});

describe("anchoBarra", () => {
  const programas = [
    { nombre: "Odontología", alumnos: 312 },
    { nombre: "Enfermería", alumnos: 224 },
    { nombre: "Especialidades", alumnos: 30 },
  ];

  it("el mayor llena la barra", () => {
    expect(anchoBarra(312, programas)).toBe("100%");
  });

  it("mide contra el mayor, no contra el total", () => {
    // 224/312 = 72%. Contra el total (566) sería 40% y la gráfica
    // dejaría de servir para comparar programas entre sí.
    expect(anchoBarra(224, programas)).toBe("72%");
  });

  it("deja un mínimo visible al programa más chico", () => {
    expect(anchoBarra(1, programas)).toBe("2%");
  });

  it("no divide entre cero con la lista vacía", () => {
    expect(anchoBarra(0, [])).toBe("0%");
  });
});

describe("fechaLegible", () => {
  // Regresión: `ciclos.inicia` llega como "2026-08-17". Leerlo con
  // `new Date()` da medianoche UTC, que en hora de México es el 16 a las
  // 18:00, y el panel decía que el ciclo empezó un día antes.
  it("no corre el día en una fecha sin hora", () => {
    expect(fechaLegible("2026-08-17")).toBe("17 de agosto de 2026");
  });

  it("respeta el fin de mes", () => {
    expect(fechaLegible("2026-12-31")).toBe("31 de diciembre de 2026");
  });

  it("deja pasar un timestamptz, que sí trae zona", () => {
    expect(fechaLegible("2026-08-17T18:00:00Z")).toBe("17 de agosto de 2026");
  });
});
