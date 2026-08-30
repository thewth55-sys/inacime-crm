"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarClock, Loader2, Plus, Settings2 } from "lucide-react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, EventDropArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import esLocale from "@fullcalendar/core/locales/es";

import { createClient } from "@/lib/supabase/client";
import { useCan } from "@/hooks/use-can";
import { siguienteMediaHora } from "@/lib/agenda/rangos";
import {
  ETIQUETA_ESTADO,
  type Entrevista,
  type EstadoEntrevista,
  type Entrevistador,
  type FranjaDisponibilidad,
  type SalaEntrevista,
  type TipoEntrevista,
} from "@/lib/agenda/tipos";
import { EditorEntrevista, type BorradorEntrevista } from "./editor-entrevista";

// Agenda de entrevistas de admisión.
//
// Portada del módulo de agenda de zentro-med. Lo que allá era doctor,
// consultorio y tipo de servicio, aquí es entrevistador, sala y tipo de
// entrevista; lo que allá era paciente, aquí es el aspirante que ya vive
// como negocio en el embudo.
//
// El fondo de colores no es decoración: son las franjas que cada
// entrevistador declaró. Agendar encima de un hueco vacío se ve
// distinto de agendar dentro de la disponibilidad de alguien.

const COLOR_ESTADO: Record<EstadoEntrevista, { fondo: string; borde: string }> = {
  pendiente: { fondo: "#c77b1a", borde: "#a8630f" },
  confirmada: { fondo: "#2f7d3f", borde: "#246330" },
  realizada: { fondo: "#27348B", borde: "#1c2666" },
  cancelada: { fondo: "#8b8fa3", borde: "#6f7386" },
  no_asistio: { fondo: "#c0392b", borde: "#992d22" },
};

const PALETA = ["#27348B", "#00C1F4", "#7B2D8E", "#5a9e3a", "#c77b1a", "#c0392b", "#0f8b8d", "#b5651d"];

/** Color estable por entrevistador: el mismo cada vez que se carga. */
function colorDe(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}

interface EventoCalendario {
  id: string;
  title: string;
  start: string;
  end: string;
  display?: "background";
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  extendedProps: Record<string, unknown>;
}

