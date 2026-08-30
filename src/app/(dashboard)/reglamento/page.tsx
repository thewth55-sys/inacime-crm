"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRolAcademico, ROLES_REGLAMENTO } from "@/hooks/use-rol-academico";
import { toast } from "sonner";
import { Loader2, Scale, TriangleAlert } from "lucide-react";

// Reglamento de evaluación.
//
// Es la contraparte de haber puesto las políticas en la base: sin esta
// pantalla, "configurable" significaba "configurable por quien sepa escribir
// SQL", que no es coordinación.
//
// La suma de ponderaciones la valida la base con un disparador diferible.
// Aquí se muestra el total mientras se edita para que nadie descubra el error
// al guardar, pero la regla de verdad vive allá — si esta pantalla se
// equivocara, la base seguiría rechazando.

const REDONDEOS = [
  { valor: "ninguno", nombre: "Sin redondeo", ejemplo: "8.47 → 8.47" },
  { valor: "un_decimal", nombre: "A un decimal", ejemplo: "8.47 → 8.5" },
  { valor: "medio_punto", nombre: "A medio punto", ejemplo: "8.47 → 8.5 · 8.20 → 8.0" },
  { valor: "entero", nombre: "A entero", ejemplo: "8.47 → 8" },
];

interface Politica {
  id: string;
  nombre: string;
  plan_id: string | null;
  minimo_aprobatorio: number;
  escala_min: number;
  escala_max: number;
  redondeo: string;
  asistencia_minima: number | null;
  permite_recurse: boolean;
  permite_extraordinario: boolean;
  notas: string | null;
}

interface Ponderacion {
  politica_id: string;
  periodo_clave: string;
  ponderacion: number;
  orden: number;
}

interface Plan {
  id: string;
  clave: string;
  programas: { nombre: string } | null;
}

/** Periodo tal como lo definió el ciclo activo, con su nombre legible. */
interface PeriodoDelCiclo {
  clave: string;
  nombre: string;
  orden: number;
}

/**
 * Un renglón por cada periodo que el ciclo realmente tiene.
 *
 * Antes la pantalla sólo mostraba los renglones que ya existían en
 * `politica_periodos`. Si una coordinación agregaba un cuarto parcial al
 * ciclo, el reglamento seguía repartiendo entre tres y el nuevo periodo
 * no contaba para la definitiva, sin que nada lo dijera. Ahora los
 * periodos mandan: los que faltan aparecen en 0 y quien edite tiene que
 * repartir el 100% antes de poder guardar.
 */
function completarPesos(
  guardados: Ponderacion[],
  periodos: PeriodoDelCiclo[],
  politicas: Politica[],
): Ponderacion[] {
  if (periodos.length === 0) return guardados;
  const salida: Ponderacion[] = [];
  for (const pol of politicas) {
    for (const per of periodos) {
      const ya = guardados.find(
        (g) => g.politica_id === pol.id && g.periodo_clave === per.clave,
      );
      salida.push(
        ya ?? {
          politica_id: pol.id,
          periodo_clave: per.clave,
          ponderacion: 0,
          orden: per.orden,
        },
      );
    }
  }
  return salida;
}

