/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `newTabUrl` fast path's routing rule, shared by the console server-action
 * handler (`consoleServerAction`) and the hosts that register a `type: 'api'`
 * handler beside it (`useConsoleActionRuntime`, `RecordDetailView`).
 *
 * It lives apart from `consoleServerAction` on purpose: the hosts' tests stub
 * that module with a factory, and a rule kept there would vanish under every
 * such stub. Kept here, an api action is routed by the same rule under test as
 * in the console.
 */

import type { ActionContext, ActionDef, ActionResult, ServerActionHandler } from '@object-ui/core';

/**
 * Whether `action` takes the zero-roundtrip `newTabUrl` fast path:
 * `opensInNewTab` plus a non-empty `newTabUrl`. The spec gives that pair one
 * meaning whatever the action's `type` — navigate the pre-opened tab, no
 * request — so a host's `type: 'api'` handler asks this and hands such an
 * action to the handler `createConsoleServerActionHandler` builds,
 * instead of sending its own request to `target`.
 */
export function takesNewTabUrlFastPath(action: ActionDef): action is ActionDef & { newTabUrl: string } {
  return !!action.opensInNewTab && typeof action.newTabUrl === 'string' && action.newTabUrl !== '';
}

/**
 * A host's registered `type: 'api'` handler, made to honour the `newTabUrl`
 * fast path: an action that {@link takesNewTabUrlFastPath} goes to
 * `consoleHandler` (the handler `createConsoleServerActionHandler`
 * built for the same surface, so the record id resolves the way that surface
 * resolves it), and every other action to `apiHandler` unchanged.
 *
 * Without it the console's api handlers sent their request to `target` and
 * never read the pair, so a `type: 'api'` action declaring `opensInNewTab` +
 * `newTabUrl` opened no tab and POSTed instead, from the record header, its
 * more-menu and the list toolbar alike (objectstack#26747). The pair's early
 * row-count refusal is the fast path's own, forwarded only for those actions;
 * an ordinary api action keeps having none.
 */
export function withNewTabUrlFastPath(
  apiHandler: (action: ActionDef, context?: ActionContext) => Promise<ActionResult>,
  consoleHandler: ServerActionHandler,
): ServerActionHandler {
  return Object.assign(
    (action: ActionDef, context?: ActionContext) => (takesNewTabUrlFastPath(action)
      ? consoleHandler(action, context)
      : apiHandler(action, context)),
    {
      refuseBeforeInput: (action: ActionDef, context?: ActionContext) => (takesNewTabUrlFastPath(action)
        ? consoleHandler.refuseBeforeInput?.(action, context)
        : undefined),
    },
  );
}
