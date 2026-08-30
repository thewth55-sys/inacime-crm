"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  ChevronDown,
  Crown,
  LogOut,
  Shield,
  User,
  UserCog,
  UsersRound,
  X,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import { usePendientesDeAlta } from "@/hooks/use-pendientes-alta";
import {
  areaDeRuta,
  areasDe,
  NAV_PIE,
  NAV_SIEMPRE,
  type NavItem,
} from "@/components/layout/nav-config";
import { useRolAcademico } from "@/hooks/use-rol-academico";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    // Primary-tinted: significant but not as scarce as owner.
    className:
      "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    // Neutral slate: the operational default.
    className:
      "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    // Muted slate: read-only role; visually quieter than agent.
    className:
      "border-border bg-card text-muted-foreground",
  },
};

/** Iniciales para el avatar cuadrado: "Aranza Delgado Rueda" -> "AD". */
function iniciales(nombre?: string | null, correo?: string | null): string {
  const base = (nombre || correo || "?").trim();
  const partes = base.split(/[\s@.]+/).filter(Boolean);
  return (partes[0]?.[0] ?? "?").concat(partes[1]?.[0] ?? "").toUpperCase();
}

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

import { useTranslations } from "next-intl";

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const { rol: rolAcademico, cargando: cargandoRol } = useRolAcademico();
  const pendientesAlta = usePendientesDeAlta(rolAcademico);

  const areas = cargandoRol ? [] : areasDe(rolAcademico);
  // Con una sola área no tiene sentido plegar nada: sería un encabezado
  // sobrando encima de la única lista que hay.
  const plano = areas.length <= 1;

  // Arranca abierta el área de la ruta actual; el resto cerradas. Así, entrar
  // a una herramienta no obliga a plegar las otras a mano.
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  useEffect(() => {
    const actual = areaDeRuta(pathname);
    if (actual) setAbiertas((prev) => (prev.has(actual) ? prev : new Set(prev).add(actual)));
  }, [pathname]);

  const alternarArea = (id: string) =>
    setAbiertas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });

  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:w-60 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Primary"
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible. */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-4">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            {/* Variante clara siempre: la barra es marino en los dos modos. */}
            <Image
              src="/inacime-logo-claro.png"
              alt="INACIME"
              width={2396}
              height={725}
              priority
              className="h-7 w-auto"
            />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Ficha de quien está usando el panel. En el mockup va arriba, no
            abajo: es lo primero que confirma "entré con la cuenta correcta". */}
        <div className="shrink-0 px-3 pt-3">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3.5 py-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-primary text-[15px] font-bold text-primary-foreground">
              {iniciales(profile?.full_name, profile?.email)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-bold text-sidebar-foreground">
                {profile?.full_name || t("defaultUser")}
              </div>
              <div className="truncate text-[11.5px] font-semibold text-sidebar-foreground/50">
                {/* El rol escolar manda sobre el del CRM: a un docente le
                    servía de poco leer "Dueño", que es su rol de cuenta y no
                    lo que hace en el panel. */}
                {rolAcademico
                  ? t(`rol_${rolAcademico}`)
                  : accountRole
                    ? t(ROLE_CHIP[accountRole].labelKey)
                    : profile?.email}
              </div>
            </div>
          </div>
        </div>

        {/* Navegación por área.
            Con una sola área se pinta plana, como en el mockup: el docente ve
            su lista y ya. Con varias —dirección— se agrupan y se pliegan, para
            entrar a admisiones sin cargar con docencia al mismo tiempo. */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1">
            {NAV_SIEMPRE.map((item) => (
              <li key={item.href}>
                <Enlace item={item} activo={esRuta(pathname, item.href)} t={t} />
              </li>
            ))}
          </ul>

          {areas.map((area) => {
            const items = area.items;
            const abierto = plano || abiertas.has(area.id);
            return (
              <div key={area.id} className={plano ? "mt-1" : "mt-3"}>
                {!plano && (
                  <button
                    type="button"
                    onClick={() => alternarArea(area.id)}
                    aria-expanded={abierto}
                    aria-controls={`area-${area.id}`}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.8px] text-sidebar-foreground/45 transition-colors hover:text-sidebar-foreground/70"
                  >
                    <area.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="flex-1">{t(area.labelKey)}</span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-transform",
                        abierto ? "rotate-0" : "-rotate-90",
                      )}
                      aria-hidden
                    />
                  </button>
                )}
                {abierto && (
                  <ul id={`area-${area.id}`} className="flex flex-col gap-1">
                    {items.map((item) => (
                      <li key={item.href}>
                        <Enlace
                          item={item}
                          activo={esRuta(pathname, item.href)}
                          t={t}
                          insignia={
                            item.href === "/inbox" && totalUnread > 0
                              ? "punto"
                              : item.href === "/notifications" && unreadNotifications > 0
                                ? String(Math.min(unreadNotifications, 9)) +
                                  (unreadNotifications > 9 ? "+" : "")
                                : item.href === "/alta-alumnos" && pendientesAlta > 0
                                  ? String(Math.min(pendientesAlta, 9)) +
                                    (pendientesAlta > 9 ? "+" : "")
                                  : null
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          <div className="my-4 border-t border-sidebar-border" />

          <ul className="flex flex-col gap-1">
            {NAV_PIE.map((item) => (
              <li key={item.href}>
                <Enlace item={item} activo={pathname.startsWith(item.href)} t={t} />
              </li>
            ))}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-3">
          {/* Account name display — surfaced only when the account
              name differs from the user's own name (see
              `showAccountStrip`). For a default solo account the two
              match, so we hide it to avoid duplicating the user name
              below; for renamed or shared accounts it tells the user
              which account they're acting in. */}
          {showAccountStrip && account?.name ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-sidebar-foreground/50">
              <UsersRound className="size-3.5 shrink-0" />
              {/* `title=` exposes the full name on hover when it
                  gets truncated (long account names + narrow
                  sidebars). Cheap a11y win. */}
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                // Always render the chip — owners used to be
                // invisible here, which made them indistinguishable
                // from admins at a glance. Now everyone sees their
                // role (with a colour cue) regardless of tier.
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {t(meta.labelKey as string)}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}
          {/* Sólo cerrar sesión: la ficha del usuario ya vive arriba y el
              perfil se llega desde Configuración. Repetirlo aquí era ruido. */}
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="size-4 shrink-0" />
            {t("menuSignOut")}
          </button>
        </div>
      </aside>
    </>
  );
}


// ---------------------------------------------------------------------------

/** Una opción del menú. La insignia va en lima institucional. */
function Enlace({
  item,
  activo,
  t,
  insignia,
}: {
  item: NavItem;
  activo: boolean;
  t: (k: string) => string;
  insignia?: "punto" | string | null;
}) {
  return (
    <Link
      href={item.href}
      className={cn(
        // Más alto en móvil para que el pulgar acierte sin apuntar.
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
        activo
          ? "bg-primary font-bold text-primary-foreground"
          : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{t(item.labelKey)}</span>
      {item.beta && (
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
          {t("beta")}
        </span>
      )}
      {insignia === "punto" ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#BDDB61] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#BDDB61]" />
        </span>
      ) : insignia ? (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#BDDB61] px-1.5 text-[10px] font-bold text-[#27348B]">
          {insignia}
        </span>
      ) : null}
    </Link>
  );
}

/** Activo también en las subrutas: /flows/abc marca /flows. */
function esRuta(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
