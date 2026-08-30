import { describe, expect, it } from "vitest";
import {
  avisoDeVentana,
  problemaDelCiclo,
  siguienteClave,
  siguienteOrden,
  type Ciclo,
  type Periodo,
} from "./ciclos";

const per = (clave: string, orden: number, extra: Partial<Periodo> = {}): Periodo => ({
  id: clave,
  ciclo_id: "c",
  clave,
  nombre: clave,
  orden,
  captura_abre: null,
  captura_cierra: null,
  ...extra,
});

const ciclo: Ciclo = {
  id: "c",
  clave: "2026-3",
  nombre: "Ciclo 2026-3",
  inicia: "2026-08-17",
  termina: "2026-12-12",
  estado: "activo",
};

describe("siguienteClave", () => {
  it("continúa la numeración existente", () => {
    expect(siguienteClave([per("P1", 1), per("P2", 2)])).toBe("P3");
  });

  it("respeta el prefijo que ya usaba la coordinación", () => {
    expect(siguienteClave([per("PAR1", 1), per("PAR2", 2)])).toBe("PAR3");
  });

  it("no repite cuando hay un hueco en la numeración", () => {
    // Si borraron P2, la siguiente debe ser P4 y no P3: P3 ya existe y
    // la clave es única por ciclo.
    expect(siguienteClave([per("P1", 1), per("P3", 2)])).toBe("P4");
  });

  it("ignora las claves no numeradas al deducir el patrón", () => {
    expect(siguienteClave([per("P1", 1), per("FINAL", 2)])).toBe("P2");
  });

  it("arranca en P1 con la lista vacía", () => {
    expect(siguienteClave([])).toBe("P1");
  });
});

describe("siguienteOrden", () => {
  it("va después del mayor, no del conteo", () => {
    expect(siguienteOrden([per("P1", 1), per("P3", 7)])).toBe(8);
  });

  it("arranca en 1", () => {
    expect(siguienteOrden([])).toBe(1);
  });
});

describe("problemaDelCiclo", () => {
  it("acepta uno bien formado", () => {
    expect(problemaDelCiclo(ciclo)).toBeNull();
  });

  it("rechaza el que termina antes de empezar", () => {
    expect(problemaDelCiclo({ ...ciclo, termina: "2026-08-01" })).toMatch(/terminar antes/);
  });

  it("rechaza la clave en blanco", () => {
    expect(problemaDelCiclo({ ...ciclo, clave: "   " })).toMatch(/clave/);
  });
});

describe("avisoDeVentana", () => {
  it("calla cuando la ventana cabe en el ciclo", () => {
    expect(
      avisoDeVentana(
        per("P1", 1, { captura_abre: "2026-09-01T00:00:00Z", captura_cierra: "2026-09-15T00:00:00Z" }),
        ciclo,
      ),
    ).toBeNull();
  });

  it("avisa si cierra antes de abrir", () => {
    expect(
      avisoDeVentana(
        per("P1", 1, { captura_abre: "2026-09-15T00:00:00Z", captura_cierra: "2026-09-01T00:00:00Z" }),
        ciclo,
      ),
    ).toMatch(/antes de abrir/);
  });

  it("avisa si cierra después del ciclo", () => {
    expect(
      avisoDeVentana(per("P1", 1, { captura_cierra: "2027-01-10T00:00:00Z" }), ciclo),
    ).toMatch(/termina el ciclo/);
  });

  it("no avisa por un periodo sin ventana configurada", () => {
    expect(avisoDeVentana(per("P1", 1), ciclo)).toBeNull();
  });
});
