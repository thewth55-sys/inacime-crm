"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { contarPendientesDeAlta } from "@/lib/academico/inscripcion";
import type { RolAcademico } from "@/hooks/use-rol-academico";

const PUEDEN_DAR_ALTA: RolAcademico[] = ["direccion", "control_escolar"];

/**
 * Cuántos aspirantes ganados esperan matrícula. Alimenta la insignia del menú.
 *
 * Es lo que convierte "avísale a control escolar cuando ganes uno" en algo que
 * el sistema empuja solo: la insignia no se va hasta que el expediente existe.
 *
 * Sólo consulta para quien puede actuar. Para un docente sería una cifra que
 * no puede atender, y una consulta que RLS rechazaría de todos modos.
 */
export function usePendientesDeAlta(rol: RolAcademico | null): number {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!rol || !PUEDEN_DAR_ALTA.includes(rol)) {
      return;
    }
    let cancelado = false;

    void contarPendientesDeAlta(createClient()).then((n) => {
      if (!cancelado) setTotal(n);
    });

    return () => {
      cancelado = true;
    };
  }, [rol]);

  return total;
}
