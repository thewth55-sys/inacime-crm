-- ============================================================
-- 010_periodos_configurables.sql — Los periodos los define el ciclo,
-- no el código
--
-- El problema
--   Cuántos periodos de evaluación tiene un ciclo estaba fijado en la
--   semilla: P1, P2 y FINAL. Abrir un cuatrimestre con cuatro parciales,
--   o uno con un diagnóstico que no cuenta, exigía correr SQL a mano.
--   Eso contradice lo acordado: el reglamento y el mapa curricular los
--   define cada coordinación, no un despliegue.
--
-- La ponderación vivía en dos lugares
--   `periodos.ponderacion` (por ciclo, con su trigger de suma 1) y
--   `politica_periodos.ponderacion` (por política de evaluación, con
--   OTRO trigger de suma 1). El cálculo de la definitiva sólo usa la
--   segunda —`calcula_definitiva` une por `periodo_clave`—, así que la
--   primera era peso muerto que además podía contradecirla sin que nada
--   avisara. Peor: obligaba a pedir la ponderación al crear el ciclo,
--   antes de que exista el reglamento que la decide.
--
--   Aquí se queda una sola: el ciclo dice QUÉ periodos hay y CUÁNDO se
--   captura; el reglamento dice CUÁNTO pesa cada uno.
--
-- Ponderación 0
--   Se permite. Un periodo diagnóstico que se captura pero no cuenta
--   para la definitiva es un caso real, y antes había que fingir que
--   pesaba algo. La suma sigue teniendo que dar 1.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Fuera la ponderación por ciclo y su trigger
-- ------------------------------------------------------------
drop trigger if exists periodos_ponderacion_suma on academico.periodos;
drop function if exists academico.valida_ponderaciones();
alter table academico.periodos drop column if exists ponderacion;

-- ------------------------------------------------------------
-- 2. Un periodo puede pesar 0
-- ------------------------------------------------------------
alter table academico.politica_periodos
  drop constraint if exists politica_periodos_ponderacion_check;
alter table academico.politica_periodos
  add constraint politica_periodos_ponderacion_check
  check (ponderacion >= 0 and ponderacion <= 1);

-- ------------------------------------------------------------
-- 3. Permisos de escritura: ya estaban, no se tocan
--
-- Se revisó antes de agregar nada. La migración 002 ya da for-all sobre
-- ciclos y periodos a `academico.es_staff()`, que es exactamente
-- dirección, control escolar y coordinación. Un docente los lee pero no
-- los escribe, que es lo correcto: mover la ventana de captura de su
-- propio grupo sería juez y parte.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 4. Un periodo con calificaciones no se borra
--
-- La llave foránea de `calificaciones.periodo_id` ya lo impide, pero el
-- error que devuelve habla de constraints y no dice qué hacer. Este
-- trigger falla con una frase que sí se entiende desde la pantalla.
-- ------------------------------------------------------------
create or replace function academico.periodo_sin_capturas()
returns trigger language plpgsql as $$
declare v_n int;
begin
  select count(*) into v_n
  from academico.calificaciones where periodo_id = old.id;
  if v_n > 0 then
    raise exception
      'No se puede borrar el periodo %: ya tiene % calificaciones capturadas. Ciérralo o deja el ciclo como está.',
      old.nombre, v_n;
  end if;
  return old;
end $$;

drop trigger if exists periodos_sin_capturas on academico.periodos;
create trigger periodos_sin_capturas
  before delete on academico.periodos
  for each row execute function academico.periodo_sin_capturas();

-- ------------------------------------------------------------
-- 5. El resumen ya no lee `ponderacion`
-- ------------------------------------------------------------
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
    (select count(*)::int from grupos_ciclo)                as grupos,
    (select coalesce(sum(cupo), 0)::int from grupos_ciclo)  as lugares,
    (select count(*)::int
       from academico.inscripciones i
       join grupos_ciclo gc on gc.id = i.grupo_id
      where i.estatus = 'activa')                           as ocupados
),
periodos_ciclo as (
  select p.id, p.nombre, p.orden, p.captura_cierra
  from academico.periodos p
  join ciclo c on c.id = p.ciclo_id
),
-- Un acta falta cuando el grupo no tiene renglón para ese periodo, o lo
-- tiene abierto. Las dos cosas cuentan igual para dirección: en ninguna
-- hay calificaciones firmadas.
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
  'periodos',        (select count(*)::int from periodos_ciclo),
  'actas', (select to_jsonb(ap) from actas_pendientes ap),
  'programas', coalesce((select jsonb_agg(to_jsonb(pp)) from por_programa pp), '[]'::jsonb)
);
$$;

grant execute on function academico.resumen_operativo() to authenticated;
