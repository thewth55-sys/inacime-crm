"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Entrevistador, FranjaDisponibilidad } from "@/lib/agenda/tipos";

// Disponibilidad declarada por cada entrevistador.
//
// No es un horario semanal recurrente a propósito: los coordinadores
// reparten su tiempo entre clases, campus y temporadas de admisión, así
// que la disponibilidad se declara por franjas concretas.
//
// Y la declara cada quien sobre sí mismo —la RLS no da atajo de
// administrador—. Si admisiones la transcribiera por ellos, dejaría de
// ser un dato en el que se pueda confiar para agendar.

export function MiDisponibilidad() {
  const { user, loading: cargandoAuth } = useAuth();
  const [cargando, setCargando] = useState(true);
  const [yo, setYo] = useState<Entrevistador | null>(null);
  const [franjas, setFranjas] = useState<FranjaDisponibilidad[]>([]);

  const [inicia, setInicia] = useState("");
  const [termina, setTermina] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);

  const recargar = useCallback(async (entrevistadorId: string) => {
    const { data } = await createClient()
      .from("entrevistador_disponibilidad")
      .select("*")
      .eq("entrevistador_id", entrevistadorId)
      .order("inicia_en", { ascending: true });
    setFranjas((data ?? []) as FranjaDisponibilidad[]);
  }, []);

  useEffect(() => {
    if (cargandoAuth || !user) return;
    void (async () => {
      setCargando(true);
      const { data } = await createClient()
        .from("entrevistadores")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      const fila = (data as Entrevistador) ?? null;
      setYo(fila);
      if (fila) await recargar(fila.id);
      setCargando(false);
    })();
  }, [cargandoAuth, user, recargar]);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!yo || !inicia || !termina) return;
    if (new Date(termina) <= new Date(inicia)) {
      toast.error("La franja no puede terminar antes de empezar.");
      return;
    }
    setGuardando(true);
    try {
      const { error } = await createClient().from("entrevistador_disponibilidad").insert({
        account_id: yo.account_id,
        entrevistador_id: yo.id,
        inicia_en: new Date(inicia).toISOString(),
        termina_en: new Date(termina).toISOString(),
        notas: notas || null,
      });
      if (error) throw error;
      toast.success("Franja agregada");
      setInicia("");
      setTermina("");
      setNotas("");
      await recargar(yo.id);
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    if (!yo) return;
    setBorrandoId(id);
    try {
      const { error } = await createClient()
        .from("entrevistador_disponibilidad")
        .delete()
        .eq("id", id);
      if (error) throw error;
      await recargar(yo.id);
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? "No se pudo borrar.");
    } finally {
      setBorrandoId(null);
    }
  }

  if (cargando || cargandoAuth) return <Cargando />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/agenda"
          className="mb-2 inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Agenda
        </Link>
        <h1 className="text-[28px] font-bold tracking-[-0.5px] text-primary">Mi disponibilidad</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Las horas en que puedes entrevistar. Aparecen de fondo en la agenda para
          que admisiones sepa dónde cabe una cita sin preguntarte.
        </p>
      </div>

      {!yo ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center">
          <CalendarClock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-lg font-bold text-primary">No estás dado de alta como entrevistador</h2>
          <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-muted-foreground">
            Dirección tiene que crear tu ficha de entrevistador y ligarla a esta
            cuenta desde el catálogo de la agenda. Hasta entonces no hay dónde
            guardar tus horas.
          </p>
        </div>
      ) : (
        <>
          <form onSubmit={agregar} className="rounded-2xl border border-border bg-card p-5">
            <div className="grid gap-3.5 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
              <Campo etiqueta="DESDE">
                <input
                  type="datetime-local"
                  value={inicia}
                  onChange={(e) => setInicia(e.target.value)}
                  required
                  className={ENTRADA}
                />
              </Campo>
              <Campo etiqueta="HASTA">
                <input
                  type="datetime-local"
                  value={termina}
                  onChange={(e) => setTermina(e.target.value)}
                  required
                  className={ENTRADA}
                />
              </Campo>
              <Campo etiqueta="NOTA">
                <input
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Campus Coacalco, sólo por la mañana…"
                  className={ENTRADA}
                />
              </Campo>
              <button
                type="submit"
                disabled={guardando}
                className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {guardando ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden />
                )}
                Agregar
              </button>
            </div>
          </form>

          {franjas.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center text-sm font-semibold text-muted-foreground">
              Todavía no declaras horas. Mientras no lo hagas, admisiones agenda a
              ciegas sobre tu calendario.
            </div>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-border bg-card">
              {franjas.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-foreground">{rotula(f)}</div>
                    {f.notas && (
                      <div className="truncate text-xs font-semibold text-muted-foreground">
                        {f.notas}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => borrar(f.id)}
                    disabled={borrandoId === f.id}
                    aria-label="Borrar franja"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#c0392b] disabled:opacity-50"
                  >
                    {borrandoId === f.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** "mié 3 sep, 9:00 – 13:00" · repite la fecha sólo si cruza medianoche. */
function rotula(f: FranjaDisponibilidad): string {
  const d1 = new Date(f.inicia_en);
  const d2 = new Date(f.termina_en);
  const fecha = (d: Date) =>
    d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
  const hora = (d: Date) => d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return d1.toDateString() === d2.toDateString()
    ? `${fecha(d1)}, ${hora(d1)} – ${hora(d2)}`
    : `${fecha(d1)} ${hora(d1)} – ${fecha(d2)} ${hora(d2)}`;
}

const ENTRADA =
  "h-11 w-full rounded-xl border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-3.5 text-sm font-semibold text-foreground outline-none focus:border-primary focus:bg-card";

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">{etiqueta}</span>
      {children}
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
