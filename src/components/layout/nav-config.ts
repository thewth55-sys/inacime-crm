import {
  Bell,
  Bot,
  ClipboardCheck,
  GitBranch,
  GraduationCap,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Scale,
  Settings,
  Shield,
  UserCog,
  UserPlus,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import type { RolAcademico } from "@/hooks/use-rol-academico";

// Estructura del menú, por área de trabajo.
//
// El mockup da a cada perfil su propia barra: el docente ve cinco opciones,
// no veinte. Aquí se logra con áreas: cada rol ve las suyas, y quien alcanza
// varias —dirección— las recibe en grupos que se pliegan, para entrar a las
// herramientas de admisión sin cargar con las de docencia al mismo tiempo.
//
// Esto sólo decide qué se MUESTRA. Quién puede leer o escribir qué lo decide
// RLS: plegar un grupo no protege nada.

export interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /** Restringe la opción dentro de su área. Sin esto, la ve toda el área. */
  soloRoles?: RolAcademico[];
  beta?: boolean;
}

export interface NavArea {
  id: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  items: NavItem[];
}

/** Fuera de toda área: se ve siempre, con rol o sin él. */
export const NAV_SIEMPRE: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
];

export const NAV_PIE: NavItem[] = [
  { href: "/settings", labelKey: "settings", icon: Settings },
];

export const AREAS: NavArea[] = [
  {
    id: "admisiones",
    labelKey: "areaAdmisiones",
    icon: UserPlus,
    items: [
      { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
      { href: "/notifications", labelKey: "notifications", icon: Bell },
      { href: "/contacts", labelKey: "contacts", icon: Users },
      { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
      { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
      { href: "/automations", labelKey: "automations", icon: Zap },
      { href: "/flows", labelKey: "flows", icon: Workflow, beta: true },
      { href: "/agents", labelKey: "aiAgents", icon: Bot },
    ],
  },
  {
    id: "docencia",
    labelKey: "areaDocencia",
    icon: ClipboardCheck,
    items: [
      { href: "/asistencias", labelKey: "asistencias", icon: ClipboardCheck },
      { href: "/calificaciones", labelKey: "calificaciones", icon: GraduationCap },
    ],
  },
  {
    id: "control_escolar",
    labelKey: "areaControlEscolar",
    icon: GraduationCap,
    items: [
      { href: "/alta-alumnos", labelKey: "altaAlumnos", icon: GraduationCap },
    ],
  },
  {
    id: "administracion",
    labelKey: "areaAdministracion",
    icon: Shield,
    items: [
      { href: "/usuarios", labelKey: "usuarios", icon: UserCog, soloRoles: ["direccion"] },
      {
        href: "/reglamento",
        labelKey: "reglamento",
        icon: Scale,
        soloRoles: ["direccion", "coordinacion"],
      },
    ],
  },
];

/**
 * Qué áreas alcanza cada rol.
 *
 * Un docente no tiene cuenta del CRM —el latido de presencia lo mostraba
 * fallando en cada ciclo— así que admisiones no le sirve de nada. Finanzas y
 * alumno todavía no tienen pantallas propias: se dejan vacíos a propósito, en
 * vez de mandarlos a un panel que no les habla.
 */
const ACCESO: Record<RolAcademico, string[]> = {
  direccion: ["admisiones", "docencia", "control_escolar", "administracion"],
  control_escolar: ["admisiones", "docencia", "control_escolar"],
  coordinacion: ["docencia", "control_escolar", "administracion"],
  docente: ["docencia"],
  finanzas: [],
  alumno: [],
};

/** Quien no tiene rol escolar es del CRM: un asesor de admisiones. */
const ACCESO_SIN_ROL = ["admisiones"];

export function areasDe(rol: RolAcademico | null): NavArea[] {
  const permitidas = rol ? ACCESO[rol] : ACCESO_SIN_ROL;
  return AREAS.filter((a) => permitidas.includes(a.id))
    .map((a) => ({
      ...a,
      items: a.items.filter((i) => !i.soloRoles || (rol && i.soloRoles.includes(rol))),
    }))
    .filter((a) => a.items.length > 0);
}

/** El área a la que pertenece una ruta, para abrir su grupo al entrar. */
export function areaDeRuta(pathname: string): string | null {
  for (const a of AREAS) {
    if (a.items.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"))) {
      return a.id;
    }
  }
  return null;
}
