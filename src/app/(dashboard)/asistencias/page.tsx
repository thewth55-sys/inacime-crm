"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Check, Clock, X, Loader2, CalendarDays } from "lucide-react";
import {
  abrirSesion,
  cargarLista,
  cargarMisGrupos,
  guardarAsistencia,
  resumir,
} from "@/lib/academico/asistencias";
import type {
  EstadoAsistencia,
  FilaAsistencia,
  GrupoDocente,
} from "@/lib/academico/tipos";

// Captura de asistencia — móvil primero.
//
// El docente pasa lista de pie, en la clínica, con señal irregular. De ahí
// tres decisiones que no se ven en el diseño:
//
//   1. Los botones P/R/A miden 44px de alto. Es el mínimo para acertar con
//      el pulgar sin mirar; más chico obliga a detenerse y apuntar.
//   2. Marcar es local. No se manda nada al servidor hasta que se toca
//      Guardar, así que una racha sin señal no interrumpe el pase de lista.
//   3. El guardado va en un solo upsert. O entra la lista completa o no
//      entra nada — media lista guardada es peor que ninguna.

const HOY = () => new Date().toISOString().slice(0, 10);

const ESTADOS: { valor: EstadoAsistencia; letra: string; nombre: string; clase: string }[] = [
  { valor: "P", letra: "P", nombre: "Presente", clase: "bg-[#5a9e3a] text-white" },
  { valor: "R", letra: "R", nombre: "Retardo", clase: "bg-[#e8a33d] text-white" },
  { valor: "A", letra: "A", nombre: "Ausente", clase: "bg-[#e05252] text-white" },
];

