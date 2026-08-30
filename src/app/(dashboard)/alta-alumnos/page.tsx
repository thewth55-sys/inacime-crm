"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRolAcademico } from "@/hooks/use-rol-academico";
import { toast } from "sonner";
import { Loader2, GraduationCap, ShieldAlert, ArrowRight, Check } from "lucide-react";
import {
  cargarPendientesDeAlta,
  cargarPlanes,
  type AspiranteGanado,
  type Plan,
} from "@/lib/academico/inscripcion";
import { cargarMisGrupos } from "@/lib/academico/asistencias";
import type { GrupoDocente } from "@/lib/academico/tipos";

// Alta de alumnos a partir de aspirantes ganados.
//
// Antes, convertir a un aspirante en alumno dependía de que admisiones se
// acordara de avisar por otro canal. Aquí el propio sistema lo empuja: en
// cuanto un negocio se marca como ganado, aparece en esta cola y no se va
// hasta que alguien le asigna matrícula y plan.
//
// Se prellena todo lo que el CRM ya sabe —nombre, teléfono, correo, programa
// de interés— porque volver a teclearlo es donde se cuelan las erratas que
// después nadie entiende.

export default function AltaAlumnosPage() {
  const { rol, cargando: cargandoRol } = useRolAcademico();
  const [pendientes, setPendientes] = useState<AspiranteGanado[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [grupos, setGrupos] = useState<GrupoDocente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [activo, setActivo] = useState<AspiranteGanado | null>(null);
  const [enviando, setEnviando] = useState(false);

  const [form, setForm] = useState({
    matricula: "",
    nombre: "",
    planId: "",
    password: "",
    correoPersonal: "",
    telefono: "",
    curp: "",
    grupoIds: [] as string[],
  });

  const puede = rol === "direccion" || rol === "control_escolar";

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const db = createClient();
      const [ps, pl, gs] = await Promise.all([
        cargarPendientesDeAlta(db),
        cargarPlanes(db),
        cargarMisGrupos(db).catch(() => []),
      ]);
      setPendientes(ps);
      setPlanes(pl);
      setGrupos(gs);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "No se pudo cargar la cola.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const abrir = (a: AspiranteGanado) => {
    setActivo(a);
    // Lo que el CRM ya sabe entra prellenado; la matrícula es lo único que
    // no puede adivinarse.
    setForm({
      matricula: "",
      nombre: a.nombre,
      planId: planes.find((p) => p.programa === a.programa)?.id ?? planes[0]?.id ?? "",
      password: "",
      correoPersonal: a.correo ?? "",
      telefono: a.telefono ?? "",
      curp: "",
      grupoIds: [],
    });
  };

  const alternarGrupo = (id: string) =>
    setForm((f) => ({
      ...f,
      grupoIds: f.grupoIds.includes(id)
        ? f.grupoIds.filter((g) => g !== id)
        : [...f.grupoIds, id],
    }));

  const darDeAlta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activo) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/academico/alumnos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, contactId: activo.contactId }),
      });
      const json = await r.json();
      if (!r.ok) {
        toast.error(json.error ?? "No se pudo dar de alta.");
        return;
      }
      toast.success(
        `${form.nombre} entra con su matrícula ${json.matricula}` +
          (json.inscritoEn > 0 ? ` · inscrito en ${json.inscritoEn} grupo(s)` : ""),
      );
      setActivo(null);
      await cargar();
    } catch {
      toast.error("No se pudo contactar al servidor.");
    } finally {
      setEnviando(false);
    }
  };

  if (cargandoRol || cargando) return <Cargando />;

  if (!puede) {
    return (
      <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center">
        <ShieldAlert className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-primary">Sin acceso</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-muted-foreground">
          Dar de alta alumnos es competencia de dirección y control escolar.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.5px] text-primary">
          Alta de alumnos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aspirantes que ganaron su lugar y esperan matrícula. Salen de la lista
          en cuanto tienen expediente.
        </p>
      </div>

      {pendientes.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center">
          <Check className="mx-auto h-6 w-6 text-[#2f7d3f]" aria-hidden />
          <h2 className="mt-3 text-lg font-bold text-primary">Nada pendiente</h2>
          <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-muted-foreground">
            Todos los aspirantes ganados ya tienen expediente. Cuando admisiones
            marque otro negocio como ganado, aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <div className="text-base font-bold text-primary">
              {pendientes.length}{" "}
              {pendientes.length === 1 ? "aspirante espera" : "aspirantes esperan"} matrícula
            </div>
            <div className="text-xs font-semibold text-muted-foreground">
              Vienen del embudo de admisiones, marcados como ganados.
            </div>
          </div>
          <ul>
            {pendientes.map((a) => (
              <li
                key={a.dealId}
                className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3.5 last:border-b-0"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-soft text-[11px] font-bold text-primary">
                  {iniciales(a.nombre)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-foreground">{a.nombre}</div>
                  <div className="truncate text-xs font-semibold text-muted-foreground">
                    {a.telefono}
                    {a.programa ? ` · ${a.programa}` : ""}
                    {" · ganado el "}
                    {new Date(a.ganadoEn).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => abrir(a)}
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
                >
                  Dar de alta
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Formulario de alta */}
      {activo && (
        <form onSubmit={darDeAlta} className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <GraduationCap className="h-5 w-5 text-primary" aria-hidden />
            <div>
              <div className="text-base font-bold text-primary">
                Expediente de {activo.nombre}
              </div>
              <div className="text-xs font-semibold text-muted-foreground">
                Los datos del CRM vienen prellenados. Revísalos antes de guardar.
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="MATRÍCULA" ayuda="Con esto entra al portal. No se puede cambiar después.">
              <input
                value={form.matricula}
                onChange={(e) => setForm({ ...form, matricula: e.target.value })}
                required
                placeholder="12410783"
                className={ENTRADA}
              />
            </Campo>

            <Campo etiqueta="NOMBRE COMPLETO">
              <input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                required
                className={ENTRADA}
              />
            </Campo>

            <Campo etiqueta="PLAN DE ESTUDIOS" ayuda="Define su mapa curricular y el reglamento que se le aplica.">
              <select
                value={form.planId}
                onChange={(e) => setForm({ ...form, planId: e.target.value })}
                required
                className={ENTRADA}
              >
                <option value="">Elige un plan…</option>
                {planes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.programa} · {p.clave}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="CURP" ayuda="Obligatoria para facturar colegiaturas deducibles.">
              <input
                value={form.curp}
                onChange={(e) => setForm({ ...form, curp: e.target.value.toUpperCase() })}
                maxLength={18}
                placeholder="18 caracteres"
                className={ENTRADA}
              />
            </Campo>

            <Campo
              etiqueta="CORREO PERSONAL"
              ayuda="A éste llega el restablecimiento de contraseña. Puede ser el del tutor."
            >
              <input
                type="email"
                value={form.correoPersonal}
                onChange={(e) => setForm({ ...form, correoPersonal: e.target.value })}
                className={ENTRADA}
              />
            </Campo>

            <Campo etiqueta="TELÉFONO">
              <input
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                className={ENTRADA}
              />
            </Campo>

            <Campo
              etiqueta="CONTRASEÑA PROVISIONAL"
              ayuda="Se la entregas en persona. Va visible a propósito: oculta, se teclea mal y nadie se entera hasta que no puede entrar."
            >
              <input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
                placeholder="Mínimo 8 caracteres"
                className={ENTRADA}
              />
            </Campo>
          </div>

          {grupos.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">
                INSCRIBIR EN GRUPOS DEL CICLO ACTIVO
              </div>
              <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
                Opcional. Puedes inscribirlo después desde grupos.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {grupos.map((g) => {
                  const puesto = form.grupoIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => alternarGrupo(g.id)}
                      aria-pressed={puesto}
                      className={`rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                        puesto
                          ? "border-primary bg-primary-soft text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {g.clave} — {g.materia}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              type="submit"
              disabled={enviando}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-40"
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {enviando ? "Dando de alta…" : "Crear expediente y acceso"}
            </button>
            <button
              type="button"
              onClick={() => setActivo(null)}
              className="h-11 rounded-xl border border-border bg-card px-5 text-sm font-bold text-primary"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const ENTRADA =
  "h-12 w-full rounded-xl border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-4 text-sm font-semibold text-foreground outline-none focus:border-primary focus:bg-card";

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
      <span className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">
        {etiqueta}
      </span>
      {children}
      {ayuda && (
        <span className="text-[11px] font-semibold leading-snug text-muted-foreground">
          {ayuda}
        </span>
      )}
    </label>
  );
}

function iniciales(nombre: string): string {
  const p = nombre.replace(",", "").trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}

function Cargando() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm font-semibold text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      Cargando…
    </div>
  );
}
