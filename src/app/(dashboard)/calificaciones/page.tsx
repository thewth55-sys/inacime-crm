"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRolAcademico, ROLES_STAFF } from "@/hooks/use-rol-academico";
import { toast } from "sonner";
import { Loader2, Lock, LockOpen, ShieldCheck } from "lucide-react";
import { cargarMisGrupos } from "@/lib/academico/asistencias";
import {
  cargarActa,
  cargarCaptura,
  cargarPeriodos,
  cargarPolitica,
  cerrarActa,
  guardarCalificaciones,
  reabrirActa,
  type EstadoActa,
  type FilaCaptura,
  type Periodo,
  type Politica,
} from "@/lib/academico/calificaciones";
import type { GrupoDocente } from "@/lib/academico/tipos";

// Captura de calificaciones y cierre de acta.
//
// Dos cosas que esta pantalla NO decide, a propósito:
//
//   La definitiva la calcula la base con la política del plan. Traerla aquí
//   significaría que cambiar el reglamento obliga a desplegar.
//
//   Que un acta cerrada no se pueda editar lo impone RLS. Aquí sólo se
//   deshabilitan los campos para no invitar a intentarlo — si alguien
//   quitara el `disabled` desde el navegador, la base seguiría rechazando.

export default function CalificacionesPage() {
  const { user } = useAuth();
  const { rol, cargando: cargandoRol } = useRolAcademico();

  const [grupos, setGrupos] = useState<GrupoDocente[] | null>(null);
  const [grupoId, setGrupoId] = useState("");
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [periodoId, setPeriodoId] = useState("");
  const [filas, setFilas] = useState<FilaCaptura[]>([]);
  const [politica, setPolitica] = useState<Politica | null>(null);
  const [acta, setActa] = useState<EstadoActa>({
    id: null,
    estado: "abierta",
    firmadaEn: null,
  });
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [sinGuardar, setSinGuardar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeReabrir = rol !== null && ROLES_STAFF.includes(rol);
  const cerrada = acta.estado === "cerrada";
  const periodo = periodos.find((p) => p.id === periodoId);

  useEffect(() => {
    const db = createClient();
    cargarMisGrupos(db)
      .then(async (gs) => {
        setGrupos(gs);
        if (gs.length === 0) return;
        setGrupoId(gs[0].id);
        const ps = await cargarPeriodos(db, gs[0].cicloClave);
        setPeriodos(ps);
        if (ps.length > 0) setPeriodoId(ps[0].id);
      })
      .catch((e) => setError(mensaje(e)))
      .finally(() => setCargando(false));
  }, []);

  const recargar = useCallback(async () => {
    if (!grupoId || !periodoId || periodos.length === 0) return;
    setCargando(true);
    setError(null);
    try {
      const db = createClient();
      const [fs, a] = await Promise.all([
        cargarCaptura(db, grupoId, periodos),
        cargarActa(db, grupoId, periodoId),
      ]);
      setFilas(fs);
      setActa(a);
      setPolitica(fs.length > 0 ? await cargarPolitica(db, fs[0].inscripcionId) : null);
      setSinGuardar(false);
    } catch (e) {
      setError(mensaje(e));
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, [grupoId, periodoId, periodos]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const escribir = (inscripcionId: string, texto: string) => {
    const n = texto === "" ? null : Number(texto);
    setFilas((prev) =>
      prev.map((f) =>
        f.inscripcionId === inscripcionId && periodo
          ? { ...f, valores: { ...f.valores, [periodo.clave]: n } }
          : f,
      ),
    );
    setSinGuardar(true);
  };

  const guardar = async () => {
    if (!periodo || !user) return;
    setGuardando(true);
    try {
      const n = await guardarCalificaciones(
        createClient(),
        periodo.id,
        user.id,
        filas.map((f) => ({
          inscripcionId: f.inscripcionId,
          valor: f.valores[periodo.clave] ?? null,
        })),
      );
      toast.success(n === 1 ? "Se guardó 1 calificación" : `Se guardaron ${n} calificaciones`);
      await recargar();
    } catch (e) {
      toast.error(mensaje(e));
    } finally {
      setGuardando(false);
    }
  };

  const cerrar = async () => {
    if (!periodo || !user) return;
    const faltan = filas.filter((f) => f.valores[periodo.clave] == null).length;
    const aviso =
      faltan > 0
        ? `Quedan ${faltan} sin calificar. Al cerrar el acta ya no podrás capturarlas sin pedir una reapertura.\n\n¿Cerrar de todos modos?`
        : "Al cerrar el acta las calificaciones quedan firmadas y los alumnos las verán. Sólo coordinación puede reabrirla.\n\n¿Cerrar y firmar?";
    if (!window.confirm(aviso)) return;

    setGuardando(true);
    try {
      await cerrarActa(createClient(), grupoId, periodo.id, user.id);
      toast.success("Acta cerrada y firmada");
      await recargar();
    } catch (e) {
      toast.error(mensaje(e));
    } finally {
      setGuardando(false);
    }
  };

  const reabrir = async () => {
    if (!acta.id) return;
    const motivo = window.prompt(
      "¿Por qué se reabre el acta? Queda registrado de forma permanente en la bitácora.",
    );
    if (!motivo?.trim()) return;
    setGuardando(true);
    try {
      await reabrirActa(createClient(), acta.id, motivo.trim());
      toast.success("Acta reabierta");
      await recargar();
    } catch (e) {
      toast.error(mensaje(e));
    } finally {
      setGuardando(false);
    }
  };

  if (cargandoRol || (cargando && grupos === null)) return <Cargando />;

  if (grupos !== null && grupos.length === 0) {
    return (
      <Aviso
        titulo="No tienes grupos en el ciclo activo"
        detalle="Las calificaciones se capturan sobre los grupos asignados en el ciclo abierto."
      />
    );
  }

  const capturadas = periodo
    ? filas.filter((f) => f.valores[periodo.clave] != null).length
    : 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.5px] text-primary">
          Calificaciones por grupo
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          La definitiva la calcula el sistema con el reglamento del plan. No se
          captura a mano.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="GRUPO">
          <select
            value={grupoId}
            onChange={(e) => setGrupoId(e.target.value)}
            className="h-12 w-full rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground outline-none focus:border-primary"
          >
            {grupos?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.cicloClave} · {g.clave} — {g.materia}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="PERIODO A CAPTURAR">
          <select
            value={periodoId}
            onChange={(e) => setPeriodoId(e.target.value)}
            className="h-12 w-full rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground outline-none focus:border-primary"
          >
            {periodos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[#f3c4c4] bg-[#fdeaea] px-4 py-3 text-sm font-semibold text-[#b73b3b]"
        >
          {error}
        </div>
      )}

      {/* Estado del acta */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
          cerrada
            ? "border-[#c9dbb1] bg-[#f2f8ea]"
            : "border-border bg-card"
        }`}
      >
        <div className="flex items-center gap-2.5">
          {cerrada ? (
            <Lock className="h-4 w-4 text-[#2f7d3f]" aria-hidden />
          ) : (
            <LockOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <div>
            <div className="text-sm font-bold text-foreground">
              {cerrada ? "Acta cerrada y firmada" : "Captura abierta"}
            </div>
            <div className="text-xs font-semibold text-muted-foreground">
              {cerrada
                ? "Los alumnos ya ven su calificación. Sólo coordinación puede reabrirla."
                : `${capturadas} de ${filas.length} capturadas · los alumnos aún no la ven`}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {!cerrada && (
            <>
              <button
                type="button"
                onClick={guardar}
                disabled={guardando || !sinGuardar}
                className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-bold text-primary disabled:opacity-40"
              >
                {guardando ? "Guardando…" : sinGuardar ? "Guardar borrador" : "Guardado"}
              </button>
              <button
                type="button"
                onClick={cerrar}
                disabled={guardando || filas.length === 0}
                className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-40"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Cerrar y firmar acta
              </button>
            </>
          )}
          {cerrada && puedeReabrir && (
            <button
              type="button"
              onClick={reabrir}
              disabled={guardando}
              className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-bold text-primary disabled:opacity-40"
            >
              Reabrir acta
            </button>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40">
              <Th>ALUMNO</Th>
              <Th>MATRÍCULA</Th>
              {periodos.map((p) => (
                <Th key={p.id} centro>
                  {p.clave}
                </Th>
              ))}
              <Th centro>DEFINITIVA</Th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr>
                <td colSpan={periodos.length + 3}>
                  <Cargando />
                </td>
              </tr>
            ) : filas.length === 0 ? (
              <tr>
                <td
                  colSpan={periodos.length + 3}
                  className="px-4 py-10 text-center text-sm font-semibold text-muted-foreground"
                >
                  Este grupo no tiene alumnos inscritos.
                </td>
              </tr>
            ) : (
              filas.map((f) => (
                <tr key={f.inscripcionId} className="border-t border-border/60">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary-soft text-[11px] font-bold text-primary">
                        {f.iniciales}
                      </span>
                      <span className="text-sm font-bold text-foreground">{f.nombre}</span>
                      {f.tipo !== "regular" && (
                        <span className="rounded-md bg-[#fff1e0] px-1.5 py-0.5 text-[10px] font-bold text-[#c77b1a]">
                          {f.tipo}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs font-semibold tabular-nums text-muted-foreground">
                    {f.matricula}
                  </td>
                  {periodos.map((p) => {
                    const esActivo = p.id === periodoId;
                    const v = f.valores[p.clave];
                    return (
                      <td key={p.id} className="px-2 py-2.5 text-center">
                        {esActivo && !cerrada ? (
                          <input
                            type="number"
                            step="0.1"
                            min={politica?.escalaMin ?? 0}
                            max={politica?.escalaMax ?? 10}
                            value={v ?? ""}
                            onChange={(e) => escribir(f.inscripcionId, e.target.value)}
                            aria-label={`${p.nombre} de ${f.nombre}`}
                            className="h-10 w-20 rounded-lg border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] text-center text-sm font-bold text-foreground outline-none focus:border-primary focus:bg-card"
                          />
                        ) : (
                          <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                            {v ?? "—"}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-center">
                    <Definitiva valor={f.definitiva} politica={politica} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {politica && (
        <p className="text-xs font-semibold text-muted-foreground">
          Reglamento aplicado: <strong>{politica.nombre}</strong> · mínimo
          aprobatorio {politica.minimoAprobatorio} · escala {politica.escalaMin}–
          {politica.escalaMax}
          {politica.esInstitucional && " · política institucional, el plan no tiene una propia"}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Definitiva({
  valor,
  politica,
}: {
  valor: number | null;
  politica: Politica | null;
}) {
  if (valor === null) {
    return (
      <span
        className="text-xs font-semibold text-muted-foreground"
        title="Falta capturar algún periodo. Una definitiva a medias se lee como reprobado."
      >
        —
      </span>
    );
  }
  const aprueba = politica ? valor >= politica.minimoAprobatorio : true;
  return (
    <span
      className={`inline-block rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums ${
        aprueba ? "bg-[#eaf7ee] text-[#2f7d3f]" : "bg-[#fdeaea] text-[#b73b3b]"
      }`}
    >
      {valor}
    </span>
  );
}

function Th({ children, centro }: { children: React.ReactNode; centro?: boolean }) {
  return (
    <th
      className={`px-4 py-3 text-[10.5px] font-bold tracking-[0.8px] text-muted-foreground ${
        centro ? "text-center" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">
        {etiqueta}
      </span>
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

function mensaje(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (err?.message?.includes("acta de este grupo")) {
    return "El acta ya está cerrada. Pide a coordinación que la reabra para corregir.";
  }
  if (err?.code === "42501" || err?.code === "PGRST301") {
    return "Tu cuenta no tiene permiso para capturar en este grupo.";
  }
  return err?.message || "No se pudo cargar. Intenta de nuevo.";
}
