/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Test support for objectstack#29550: the server half of the one-object view
 * read, `GET /api/v1/meta/view?object=OBJECT`, for the suites that stand a
 * metadata store in for the server.
 *
 * `listViews` and `listViewOverrides` read one object's views through that
 * route while nothing has stored the whole view list. A suite whose store
 * answers `client.meta.getItems('view')` hands its store to
 * {@link answerObjectViewRead} from its `fetch` double, so the route answers
 * from the same rows the store holds, the way the server does.
 */

/**
 * The rows the server's `?object=` serves from a whole view list: `viewKind`
 * set, `object` naming the object, sorted by `order` and then `name`. It
 * restates `createMetaListAnswer` step 4 (`packages/rest/src/meta-item-read-gate.ts`),
 * the server's rule; the adapter's own copy of it is not imported, so a
 * drift between the two shows up as a red suite.
 */
export function serveObjectViews(items: readonly any[], object: string): any[] {
  return items
    .filter((v: any) => v && typeof v === 'object' && v.viewKind && v.object === object)
    .sort((a: any, b: any) =>
      ((a.order ?? 0) as number) - ((b.order ?? 0) as number)
      || String(a.name).localeCompare(String(b.name)));
}

/**
 * When `input` is the one-object view read, its answer from `list()` (a
 * stand-in for the server's whole view list, the `{ type, items }` envelope or
 * a bare array) by the server's rule; otherwise `undefined`, for the double's
 * own routes. A `list()` that rejects rejects the request, as a dropped
 * connection would.
 */
export async function answerObjectViewRead(
  input: RequestInfo | URL,
  list: () => Promise<any>,
): Promise<Response | undefined> {
  const url = new URL(String(input), 'http://test.local');
  const object = url.searchParams.get('object');
  if (url.pathname !== '/api/v1/meta/view' || object === null) return undefined;
  const answer = await list();
  const items: any[] = Array.isArray(answer?.items) ? answer.items : Array.isArray(answer) ? answer : [];
  return new Response(JSON.stringify({ type: 'view', items: serveObjectViews(items, object) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
