// Formas que devuelve el esquema `academico`. Se escriben a mano en vez de
// generarlas con el CLI de Supabase porque ese generador emite el esquema
// entero, y aquí sólo hacen falta las cuatro tablas que toca la captura.

export type EstadoAsistencia = "P" | "R" | "A" | "J";

/** Grupo tal como lo ve el docente en el selector. */
export interface GrupoDocente {
  id: string;
  clave: string;
  aula: string | null;
  materia: string;
  materiaClave: string;
  cicloClave: string;
  /** Días y horas en que se reúne, ya en texto legible. */
  horario: string;
  inscritos: number;
}

/** Una fila de la lista de asistencia. */
export interface FilaAsistencia {
  inscripcionId: string;
  alumnoId: string;
  matricula: string;
  nombre: string;
  iniciales: string;
  /** Estado de HOY. `null` mientras no se ha marcado nada. */
  estado: EstadoAsistencia | null;
  /**
   * Porcentaje de asistencia acumulado ANTES de esta sesión, o null si el
   * grupo no tiene sesiones previas. Es el dato que permite ver a quién se
   * le está yendo el curso sin abrir otra pantalla.
   */
  porcentajePrevio: number | null;
  sesionesPrevias: number;
}

export interface ResumenAsistencia {
  presentes: number;
  retardos: number;
  ausentes: number;
  justificadas: number;
  sinMarcar: number;
}
