"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Search, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { buscarAspirantes } from "@/lib/agenda/aspirantes";
import { aValorLocal, hayChoque } from "@/lib/agenda/rangos";
import {
  ESTADOS,
  ETIQUETA_ESTADO,
  type AspiranteAgendable,
  type Entrevista,
  type EstadoEntrevista,
  type Entrevistador,
  type SalaEntrevista,
  type TipoEntrevista,
} from "@/lib/agenda/tipos";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type BorradorEntrevista =
  | { modo: "nueva"; iniciaEn: string; terminaEn: string; entrevistadorId?: string; salaId?: string }
  | { modo: "edicion"; entrevista: Entrevista };

const ENTRADA =
  "h-11 w-full rounded-xl border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-3.5 text-sm font-semibold text-foreground outline-none focus:border-primary focus:bg-card disabled:opacity-60";

export function EditorEntrevista({
  abierto,
  onAbiertoChange,
  borrador,
  entrevistadores,
  salas,
  tipos,
  puedeEditar,
  onGuardado,
}: {
  abierto: boolean;
  onAbiertoChange: (v: boolean) => void;
  borrador: BorradorEntrevista | null;
  entrevistadores: Entrevistador[];
  salas: SalaEntrevista[];
  tipos: TipoEntrevista[];
  puedeEditar: boolean;
  onGuardado: () => void;
}) {
  const [tipoId, setTipoId] = useState("");
  const [entrevistadorId, setEntrevistadorId] = useState("");
  const [salaId, setSalaId] = useState("");
  const [iniciaEn, setIniciaEn] = useState("");
  const [duracion, setDuracion] = useState(30);
  const [estado, setEstado] = useState<EstadoEntrevista>("pendiente");
  const [notas, setNotas] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState(false);

  const [aspirante, setAspirante] = useState<AspiranteAgendable | null>(null);
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<AspiranteAgendable[]>([]);
  const [buscando, setBuscando] = useState(false);
  const secuencia = useRef(0);

  const editandoId = borrador?.modo === "edicion" ? borrador.entrevista.id : null;

  useEffect(() => {
    if (!borrador) return;
    if (borrador.modo === "edicion") {
      const e = borrador.entrevista;
      setTipoId(e.tipo_id ?? "");
      setEntrevistadorId(e.entrevistador_id ?? "");
      setSalaId(e.sala_id ?? "");
      setIniciaEn(aValorLocal(e.inicia_en));
      setDuracion(
        Math.round((new Date(e.termina_en).getTime() - new Date(e.inicia_en).getTime()) / 60000),
      );
      setEstado(e.estado);
      setNotas(e.notas ?? "");
      setAspirante(
        e.contact
          ? {
              dealId: e.deal_id,
              contactId: e.contact.id,
              nombre: e.contact.name ?? "Sin nombre",
              telefono: e.contact.phone,
              programa: e.contact.company ?? null,
            }
          : null,
      );
    } else {
      setTipoId("");
      setEntrevistadorId(borrador.entrevistadorId ?? "");
      setSalaId(borrador.salaId ?? "");
      setIniciaEn(aValorLocal(borrador.iniciaEn));
      setDuracion(
        Math.max(
          5,
          Math.round(
            (new Date(borrador.terminaEn).getTime() - new Date(borrador.iniciaEn).getTime()) / 60000,
          ),
        ),
      );
      setEstado("pendiente");
      setNotas("");
      setAspirante(null);
    }
    setConsulta("");
    setResultados([]);
    setAviso(null);
  }, [borrador]);

  // Avisa de empalmes contra el entrevistador y contra la sala. Es un
  // aviso, no un bloqueo: a veces se empalma a propósito.
  const revisarEmpalme = useCallback(
    async (desde: string, hasta: string, entId: string, sId: string) => {
      setAviso(null);
      if (!desde || !hasta || (!entId && !sId)) return;
      try {
        for (const [clave, valor, texto] of [
          ["entrevistador_id", entId, "Ese entrevistador ya tiene otra cita a esa hora."],
          ["sala_id", sId, "Esa sala ya está ocupada a esa hora."],
        ] as const) {
          if (!valor) continue;
          const p = new URLSearchParams({ desde, hasta, [clave]: valor });
          const res = await fetch(`/api/entrevistas?${p.toString()}`);
          const datos = await res.json();
          const otras: Entrevista[] = (datos.entrevistas ?? []).filter(
            (e: Entrevista) => e.id !== editandoId,
          );
          if (hayChoque(otras, { inicia_en: desde, termina_en: hasta })) {
            setAviso(texto);
            return;
          }
        }
      } catch (e) {
        console.error("No se pudo revisar empalmes:", e);
      }
    },
    [editandoId],
  );

  function revisar(inicio: string, mins: number, entId: string, sId: string) {
    if (!inicio) return;
    const desde = new Date(inicio);
    const hasta = new Date(desde.getTime() + mins * 60000);
    void revisarEmpalme(desde.toISOString(), hasta.toISOString(), entId, sId);
  }

  useEffect(() => {
    if (!consulta.trim()) {
      setResultados([]);
      return;
    }
    const seq = ++secuencia.current;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await buscarAspirantes(createClient(), consulta);
        if (seq !== secuencia.current) return;
        setResultados(r);
      } catch {
        if (seq === secuencia.current) setResultados([]);
      } finally {
        if (seq === secuencia.current) setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [consulta]);

  async function guardar() {
    if (!iniciaEn) {
      toast.error("Falta la hora de inicio.");
      return;
    }
    const desde = new Date(iniciaEn);
    const hasta = new Date(desde.getTime() + duracion * 60000);

    setGuardando(true);
    try {
      const comun = {
        tipo_id: tipoId || null,
        entrevistador_id: entrevistadorId || null,
        sala_id: salaId || null,
        inicia_en: desde.toISOString(),
        termina_en: hasta.toISOString(),
        notas: notas || null,
      };
      const res =
        borrador?.modo === "edicion"
          ? await fetch(`/api/entrevistas/${borrador.entrevista.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...comun, estado }),
            })
          : await fetch("/api/entrevistas", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...comun,
                contact_id: aspirante?.contactId ?? null,
                deal_id: aspirante?.dealId ?? null,
              }),
            });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: null }));
        throw new Error(error ?? "No se pudo guardar.");
      }
      toast.success(borrador?.modo === "edicion" ? "Entrevista actualizada" : "Entrevista agendada");
      onAbiertoChange(false);
      onGuardado();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (borrador?.modo !== "edicion") return;
    if (!window.confirm("¿Borrar esta entrevista de la agenda?")) return;
    setBorrando(true);
    try {
      const res = await fetch(`/api/entrevistas/${borrador.entrevista.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo borrar.");
      toast.success("Entrevista borrada");
      onAbiertoChange(false);
      onGuardado();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBorrando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent className="max-h-[90vh] w-full max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-primary">
            {borrador?.modo === "edicion" ? "Entrevista" : "Nueva entrevista"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          {borrador?.modo === "nueva" ? (
            <Campo etiqueta="ASPIRANTE" ayuda="Busca por nombre o teléfono entre los negocios abiertos del embudo.">
              {aspirante ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-foreground">{aspirante.nombre}</div>
                    <div className="truncate text-xs font-semibold text-muted-foreground">
                      {aspirante.telefono}
                      {aspirante.programa ? ` · ${aspirante.programa}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAspirante(null)}
                    className="shrink-0 text-xs font-bold text-primary"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <input
                    value={consulta}
                    onChange={(e) => setConsulta(e.target.value)}
                    placeholder="Nombre o teléfono…"
                    className={`${ENTRADA} pl-10`}
                  />
                  {consulta.trim() && (
                    <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-border bg-popover shadow-lg">
                      {buscando ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                        </div>
                      ) : resultados.length > 0 ? (
                        resultados.map((a) => (
                          <button
                            key={a.contactId}
                            type="button"
                            onClick={() => {
                              setAspirante(a);
                              setConsulta("");
                              setResultados([]);
                            }}
                            className="flex w-full flex-col items-start px-3.5 py-2 text-left hover:bg-muted"
                          >
                            <span className="text-sm font-bold text-foreground">{a.nombre}</span>
                            <span className="text-xs font-semibold text-muted-foreground">
                              {a.telefono}
                              {a.programa ? ` · ${a.programa}` : ""}
                            </span>
                          </button>
                        ))
                      ) : (
                        <p className="px-3.5 py-3 text-xs font-semibold text-muted-foreground">
                          Ningún aspirante con negocio abierto coincide.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Campo>
          ) : (
            <div className="rounded-xl border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-3.5 py-2.5">
              <div className="text-sm font-bold text-foreground">
                {aspirante?.nombre ?? "Sin aspirante ligado"}
              </div>
              {aspirante && (
                <div className="text-xs font-semibold text-muted-foreground">
                  {aspirante.telefono}
                  {aspirante.programa ? ` · ${aspirante.programa}` : ""}
                </div>
              )}
            </div>
          )}

          <Campo etiqueta="TIPO DE ENTREVISTA">
            <select
              value={tipoId}
              disabled={!puedeEditar}
              onChange={(e) => {
                const t = tipos.find((x) => x.id === e.target.value);
                setTipoId(e.target.value);
                const d = t ? t.duracion_min : duracion;
                if (t) setDuracion(t.duracion_min);
                revisar(iniciaEn, d, entrevistadorId, salaId);
              }}
              className={ENTRADA}
            >
              <option value="">Sin especificar</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre} ({t.duracion_min} min)
                </option>
              ))}
            </select>
          </Campo>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Campo etiqueta="ENTREVISTADOR">
              <select
                value={entrevistadorId}
                disabled={!puedeEditar}
                onChange={(e) => {
                  setEntrevistadorId(e.target.value);
                  revisar(iniciaEn, duracion, e.target.value, salaId);
                }}
                className={ENTRADA}
              >
                <option value="">Por asignar</option>
                {entrevistadores.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="SALA">
              <select
                value={salaId}
                disabled={!puedeEditar}
                onChange={(e) => {
                  setSalaId(e.target.value);
                  revisar(iniciaEn, duracion, entrevistadorId, e.target.value);
                }}
                className={ENTRADA}
              >
                <option value="">Por asignar</option>
                {salas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.campus ? `${s.campus} · ${s.nombre}` : s.nombre}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <div className="grid grid-cols-[1fr_110px] gap-3.5">
            <Campo etiqueta="INICIA">
              <input
                type="datetime-local"
                value={iniciaEn}
                disabled={!puedeEditar}
                onChange={(e) => {
                  setIniciaEn(e.target.value);
                  revisar(e.target.value, duracion, entrevistadorId, salaId);
                }}
                className={ENTRADA}
              />
            </Campo>
            <Campo etiqueta="DURACIÓN">
              <input
                type="number"
                min={5}
                step={5}
                value={duracion}
                disabled={!puedeEditar}
                onChange={(e) => {
                  const n = Number(e.target.value) || 30;
                  setDuracion(n);
                  revisar(iniciaEn, n, entrevistadorId, salaId);
                }}
                className={ENTRADA}
              />
            </Campo>
          </div>

          {borrador?.modo === "edicion" && (
            <Campo
              etiqueta="ESTADO"
              ayuda="Se confirma sola en cuanto tiene entrevistador y sala."
            >
              <select
                value={estado}
                disabled={!puedeEditar}
                onChange={(e) => setEstado(e.target.value as EstadoEntrevista)}
                className={ENTRADA}
              >
                {ESTADOS.map((s) => (
                  <option key={s} value={s}>
                    {ETIQUETA_ESTADO[s]}
                  </option>
                ))}
              </select>
            </Campo>
          )}

          <Campo etiqueta="NOTAS">
            <input
              value={notas}
              disabled={!puedeEditar}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Lo que necesite saber quien reciba"
              className={ENTRADA}
            />
          </Campo>

          {aviso && (
            <p className="flex items-start gap-2 rounded-xl border border-[#f5dcae] bg-[#fff8ec] px-3.5 py-2.5 text-xs font-semibold text-[#8a6321]">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              {aviso} Se puede guardar de todos modos.
            </p>
          )}
        </div>

        {puedeEditar && (
          <DialogFooter className="gap-2">
            {borrador?.modo === "edicion" && (
              <button
                type="button"
                onClick={borrar}
                disabled={borrando || guardando}
                className="mr-auto flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-[#c0392b] disabled:opacity-50"
              >
                {borrando ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden />
                )}
                Borrar
              </button>
            )}
            <button
              type="button"
              onClick={guardar}
              disabled={guardando || borrando || !iniciaEn}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Guardar
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
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
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">{etiqueta}</span>
      {children}
      {ayuda && (
        <span className="text-[11px] font-semibold leading-snug text-muted-foreground">{ayuda}</span>
      )}
    </label>
  );
}
