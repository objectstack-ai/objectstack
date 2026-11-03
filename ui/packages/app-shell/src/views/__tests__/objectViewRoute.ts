/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Test support for objectstack#29550: the server half of the one-object view
 * read, `GET /api/v1/meta/view?object=OBJECT`, for app-shell suites whose fake
 * server or fake `client.meta` holds the published view rows.
 *
 * The adapter's `listViews` / `listViewOverrides` read one object's views
 * through that route while nothing has stored or is reading the whole view
 * list. A suite hands its rows to {@link answerObjectViewRead} from its `fetch`
 * double, so the route answers from the same rows its whole list does.
 */

/**
 * The rows the server's `?object=` serves: `viewKind` set, `object` naming the
 * object, sorted by `order` and then `name` (`createMetaListAnswer` step 4,
 * `packages/rest/src/meta-item-read-gate.ts`). Restated, not imported from the
 * adapter, so a drift between the two shows up as a red suite.
 */
export function serveObjectViews(items: readonly any[], object: string): any[] {
  return items
    .filter((v: any) => v && typeof v === 'object' && v.viewKind && v.object === object)
    .sort((a: any, b: any) =>
      ((a.order ?? 0) as number) - ((b.order ?? 0) as number)
      || String(a.name).localeCompare(String(b.name)));
}

/** The object `url` asks views of, when it is the one-object view read. */
export function objectViewReadOf(input: RequestInfo | URL): string | undefined {
  const url = new URL(String(input), 'http://test.local');
  if (url.pathname !== '/api/v1/meta/view') return undefined;
  return url.searchParams.get('object') ?? undefined;
}

/**
 * When `input` is the one-object view read, its answer from `rows()` (the
 * server's whole view list: an array, or the `{ items }` envelope);
 * otherwise `undefined`, for the double's own routes.
 */
export async function answerObjectViewRead(
  input: RequestInfo | URL,
  rows: () => any | Promise<any>,
): Promise<Response | undefined> {
  const object = objectViewReadOf(input);
  if (object === undefined) return undefined;
  const answer = await rows();
  const items: any[] = Array.isArray(answer?.items) ? answer.items : Array.isArray(answer) ? answer : [];
  return new Response(JSON.stringify({ type: 'view', items: serveObjectViews(structuredClone(items), object) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
