/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useCapabilityGate — the UI half of ADR-0066 D4's `requiredPermissions`
 * contract, for surfaces that filter actions THEMSELVES.
 *
 * `ActionEngine.getActionsForLocation` applies this gate for everything routed
 * through the engine. But several renderers filter their own action lists —
 * `page:header` (record_header / record_more) and the grid's row-action menu
 * (list_item) — and each of those bypassed the engine entirely, so a button
 * declaring a capability nobody holds still rendered (framework#3923). One hook
 * so all three surfaces gate identically and can't drift apart.
 *
 * Source of truth for what the caller holds: the ActionProvider's runner
 * context (`user.systemPermissions`) — the same object the engine reads — with
 * the ambient predicate scope as fallback for hosts that mount an
 * ExpressionProvider but no action runtime.
 *
 * **Fail-OPEN when unknown.** No runner, no user, no `systemPermissions` array:
 * the action shows. Unknown is not denied, the server is the authority
 * (the framework's ADR-0124 D1 — server enforces, client is courtesy), and
 * hiding a permitted user's button on missing client data is the worse
 * failure. An EMPTY array is not unknown — it means "holds nothing" and gates
 * normally.
 */

import { useCallback, useContext } from 'react';
import { ActionCtxReact } from '../context/ActionContext.js';
import { usePredicateScope } from './useExpression.js';

/**
 * The caller's system capabilities, or `undefined` when the host never supplied
 * them (→ callers must fail open).
 */
export function useHeldCapabilities(): string[] | undefined {
  const actionCtx = useContext(ActionCtxReact);
  const predicateScope = usePredicateScope();
  const runnerUser = (actionCtx?.runner?.getContext?.() as any)?.user;
  if (Array.isArray(runnerUser?.systemPermissions)) return runnerUser.systemPermissions;
  const scopeUser = (predicateScope as any)?.user;
  if (Array.isArray(scopeUser?.systemPermissions)) return scopeUser.systemPermissions;
  return undefined;
}

/**
 * `(requiredPermissions) => mayInvoke`. Actions declaring nothing always pass.
 */
export function useCapabilityGate(): (required: unknown) => boolean {
  const held = useHeldCapabilities();
  return useCallback(
    (required: unknown) => {
      if (!Array.isArray(required) || required.length === 0) return true;
      if (!Array.isArray(held)) return true; // unknown → fail open
      return required.every((p) => typeof p === 'string' && held.includes(p));
    },
    [held],
  );
}
