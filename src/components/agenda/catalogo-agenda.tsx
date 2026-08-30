"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import type { Entrevistador, SalaEntrevista, TipoEntrevista } from "@/lib/agenda/tipos";

// Catálogo de la agenda: quién entrevista, dónde y qué se agenda.
//
// Existe por la misma razón que la pantalla de reglamento: son datos de
// operación que cambian cada ciclo —entra una coordinadora nueva, se
// habilita un aula en Tecámac, se agrega el examen de admisión— y
// dejarlos en el código obligaría a un despliegue por cada cambio.

export function CatalogoAgenda() {
  const { profile, profileLoading } = useAuth();
  const puede = useCan("edit-settings");

  const [cargando, setCargando] = useState(true);
  const [entrevistadores, setEntrevistadores] = useState<Entrevistador[]>([]);
  const [salas, setSalas] = useState<SalaEntrevista[]>([]);
  const [tipos, setTipos] = useState<TipoEntrevista[]>([]);
  const [miembros, setMiembros] = useState<{ user_id: string; full_name: string | null; email: string | null }[]>([]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const db = createClient();
      const [e, s, t, m] = await Promise.all([
        db.from("entrevistadores").select("*").order("nombre"),
        db.from("salas_entrevista").select("*").order("nombre"),
        db.from("tipos_entrevista").select("*").order("nombre"),
        db.from("profiles").select("user_id, full_name, email"),
      ]);
      setEntrevistadores((e.data ?? []) as Entrevistador[]);
      setSalas((s.data ?? []) as SalaEntrevista[]);
      setTipos((t.data ?? []) as TipoEntrevista[]);
      setMiembros(m.data ?? []);
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? "No se pudo cargar el catálogo.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function crear(tabla: string, fila: Record<string, unknown>) {
    if (!profile?.account_id) {
      toast.error("Tu perfil todavía no tiene cuenta asignada.");
      return;
    }
    const { error } = await createClient()
      .from(tabla)
      .insert({ ...fila, account_id: profile.account_id });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Guardado");
    await cargar();
  }

  async function borrar(tabla: string, id: string) {
    const { error } = await createClient().from(tabla).delete().eq("id", id);
    if (error) {
      // Las entrevistas ya agendadas conservan su historia: el borrado
      // pone la referencia en NULL, no arrastra la cita. Si aun así
      // falla, casi siempre es RLS y decirlo tal cual ahorra adivinar.
      toast.error(error.message);
      return;
    }
    await cargar();
  }

  if (profileLoading || cargando) return <Cargando />;

  if (!puede) {
    return (
      <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center">
        <ShieldAlert className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-primary">Sólo administradores</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-muted-foreground">
          El catálogo de la agenda lo mantiene quien administra la cuenta. Puedes
          seguir agendando entrevistas con lo que ya está dado de alta.
        </p>
      </div>
    );
  }

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
        <h1 className="text-[28px] font-bold tracking-[-0.5px] text-primary">
          Catálogo de la agenda
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quién puede entrevistar, en qué salas y qué tipos de cita existen. Todo
          se edita aquí, sin tocar código.
        </p>
      </div>

      <Bloque
        titulo="Entrevistadores"
        ayuda="Liga la ficha a una cuenta del panel para que esa persona pueda declarar su propia disponibilidad."
        campos={[
          { clave: "nombre", etiqueta: "NOMBRE", requerido: true, ancho: "1.4fr" },
          { clave: "cargo", etiqueta: "CARGO", marcador: "Coordinación de Odontología" },
          {
            clave: "user_id",
            etiqueta: "CUENTA",
            opciones: [
              { valor: "", texto: "Sin cuenta" },
              ...miembros.map((m) => ({
                valor: m.user_id,
                texto: m.full_name || m.email || m.user_id.slice(0, 8),
              })),
            ],
          },
        ]}
        onCrear={(v) => crear("entrevistadores", { ...v, user_id: v.user_id || null })}
        filas={entrevistadores.map((e) => ({
          id: e.id,
          titulo: e.nombre,
          detalle: [e.cargo, e.user_id ? "cuenta ligada" : "sin cuenta ligada"]
            .filter(Boolean)
            .join(" · "),
        }))}
        onBorrar={(id) => borrar("entrevistadores", id)}
        vacio="Nadie puede recibir aspirantes todavía."
      />

      <Bloque
        titulo="Salas"
        ayuda="El campus es texto libre: abrir una sede nueva no debería requerir un despliegue."
        campos={[
          { clave: "nombre", etiqueta: "SALA", requerido: true, marcador: "Sala de admisiones 1" },
          { clave: "campus", etiqueta: "CAMPUS", marcador: "Coacalco" },
        ]}
        onCrear={(v) => crear("salas_entrevista", v)}
        filas={salas.map((s) => ({
          id: s.id,
          titulo: s.nombre,
          detalle: s.campus ?? "sin campus",
        }))}
        onBorrar={(id) => borrar("salas_entrevista", id)}
        vacio="Sin salas, una cita no dice a dónde presentarse."
      />

      <Bloque
        titulo="Tipos de entrevista"
        ayuda="La duración se usa como valor de arranque al agendar; siempre se puede ajustar cita por cita."
        campos={[
          { clave: "nombre", etiqueta: "TIPO", requerido: true, marcador: "Entrevista de admisión" },
          { clave: "duracion_min", etiqueta: "MINUTOS", tipo: "number", inicial: "30", ancho: "110px" },
        ]}
        onCrear={(v) => crear("tipos_entrevista", { ...v, duracion_min: Number(v.duracion_min) || 30 })}
        filas={tipos.map((t) => ({
          id: t.id,
          titulo: t.nombre,
          detalle: `${t.duracion_min} min`,
        }))}
        onBorrar={(id) => borrar("tipos_entrevista", id)}
        vacio="Sin tipos, cada quien decide cuánto dura una entrevista."
      />
    </div>
  );
}

