import type { Request } from '@playwright/test';

/**
 * Which browser requests WRITE the records of one object, named route by route.
 *
 * "Every non-GET under `/api/v1/data/:object` is a write" stopped being true
 * when the record page began loading through `POST /api/v1/data/:object/:id/page`:
 * a read with a request body, so a detector built on the HTTP method alone
 * counted a member's own page load as two writes. The write set is therefore
 * NAMED here, so a future read-shaped POST cannot be mistaken for a write,
 * and a real write still is.
 *
 * Source: the route ledgers, `packages/rest/src/rest-route-ledger.ts` (the
 * `crud`, `data-actions`, `record-shares` and `batch` families) and
 * `packages/runtime/src/route-ledger.ts` (the `/actions` domain). The rows were
 * transcribed from them once; nothing re-derives this list, so a write route
 * added to a ledger is not watched here until it is added below.
 *
 *   - PATCH, PUT and DELETE anywhere under `/data/:object` are writes by method.
 *   - A POST is a write only on a route named in `WRITE_POSTS`. The two
 *     read-shaped POSTs in the ledger, `POST /data/:object/query` and
 *     `POST /data/:object/:id/page`, are deliberately absent.
 *   - `POST /batch`, the cross-object transaction, names its objects in the
 *     body; it writes `object` when one of its operations names it, or when
 *     the body cannot be read.
 *
 * Each route also matches under the environment-scoped mirror
 * (`/api/v1/environments/:environmentId/...`).
 */
const WRITE_POSTS = [
  'POST /api/v1/data/:object',
  'POST /api/v1/data/:object/:id/clone',
  'POST /api/v1/data/:object/:id/shares',
  'POST /api/v1/data/:object/import',
  'POST /api/v1/data/:object/import/jobs',
  'POST /api/v1/data/:object/batch',
  'POST /api/v1/data/:object/createMany',
  'POST /api/v1/data/:object/updateMany',
  'POST /api/v1/data/:object/deleteMany',
  'POST /api/v1/actions/:object/:action',
  'POST /api/v1/actions/:object/:action/:recordId',
  'POST /api/v1/actions/_activation/:object/:action',
] as const;

const WRITE_METHODS = new Set(['PATCH', 'PUT', 'DELETE']);
const ENV_MIRROR = '(?:/environments/[^/]+)?';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `/api/v1/data/:object/:id` → a pathname regex, `:object` bound to `object`. */
function routePattern(path: string, object: string): RegExp {
  const rest = path
    .replace(/^\/api\/v1/, '')
    .split('/')
    .map((seg) => (seg === ':object' ? escape(object) : seg.startsWith(':') ? '[^/]+' : escape(seg)))
    .join('/');
  return new RegExp(`^/api/v1${ENV_MIRROR}${rest}/?$`);
}

function batchNames(request: Request, object: string): boolean {
  let body: unknown;
  try {
    body = request.postDataJSON();
  } catch {
    return true;
  }
  const operations = (body as { operations?: unknown } | null)?.operations;
  if (!Array.isArray(operations)) return true;
  return operations.some((op) => (op as { object?: unknown } | null)?.object === object);
}

/** A predicate over browser requests: does this one write a record of `object`? */
export function writesRecordsOf(object: string): (request: Request) => boolean {
  const dataPrefix = new RegExp(`^/api/v1${ENV_MIRROR}/data/${escape(object)}(?:/|$)`);
  const posts = WRITE_POSTS.map((row) => routePattern(row.slice('POST '.length), object));
  const crossObjectBatch = new RegExp(`^/api/v1${ENV_MIRROR}/batch/?$`);
  return (request) => {
    const method = request.method();
    const path = new URL(request.url()).pathname;
    if (WRITE_METHODS.has(method)) return dataPrefix.test(path);
    if (method !== 'POST') return false;
    if (posts.some((p) => p.test(path))) return true;
    return crossObjectBatch.test(path) && batchNames(request, object);
  };
}
