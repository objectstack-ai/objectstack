/**
 * The fake framework the console's preference pins run against: discovery,
 * empty metadata, and the `sys_user_preference` rows of a store, answered the
 * way the server answers them.
 *
 * Shared by `consoleUserPreferenceBudget.test.tsx` (objectui#12187, one
 * preference read per load) and `consoleListStateWall-12418.test.tsx` (a
 * user's list state under a walled posture), so the two pins judge the same
 * wire.
 *
 * A preference read is answered by `user_id` and by `key`, with the operators
 * the console sends: `=`, `in`, and `startswith` for a key family
 * (objectui#12418). Any other operator is refused loudly, and it is refused
 * when the filter is READ, not when a row is matched: an `or` whose first arm
 * matches every row would otherwise never evaluate the second, and an operator
 * nobody answers would pass unseen.
 */

export const PREFERENCE_RESOURCE = 'sys_user_preference';

/** Each user's stored rows: `{ [user]: { [key]: value } }`. */
export type PreferenceStore = Record<string, Record<string, unknown>>;

interface PrefRow { id: string; user_id: string; key: string; value: unknown }
type FilterNode = [string, ...unknown[]];

/** The operators a preference read may send. */
const OPERATORS = new Set(['=', 'in', 'startswith']);

/** Refuse any operator the console does not send, anywhere in the filter. */
function assertOperators(node: FilterNode): void {
  const [head, ...rest] = node;
  if (head === 'and' || head === 'or') {
    (rest as FilterNode[]).forEach(assertOperators);
    return;
  }
  const [op] = rest;
  if (!OPERATORS.has(String(op))) {
    throw new Error(`fake framework: filter operator ${String(op)} is not one this path sends`);
  }
}

/** Answer one filter node the way the server's AST does. */
function matches(node: FilterNode, row: PrefRow): boolean {
  const [head, ...rest] = node;
  if (head === 'and') return (rest as FilterNode[]).every((n) => matches(n, row));
  if (head === 'or') return (rest as FilterNode[]).some((n) => matches(n, row));
  const [op, value] = rest;
  const actual = (row as unknown as Record<string, unknown>)[head];
  if (op === '=') return actual === value;
  if (op === 'in') return Array.isArray(value) && value.includes(actual);
  if (op === 'startswith') return typeof actual === 'string' && actual.startsWith(String(value));
  return false;
}

/** One preference read, as the wire carried it. */
export interface PrefGet {
  user: string | undefined;
  keys: string[];
  prefixes: string[];
  top: string | null;
}
/** One preference write, as the wire carried it. */
export interface PrefWrite { method: string; id: string | undefined; value: unknown }
/** One metadata write (anything but a GET under `/api/v1/meta/`). */
export interface MetaWrite { method: string; path: string }

/** Collect the `user_id`, the keys and the key prefixes a filter asks for. */
function scopeOf(node: FilterNode, into: PrefGet): PrefGet {
  const [head, ...rest] = node;
  if (head === 'and' || head === 'or') {
    (rest as FilterNode[]).forEach((n) => scopeOf(n, into));
    return into;
  }
  const [op, value] = rest;
  if (head === 'user_id' && op === '=') into.user = String(value);
  if (head === 'key' && op === '=') into.keys.push(String(value));
  if (head === 'key' && op === 'in') into.keys.push(...(value as string[]));
  if (head === 'key' && op === 'startswith') into.prefixes.push(String(value));
  return into;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The row id the fake gives a stored `(user, key)`. */
export const preferenceRowId = (user: string, key: string) => `row-${user}-${key}`;

export interface PreferenceFramework {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  wire: { gets: PrefGet[]; writes: PrefWrite[]; metaWrites: MetaWrite[] };
}

/**
 * Build the fake over a store. `walled` answers every metadata write the way a
 * walled posture answers a tenant (objectstack `walledCatalogWriteVerdict`):
 * 403, and nothing stored.
 */
export function createPreferenceFramework(
  store: PreferenceStore,
  opts: { walled?: boolean } = {},
): PreferenceFramework {
  const wire = { gets: [] as PrefGet[], writes: [] as PrefWrite[], metaWrites: [] as MetaWrite[] };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost/');
    const method = (init?.method ?? 'GET').toUpperCase();
    // A real round trip is not instantaneous; the gap is what lets two loads overlap.
    await new Promise((resolve) => setTimeout(resolve, 5));

    if (url.pathname.endsWith('/api/v1/discovery')) {
      return json(200, { success: true, data: { capabilities: {}, routes: {} } });
    }
    if (url.pathname.includes('/api/v1/meta/')) {
      if (method !== 'GET') {
        wire.metaWrites.push({ method, path: url.pathname });
        if (opts.walled) {
          return json(403, {
            success: false,
            error: { code: 'PERMISSION_DENIED', message: 'Environment metadata is read-only for tenants under this posture' },
          });
        }
        return json(200, { success: true });
      }
      return json(200, { success: true, data: { items: [] } });
    }
    const prefix = `/api/v1/data/${PREFERENCE_RESOURCE}`;
    if (url.pathname.startsWith(prefix)) {
      if (method === 'GET') {
        const filter = JSON.parse(url.searchParams.get('filter') ?? '["and"]') as FilterNode;
        assertOperators(filter);
        wire.gets.push(scopeOf(filter, { user: undefined, keys: [], prefixes: [], top: url.searchParams.get('top') }));
        const rows: PrefRow[] = Object.entries(store).flatMap(([user, byKey]) =>
          Object.entries(byKey).map(([key, value]) => ({ id: preferenceRowId(user, key), user_id: user, key, value })),
        );
        const top = Number(url.searchParams.get('top') ?? Infinity);
        const records = rows.filter((r) => matches(filter, r)).slice(0, top);
        return json(200, { success: true, data: { records, total: records.length } });
      }
      const id = url.pathname.slice(prefix.length + 1) || undefined;
      const body = init?.body ? (JSON.parse(String(init.body)) as { value?: unknown }) : {};
      wire.writes.push({ method, id, value: body.value });
      return json(200, { success: true, data: { object: PREFERENCE_RESOURCE, id, record: { id } } });
    }
    return json(404, {});
  };
  return { fetch, wire };
}
