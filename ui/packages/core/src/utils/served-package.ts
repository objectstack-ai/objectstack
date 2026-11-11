/**
 * The package a served metadata item belongs to, read from its `_packageId`
 * read decoration (ADR-0150 D5), or `undefined` when the item names none.
 *
 * Two served values name no package and are never sent as one: the overlay
 * provenance sentinel `sys_metadata`, which the server stamps on a row bound to
 * no package, and `__runtime__`, the runtime compatibility package. An item
 * authored in the environment carries neither or no `_packageId` at all, so its
 * readers stay caller-less.
 *
 * Only the item's OWN decoration is read: a reference written inside a
 * dashboard or report is resolved from that item's package, never from the app
 * that hosts it or from the first result a query returns.
 */
export function servedPackageId(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const raw = (item as { _packageId?: unknown })._packageId;
  return typeof raw === 'string' && raw !== '' && !PACKAGELESS_SERVED_IDS.has(raw) ? raw : undefined;
}

const PACKAGELESS_SERVED_IDS: ReadonlySet<string> = new Set(['sys_metadata', '__runtime__']);