interface CampoDef {
  clave: string;
  etiqueta: string;
  requerido?: boolean;
  marcador?: string;
  tipo?: string;
  inicial?: string;
  ancho?: string;
  opciones?: { valor: string; texto: string }[];
}

function Bloque({
  titulo,
  ayuda,
  campos,
  onCrear,
  filas,
  onBorrar,
  vacio,
}: {
  titulo: string;
  ayuda: string;
  campos: CampoDef[];
  onCrear: (valores: Record<string, string>) => Promise<void>;
  filas: { id: string; titulo: string; detalle: string }[];
  onBorrar: (id: string) => Promise<void>;
  vacio: string;
}) {
  const inicial = () =>
    Object.fromEntries(campos.map((c) => [c.clave, c.inicial ?? ""])) as Record<string, string>;
  const [valores, setValores] = useState<Record<string, string>>(inicial);
  const [guardando, setGuardando] = useState(false);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await onCrear(valores);
      setValores(inicial());
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-base font-bold text-primary">{titulo}</h2>
        <p className="text-xs font-semibold text-muted-foreground">{ayuda}</p>
      </div>

      <form
        onSubmit={enviar}
        className="grid gap-3 border-b border-border bg-[#f8f9fd] px-5 py-4 sm:grid-flow-col sm:items-end dark:bg-muted"
        style={{
          gridTemplateColumns: `${campos.map((c) => c.ancho ?? "1fr").join(" ")} auto`,
        }}
      >
        {campos.map((c) => (
          <label key={c.clave} className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">
              {c.etiqueta}
            </span>
            {c.opciones ? (
              <select
                value={valores[c.clave]}
                onChange={(e) => setValores({ ...valores, [c.clave]: e.target.value })}
                className={ENTRADA}
              >
                {c.opciones.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.texto}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={c.tipo ?? "text"}
                value={valores[c.clave]}
                required={c.requerido}
                placeholder={c.marcador}
                onChange={(e) => setValores({ ...valores, [c.clave]: e.target.value })}
                className={ENTRADA}
              />
            )}
          </label>
        ))}
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
      </form>

      {filas.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm font-semibold text-muted-foreground">{vacio}</p>
      ) : (
        <ul>
          {filas.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 border-b border-border/60 px-5 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-foreground">{f.titulo}</div>
                <div className="truncate text-xs font-semibold text-muted-foreground">{f.detalle}</div>
              </div>
              <button
                type="button"
                aria-label={`Borrar ${f.titulo}`}
                disabled={borrandoId === f.id}
                onClick={async () => {
                  setBorrandoId(f.id);
                  await onBorrar(f.id);
                  setBorrandoId(null);
                }}
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
    </section>
  );
}

const ENTRADA =
  "h-11 w-full min-w-0 rounded-xl border-[1.5px] border-[#dfe3ef] bg-card px-3.5 text-sm font-semibold text-foreground outline-none focus:border-primary";

function Cargando() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm font-semibold text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      Cargando…
    </div>
  );
}
