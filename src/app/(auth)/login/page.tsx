"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Pantalla de acceso al Panel INACIME.
//
// Sigue el mockup institucional al pie de la letra, así que los colores van
// escritos a mano en vez de salir de los tokens del tema: es una pantalla de
// marca y se ve igual sin importar si el visitante tiene el sistema en claro
// u oscuro. El resto de la aplicación sí respeta el tema.
//
// Paleta: #27348B azul institucional · #00C1F4 cian · #BDDB61 lima

const BENEFICIOS = [
  { icono: "📊", texto: "Consulta tus calificaciones por parcial" },
  { icono: "🕐", texto: "Revisa horarios, grupos y aulas" },
  { icono: "💳", texto: "Paga tu colegiatura en línea" },
  { icono: "🧾", texto: "Descarga recibos y facturas" },
  { icono: "📝", texto: "Levanta solicitudes y trámites" },
];

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Lo reenvía `/join/<token>` cuando quien visita ya tiene cuenta: al entrar
  // lo mandamos a aceptar la invitación en vez de al panel.
  const inviteToken = searchParams.get("invite");
  // El mockup ofrece dos accesos. Ambos autentican igual; lo único que cambia
  // es cómo se llama el identificador que la persona tiene a la mano.
  const esDocente = searchParams.get("acceso") === "docente";

  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [mantenerSesion, setMantenerSesion] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Supabase autentica por correo. La matrícula y el número de empleado
    // requieren resolverlos contra el núcleo académico (`academico.alumnos`
    // y `academico.docentes`), que todavía no vive en esta base — así que
    // por ahora se lo decimos claro en vez de fallar con "credenciales
    // inválidas", que mandaría a la persona a buscar el error donde no está.
    if (!usuario.includes("@")) {
      setError(
        "Por ahora el acceso es con tu correo institucional. La entrada con matrícula o número de empleado se habilita cuando se conecte el expediente académico.",
      );
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: usuario.trim(),
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(inviteToken ? `/join/${encodeURIComponent(inviteToken)}` : "/dashboard");
  };

  return (
    <div className="grid min-h-screen grid-cols-1 bg-[#27348B] lg:grid-cols-[1.05fr_0.95fr]">
      {/* ---------------- Columna del formulario ---------------- */}
      <div className="flex flex-col justify-center bg-white px-6 py-14 sm:px-[8vw]">
        <Image
          src="/inacime-logo.png"
          alt="INACIME"
          width={2396}
          height={725}
          priority
          className="self-start"
          style={{ height: 52, width: "auto", marginBottom: 52 }}
        />

        <h1 className="text-[38px] font-bold leading-[1.1] tracking-[-0.8px] text-[#27348B]">
          {inviteToken ? "Acepta tu invitación" : "Portal académico"}
        </h1>
        <p className="mb-9 mt-3 text-base font-medium text-[#6b7089]">
          {inviteToken
            ? "Entra con tu cuenta para unirte al equipo."
            : esDocente
              ? "Accede con tu número de empleado."
              : "Accede con tu matrícula o número de empleado."}
        </p>

        <form onSubmit={handleLogin} className="flex max-w-[400px] flex-col gap-[18px]">
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-[#f3c4c4] bg-[#fdeaea] px-4 py-3 text-sm font-semibold leading-relaxed text-[#b73b3b]"
            >
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="usuario"
              className="mb-2 block text-[12.5px] font-bold tracking-[0.4px] text-[#6b7089]"
            >
              {esDocente ? "NÚMERO DE EMPLEADO" : "MATRÍCULA O USUARIO"}
            </label>
            <input
              id="usuario"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoComplete="username"
              required
              className="w-full rounded-xl border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-[17px] py-[15px] text-[15px] font-semibold text-[#2B2B3A] outline-none focus:border-[#00C1F4] focus:bg-white"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-[12.5px] font-bold tracking-[0.4px] text-[#6b7089]"
            >
              CONTRASEÑA
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-xl border-[1.5px] border-[#dfe3ef] bg-[#f8f9fd] px-[17px] py-[15px] text-[15px] text-[#2B2B3A] outline-none focus:border-[#00C1F4] focus:bg-white"
            />
          </div>

          <div className="mt-0.5 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-[9px] text-sm font-semibold text-[#6b7089]">
              <input
                type="checkbox"
                checked={mantenerSesion}
                onChange={(e) => setMantenerSesion(e.target.checked)}
                className="h-[17px] w-[17px] accent-[#00C1F4]"
              />
              Mantener sesión
            </label>
            <Link
              href="/forgot-password"
              className="text-sm font-semibold text-[#00C1F4] hover:text-[#27348B]"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2.5 cursor-pointer rounded-xl bg-[#00C1F4] p-[17px] text-base font-bold text-white shadow-[0_10px_26px_rgba(0,193,244,0.34)] transition-colors hover:bg-[#27348B] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Entrando…" : "Iniciar sesión"}
          </button>

          <div className="mt-1.5 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#e6e9f3]" />
            <span className="text-xs font-bold text-[#a3a8bd]">O</span>
            <div className="h-px flex-1 bg-[#e6e9f3]" />
          </div>

          <Link
            href={esDocente ? "/login" : "/login?acceso=docente"}
            className="cursor-pointer rounded-xl border-[1.5px] border-[#dfe3ef] bg-white p-[15px] text-center text-[15px] font-bold text-[#27348B] transition-colors hover:border-[#27348B] hover:bg-[#f8f9fd]"
          >
            {esDocente ? "Acceso para estudiantes" : "Acceso para docentes"}
          </Link>
        </form>

        <p className="mt-11 text-[13px] font-medium text-[#a3a8bd]">
          ¿Problemas para entrar?{" "}
          <a
            href="https://wa.me/525596326293"
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-[#00C1F4] hover:text-[#27348B]"
          >
            Escríbenos por WhatsApp
          </a>
        </p>
      </div>

      {/* ---------------- Columna institucional ---------------- */}
      <div className="relative hidden flex-col justify-center overflow-hidden bg-[linear-gradient(150deg,#2f44b8_0%,#27348B_52%,#1c2569_100%)] px-[6vw] py-14 lg:flex">
        <Image
          src="/inacime-marca.png"
          alt=""
          aria-hidden
          width={725}
          height={725}
          className="pointer-events-none absolute -bottom-[90px] -right-[90px] w-[420px] opacity-[0.09]"
        />

        <span className="inline-flex self-start rounded-full border border-[rgba(189,219,97,0.4)] bg-[rgba(189,219,97,0.15)] px-4 py-2 text-xs font-bold tracking-[1px] text-[#d6ee9a]">
          CICLO 2026-3 · ACTIVO
        </span>

        <h2 className="mt-6 text-[32px] font-bold leading-[1.2] tracking-[-0.5px] text-white">
          Todo tu expediente escolar
          <br />
          en un solo lugar
        </h2>

        <div className="mt-[34px] flex flex-col gap-4">
          {BENEFICIOS.map((b) => (
            <div key={b.texto} className="flex items-center gap-[15px]">
              <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] bg-white/[0.12] text-[17px]">
                {b.icono}
              </span>
              <span className="text-base font-semibold text-white/90">{b.texto}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
