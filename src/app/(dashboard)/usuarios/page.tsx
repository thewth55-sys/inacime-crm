"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRolAcademico, type RolAcademico } from "@/hooks/use-rol-academico";
import { toast } from "sonner";
import { Loader2, UserPlus, ShieldAlert } from "lucide-react";

// Alta y administración de usuarios del expediente escolar.
//
// El alta la hace la ruta de servidor: crear una cuenta exige la llave de
// servicio. Aquí sólo se recogen los datos y se muestra qué dominio toca.
//
// La restricción de dominio se valida en tres lugares, a propósito: en este
// formulario para explicar, en la ruta para devolver un mensaje claro, y en
// un disparador de la base para que no se pueda saltar por ninguna vía.

const ROLES: { valor: RolAcademico; nombre: string; detalle: string }[] = [
  { valor: "direccion", nombre: "Dirección", detalle: "Acceso total, incluida la configuración del ciclo" },
  { valor: "control_escolar", nombre: "Control Escolar", detalle: "Alumnos, grupos, actas y reportes" },
  { valor: "coordinacion", nombre: "Coordinación", detalle: "Docentes, grupos y reglamento de evaluación" },
  { valor: "finanzas", nombre: "Finanzas", detalle: "Cobranza. Sólo lectura en lo académico" },
  { valor: "docente", nombre: "Docente", detalle: "Sólo sus grupos: asistencia y calificaciones" },
  { valor: "alumno", nombre: "Alumno", detalle: "Su propio expediente. Entra con su matrícula" },
];

interface Usuario {
  id: string;
  nombre: string;
  rol: RolAcademico;
  activo: boolean;
  creado_en: string;
}

