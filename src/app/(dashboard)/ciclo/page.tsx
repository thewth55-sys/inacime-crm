"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarRange, Loader2, Plus, Scale, ShieldAlert, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useRolAcademico } from "@/hooks/use-rol-academico";
import {
  avisoDeVentana,
  cargarCiclos,
  cargarPeriodos,
  contarCapturas,
  ETIQUETA_ESTADO_CICLO,
  problemaDelCiclo,
  siguienteClave,
  siguienteOrden,
  type Ciclo,
  type EstadoCiclo,
  type Periodo,
} from "@/lib/academico/ciclos";

// Ciclo y periodos de evaluación.
//
// Cuántos parciales tiene un ciclo dejó de estar en el código: hay planes
// con dos parciales y examen, otros con tres, y alguno con un
// diagnóstico que se captura pero no cuenta para la definitiva. Cada
// coordinación lo define aquí, igual que el reglamento.
//
// La ponderación NO se pide en esta pantalla. El ciclo dice qué periodos
// hay y cuándo se captura; cuánto pesa cada uno lo dice el reglamento de
// evaluación, que puede diferir por plan. Tenerlo en los dos lados era
// pedir que se contradijeran.

const ENTRADA =
  "h-11 w-full min-w-0 rounded-xl border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-3.5 text-sm font-semibold text-foreground outline-none focus:border-primary focus:bg-card disabled:opacity-60";

