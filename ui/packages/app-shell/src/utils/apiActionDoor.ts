/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which door a `type: 'api'` click goes through (objectstack#27611, step 3 of
 * the ruling on objectstack#27506: people and agents use one system).
 * Module-internal: the two api handlers — `useConsoleActionRuntime`'s and
 * `RecordDetailView`'s — call it, and nothing outside this package can import
 * it (it is not re-exported from `utils/index` or the package entry).
 *
 * ## Two doors, chosen by a lookup, not a guess
 *
 * - **the action door**, `POST /api/v1/actions/:object/:action` — for a click
 *   whose object and `name` resolve to a DECLARED `type: 'api'` action whose
 *   `target` is a path on this origin ({@link findDeclaredApiAction}). The
 *   server resolves the declaration by name and runs every gate it carries —
 *   the sign-in floor, its `requiredPermissions` (ADR-0066 D4), its activation
 *   switch (ADR-0126 §8: a switched-off action answers `409 ACTION_DISABLED`
 *   and its target is never called), its param contract and a caller-scoped
 *   load of the subject row — then forwards the request to `target` in-process
 *   with the caller's credentials. The server assembles the target's body from
 *   the declaration (`recordIdParam` / `recordIdField` from the subject row,
 *   `bodyShape.wrap`, the `outputs.*` fold, `organizationId` for an
 *   `/api/v1/auth/` target, `bodyExtra`, `method`, the target's
 *   placeholders), by the rules the direct fetch applies. So the click sends
 *   only what the browser alone holds: the subject row's id and the params bag,
 *   its `{{page.<var>}}` tokens already resolved.
 * - **the target itself**, fetched by the browser — for every other api click.
 *   An off-origin `target` is never governed by this server (its doors refuse
 *   it), and a click that names no declared action — an inline page
 *   `action:button` whose `name` is optional — has no gate to apply. That is
 *   not a fallback for a door that failed: for those clicks the target IS the
 *   door.
 *
 * ⚠️ **What the lookup cannot see, said rather than assumed.** It reads the
 * object metadata the host already holds, as the flow launch's lookup does
 * (`utils/flowLaunch`): an object's own `actions[]`, which includes every
 * `defineAction({ objectName })` declared beside it. An object-LESS declared
 * action (`/actions/global/:action`) and a standalone authored action row no
 * object embeds are absent from it, so such a click keeps the direct fetch it
 * always made.
 *
 * ## Who owns which half of the exchange
 *
 * The `/actions` REQUEST belongs to `@object-ui/core`'s dispatcher —
 * `createServerActionHandler` owns name-only identity (ADR-0110 D1), the
 * `{ recordId, params }` body and the `_rowRecord` strip, and app-shell names
 * that route nowhere else (`actions-envelope.ratchet.test.ts`). Its ANSWER is
 * the forwarded target's, so it is read by the host's api rules — the
 * entitlement dialog, `apiActionFailureMessage`, the `{ success, data }`
 * unwrap and `refreshAfter` — and the raw answer is handed back here for that.
 */

import { createServerActionHandler } from '@object-ui/core';
import type { ActionDef, ActionResult, ServerActionFetch } from '@object-ui/core';

/**
 * `true` for a `target` the action door forwards to: a path on this origin.
 * The server's own predicate, restated so the two answer alike: `//host` is
 * protocol-relative (another origin), and `/\host` is the same thing spelled
 * for browsers that read a backslash as a slash.
 */
export function isSameOriginApiTarget(target: unknown): target is string {
  if (typeof target !== 'string' || target.length < 2 || !target.startsWith('/')) return false;
  const second = target.charAt(1);
  return second !== '/' && second !== '\\';
}

/** The keys of a declared action the lookup reads. */
interface DeclaredActionShape {
  name?: unknown;
  type?: unknown;
  target?: unknown;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Is `clicked` the target `declared` produces? The runner substitutes every
 * `${param.*}` / `${ctx.*}` token before a registered api handler sees the
 * target (`ActionRunner.interpolateTarget`), each value percent-encoded, so a
 * substituted token spans no `/`, `?` or `#`. `{field}` row placeholders reach
 * the handler unsubstituted and compare as written.
 */
function declaredTargetMatches(declared: string, clicked: string): boolean {
  if (declared === clicked) return true;
  if (!declared.includes('${')) return false;
  const pattern = declared.split(/\$\{[^}]*\}/).map(escapeRegExp).join('[^/?#]*');
  return new RegExp(`^${pattern}$`).test(clicked);
}

/**
 * The declared same-origin api action a click names, or `undefined` when it
 * names none.
 *
 * A match needs all five: the object is in `objects`, it declares an action of
 * this `name`, that action's `type` is `'api'`, its `target` is a path on this
 * origin, and the click's target is the one that declaration produces. A
 * same-named action of another type, or one aimed elsewhere, is not the
 * click's declaration — sending the click to it would run something the click
 * did not ask for.
 */
export function findDeclaredApiAction(
  objects: readonly unknown[] | undefined,
  objectName: string | undefined,
  actionName: string | undefined,
  clickedTarget: string,
): (DeclaredActionShape & { name: string; target: string }) | undefined {
  if (!objectName || !actionName || !Array.isArray(objects)) return undefined;
  const objectDef = objects.find(
    (o) => (o as { name?: unknown } | null | undefined)?.name === objectName,
  ) as { actions?: unknown } | undefined;
  const actions: unknown[] = Array.isArray(objectDef?.actions) ? objectDef.actions : [];
  const declared = actions.find(
    (a) => (a as DeclaredActionShape | null | undefined)?.name === actionName,
  ) as DeclaredActionShape | undefined;
  if (!declared || declared.type !== 'api' || !isSameOriginApiTarget(declared.target)) return undefined;
  if (!declaredTargetMatches(declared.target, clickedTarget)) return undefined;
  return declared as DeclaredActionShape & { name: string; target: string };
}

export interface ApiActionDoorInput {
  /** The host's authenticated transport. */
  fetch: ServerActionFetch;
  baseUrl: string;
  /** The clicked action; its `name` is the declaration's. */
  action: ActionDef;
  /** The object the declaration belongs to. */
  objectName: string;
  /**
   * The SUBJECT ROW's id, resolved by the host. The door loads the row by it
   * and reads `recordIdField` and the target's `{field}` placeholders off that
   * row, so this is the row's `id`, never the `recordIdField` value.
   */
  recordId: unknown;
  /** The params bag, `_rowRecord` stripped and `{{page.<var>}}` tokens resolved. */
  params: Record<string, unknown>;
}

/** The door's answer, raw, or the dispatcher's own result when none arrived. */
export type ApiActionDoorExchange =
  | { answered: true; res: { ok: boolean; status: number }; json: unknown }
  | { answered: false; result: ActionResult };

/** Send a declared same-origin api click through the action door. */
export async function sendApiActionThroughDoor(input: ApiActionDoorInput): Promise<ApiActionDoorExchange> {
  let answered: { res: { ok: boolean; status: number }; json: unknown } | undefined;
  const keepAnswer: ServerActionFetch = async (url, init) => {
    const res = await input.fetch(url, init);
    const json = await res.json().catch(() => null);
    answered = { res: { ok: res.ok, status: res.status }, json };
    return { ok: res.ok, status: res.status, json: async () => json };
  };
  const dispatch = createServerActionHandler({
    fetch: keepAnswer,
    baseUrl: input.baseUrl,
    // The host already resolved the subject row; the dispatcher must not
    // re-derive it from a grid selection.
    resolveRecordId: () => ({ recordId: input.recordId }),
  });
  const result = await dispatch({ ...input.action, objectName: input.objectName, params: input.params });
  return answered ? { answered: true, ...answered } : { answered: false, result };
}
