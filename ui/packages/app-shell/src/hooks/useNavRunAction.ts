/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useNavRunAction` — the console-side consumer of the DECLARED nav
 * `runAction` slot (`ObjectNavItemSchema.runAction`, objectstack#7253).
 *
 * ## What it consumes
 *
 * `NavigationRenderer.resolveHref` encodes an object nav entry's declared
 * `runAction` as {@link NAV_RUN_ACTION_PARAM} on the list href. When the shell
 * lands on that list, this hook reads the name back through the SAME constant
 * and hands it to the toolbar, which marks the matching action `autoTrigger` so
 * it runs through the ordinary execute path — param dialogs, confirms and
 * entitlement gates all still apply.
 *
 * ## Why this is a hook and not two `window.location` reads (#5216)
 *
 * It replaces a private convention: `EnvironmentListToolbar` used to read a
 * bare `'runAction'` literal off `window.location.search` and compare it to a
 * hard-coded `'create_environment'`, while `CloudOnboardingNext` hand-built the
 * matching query string at the other end. Two literals, no schema, no registry
 * — a second de-facto contract that `objectui validate` could not see and no
 * gate could check. The name now has one definition and the VALUE comes from
 * declared metadata, so the deep link is authored, validated and rendered
 * through one contract.
 *
 * ## Arming is destructive — the #4123 rule, kept
 *
 * Consumption is modelled as "strip the param", so arming SPENDS a one-shot
 * user intent: once stripped, a reload cannot retry it. So the caller passes an
 * `armed` predicate and the hook consumes only when it answers true — i.e. only
 * when there is genuinely something to run. This is also the client's answer to
 * a name no action declares: `defineStack`'s cross-reference walk rejects those
 * at AUTHORING time ("deep-link references action '…' (via runAction)"), and a
 * client that somehow arrives holding one runs nothing AND leaves the URL
 * alone, so a later mount with fresher metadata can still honour it. Degrading
 * quietly is right here precisely because the loud rejection already happened
 * upstream, where the author could act on it.
 *
 * Router-free on purpose (`window.location` + `history.replaceState`): the
 * toolbars that call this also render in tests and hosts without a Router, and
 * the param is a one-shot signal rather than navigation state.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { NAV_RUN_ACTION_PARAM } from '@object-ui/layout';
import { hasDeclaredVisibilityGate } from '@object-ui/components';
import { useCondition, toPredicateInput, usePredicateRecordContext } from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';

/** Read the requested action name off the URL as it was on arrival. */
function readRequested(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get(NAV_RUN_ACTION_PARAM);
    return raw && raw !== '' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Consume `requested` once `shouldArm` answers true: strip the param and hand
 * the name back while it is armed. The ONE implementation of the #4123
 * consume-once rule, shared by both hooks below.
 */
function useConsumeOnce(requested: string | null, shouldArm: (requested: string) => boolean): string | null {
  const consumed = useRef(false);
  const shouldRun = requested !== null && !consumed.current && shouldArm(requested);
  useEffect(() => {
    if (!shouldRun) return;
    consumed.current = true;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(NAV_RUN_ACTION_PARAM);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      /* URL cleanup is cosmetic — never fail the trigger over it */
    }
  }, [shouldRun]);
  return shouldRun ? requested : null;
}

/**
 * Read the declared deep link once, and consume it once `armed` says something
 * can act on it.
 *
 * @param armed Called with the requested action name; return `true` only when
 *   that action is actually present and runnable on this surface. Returning
 *   `false` leaves the URL untouched — the intent stays recoverable.
 * @returns The requested action name while it is armed and unconsumed, else
 *   `null`. Callers use it to mark exactly that action `autoTrigger: true`.
 */
export function useNavRunAction(armed: (requested: string) => boolean): string | null {
  // Read at mount, from the URL as it was on arrival. `useState`'s initializer
  // (not a ref assignment) so a re-render caused by the strip below cannot
  // re-read an already-emptied search string and lose the name mid-flight.
  const [requested] = useState<string | null>(readRequested);
  return useConsumeOnce(requested, armed);
}

/** The fields of a declared action the preparation step reads. */
interface DeepLinkCandidate {
  name?: string;
  label?: string;
  visible?: unknown;
}

/**
 * The deep-link PREPARATION step for a surface that renders its declared
 * actions through `action:bar` — `useNavRunAction` plus the action's own
 * declared `visible` gate (objectui#4191, ruling A).
 *
 * ## Why the gate is here and not only in the renderer
 *
 * The renderers (`action:button` / `action:menu`, through the shared
 * `useAutoTriggerOnce`) already refuse an `autoTrigger` whose action is hidden
 * by its own `visible`. But by the time a renderer refuses, THIS step has
 * already consumed the one-shot intent — the param is stripped and a reload
 * cannot retry it, the #4123 failure. So the preparation step asks the same
 * question first: a candidate its author hid on this surface is neither marked
 * `autoTrigger` nor consumed, and the refusal is reported here — a notice for
 * the user (the same `actions.notAvailableHere` text the renderers use) and a
 * dev-build diagnostic for the author.
 *
 * ## The SAME predicate the renderer evaluates — composed, not re-implemented
 *
 * `action:button` hides itself when `hasDeclaredVisibilityGate(visible)` and
 * the fail-closed `useCondition(toPredicateInput(visible), recordContext,
 * { throwOnError: true, label })` answers false. This step calls exactly those
 * three exported functions with exactly those inputs: the ambient predicate
 * scope is read by `useCondition` itself from the same tree position the bar
 * renders at, and the record context is `usePredicateRecordContext(undefined)`
 * because a list toolbar has no row — the bar is mounted without `data` there,
 * so the button binds no row either. The `label` is spelled the way
 * `action:button` spells it, so a throwing predicate warns once, not twice.
 * `__tests__/useOfferedNavRunAction.test.tsx` pins the two verdicts against each
 * other through the real `action:bar`.
 *
 * Not an authorization boundary: confirm / param / entitlement / server
 * permission checks apply on every execute path whatever this answers.
 *
 * @param actions   The surface's declared actions (already localized).
 * @param onSurface Does this action render on this surface (placement)?
 * @param enabled   `false` when another consumer owns the param on this page.
 * @returns The requested action name while armed and unconsumed, else `null`.
 */
export function useOfferedNavRunAction(
  actions: readonly DeepLinkCandidate[],
  onSurface: (action: DeepLinkCandidate) => boolean,
  enabled: boolean,
): string | null {
  const [requested] = useState<string | null>(readRequested);
  const candidate =
    enabled && requested !== null
      ? actions.find((a) => a?.name === requested && onSurface(a))
      : undefined;

  const noRow = usePredicateRecordContext(undefined);
  const isVisible = useCondition(toPredicateInput(candidate?.visible as never), noRow, {
    throwOnError: true,
    label: `action "${candidate?.name ?? candidate?.label ?? 'action:button'}" (visible)`,
  });
  const hidden = candidate !== undefined && hasDeclaredVisibilityGate(candidate.visible) && !isVisible;

  const { t } = useObjectTranslation();
  const refusalReported = useRef(false);
  useEffect(() => {
    if (!hidden || !candidate || refusalReported.current) return;
    refusalReported.current = true;
    toast.warning(
      t('actions.notAvailableHere', {
        defaultValue: '"{{action}}" is not available on the current page.',
        action: candidate.label || candidate.name || '',
      }),
      { id: `auto-trigger-refused:${candidate.name ?? candidate.label ?? ''}` },
    );
    if (process.env.NODE_ENV !== 'production') {
      const predicate =
        typeof candidate.visible === 'string' ? candidate.visible : JSON.stringify(candidate.visible);
      console.warn(
        `[nav] deep link ?${NAV_RUN_ACTION_PARAM}=${candidate.name} was NOT armed: the action's own ` +
          `declared \`visible\` gate evaluated false on this surface, and the author's verdict ` +
          `outranks the deep link (objectui#4191). The intent is left in the URL. Predicate: ${predicate}.`,
      );
    }
  }, [hidden, candidate, t]);

  return useConsumeOnce(requested, () => candidate !== undefined && !hidden);
}