export default function CicloPage() {
  const { rol, cargando: cargandoRol } = useRolAcademico();
  const puede = rol === "direccion" || rol === "coordinacion" || rol === "control_escolar";

  const [ciclos, setCiclos] = useState<Ciclo[]>([]);
  const [selId, setSelId] = useState("");
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [capturas, setCapturas] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const sel = ciclos.find((c) => c.id === selId) ?? null;
  const activo = ciclos.find((c) => c.estado === "activo") ?? null;

  const cargarTodo = useCallback(async (preferido?: string) => {
    setCargando(true);
    try {
      const db = createClient();
      const cs = await cargarCiclos(db);
      setCiclos(cs);
      const elegido =
        (preferido && cs.find((c) => c.id === preferido)?.id) ??
        cs.find((c) => c.estado === "activo")?.id ??
        cs[0]?.id ??
        "";
      setSelId(elegido);
      if (elegido) {
        const ps = await cargarPeriodos(db, elegido);
        setPeriodos(ps);
        setCapturas(await contarCapturas(db, ps));
      } else {
        setPeriodos([]);
        setCapturas({});
      }
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "No se pudo cargar el ciclo.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarTodo();
  }, [cargarTodo]);

  async function elegirCiclo(id: string) {
    setSelId(id);
    try {
      const db = createClient();
      const ps = await cargarPeriodos(db, id);
      setPeriodos(ps);
      setCapturas(await contarCapturas(db, ps));
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "No se pudieron cargar los periodos.");
    }
  }

  const editarCiclo = <K extends keyof Ciclo>(campo: K, valor: Ciclo[K]) =>
    setCiclos((prev) => prev.map((c) => (c.id === selId ? { ...c, [campo]: valor } : c)));

  const editarPeriodo = <K extends keyof Periodo>(id: string, campo: K, valor: Periodo[K]) =>
    setPeriodos((prev) => prev.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));

  async function crearCiclo() {
    const anio = new Date().getFullYear();
    const nuevo = {
      clave: `${anio}-1`,
      nombre: `Ciclo ${anio}-1`,
      inicia: new Date().toISOString().slice(0, 10),
      termina: new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10),
      estado: "planeacion" as EstadoCiclo,
    };
    try {
      const { data, error } = await createClient()
        .schema("academico")
        .from("ciclos")
        .insert(nuevo)
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Ciclo creado en planeación. Ajusta clave y fechas.");
      await cargarTodo(data.id as string);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "No se pudo crear el ciclo.");
    }
  }

  async function guardarCiclo() {
    if (!sel) return;
    const problema = problemaDelCiclo(sel);
    if (problema) {
      toast.error(problema);
      return;
    }
    // Sólo puede haber un ciclo activo —hay un índice único que lo
    // garantiza—. Avisarlo aquí evita que el guardado falle con un
    // mensaje de índice duplicado que nadie sabe traducir.
    if (sel.estado === "activo" && activo && activo.id !== sel.id) {
      toast.error(`${activo.nombre} sigue activo. Ciérralo antes de activar éste.`);
      return;
    }
    setGuardando(true);
    try {
      const { error } = await createClient()
        .schema("academico")
        .from("ciclos")
        .update({
          clave: sel.clave.trim(),
          nombre: sel.nombre.trim(),
          inicia: sel.inicia,
          termina: sel.termina,
          estado: sel.estado,
        })
        .eq("id", sel.id);
      if (error) throw error;
      toast.success("Ciclo guardado");
      await cargarTodo(sel.id);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  async function agregarPeriodo() {
    if (!sel) return;
    try {
      const { error } = await createClient()
        .schema("academico")
        .from("periodos")
        .insert({
          ciclo_id: sel.id,
          clave: siguienteClave(periodos),
          nombre: `Periodo ${siguienteOrden(periodos)}`,
          orden: siguienteOrden(periodos),
        });
      if (error) throw error;
      await elegirCiclo(sel.id);
      toast.success("Periodo agregado. Dale nombre y define su peso en el reglamento.");
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "No se pudo agregar.");
    }
  }

  async function guardarPeriodos() {
    if (!sel) return;
    setGuardando(true);
    try {
      const a = createClient().schema("academico");
      for (const p of periodos) {
        const { error } = await a
          .from("periodos")
          .update({
            clave: p.clave.trim(),
            nombre: p.nombre.trim(),
            orden: p.orden,
            captura_abre: p.captura_abre || null,
            captura_cierra: p.captura_cierra || null,
          })
          .eq("id", p.id);
        if (error) throw error;
      }
      toast.success("Periodos guardados");
      await elegirCiclo(sel.id);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  async function borrarPeriodo(p: Periodo) {
    if (!window.confirm(`¿Quitar ${p.nombre} del ciclo?`)) return;
    try {
      const { error } = await createClient()
        .schema("academico")
        .from("periodos")
        .delete()
        .eq("id", p.id);
      if (error) throw error;
      await elegirCiclo(sel!.id);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "No se pudo borrar.");
    }
  }

  if (cargandoRol || cargando) return <Cargando />;

  if (!puede) {
    return (
      <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center">
        <ShieldAlert className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-primary">Sólo dirección y coordinación</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-muted-foreground">
          Los periodos definen las ventanas de captura de todos los grupos. Los ajusta
          quien coordina la oferta académica.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.5px] text-primary">Ciclo y periodos</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Cuántos periodos de evaluación tiene el ciclo y cuándo se captura cada uno.
            No hay un número fijo: agrega los que necesite el plan.
          </p>
        </div>
        <button
          type="button"
          onClick={crearCiclo}
          className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-4 text-sm font-bold text-primary"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nuevo ciclo
        </button>
      </div>

      {ciclos.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center">
          <CalendarRange className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-lg font-bold text-primary">Todavía no hay ciclos</h2>
          <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-muted-foreground">
            Sin ciclo no se pueden abrir grupos ni capturar calificaciones. Crea el
            primero y define sus periodos.
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-[200px_1fr_170px_170px_190px]">
              <Campo etiqueta="CICLO">
                <select value={selId} onChange={(e) => elegirCiclo(e.target.value)} className={ENTRADA}>
                  {ciclos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.clave} · {ETIQUETA_ESTADO_CICLO[c.estado]}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="NOMBRE">
                <input
                  value={sel?.nombre ?? ""}
                  onChange={(e) => editarCiclo("nombre", e.target.value)}
                  className={ENTRADA}
                />
              </Campo>
              <Campo etiqueta="INICIA">
                <input
                  type="date"
                  value={sel?.inicia ?? ""}
                  onChange={(e) => editarCiclo("inicia", e.target.value)}
                  className={ENTRADA}
                />
              </Campo>
              <Campo etiqueta="TERMINA">
                <input
                  type="date"
                  value={sel?.termina ?? ""}
                  onChange={(e) => editarCiclo("termina", e.target.value)}
                  className={ENTRADA}
                />
              </Campo>
              <Campo etiqueta="ESTADO" ayuda="Sólo un ciclo puede estar activo a la vez.">
                <select
                  value={sel?.estado ?? "planeacion"}
                  onChange={(e) => editarCiclo("estado", e.target.value as EstadoCiclo)}
                  className={ENTRADA}
                >
                  {(["planeacion", "activo", "cerrado"] as const).map((e) => (
                    <option key={e} value={e}>
                      {ETIQUETA_ESTADO_CICLO[e]}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                value={sel?.clave ?? ""}
                onChange={(e) => editarCiclo("clave", e.target.value)}
                placeholder="Clave, p. ej. 2026-3"
                aria-label="Clave del ciclo"
                className={`${ENTRADA} max-w-[200px]`}
              />
              <button
                type="button"
                onClick={guardarCiclo}
                disabled={guardando}
                className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Guardar ciclo
              </button>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
              <div>
                <h2 className="text-base font-bold text-primary">
                  Periodos de evaluación ({periodos.length})
                </h2>
                <p className="text-xs font-semibold text-muted-foreground">
                  El peso de cada uno se define en el reglamento, no aquí: puede
                  cambiar de un plan a otro.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/reglamento"
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-border px-3.5 text-sm font-bold text-primary"
                >
                  <Scale className="h-4 w-4" aria-hidden />
                  Pesos
                </Link>
                <button
                  type="button"
                  onClick={agregarPeriodo}
                  className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Agregar periodo
                </button>
              </div>
            </div>

            {periodos.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm font-semibold text-muted-foreground">
                Este ciclo no tiene periodos. Sin al menos uno no se puede capturar
                ninguna calificación.
              </p>
            ) : (
              <ul>
                {periodos.map((p) => {
                  const aviso = sel ? avisoDeVentana(p, sel) : null;
                  const capturadas = capturas[p.id] ?? 0;
                  return (
                    <li key={p.id} className="border-b border-border/60 px-5 py-4 last:border-b-0">
                      <div className="grid gap-3 lg:grid-cols-[80px_120px_1fr_190px_190px_44px] lg:items-end">
                        <Campo etiqueta="ORDEN">
                          <input
                            type="number"
                            min={1}
                            value={p.orden}
                            onChange={(e) => editarPeriodo(p.id, "orden", Number(e.target.value) || 1)}
                            className={ENTRADA}
                          />
                        </Campo>
                        <Campo etiqueta="CLAVE">
                          <input
                            value={p.clave}
                            onChange={(e) => editarPeriodo(p.id, "clave", e.target.value)}
                            className={ENTRADA}
                          />
                        </Campo>
                        <Campo etiqueta="NOMBRE">
                          <input
                            value={p.nombre}
                            onChange={(e) => editarPeriodo(p.id, "nombre", e.target.value)}
                            className={ENTRADA}
                          />
                        </Campo>
                        <Campo etiqueta="CAPTURA ABRE">
                          <input
                            type="datetime-local"
                            value={aLocal(p.captura_abre)}
                            onChange={(e) =>
                              editarPeriodo(p.id, "captura_abre", deLocal(e.target.value))
                            }
                            className={ENTRADA}
                          />
                        </Campo>
                        <Campo etiqueta="CAPTURA CIERRA">
                          <input
                            type="datetime-local"
                            value={aLocal(p.captura_cierra)}
                            onChange={(e) =>
                              editarPeriodo(p.id, "captura_cierra", deLocal(e.target.value))
                            }
                            className={ENTRADA}
                          />
                        </Campo>
                        <button
                          type="button"
                          onClick={() => borrarPeriodo(p)}
                          disabled={capturadas > 0}
                          title={
                            capturadas > 0
                              ? `Ya tiene ${capturadas} calificaciones capturadas`
                              : "Quitar periodo"
                          }
                          aria-label={`Quitar ${p.nombre}`}
                          className="flex h-11 w-11 items-center justify-center rounded-xl text-[#c0392b] disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                      {(aviso || capturadas > 0) && (
                        <p className="mt-2 text-[11.5px] font-semibold text-muted-foreground">
                          {capturadas > 0 &&
                            `${capturadas} ${capturadas === 1 ? "calificación capturada" : "calificaciones capturadas"}. `}
                          {aviso && <span className="text-[#c77b1a]">{aviso}</span>}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {periodos.length > 0 && (
              <div className="flex justify-end border-t border-border px-5 py-4">
                <button
                  type="button"
                  onClick={guardarPeriodos}
                  disabled={guardando}
                  className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Guardar periodos
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** timestamptz → valor de <input datetime-local>, en hora local. */
function aLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function deLocal(valor: string): string | null {
  return valor ? new Date(valor).toISOString() : null;
}

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">{etiqueta}</span>
      {children}
      {ayuda && (
        <span className="text-[11px] font-semibold leading-snug text-muted-foreground">{ayuda}</span>
      )}
    </label>
  );
}

function Cargando() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm font-semibold text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      Cargando…
    </div>
  );
}
