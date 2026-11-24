/**
 * Recently-used lookup memory.
 *
 * Mainstream record pickers (Salesforce, Dataverse, SAP, ServiceNow) surface
 * the user's recently-picked records the moment a lookup is focused — before
 * any typing. We approximate that with a small per-object ring of the last few
 * selected record ids, kept in localStorage (no backend dependency). When a
 * recent-items API later exists, this module is the single seam to swap.
 */

const KEY_PREFIX = 'objectui:lookup:recent:';

/**
 * The ring's storage key: per user as well as per object, so two accounts
 * signed in one after the other in the same browser never see each other's
 * picks. Without a known user (no permission provider) the key is the
 * object's alone, as it always was.
 */
function keyOf(objectName: string, userId: string | null | undefined): string {
  return userId ? `${KEY_PREFIX}${userId}:${objectName}` : KEY_PREFIX + objectName;
}
const MAX_RECENT = 5;

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    // Accessing localStorage can throw in sandboxed iframes / SSR.
    return null;
  }
}

/** Most-recent-first list of record ids `userId` previously chose for `objectName`. */
export function getRecentLookupIds(objectName: string, userId?: string | null): Array<string | number> {
  const s = storage();
  if (!objectName || !s) return [];
  try {
    const raw = s.getItem(keyOf(objectName, userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Record that `userId` just chose `id` for `objectName` (moves it to the front). */
export function pushRecentLookupId(objectName: string, id: string | number | null | undefined, userId?: string | null): void {
  const s = storage();
  if (!objectName || id === null || id === undefined || id === '' || !s) return;
  try {
    const next = [id, ...getRecentLookupIds(objectName, userId).filter((x) => x !== id)].slice(0, MAX_RECENT);
    s.setItem(keyOf(objectName, userId), JSON.stringify(next));
  } catch {
    // Ignore quota / serialization failures — recents are best-effort.
  }
}