export function CalendarioEntrevistas() {
  const puedeEditar = useCan("send-messages");

  const [cargando, setCargando] = useState(true);
  const [entrevistadores, setEntrevistadores] = useState<Entrevistador[]>([]);
  const [salas, setSalas] = useState<SalaEntrevista[]>([]);
  const [tipos, setTipos] = useState<TipoEntrevista[]>([]);
  const [entrevistas, setEntrevistas] = useState<Entrevista[]>([]);
  const [franjas, setFranjas] = useState<FranjaDisponibilidad[]>([]);

  const [filtroEntrevistador, setFiltroEntrevistador] = useState("");
  const [filtroSala, setFiltroSala] = useState("");
  // Se filtra en memoria: las entrevistas del rango visible ya están
  // cargadas, y volver al servidor sólo para ocultar unas cuantas
  // añadiría una espera donde ahora no la hay.
  const [filtroEstado, setFiltroEstado] = useState<EstadoEntrevista | "">("");
  const [rango, setRango] = useState<{ desde: string; hasta: string } | null>(null);

  const [editorAbierto, setEditorAbierto] = useState(false);
  const [borrador, setBorrador] = useState<BorradorEntrevista | null>(null);

  // Una barra de siete botones y una rejilla semanal dan por hecho un
  // monitor. En un teléfono se amontonan o empujan scroll horizontal,
  // que se lee como "la agenda se corta". Debajo de sm se abre en vista
  // de día con la barra recortada.
  const [enMovil, setEnMovil] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    setEnMovil(mql.matches);
    const alCambiar = (e: MediaQueryListEvent) => setEnMovil(e.matches);
    mql.addEventListener("change", alCambiar);
    return () => mql.removeEventListener("change", alCambiar);
  }, []);

  // `initialView` sólo aplica al montar: FullCalendar ignora los cambios
  // posteriores, y `enMovil` empieza en false y se resuelve al tick
  // siguiente, cuando el calendario ya se pintó con la vista incorrecta.
  const refCalendario = useRef<FullCalendar>(null);
  useEffect(() => {
    const api = refCalendario.current?.getApi();
    if (!api) return;
    const vista = enMovil ? "timeGridDay" : "timeGridWeek";
    if (api.view.type !== vista) api.changeView(vista);
  }, [enMovil]);

  useEffect(() => {
    void (async () => {
      const db = createClient();
      const [e, s, t] = await Promise.all([
        db.from("entrevistadores").select("*").eq("activo", true).order("nombre"),
        db.from("salas_entrevista").select("*").eq("activo", true).order("nombre"),
        db.from("tipos_entrevista").select("*").eq("activo", true).order("nombre"),
      ]);
      setEntrevistadores((e.data ?? []) as Entrevistador[]);
      setSalas((s.data ?? []) as SalaEntrevista[]);
      setTipos((t.data ?? []) as TipoEntrevista[]);
    })();
  }, []);

  const cargar = useCallback(async () => {
    if (!rango) return;
    setCargando(true);
    try {
      const p = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta });
      if (filtroEntrevistador) p.set("entrevistador_id", filtroEntrevistador);
      if (filtroSala) p.set("sala_id", filtroSala);
      const res = await fetch(`/api/entrevistas?${p.toString()}`);
      if (!res.ok) throw new Error("No se pudo cargar la agenda.");
      const datos = await res.json();
      setEntrevistas((datos.entrevistas ?? []) as Entrevista[]);

      const db = createClient();
      let q = db
        .from("entrevistador_disponibilidad")
        .select("*")
        .gte("termina_en", rango.desde)
        .lte("inicia_en", rango.hasta);
      if (filtroEntrevistador) q = q.eq("entrevistador_id", filtroEntrevistador);
      const { data, error } = await q;
      if (error) throw error;
      setFranjas((data ?? []) as FranjaDisponibilidad[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [rango, filtroEntrevistador, filtroSala]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const eventos = useMemo<EventoCalendario[]>(() => {
    const citas: EventoCalendario[] = entrevistas
      .filter((e) => e.estado !== "cancelada")
      .filter((e) => !filtroEstado || e.estado === filtroEstado)
      .map((e) => {
        const c = COLOR_ESTADO[e.estado];
        const quien = e.contact?.name || e.contact?.phone || "Sin aspirante";
        return {
          id: e.id,
          title: e.sala ? `${quien} · ${e.sala.nombre}` : quien,
          start: e.inicia_en,
          end: e.termina_en,
          backgroundColor: c.fondo,
          borderColor: c.borde,
          textColor: "#fff",
          extendedProps: { clase: "entrevista", entrevista: e },
        };
      });

    const fondo: EventoCalendario[] = franjas.map((f) => ({
      id: `franja-${f.id}`,
      title: entrevistadores.find((e) => e.id === f.entrevistador_id)?.nombre ?? "",
      start: f.inicia_en,
      end: f.termina_en,
      display: "background" as const,
      backgroundColor: colorDe(f.entrevistador_id),
      extendedProps: { clase: "disponibilidad" },
    }));

    return [...fondo, ...citas];
  }, [entrevistas, franjas, filtroEstado, entrevistadores]);

  function alHacerClic(info: EventClickArg) {
    if (info.event.extendedProps.clase !== "entrevista") return;
    setBorrador({ modo: "edicion", entrevista: info.event.extendedProps.entrevista as Entrevista });
    setEditorAbierto(true);
  }

  async function reprogramar(info: EventDropArg | EventResizeDoneArg) {
    if (info.event.extendedProps.clase !== "entrevista" || !info.event.start || !info.event.end) {
      info.revert();
      return;
    }
    const e = info.event.extendedProps.entrevista as Entrevista;
    try {
      const res = await fetch(`/api/entrevistas/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inicia_en: info.event.start.toISOString(),
          termina_en: info.event.end.toISOString(),
        }),
      });
      if (!res.ok) throw new Error("No se pudo reprogramar.");
      toast.success("Entrevista reprogramada");
      await cargar();
    } catch (err) {
      toast.error((err as Error).message);
      info.revert();
    }
  }

  // El botón existe porque en un teléfono arrastrar para seleccionar un
  // rango exige una pulsación larga que nadie adivina: sin él, agendar
  // desde el celular parecería imposible.
  function abrirNueva() {
    if (!puedeEditar) return;
    const inicio = siguienteMediaHora(new Date());
    setBorrador({
      modo: "nueva",
      iniciaEn: inicio.toISOString(),
      terminaEn: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
      entrevistadorId: filtroEntrevistador || undefined,
      salaId: filtroSala || undefined,
    });
    setEditorAbierto(true);
  }

  const sinCatalogo = entrevistadores.length === 0 && salas.length === 0 && tipos.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.5px] text-primary">
            Agenda de entrevistas
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quién entrevista a quién, cuándo y en qué sala. Arrastra una cita para
            reprogramarla.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/agenda/disponibilidad"
            className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-sm font-bold text-primary"
          >
            <CalendarClock className="h-4 w-4" aria-hidden />
            Mi disponibilidad
          </Link>
          {puedeEditar && (
            <button
              type="button"
              onClick={abrirNueva}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Nueva entrevista
            </button>
          )}
        </div>
      </div>

      {sinCatalogo && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#f5dcae] bg-[#fff8ec] px-5 py-4">
          <Settings2 className="h-5 w-5 shrink-0 text-[#8a6321]" aria-hidden />
          <p className="min-w-0 flex-1 text-sm font-semibold text-[#8a6321]">
            Todavía no hay entrevistadores, salas ni tipos de entrevista. Sin eso se
            pueden apartar huecos, pero no decir a quién se presenta el aspirante ni
            en qué campus.
          </p>
          <Link
            href="/agenda/catalogo"
            className="h-10 shrink-0 rounded-xl bg-[#8a6321] px-4 text-sm font-bold leading-10 text-white"
          >
            Configurar
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filtroEntrevistador}
          onChange={(e) => setFiltroEntrevistador(e.target.value)}
          className={FILTRO}
        >
          <option value="">Todos los entrevistadores</option>
          {entrevistadores.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
        <select value={filtroSala} onChange={(e) => setFiltroSala(e.target.value)} className={FILTRO}>
          <option value="">Todas las salas</option>
          {salas.map((s) => (
            <option key={s.id} value={s.id}>
              {s.campus ? `${s.campus} · ${s.nombre}` : s.nombre}
            </option>
          ))}
        </select>
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value as EstadoEntrevista | "")}
          className={FILTRO}
        >
          <option value="">Todos los estados</option>
          {(["pendiente", "confirmada", "realizada", "no_asistio"] as const).map((s) => (
            <option key={s} value={s}>
              {ETIQUETA_ESTADO[s]}
            </option>
          ))}
        </select>
        {cargando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {(["pendiente", "confirmada", "realizada", "no_asistio"] as const).map((s) => (
            <span
              key={s}
              className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: COLOR_ESTADO[s].fondo }}
                aria-hidden
              />
              {ETIQUETA_ESTADO[s]}
            </span>
          ))}
        </div>
      </div>

      <div className="agenda-inacime overflow-x-hidden rounded-2xl border border-border bg-card p-2 sm:p-3">
        <FullCalendar
          ref={refCalendario}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={enMovil ? "timeGridDay" : "timeGridWeek"}
          headerToolbar={
            enMovil
              ? { left: "prev,next", center: "title", right: "today" }
              : {
                  left: "prev,next today",
                  center: "title",
                  right: "timeGridDay,timeGridWeek,dayGridMonth,listWeek",
                }
          }
          height={enMovil ? "auto" : 700}
          firstDay={1}
          // Rejilla de 24 h a propósito: FullCalendar oculta sin avisar
          // los eventos que caen fuera del rango, y una entrevista
          // agendada a las 7 de la tarde desaparecería en silencio.
          // `scrollTime` sólo decide dónde abre la vista.
          slotMinTime="00:00:00"
          slotMaxTime="24:00:00"
          scrollTime="08:00:00"
          nowIndicator
          locale={esLocale}
          events={eventos}
          editable={puedeEditar}
          selectable={puedeEditar}
          selectMirror
          unselectAuto
          eventClick={alHacerClic}
          eventDrop={reprogramar}
          eventResize={reprogramar}
          select={(info) => {
            if (!puedeEditar) return;
            setBorrador({
              modo: "nueva",
              iniciaEn: info.startStr,
              terminaEn: info.endStr,
              entrevistadorId: filtroEntrevistador || undefined,
              salaId: filtroSala || undefined,
            });
            setEditorAbierto(true);
            info.view.calendar.unselect();
          }}
          datesSet={(arg) =>
            setRango({ desde: arg.start.toISOString(), hasta: arg.end.toISOString() })
          }
        />
      </div>

      <EditorEntrevista
        abierto={editorAbierto}
        onAbiertoChange={setEditorAbierto}
        borrador={borrador}
        entrevistadores={entrevistadores}
        salas={salas}
        tipos={tipos}
        puedeEditar={puedeEditar}
        onGuardado={() => void cargar()}
      />
    </div>
  );
}

const FILTRO =
  "h-10 rounded-xl border-[1.5px] border-[#dfe3ef] bg-card px-3 text-[13px] font-semibold text-foreground outline-none focus:border-primary";