export default function AsistenciasPage() {
  const { user } = useAuth();
  const [grupos, setGrupos] = useState<GrupoDocente[] | null>(null);
  const [grupoId, setGrupoId] = useState<string>("");
  const [fecha, setFecha] = useState<string>(HOY);
  const [sesionId, setSesionId] = useState<string | null>(null);
  const [filas, setFilas] = useState<FilaAsistencia[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [sinGuardar, setSinGuardar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = createClient();
    cargarMisGrupos(db)
      .then((gs) => {
        setGrupos(gs);
        if (gs.length > 0) setGrupoId(gs[0].id);
      })
      .catch((e) => setError(mensaje(e)))
      .finally(() => setCargando(false));
  }, []);

  const abrir = useCallback(async (gid: string, f: string) => {
    if (!gid) return;
    setCargando(true);
    setError(null);
    try {
      const db = createClient();
      const sid = await abrirSesion(db, gid, f);
      setSesionId(sid);
      setFilas(await cargarLista(db, gid, sid));
      setSinGuardar(false);
    } catch (e) {
      setError(mensaje(e));
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (grupoId) void abrir(grupoId, fecha);
  }, [grupoId, fecha, abrir]);

  const marcar = (inscripcionId: string, estado: EstadoAsistencia) => {
    setFilas((prev) =>
      prev.map((f) =>
        f.inscripcionId === inscripcionId
          ? { ...f, estado: f.estado === estado ? null : estado }
          : f,
      ),
    );
    setSinGuardar(true);
  };

  const todosPresentes = () => {
    setFilas((prev) => prev.map((f) => ({ ...f, estado: "P" as EstadoAsistencia })));
    setSinGuardar(true);
  };

  const guardar = async () => {
    if (!sesionId || !user) return;
    setGuardando(true);
    try {
      const n = await guardarAsistencia(createClient(), sesionId, user.id, filas);
      setSinGuardar(false);
      toast.success(
        n === 1 ? "Se guardó 1 asistencia" : `Se guardaron ${n} asistencias`,
      );
    } catch (e) {
      toast.error(mensaje(e));
    } finally {
      setGuardando(false);
    }
  };

  const grupo = grupos?.find((g) => g.id === grupoId);
  const r = resumir(filas);

  if (cargando && grupos === null) return <Cargando />;

  if (grupos !== null && grupos.length === 0) {
    return (
      <Aviso
        titulo="No tienes grupos en el ciclo activo"
        detalle="La asistencia se captura sobre los grupos que coordinación te haya asignado en el ciclo que esté abierto."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-28 lg:pb-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.5px] text-primary">
          Registro de asistencias
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Toca el estado de cada alumno. Nada se envía hasta que guardas.
        </p>
      </div>

      {/* Grupo y fecha */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">
            GRUPO
          </span>
          <select
            value={grupoId}
            onChange={(e) => setGrupoId(e.target.value)}
            className="h-12 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground outline-none focus:border-primary"
          >
            {grupos?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.cicloClave} · {g.clave} — {g.materia}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">
            FECHA DE SESIÓN
          </span>
          <div className="relative">
            <CalendarDays
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="date"
              value={fecha}
              max={HOY()}
              onChange={(e) => setFecha(e.target.value)}
              className="h-12 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm font-semibold text-foreground outline-none focus:border-primary sm:w-52"
            />
          </div>
        </label>
      </div>

      {grupo && (
        <p className="-mt-1 text-xs font-semibold text-muted-foreground">
          {grupo.horario}
          {grupo.aula ? ` · ${grupo.aula}` : ""} · {grupo.inscritos} inscritos
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[#f3c4c4] bg-[#fdeaea] px-4 py-3 text-sm font-semibold text-[#b73b3b]"
        >
          {error}
        </div>
      )}

      {/* Lista */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="text-base font-bold text-primary">
              Lista de asistencia
            </div>
            <div className="text-xs font-semibold text-muted-foreground">
              {filas.length} {filas.length === 1 ? "alumno" : "alumnos"}
            </div>
          </div>
          <button
            type="button"
            onClick={todosPresentes}
            disabled={filas.length === 0}
            className="shrink-0 rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold text-primary transition-colors hover:border-primary disabled:opacity-40"
          >
            ✓ Todos presentes
          </button>
        </div>

        {cargando ? (
          <Cargando />
        ) : filas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm font-semibold text-muted-foreground">
            Este grupo no tiene alumnos inscritos.
          </p>
        ) : (
          <ul>
            {filas.map((f) => (
              <li
                key={f.inscripcionId}
                className="flex flex-col gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-xs font-bold text-primary">
                    {f.iniciales}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-foreground">
                      {f.nombre}
                    </div>
                    <div className="truncate text-xs font-semibold text-muted-foreground">
                      {f.matricula}
                      {f.porcentajePrevio !== null && (
                        <>
                          {" · "}
                          <span
                            className={
                              f.porcentajePrevio < 80
                                ? "text-[#b73b3b]"
                                : "text-muted-foreground"
                            }
                          >
                            {f.porcentajePrevio}% en {f.sesionesPrevias}{" "}
                            {f.sesionesPrevias === 1 ? "sesión" : "sesiones"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* 44px de alto: el mínimo para acertar con el pulgar. */}
                <div className="flex shrink-0 gap-2">
                  {ESTADOS.map((e) => {
                    const activo = f.estado === e.valor;
                    return (
                      <button
                        key={e.valor}
                        type="button"
                        onClick={() => marcar(f.inscripcionId, e.valor)}
                        aria-pressed={activo}
                        aria-label={`${e.nombre} — ${f.nombre}`}
                        className={`h-11 flex-1 rounded-xl text-sm font-bold transition-colors sm:w-11 sm:flex-none ${
                          activo
                            ? e.clase
                            : "bg-muted text-muted-foreground hover:bg-muted/70"
                        }`}
                      >
                        {e.letra}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Resumen + guardar. Fijo abajo en móvil: el pulgar ya está ahí. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card px-4 py-3 lg:static lg:rounded-2xl lg:border lg:px-5 lg:py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-4 text-sm">
            <Marcador icono={Check} valor={r.presentes} etiqueta="Presentes" color="#2f7d3f" />
            <Marcador icono={Clock} valor={r.retardos} etiqueta="Retardos" color="#c77b1a" />
            <Marcador icono={X} valor={r.ausentes} etiqueta="Ausentes" color="#b73b3b" />
          </div>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando || !sinGuardar || filas.length === 0}
            className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition-opacity disabled:opacity-40"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {guardando ? "Guardando…" : sinGuardar ? "Guardar asistencia" : "Guardado"}
          </button>
        </div>
        {r.sinMarcar > 0 && (
          <p className="mt-2 text-xs font-semibold text-muted-foreground">
            {r.sinMarcar} sin marcar — no se guardan hasta que les des un estado.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Marcador({
  icono: Icono,
  valor,
  etiqueta,
  color,
}: {
  icono: typeof Check;
  valor: number;
  etiqueta: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icono className="h-4 w-4" style={{ color }} aria-hidden />
      <span className="font-bold tabular-nums text-foreground">{valor}</span>
      <span className="hidden text-xs font-semibold text-muted-foreground sm:inline">
        {etiqueta}
      </span>
    </div>
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

function Aviso({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center">
      <h2 className="text-lg font-bold text-primary">{titulo}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-muted-foreground">
        {detalle}
      </p>
    </div>
  );
}

/** Traduce el error de Postgres a algo que le sirva a quien pasa lista. */
function mensaje(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (err?.code === "42501" || err?.code === "PGRST301") {
    return "Tu cuenta no tiene permiso para capturar en este grupo. Coordinación asigna los grupos a cada docente.";
  }
  if (err?.code === "PGRST106") {
    return "El expediente escolar no está disponible todavía. Avisa a sistemas.";
  }
  return err?.message || "No se pudo cargar la lista. Intenta de nuevo.";
}
