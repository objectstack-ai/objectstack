/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `autoTrigger` — the client-composed "run this action as soon as a renderer
 * receives it" flag (#844), and the ONE implementation of its once-ness (#4162).
 *
 * ## What the flag means
 *
 * A caller (a welcome-page CTA that deep-links into "create", say) marks an
 * action `autoTrigger: true` to have it run once on mount, through the exact
 * same execute path as a click — so param dialogs, confirms and entitlement
 * gates all still apply. It is NOT persisted metadata: the flag only ever
 * exists on client-composed schemas, which makes hosts its only producers.
 *
 * ## Why this lives in a shared module (#4162)
 *
 * It was consumed by `action:button` alone. `action:bar` splits its post-gate
 * list at `maxVisible` (3 desktop, 1 mobile) and hands the tail to
 * `action:menu`, which had no `autoTrigger` handling — so an auto-triggered
 * action that happened to sort past the threshold was rendered as an ordinary
 * "More" menu entry and never ran, while the caller had already spent the
 * one-shot signal it stood for (the #844 deep link is consumed by stripping it
 * from the URL: measured `urlParam=null execute=0`, unrecoverable). Which
 * actions lost their auto-trigger was a function of viewport width.
 *
 * The ruling on that card: **the flag's contract is "execute once on mount by
 * whichever renderer receives the action"**. So every renderer that can receive
 * an action consumes it — by EXECUTING, not by rendering an affordance and
 * hoping — and they all consume it through this hook. Once-ness written twice
 * is two behaviours waiting to drift apart, which is the same shape as the
 * defect being fixed.
 *
 * ## The guard's exact semantics (unchanged from `action:button`'s original)
 *
 * A ref, not state: it must not re-render, and it must survive the identity
 * churn of `schema` / `handleClick`, which change on every parent render. One
 * ref per rendered action, for the lifetime of that action's component, so:
 *
 *   - re-renders never re-fire it;
 *   - a flag that flips true LATER (a state-dependent toolbar attaches it once
 *     entitlements resolve) still fires exactly once, when it flips;
 *   - and it can never fire twice, whatever the flag does afterwards.
 *
 * Container visibility still governs mounting, and that is deliberate: a
 * renderer that returns null before its children mount (an `action:bar` whose
 * own `visible` is false, or a hidden `action:menu`) auto-triggers nothing,
 * because nothing received the action.
 *
 * ## The action's OWN declared `visible` gate outranks the flag (objectui#4191)
 *
 * The two gates answer different questions: `visible` is the metadata author's
 * verdict on whether this action may be OFFERED here; `autoTrigger` is a
 * host's transport-level statement that the user asked for it. Ruling A on
 * objectui#4191: the author's verdict wins. An action whose declared `visible`
 * evaluates false is NOT run by its auto-trigger — and, because a silent no-op
 * is exactly the failure #4123 / #4162 were about, the refusal is reported:
 * a user-visible notice ("… is not available on the current page") plus a
 * dev-build console diagnostic naming the action and its predicate.
 *
 * This is not an authorization boundary and was never one: confirm, param,
 * entitlement and server-side permission checks apply on every execute path
 * regardless. What the gate protects is the author's offer-ability rule.
 *
 * The gate lives HERE, inside the one hook, so `action:button` and
 * `action:menu` cannot disagree about it — "which renderer got the action" is
 * decided by `action:bar`'s `maxVisible` split and therefore by the viewport,
 * and the #4162 parity principle is that it must never change the outcome.
 * Each renderer hands in its own `visible` verdict (the same fail-closed
 * `useCondition` it already computes for its early return); the "is it
 * hidden?" composition is written once, below, with the same declared-gate
 * test the early returns use.
 *
 * Refusal does not spend the once-guard: it is re-judged on every commit, so an
 * action whose predicate resolves to visible later (an ambient scope that
 * arrives after first paint) still runs, once. The notice is reported at most
 * once per mounted action.
 */

import { useEffect, useRef } from 'react';
import { useObjectTranslation } from '@object-ui/i18n';
import { toast } from '../../ui/sonner';
import { hasDeclaredVisibilityGate } from './visibility-gate';

/**
 * Is this action asking to be auto-triggered? One spelling of the test, so the
 * flag cannot be read as `!== undefined` in one renderer and `=== true` in
 * another. Deliberately strict: only the literal `true` arms it.
 */
export function hasAutoTrigger(action: unknown): boolean {
  return (action as { autoTrigger?: unknown } | null | undefined)?.autoTrigger === true;
}

/** The fields of an action this module reads. */
export interface AutoTriggerSubject {
  autoTrigger?: unknown;
  visible?: unknown;
  name?: string;
  label?: string;
}

/**
 * The sonner id of an action's refusal notice — stable per action, so a
 * remount (or a second renderer receiving the same action) updates the one
 * toast instead of stacking another.
 */
function autoTriggerRefusedToastId(action: AutoTriggerSubject): string {
  return `auto-trigger-refused:${action.name ?? action.label ?? ''}`;
}

/**
 * Report a refused auto-trigger: one notice for the user (`message`, already
 * localized by the caller), one dev-build diagnostic for the author.
 */
function reportRefused(action: AutoTriggerSubject, message: string): void {
  toast.warning(message, { id: autoTriggerRefusedToastId(action) });
  if (process.env.NODE_ENV !== 'production') {
    const predicate = typeof action.visible === 'string' ? action.visible : JSON.stringify(action.visible);
    console.warn(
      `[object-ui] action "${action.name ?? action.label ?? ''}" carries autoTrigger but was NOT run: ` +
        `its own declared \`visible\` gate evaluated false on this surface, and the author's ` +
        `verdict outranks the flag (objectui#4191). Predicate: ${predicate}.`,
    );
  }
}

/**
 * Run `run` at most once, as soon as `action` asks to be auto-triggered — unless
 * the action's own declared `visible` gate hides it, in which case the trigger
 * is refused and reported instead (objectui#4191).
 *
 * @param action    The action the renderer received (read: `autoTrigger`,
 *                  `visible`, `name`, `label`).
 * @param isVisible The renderer's own evaluated `visible` verdict — the same
 *                  value its early return consults. Only consulted when the
 *                  action DECLARES a gate, exactly like that early return.
 * @param run       The renderer's click path. It may change identity freely (it
 *                  is rebuilt from `schema` on most renders); the ref is what
 *                  makes this once-only, so depending on it is safe.
 */
export function useAutoTriggerOnce(
  action: AutoTriggerSubject,
  isVisible: boolean,
  run: () => void | Promise<void>,
): void {
  const { t } = useObjectTranslation();
  const fired = useRef(false);
  const refusalReported = useRef(false);
  const armed = hasAutoTrigger(action);
  const hidden = hasDeclaredVisibilityGate(action.visible) && !isVisible;
  useEffect(() => {
    if (!armed || fired.current) return;
    if (hidden) {
      if (!refusalReported.current) {
        refusalReported.current = true;
        reportRefused(
          action,
          t('actions.notAvailableHere', {
            defaultValue: '"{{action}}" is not available on the current page.',
            action: action.label || action.name || '',
          }),
        );
      }
      return;
    }
    fired.current = true;
    void run();
    // `action` is read only on the refusal branch, for its display fields; the
    // guard refs make a re-run of this effect on a fresh action object a no-op.
  }, [armed, hidden, run, t, action]);
}
