# inacime-crm

CRM de admisiones y bandeja de WhatsApp para **INACIME**.

Derivado de [wacrm](https://github.com/ArnasDon/wacrm) (MIT). Next.js 15 + Supabase.

---

## Qué es esto

Es una de las dos mitades del Panel INACIME:

| | Dónde vive | Qué hace |
|---|---|---|
| **Este repo** | esquema `public` | Admisiones: aspirantes, embudo, bandeja de WhatsApp, agenda, difusiones, automatizaciones |
| Núcleo académico | esquema `academico` | Asistencias, calificaciones, actas, kardex |
| Odoo | instancia aparte | Contabilidad, cobranza, CFDI, nómina |

Los dos esquemas comparten el mismo Postgres de Supabase, así que convertir un
aspirante en alumno es un `INSERT` con llave foránea, no una integración.

**Regla:** este repo no escribe nada en `academico`, y el núcleo académico no
escribe nada en `public`. Todo cruce pasa por una función explícita.

---

## Puesta en marcha local

```bash
npm install
cp .env.local.example .env.local   # y llenar los valores
npm run dev
```

Variables obligatorias: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `META_APP_SECRET`,
`NEXT_PUBLIC_SITE_URL`. Ver `.env.local.example` para el detalle de cada una.

Las migraciones están en `supabase/migrations/` y se aplican en orden.

---

## Despliegue

Easypanel sobre VPS. El `Dockerfile` ya está configurado para eso —
build con webpack (no Turbopack, que revienta en Linux) y salida `standalone`.

Todas las variables de entorno deben declararse también como argumentos de
build en Easypanel, porque Next.js las necesita en tiempo de compilación.

---

## WhatsApp

Se usa la **API oficial de WhatsApp Cloud** de Meta. No hay librerías no
oficiales: el riesgo de baja del número en plena temporada de inscripción no
es asumible para una institución con RVOE.

Una restricción de Meta que condiciona el diseño: **sólo se admite un webhook
por app**. Este repo es quien recibe los eventos del número; nada más puede
suscribirse a él.

---

## Marca

El acento por defecto es el azul institucional `#27348B`, definido como tema
`inacime` en `src/app/globals.css`. Si la marca cambia, se recalculan los
valores oklch de ese bloque y el resto del sistema de componentes sigue solo.

Paleta: `#27348B` azul · `#00C1F4` cian · `#BDDB61` lima · `#7B2D8E` morado.

---

## Relación con el upstream

El remote `upstream` apunta a `thewth55-sys/wacrm`. Traer correcciones es
posible pero cada rebase toca migraciones, así que conviene hacerlo de forma
deliberada y no por costumbre.

```bash
git fetch upstream
git log --oneline HEAD..upstream/main   # ver qué hay de nuevo antes de nada
```

---

## Pendiente

Lo que este repo todavía **no** hace y hace falta para la capa de marketing:

1. Capturar `ctwa_clid` del objeto `referral` en el webhook de WhatsApp
2. Disparador de automatización por cambio de etapa (`deal_stage_changed`)
3. Eventos salientes de `deal.*` en los webhooks
4. Campo de origen y atribución en `deals`

Sin (1) y (2) no se puede devolver la conversión a Meta ni a Google.

**Antes de implementar la capa de conversiones** hace falta el aviso de
privacidad actualizado y el consentimiento explícito: enviar teléfono o correo
de aspirantes a Meta y Google, aunque vaya con hash, es transferencia de datos
personales a un tercero bajo la LFPDPPP.
