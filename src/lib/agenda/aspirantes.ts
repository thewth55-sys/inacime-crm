import type { SupabaseClient } from "@supabase/supabase-js";
import type { AspiranteAgendable } from "./tipos";

/**
 * Busca a quién citar.
 *
 * La búsqueda va sobre `deals` y no sobre `contacts` porque en el panel
 * un aspirante ES su negocio en el embudo: agendar la entrevista y
 * dejarla colgada del negocio es lo que después permite ver, desde el
 * embudo, si ya se presentó. Un contacto sin negocio no es un aspirante
 * todavía; es alguien que escribió por WhatsApp.
 *
 * Se descartan los negocios ya cerrados: a quien ya se inscribió o se
 * perdió no se le agenda una entrevista de admisión.
 */
export async function buscarAspirantes(
  db: SupabaseClient,
  texto: string,
): Promise<AspiranteAgendable[]> {
  const q = texto.trim();
  if (!q) return [];
  const like = `%${q}%`;

  const { data, error } = await db
    .from("deals")
    .select("id, status, contacts!inner ( id, name, phone, company )")
    .or(`name.ilike.${like},phone.ilike.${like}`, { referencedTable: "contacts" })
    .neq("status", "won")
    .neq("status", "lost")
    .order("updated_at", { ascending: false })
    .limit(8);

  if (error) throw error;

  interface Fila {
    id: string;
    contacts: { id: string; name: string | null; phone: string; company: string | null } | null;
  }

  // Un aspirante puede tener más de un negocio abierto —reingreso, otro
  // programa—. Se muestra una sola vez: la lista es para elegir persona,
  // no negocio, y ver el mismo nombre repetido no ayuda a decidir.
  const vistos = new Set<string>();
  const salida: AspiranteAgendable[] = [];
  for (const d of (data ?? []) as unknown as Fila[]) {
    if (!d.contacts || vistos.has(d.contacts.id)) continue;
    vistos.add(d.contacts.id);
    salida.push({
      dealId: d.id,
      contactId: d.contacts.id,
      nombre: d.contacts.name ?? "Sin nombre",
      telefono: d.contacts.phone,
      programa: d.contacts.company,
    });
  }
  return salida;
}