export default function UsuariosPage() {
  const { rol, cargando: cargandoRol } = useRolAcademico();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [dominios, setDominios] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const [form, setForm] = useState({
    rol: "docente" as RolAcademico,
    nombre: "",
    identificador: "",
    password: "",
  });

  const esDireccion = rol === "direccion";
  const esAlumno = form.rol === "alumno";
  const dominio = dominios[form.rol] ?? "";

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const a = createClient().schema("academico");
      const [us, ds] = await Promise.all([
        a.from("usuarios").select("id, nombre, rol, activo, creado_en").order("nombre"),
        a.from("dominios_permitidos").select("rol, dominio"),
      ]);
      setUsuarios((us.data ?? []) as unknown as Usuario[]);
      setDominios(
        Object.fromEntries(
          (ds.data ?? []).map((d) => [d.rol as string, d.dominio as string]),
        ),
      );
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await fetch("/api/academico/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await r.json();
      if (!r.ok) {
        toast.error(json.error ?? "No se pudo crear el usuario.");
        return;
      }
      toast.success(`${form.nombre} entra con ${json.correo}`);
      setForm({ rol: "docente", nombre: "", identificador: "", password: "" });
      setAbierto(false);
      await cargar();
    } catch {
      toast.error("No se pudo contactar al servidor.");
    } finally {
      setEnviando(false);
    }
  };

  const cambiarRol = async (id: string, nuevo: RolAcademico) => {
    const { error } = await createClient()
      .schema("academico")
      .from("usuarios")
      .update({ rol: nuevo })
      .eq("id", id);
    if (error) {
      // El disparador de dominio rechaza subir a un alumno a rol de personal:
      // su correo es @alumnos y no cumple. Es la protección funcionando.
      toast.error(error.message);
      return;
    }
    toast.success("Rol actualizado");
    await cargar();
  };

  const alternarActivo = async (u: Usuario) => {
    const { error } = await createClient()
      .schema("academico")
      .from("usuarios")
      .update({ activo: !u.activo })
      .eq("id", u.id);
    if (error) return toast.error(error.message);
    toast.success(u.activo ? "Usuario desactivado" : "Usuario reactivado");
    await cargar();
  };

  if (cargandoRol || cargando) return <Cargando />;

  if (!esDireccion) {
    return (
      <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center">
        <ShieldAlert className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-primary">Sólo dirección</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-muted-foreground">
          Dar de alta usuarios y cambiar roles es competencia de dirección
          general. Si necesitas una cuenta nueva, pídesela.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.5px] text-primary">
            Usuarios del expediente
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quién entra al panel escolar y con qué alcance.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground"
        >
          <UserPlus className="h-4 w-4" aria-hidden />
          {abierto ? "Cancelar" : "Dar de alta"}
        </button>
      </div>

      {abierto && (
        <form onSubmit={crear} className="rounded-2xl border border-border bg-card p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <Etiqueta>ROL</Etiqueta>
              <select
                value={form.rol}
                onChange={(e) =>
                  setForm({ ...form, rol: e.target.value as RolAcademico, identificador: "" })
                }
                className="h-12 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground outline-none focus:border-primary"
              >
                {ROLES.map((r) => (
                  <option key={r.valor} value={r.valor}>
                    {r.nombre} — {r.detalle}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <Etiqueta>NOMBRE COMPLETO</Etiqueta>
              <input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                required
                placeholder="Apellido Apellido, Nombre"
                className={ENTRADA}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <Etiqueta>{esAlumno ? "MATRÍCULA" : "CORREO INSTITUCIONAL"}</Etiqueta>
              <div className="flex items-center">
                <input
                  value={form.identificador}
                  onChange={(e) => setForm({ ...form, identificador: e.target.value })}
                  required
                  placeholder={esAlumno ? "12410783" : `nombre@${dominio}`}
                  className={`${ENTRADA} ${esAlumno ? "rounded-r-none" : ""}`}
                />
                {esAlumno && dominio && (
                  <span className="h-12 shrink-0 rounded-r-xl border border-l-0 border-border bg-muted px-3 text-sm font-semibold leading-[46px] text-muted-foreground">
                    @{dominio}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-semibold text-muted-foreground">
                {esAlumno
                  ? "El alumno teclea sólo su matrícula al entrar. El buzón no recibe correo, así que la contraseña se restablece desde aquí."
                  : `El personal entra forzosamente con un correo @${dominio}.`}
              </span>
            </label>

            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <Etiqueta>CONTRASEÑA PROVISIONAL</Etiqueta>
              <input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
                placeholder="Mínimo 8 caracteres"
                className={ENTRADA}
              />
              <span className="text-[11px] font-semibold text-muted-foreground">
                Se la entregas en persona. Va en texto visible a propósito: si
                se oculta, quien da el alta la teclea mal y nadie se entera
                hasta que la persona no puede entrar.
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={enviando}
            className="mt-4 flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-40"
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {enviando ? "Creando…" : "Crear usuario"}
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40">
              <Th>NOMBRE</Th>
              <Th>ROL</Th>
              <Th>ALTA</Th>
              <Th centro>ESTADO</Th>
            </tr>
          </thead>
          <tbody>
            {usuarios.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm font-semibold text-muted-foreground">
                  Todavía no hay usuarios del expediente.
                </td>
              </tr>
            ) : (
              usuarios.map((u) => (
                <tr key={u.id} className="border-t border-border/60">
                  <td className="px-4 py-3 text-sm font-bold text-foreground">{u.nombre}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.rol}
                      onChange={(e) => cambiarRol(u.id, e.target.value as RolAcademico)}
                      aria-label={`Rol de ${u.nombre}`}
                      className="h-9 rounded-lg border border-border bg-card px-2 text-xs font-bold text-foreground outline-none focus:border-primary"
                    >
                      {ROLES.map((r) => (
                        <option key={r.valor} value={r.valor}>
                          {r.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    {new Date(u.creado_en).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => alternarActivo(u)}
                      className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                        u.activo
                          ? "bg-[#eaf7ee] text-[#2f7d3f]"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {u.activo ? "Activo" : "Inactivo"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs font-semibold text-muted-foreground">
        Desactivar corta el acceso al expediente sin borrar nada: las
        calificaciones que capturó y su rastro en la bitácora siguen ahí, que
        es lo que pide una supervisión.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

const ENTRADA =
  "h-12 w-full rounded-xl border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-4 text-sm font-semibold text-foreground outline-none focus:border-primary focus:bg-card";

function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-bold tracking-[0.5px] text-muted-foreground">
      {children}
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

function Cargando() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm font-semibold text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      Cargando…
    </div>
  );
}