export default function ReglamentoPage() {
  const { rol, cargando: cargandoRol } = useRolAcademico();
  const [politicas, setPoliticas] = useState<Politica[]>([]);
  const [pesos, setPesos] = useState<Ponderacion[]>([]);
  const [periodos, setPeriodos] = useState<PeriodoDelCiclo[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [selId, setSelId] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeEditar = rol !== null && ROLES_REGLAMENTO.includes(rol);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const a = createClient().schema("academico");
      const [pol, pon, pl, per] = await Promise.all([
        a.from("politicas_evaluacion").select("*").is("vigente_hasta", null).order("nombre"),
        a.from("politica_periodos").select("*").order("orden"),
        a.from("planes_estudio").select("id, clave, programas ( nombre )"),
        a
          .from("periodos")
          .select("clave, nombre, orden, ciclos!inner ( estado )")
          .eq("ciclos.estado", "activo")
          .order("orden"),
      ]);
      if (pol.error) throw pol.error;
      const lista = (pol.data ?? []) as unknown as Politica[];
      setPoliticas(lista);
      setPlanes((pl.data ?? []) as unknown as Plan[]);
      setPeriodos((per.data ?? []) as unknown as PeriodoDelCiclo[]);
      setPesos(
        completarPesos(
          (pon.data ?? []) as unknown as Ponderacion[],
          (per.data ?? []) as unknown as PeriodoDelCiclo[],
          lista,
        ),
      );
      if (lista.length > 0 && !selId) setSelId(lista[0].id);
      setSucio(false);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "No se pudo cargar el reglamento.");
    } finally {
      setCargando(false);
    }
  }, [selId]);

  useEffect(() => {
    void cargar();
    // Sólo al montar: `cargar` depende de selId y volvería a disparar al elegir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sel = politicas.find((p) => p.id === selId) ?? null;
  const misPesos = pesos.filter((p) => p.politica_id === selId);
  const suma = misPesos.reduce((t, p) => t + Number(p.ponderacion), 0);
  const sumaOk = Math.abs(suma - 1) < 0.0001;

  const editar = <K extends keyof Politica>(campo: K, valor: Politica[K]) => {
    setPoliticas((prev) =>
      prev.map((p) => (p.id === selId ? { ...p, [campo]: valor } : p)),
    );
    setSucio(true);
  };

  const editarPeso = (clave: string, valor: number) => {
    setPesos((prev) =>
      prev.map((p) =>
        p.politica_id === selId && p.periodo_clave === clave
          ? { ...p, ponderacion: valor }
          : p,
      ),
    );
    setSucio(true);
  };

  const guardar = async () => {
    if (!sel) return;
    if (!sumaOk) {
      toast.error(`Las ponderaciones suman ${(suma * 100).toFixed(2)}%. Deben sumar 100%.`);
      return;
    }
    setGuardando(true);
    try {
      const a = createClient().schema("academico");
      const { error: e1 } = await a
        .from("politicas_evaluacion")
        .update({
          nombre: sel.nombre,
          minimo_aprobatorio: sel.minimo_aprobatorio,
          escala_min: sel.escala_min,
          escala_max: sel.escala_max,
          redondeo: sel.redondeo,
          asistencia_minima: sel.asistencia_minima,
          permite_recurse: sel.permite_recurse,
          permite_extraordinario: sel.permite_extraordinario,
          notas: sel.notas,
        })
        .eq("id", sel.id);
      if (e1) throw e1;

      const { error: e2 } = await a
        .from("politica_periodos")
        .upsert(misPesos, { onConflict: "politica_id,periodo_clave" });
      if (e2) throw e2;

      toast.success("Reglamento actualizado. Aplica desde el próximo cálculo.");
      setSucio(false);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  };

  if (cargandoRol || cargando) return <Cargando />;

  if (!puedeEditar) {
    return (
      <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center">
        <h2 className="text-lg font-bold text-primary">Sólo lectura</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-muted-foreground">
          El reglamento de evaluación lo modifican dirección y coordinación
          académica. Puedes consultarlo, pero no cambiarlo.
        </p>
      </div>
    );
  }

  const nombrePlan = (id: string | null) => {
    if (id === null) return "Institucional · aplica a los planes sin política propia";
    const p = planes.find((x) => x.id === id);
    return p ? `${p.programas?.nombre ?? ""} · plan ${p.clave}` : "Plan desconocido";
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.5px] text-primary">
          Reglamento de evaluación
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define cómo se califica en cada plan. Los cambios aplican al siguiente
          cálculo, sin tocar las calificaciones ya firmadas.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-[#f3c4c4] bg-[#fdeaea] px-4 py-3 text-sm font-semibold text-[#b73b3b]">
          {error}
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">
          POLÍTICA
        </span>
        <select
          value={selId}
          onChange={(e) => setSelId(e.target.value)}
          className="h-12 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground outline-none focus:border-primary"
        >
          {politicas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre} — {nombrePlan(p.plan_id)}
            </option>
          ))}
        </select>
      </label>

      {sel && (
        <>
          {/* La semilla marca lo provisional tanto en el nombre como en las
              notas; se revisan los dos porque coordinación puede reescribir
              uno y dejar el otro. */}
          {`${sel.nombre} ${sel.notas ?? ""}`.toLowerCase().includes("provisional") && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-[#f3d9b3] bg-[#fff8ec] px-4 py-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#c77b1a]" aria-hidden />
              <p className="text-sm font-semibold leading-relaxed text-[#a3773a]">
                Estos son valores de arranque, no el reglamento oficial de
                INACIME. Ajústalos en cuanto tengas el documento.
              </p>
            </div>
          )}

          <Panel titulo="Escala y aprobación">
            <div className="grid gap-4 sm:grid-cols-3">
              <Numero
                etiqueta="Escala mínima"
                valor={sel.escala_min}
                onChange={(v) => editar("escala_min", v)}
              />
              <Numero
                etiqueta="Escala máxima"
                valor={sel.escala_max}
                onChange={(v) => editar("escala_max", v)}
              />
              <Numero
                etiqueta="Mínimo aprobatorio"
                valor={sel.minimo_aprobatorio}
                onChange={(v) => editar("minimo_aprobatorio", v)}
              />
            </div>
          </Panel>

          <Panel
            titulo="Redondeo"
            ayuda="Cómo se ajusta la definitiva antes de asentarla en el acta."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {REDONDEOS.map((r) => (
                <button
                  key={r.valor}
                  type="button"
                  onClick={() => editar("redondeo", r.valor)}
                  className={`flex flex-col items-start rounded-xl border px-4 py-3 text-left transition-colors ${
                    sel.redondeo === r.valor
                      ? "border-primary bg-primary-soft"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <span className="text-sm font-bold text-foreground">{r.nombre}</span>
                  <span className="mt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                    {r.ejemplo}
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel
            titulo="Peso de cada periodo"
            ayuda={
              periodos.length > 0
                ? `Los ${periodos.length} periodos del ciclo activo. Cuánto aporta cada uno a la definitiva; deben sumar 100%. Un periodo puede pesar 0 si se captura pero no cuenta.`
                : "Cuánto aporta cada periodo a la definitiva. Deben sumar 100%."
            }
          >
            <div className="flex flex-col gap-2">
              {misPesos.map((p) => (
                <div key={p.periodo_clave} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-sm font-bold text-foreground">
                    {periodos.find((x) => x.clave === p.periodo_clave)?.nombre ?? p.periodo_clave}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={(Number(p.ponderacion) * 100).toFixed(2)}
                    onChange={(e) =>
                      editarPeso(p.periodo_clave, Number(e.target.value) / 100)
                    }
                    aria-label={`Peso de ${p.periodo_clave} en porcentaje`}
                    className="h-11 w-28 rounded-lg border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-3 text-center text-sm font-bold tabular-nums text-foreground outline-none focus:border-primary focus:bg-card"
                  />
                  <span className="text-sm font-semibold text-muted-foreground">%</span>
                </div>
              ))}
              <div
                className={`mt-1 text-sm font-bold ${
                  sumaOk ? "text-[#2f7d3f]" : "text-[#b73b3b]"
                }`}
              >
                Total: {(suma * 100).toFixed(2)}%
                {!sumaOk && " — debe sumar 100% para poder guardar"}
              </div>
            </div>
          </Panel>

          <Panel
            titulo="Condiciones"
            ayuda="Reglas que acompañan a la calificación."
          >
            <div className="flex flex-col gap-4">
              <Numero
                etiqueta="Asistencia mínima para tener derecho a calificación (%)"
                valor={sel.asistencia_minima ?? 0}
                onChange={(v) => editar("asistencia_minima", v === 0 ? null : v)}
                ayuda="Cero deja la condición desactivada."
              />
              <Interruptor
                etiqueta="Permite recursamiento"
                activo={sel.permite_recurse}
                onChange={(v) => editar("permite_recurse", v)}
              />
              <Interruptor
                etiqueta="Permite examen extraordinario"
                activo={sel.permite_extraordinario}
                onChange={(v) => editar("permite_extraordinario", v)}
              />
            </div>
          </Panel>

          <Panel titulo="Notas">
            <textarea
              value={sel.notas ?? ""}
              onChange={(e) => editar("notas", e.target.value)}
              rows={3}
              placeholder="Referencia al artículo del reglamento, acuerdo de academia, fecha de aprobación…"
              className="w-full rounded-xl border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary focus:bg-card"
            />
          </Panel>

          <div className="sticky bottom-0 flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-5 py-3">
            <p className="text-xs font-semibold text-muted-foreground">
              <Scale className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              Cambiar el reglamento no altera actas ya firmadas.
            </p>
            <button
              type="button"
              onClick={guardar}
              disabled={guardando || !sucio || !sumaOk}
              className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-40"
            >
              {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {guardando ? "Guardando…" : sucio ? "Guardar reglamento" : "Guardado"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Panel({
  titulo,
  ayuda,
  children,
}: {
  titulo: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-base font-bold text-primary">{titulo}</h2>
      {ayuda && (
        <p className="mt-0.5 text-xs font-semibold text-muted-foreground">{ayuda}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Numero({
  etiqueta,
  valor,
  onChange,
  ayuda,
}: {
  etiqueta: string;
  valor: number;
  onChange: (v: number) => void;
  ayuda?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-muted-foreground">{etiqueta}</span>
      <input
        type="number"
        step="0.1"
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full rounded-lg border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-3 text-sm font-bold tabular-nums text-foreground outline-none focus:border-primary focus:bg-card"
      />
      {ayuda && <span className="text-[11px] font-semibold text-muted-foreground">{ayuda}</span>}
    </label>
  );
}

function Interruptor({
  etiqueta,
  activo,
  onChange,
}: {
  etiqueta: string;
  activo: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        checked={activo}
        onChange={(e) => onChange(e.target.checked)}
        className="h-[18px] w-[18px] accent-[#00C1F4]"
      />
      <span className="text-sm font-semibold text-foreground">{etiqueta}</span>
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
