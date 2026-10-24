/**
 * ADR-0048 Phase 2 — prefer-local (container-scoped) metadata resolution.
 *
 * Two installed packages may legitimately ship the same bare name (e.g. a
 * `page` named `home`) — the install-time namespace gate keeps their namespaces
 * distinct, and resolution disambiguates them by container. When resolving a
 * bare name we prefer the item owned by the *current* container (the active
 * app's package), so a user inside `/apps/crm` sees crm's `home`, not whichever
 * package's `home` happened to load first.
 *
 * Falls back to the first name match when the container owns no such item or
 * its owning package is unknown (runtime/DB apps with no `_packageId`), so this
 * never regresses the prior first-match behaviour.
 */
export function preferLocal<T extends { name?: unknown; _packageId?: unknown }>(
  list: readonly T[] | undefined | null,
  name: string | undefined | null,
  ownerPackageId?: unknown,
): T | undefined {
  if (!list || name == null) return undefined;
  if (ownerPackageId) {
    const local = list.find((x) => x.name === name && x._packageId === ownerPackageId);
    if (local) return local;
  }
  return list.find((x) => x.name === name);
}
