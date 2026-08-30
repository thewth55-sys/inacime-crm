"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type RolAcademico =
  | "direccion"
  | "control_escolar"
  | "finanzas"
  | "coordinacion"
  | "docente"
  | "alumno";

/** Quienes ven el expediente completo, no sólo lo suyo. */
export const ROLES_STAFF: RolAcademico[] = [
  "direccion",
  "control_escolar",
  "coordinacion",
];

/** Quienes pueden cambiar el reglamento de evaluación. */
export const ROLES_REGLAMENTO: RolAcademico[] = ["direccion", "coordinacion"];

interface Estado {
  rol: RolAcademico | null;
  nombre: string | null;
  cargando: boolean;
}

/**
 * Rol escolar de quien está usando el panel, o null si no tiene ninguno.
 *
 * Un usuario puede existir en el CRM y no en el expediente escolar: un asesor
 * de admisiones no es docente ni control escolar. Por eso `null` es un
 * resultado normal y no un error — significa "esta persona no trabaja con el
 * expediente", que es la mayoría del equipo de admisiones.
 *
 * Sirve SÓLO para decidir qué mostrar. Quién puede leer o escribir qué lo
 * decide RLS en la base: esconder una opción del menú no protege nada.
 */
export function useRolAcademico(): Estado {
  const { user } = useAuth();
  const [estado, setEstado] = useState<Estado>({
    rol: null,
    nombre: null,
    cargando: true,
  });

  useEffect(() => {
    let cancelado = false;

    // Sin sesión no hay rol que buscar. Se resuelve por la misma vía que el
    // caso normal —dentro de una promesa— en lugar de llamar a setState
    // directo en el efecto, que la regla de hooks prohíbe con razón: hacerlo
    // provoca un render extra antes de pintar.
    if (!user) {
      void Promise.resolve().then(() => {
        if (!cancelado) setEstado({ rol: null, nombre: null, cargando: false });
      });
      return () => {
        cancelado = true;
      };
    }

    createClient()
      .schema("academico")
      .from("usuarios")
      .select("rol, nombre")
      .eq("id", user.id)
      .eq("activo", true)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelado) return;
        setEstado({
          rol: (data?.rol as RolAcademico) ?? null,
          nombre: (data?.nombre as string) ?? null,
          cargando: false,
        });
      });

    return () => {
      cancelado = true;
    };
  }, [user]);

  return estado;
}
