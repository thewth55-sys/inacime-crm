-- ============================================================
-- 009_resumen_operativo.sql — Cifras del panel de dirección
--
-- Por qué una función y no consultas desde el navegador
--   El resumen necesita conteos y promedios sobre alumnos, grupos,
--   inscripciones y actas. Resolverlo con PostgREST obligaría a traerse
--   cada alumno y cada inscripción sólo para contarlos en memoria: con
--   842 alumnos son ~850 filas por carga de pantalla, y crece cada
--   ciclo. Aquí se calcula donde viven los datos y viaja una fila.
--
-- SECURITY INVOKER a propósito
--   Corre con los permisos de quien llama, así que la RLS sigue
--   aplicando: los conteos reflejan lo que esa persona puede ver. Un
--   SECURITY DEFINER convertiría este resumen en una fuga silenciosa
--   —cualquiera con acceso al panel vería la matrícula completa—.
--   La pantalla además se restringe a dirección y control escolar.
--
-- Idempotente.
-- ============================================================

create or replace function academico.resumen_operativo()
returns jsonb
language sql
stable
security invoker
set search_path = academico, public
as $$
with ciclo as (
  select id, clave, nombre, inicia, termina
  from academico.ciclos
  where estado = 'activo'
  limit 1
),
grupos_ciclo as (
  select g.id, g.cupo
  from academico.grupos g
  join ciclo c on c.id = g.ciclo_id
),
-- Los lugares se cuentan sobre los grupos y los inscritos sobre las
-- inscripciones, en dos consultas separadas. Unirlas con un LEFT JOIN
-- sumaría el cupo de cada grupo una vez por inscripción: con un grupo de
-- 25 lugares y 7 inscritos daría 175. Sale correcto mientras no hay
-- inscripciones —el join produce una fila— y se rompe en silencio en
-- cuanto las hay, que es cuando alguien ya está mirando el número.
ocupacion as (
  select
    (select count(*)::int from grupos_ciclo)                     as grupos,
    (select coalesce(sum(cupo), 0)::int from grupos_ciclo)       as lugares,
    (select count(*)::int
       from academico.inscripciones i
       join grupos_ciclo gc on gc.id = i.grupo_id
      where i.estatus = 'activa')                                as ocupados
),
-- Un acta falta cuando el grupo no tiene renglón para ese periodo, o
-- lo tiene abierto. Las dos cosas cuentan igual para dirección: en
-- ninguna hay calificaciones firmadas.
periodos_ciclo as (
  select p.id, p.nombre, p.orden, p.captura_cierra
  from academico.periodos p
  join ciclo c on c.id = p.ciclo_id
),
actas_pendientes as (
  select
    count(*)::int as faltan,
    count(distinct g.docente_id)::int as docentes,
    min(p.captura_cierra) as vence,
    -- El periodo más atrasado, no el más reciente: es el que urge.
    (array_agg(p.nombre order by p.orden))[1] as periodo
  from grupos_ciclo gc
  join academico.grupos g on g.id = gc.id
  cross join periodos_ciclo p
  left join academico.actas a
    on a.grupo_id = gc.id and a.periodo_id = p.id
  where a.id is null or a.estado = 'abierta'
),
por_programa as (
  select pr.nombre, count(*)::int as alumnos
  from academico.alumnos al
  join academico.planes_estudio pl on pl.id = al.plan_id
  join academico.programas pr      on pr.id = pl.programa_id
  where al.estatus = 'activo'
  group by pr.nombre
  order by count(*) desc
)
select jsonb_build_object(
  'ciclo', (select to_jsonb(c) from ciclo c),
  'alumnos_activos', (select count(*)::int from academico.alumnos where estatus = 'activo'),
  'alumnos_total',   (select count(*)::int from academico.alumnos),
  'alumnos_riesgo',  (select count(*)::int from academico.alumnos
                      where estatus in ('baja_temporal','baja_definitiva')),
  'docentes',        (select count(*)::int from academico.docentes where activo),
  'grupos',          (select grupos   from ocupacion),
  'lugares',         (select lugares  from ocupacion),
  'ocupados',        (select ocupados from ocupacion),
  'actas', (select to_jsonb(ap) from actas_pendientes ap),
  'programas', coalesce((select jsonb_agg(to_jsonb(pp)) from por_programa pp), '[]'::jsonb)
);
$$;

comment on function academico.resumen_operativo() is
  'Cifras del panel de dirección en una sola fila. SECURITY INVOKER: los conteos respetan la RLS de quien llama.';

grant execute on function academico.resumen_operativo() to authenticated;
