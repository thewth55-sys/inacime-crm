"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  DollarSign,
  FileWarning,
  GraduationCap,
  Layers,
  Loader2,
  UserPlus,
  Users,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  anchoBarra,
  cargarResumen,
  fechaLegible as fecha,
  porcentajeOcupacion,
  type ResumenCompleto,
} from "@/lib/academico/resumen";

// Resumen operativo: lo que dirección y control escolar necesitan ver al
// entrar. Sigue el mockup v2 —cuatro cifras arriba, alumnos por programa
// a la izquierda y alertas accionables a la derecha—.
//
// Todas las cifras salen de la base. Donde el mockup mostraba cobranza y
// bandeja de trámites no se inventó nada: esos módulos no existen todavía
// y un número de adorno en el panel de dirección es peor que un hueco,
// porque se toman decisiones con él.

const PALETA = ["#27348B", "#00C1F4", "#5a9e3a", "#BDDB61", "#7B2D8E", "#8c92aa"];

export function ResumenOperativo() {
  const [datos, setDatos] = useState<ResumenCompleto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const r = await cargarResumen(createClient());
        if (!cancelado) setDatos(r);
      } catch (e) {
        if (!cancelado) setError((e as { message?: string })?.message ?? "No se pudo cargar el resumen.");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  if (cargando) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm font-semibold text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando el ciclo…
      </div>
    );
  }

  if (error || !datos) {
    return (
      <div className="rounded-2xl border border-[#f0c9c9] bg-[#fdeaea] px-6 py-10 text-center">
        <FileWarning className="mx-auto h-6 w-6 text-[#b73b3b]" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-[#b73b3b]">No se pudo cargar el resumen</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-[#8a4444]">{error}</p>
      </div>
    );
  }

  const ocupacion = porcentajeOcupacion(datos);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.5px] text-primary">Resumen operativo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {datos.ciclo
            ? `${datos.ciclo.nombre} · del ${fecha(datos.ciclo.inicia)} al ${fecha(datos.ciclo.termina)}.`
            : "No hay ningún ciclo activo. Abre uno para que el panel tenga de qué informar."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          etiqueta="ALUMNOS ACTIVOS"
          valor={datos.alumnos_activos}
          nota={
            datos.alumnos_total > datos.alumnos_activos
              ? `${datos.alumnos_total} en total, ${datos.alumnos_total - datos.alumnos_activos} fuera de activo`
              : "Toda la matrícula está activa"
          }
          icono={GraduationCap}
          fondo="#e6e9f7"
        />
        <Kpi
          etiqueta="DOCENTES"
          valor={datos.docentes}
          nota={datos.grupos > 0 ? `${(datos.grupos / Math.max(1, datos.docentes)).toFixed(1)} grupos por docente` : "Sin grupos asignados"}
          icono={Users}
          fondo="#e3f7fe"
        />
        <Kpi
          etiqueta="GRUPOS ABIERTOS"
          valor={datos.grupos}
          nota={
            ocupacion === null
              ? "Sin lugares configurados"
              : `Ocupación ${ocupacion}% · ${datos.ocupados} de ${datos.lugares} lugares`
          }
          icono={Layers}
          fondo="#eef6d6"
        />
        <Kpi
          etiqueta="ASPIRANTES POR INSCRIBIR"
          valor={datos.pendientesDeAlta}
          nota={
            datos.pendientesDeAlta === 0
              ? "Nadie espera matrícula"
              : "Ganaron su lugar y no tienen expediente"
          }
          icono={UserPlus}
          fondo="#eaf7ee"
          color={datos.pendientesDeAlta > 0 ? "#c77b1a" : undefined}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="mb-5 text-base font-bold text-primary">Alumnos inscritos por programa</h2>
          {datos.programas.length === 0 ? (
            <p className="py-6 text-sm font-semibold text-muted-foreground">
              Todavía no hay alumnos activos con plan asignado.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {datos.programas.map((p, i) => (
                <div key={p.nombre}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[13.5px] font-bold text-foreground">
                      {p.nombre}
                    </span>
                    <span className="shrink-0 text-[13.5px] font-bold tabular-nums text-primary">
                      {p.alumnos}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#eef0f6] dark:bg-muted">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: anchoBarra(p.alumnos, datos.programas),
                        background: PALETA[i % PALETA.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3.5">
          {datos.actas.faltan > 0 && (
            <Alerta
              etiqueta="ACTAS"
              etiquetaFondo="#fff1e0"
              etiquetaColor="#c77b1a"
              acento="#e8a33d"
              titulo={`${datos.actas.faltan} ${datos.actas.faltan === 1 ? "acta sin cerrar" : "actas sin cerrar"}${datos.actas.periodo ? ` desde ${datos.actas.periodo}` : ""}`}
              texto={textoActas(datos)}
              accion="Ver calificaciones"
              href="/calificaciones"
            />
          )}

          {datos.pendientesDeAlta > 0 && (
            <Alerta
              etiqueta="ADMISIONES"
              etiquetaFondo="#eaf7ee"
              etiquetaColor="#2f7d3f"
              acento="#5a9e3a"
              titulo={`${datos.pendientesDeAlta} ${datos.pendientesDeAlta === 1 ? "aspirante espera" : "aspirantes esperan"} matrícula`}
              texto="Ganaron su lugar en el embudo y todavía no tienen expediente ni acceso al portal."
              accion="Dar de alta"
              href="/alta-alumnos"
            />
          )}

          {datos.entrevistasSinAsignar > 0 && (
            <Alerta
              etiqueta="AGENDA"
              etiquetaFondo="#e3f7fe"
              etiquetaColor="#0091bd"
              acento="#00C1F4"
              titulo={`${datos.entrevistasSinAsignar} ${datos.entrevistasSinAsignar === 1 ? "entrevista sin asignar" : "entrevistas sin asignar"}`}
              texto="Les falta entrevistador o sala, así que no se le puede decir al aspirante dónde presentarse."
              accion="Abrir agenda"
              href="/agenda"
            />
          )}

          {datos.actas.faltan === 0 &&
            datos.pendientesDeAlta === 0 &&
            datos.entrevistasSinAsignar === 0 && (
              <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
                <h3 className="text-base font-bold text-primary">Nada pendiente</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm font-semibold text-muted-foreground">
                  Las actas están cerradas, no hay aspirantes esperando matrícula y toda
                  entrevista futura tiene quién y dónde.
                </p>
              </div>
            )}

          <div className="rounded-2xl border border-dashed border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">
                COBRANZA Y TRÁMITES
              </span>
            </div>
            <p className="mt-2 text-[13px] font-semibold leading-relaxed text-muted-foreground">
              El mockup contempla estas dos tarjetas, pero los módulos todavía no
              existen. Se dejan fuera en lugar de mostrar cifras de adorno: en un
              panel de dirección se toman decisiones con ellas.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function textoActas(d: ResumenCompleto): string {
  const quien =
    d.actas.docentes > 0
      ? `${d.actas.docentes} ${d.actas.docentes === 1 ? "docente no ha cerrado" : "docentes no han cerrado"} acta.`
      : "Los grupos afectados todavía no tienen docente asignado.";
  const cuando = d.actas.vence
    ? ` La captura vence el ${fecha(d.actas.vence)}.`
    : " Ningún periodo tiene fecha límite de captura configurada.";
  return quien + cuando;
}

function Kpi({
  etiqueta,
  valor,
  nota,
  icono: Icono,
  fondo,
  color,
}: {
  etiqueta: string;
  valor: number;
  nota: string;
  icono: typeof Users;
  fondo: string;
  color?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-bold tracking-[1px] text-muted-foreground">
          {etiqueta}
        </span>
        <span
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] text-primary"
          style={{ background: fondo }}
        >
          <Icono className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <div
        className="text-[28px] font-bold leading-none tabular-nums"
        style={{ color: color ?? "var(--primary)" }}
      >
        {valor.toLocaleString("es-MX")}
      </div>
      <div className="mt-1.5 text-[12.5px] font-semibold text-muted-foreground">{nota}</div>
    </div>
  );
}

function Alerta({
  etiqueta,
  etiquetaFondo,
  etiquetaColor,
  acento,
  titulo,
  texto,
  accion,
  href,
}: {
  etiqueta: string;
  etiquetaFondo: string;
  etiquetaColor: string;
  acento: string;
  titulo: string;
  texto: string;
  accion: string;
  href: string;
}) {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-5"
      style={{ borderLeft: `4px solid ${acento}` }}
    >
      <span
        className="inline-block rounded-full px-2.5 py-1 text-[11px] font-bold"
        style={{ background: etiquetaFondo, color: etiquetaColor }}
      >
        {etiqueta}
      </span>
      <h3 className="mt-2.5 text-[15.5px] font-bold text-primary">{titulo}</h3>
      <p className="mt-1.5 text-[13.5px] font-medium leading-relaxed text-muted-foreground">
        {texto}
      </p>
      <Link
        href={href}
        className="mt-3.5 inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-border px-4 text-[12.5px] font-bold text-primary hover:border-primary"
      >
        {accion}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}
