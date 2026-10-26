/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { ExpressionEvaluator, evalRowPredicate } from '@object-ui/core';

/**
 * Global predicate scope — populated by host shells (e.g. app-shell's
 * `ExpressionProvider`) so renderers like action buttons can resolve
 * deployment-level flags (`features`, `user`, …) without needing
 * to import the host shell directly. (⛔ Not `app`: objectui#8155 removed that
 * root from `buildExpressionScope`, so no host shell in this repo publishes
 * one.)
 *
 * `useCondition` / `useExpression` merge this scope under the
 * locally-passed `context`, so per-row `record` overrides still win.
 * Defaults to an empty object so components used outside a provider
 * keep behaving exactly as before.
 */
const PredicateScopeContext = createContext<Record<string, any>>({});

/**
 * Provider for the global predicate scope. Wraps children so any
 * descendant `useCondition` / `useExpression` call has access to
 * top-level variables (e.g. `features.multiOrgEnabled`).
 *
 * Most consumers should not use this directly — the app-shell's
 * `ExpressionProvider` already feeds it. It's exported for hosts that
 * want a custom shell.
 */
export function PredicateScopeProvider({
  scope,
  children,
}: {
  scope: Record<string, any>;
  children: ReactNode;
}) {
  return createElement(PredicateScopeContext.Provider, { value: scope }, children);
}

/**
 * Read the current global predicate scope. Returns an empty object when
 * no provider is mounted.
 */
export function usePredicateScope(): Record<string, any> {
  return useContext(PredicateScopeContext);
}

/**
 * Normalize a schema-supplied predicate (`visible` / `enabled` / `disabled` /
 * `hidden`) into the form `useCondition` expects — the canonical helper to use
 * in renderers so we never end up with `${[object Object]}` after JS
 * template-literal interpolation.
 *
 * **Re-exported from `@object-ui/core`, not reimplemented here.** There is
 * exactly ONE implementation — `packages/core/src/evaluator/predicateInput.ts`
 * — shared by the engine path (`ActionEngine.getActionsForLocation`) and the
 * renderer path (`action-button` / `action-menu` / `action-bar` / …). See that
 * file for the accepted input shapes and for why a `cel` envelope must survive
 * normalization (#2661 / #3314).
 *
 * ## Why a re-export and not a twin (#3367)
 *
 * This module used to carry an independent renderer-side implementation with
 * item-for-item identical semantics, held in step with the canonical one by a
 * 14-shape normalization parity table. That table was a *guardrail against
 * drift*, not a single source of truth — and #3314 is the record of what two
 * normalizations do when left alone: they drift, and the same `visible:`
 * predicate reaches different verdicts depending on which path surfaced the
 * action. A re-export cannot drift, so the parity suite now pins identity
 * (`react`'s export IS `core`'s function) instead of enumerating shapes, and
 * keeps pinning the two PATHS verdict-for-verdict.
 *
 * Routing hook code through the `@object-ui/core` barrel is not a new coupling:
 * this module already imports `ExpressionEvaluator` / `evalRowPredicate` from
 * it, and `@object-ui/core` is a declared dependency of `@object-ui/react`
 * (the reverse direction is the forbidden one — core declares "Zero React
 * dependencies").
 */
export { toPredicateInput } from '@object-ui/core';

/**
 * Build the predicate context for a **row record** — the bag to hand
 * {@link useCondition} when the thing being gated is scoped to one record.
 *
 * The row is bound ONE way: `record.status` — the canon (objectui#5330, ruled
 * 2026-08-20; Phase 2 executed by `83fe6e741`). This is not a dialect choice;
 * it is one rule, and it is `evalRowPredicate`'s rule
 * (`core/evaluator/listConditional.ts` — the record header, list rows, the row
 * kebab and conditional formatting all evaluate through it), restated here for
 * the `useCondition` tier so both tiers answer an author's `visible:` the same
 * way.
 *
 * ## The two retired spellings (`83fe6e741`)
 *
 * Until Phase 2 this bag also carried the row spread flat (bare `status`, the
 * row-action shorthand) and as `data` (legacy), and `useCondition` below warned
 * once per non-canonical spelling (Phase 1, `d1ab06f0f`). Both bindings and the
 * warning are gone. A bare-field or `data.*` predicate against this bag now
 * faults exactly as it always did on the server (`buildScope({ record })`
 * mounts exactly `['record']`: `Unknown variable: status` / `Unknown variable:
 * data`), and each `useCondition` leg applies its EXISTING fault policy — the
 * throwing legs (`throwOnError`: every action `visible` — `action:button`,
 * `action:menu`, `action:bar`, `DeclaredActionsBar`, and since objectui#11212
 * `action:group`, `action:icon` and the related-list toolbar) hide and report
 * `was hidden/disabled: its predicate threw`, naming the variable; the
 * non-throwing legs fail soft to `true`. The same holds for a legacy `${data.x}` / `${x}` string: one bag
 * shape, both dialects. Nothing detects a retired spelling here; it is simply
 * unbound. `@object-ui/core`'s `evaluator/rowPredicateCanon.ts` carries the
 * canon statement, the server measurement, the layer scoping (`data` stays
 * canonical one layer over, in a metadata-editing form — ADR-0089 D3) and the
 * offline detector.
 *
 * ## Why a helper and not "just `{ record }`" (objectui#4075 / #4080)
 *
 * Because the rule has two halves and every predicate face has to get both:
 * the SHAPE — `record` is the row's one name, so `record.viewer.can_act`, what
 * every declared action on framework's `sys_approval_request` gates on
 * (framework#3310 / objectstack-ai/objectstack#3424), reaches the row — and the NO-ROW case below.
 * `DeclaredActionsBar` and the four generic action renderers once carried
 * inline copies of this bag and drifted (objectui#4077 / #4079); one named
 * helper is what keeps a fifth copy from drifting again.
 *
 * Note the direction of the merge: `useCondition` evaluates on
 * `new ExpressionEvaluator({ ...scope, ...context })`, so this bag's `record`
 * shadows an ambient `record` a host put in the predicate scope — the row is
 * the subject — while every OTHER ambient key (`features`, `user`, a host's own
 * `data`) survives to the predicate as the host's own.
 *
 * This is the BINDING rule only. It deliberately does not touch the evaluation
 * entry — `useCondition` / `toPredicateInput` / `hasDeclaredVisibilityGate`
 * keep their pinned semantics (objectui#3492 / #3842 / #3850 / #3871), and each
 * caller keeps its own error policy (fail-closed `visible` vs the fail-soft
 * legs). Binding the row is a different question from what to do when the
 * predicate faults.
 *
 * ## No row → bind NOTHING, do not bind an empty one
 *
 * `null` / `undefined` / a non-object returns an EMPTY bag, not
 * `{ record: {} }`. The difference is load-bearing: `useCondition` merges this
 * context OVER the ambient predicate scope, so binding an empty record would
 * blank out a `record` that a host had put in the scope itself — which is
 * exactly how `action:group`'s dropdown leaf is driven in
 * `action-group-dropdown-visible.test.tsx`, and it is a legitimate way for a
 * host to supply the row. "This surface has no row of its own" must stay
 * distinct from "this surface's row is empty"; only the latter is entitled to
 * shadow the scope.
 *
 * @param record The row, or nothing.
 */
export function usePredicateRecordContext(record: unknown): Record<string, any> {
  return useMemo(() => {
    if (record == null || typeof record !== 'object' || Array.isArray(record)) return {};
    return { record: record as Record<string, any> };
  }, [record]);
}

/**
 * Hook for evaluating expressions with dynamic context
 * 
 * @example
 * ```tsx
 * const isVisible = useExpression('${data.age >= 18}', { data });
 * const label = useExpression('Hello ${user.name}!', { user });
 * ```
 */
export function useExpression(
  expression: string | boolean | number | null | undefined,
  context: Record<string, any> = {}
): any {
  const scope = usePredicateScope();
  // We evaluate directly without caching the evaluator to avoid issues with context changes
  return useMemo(
    () => {
      // Merge global scope under the local context — local wins so per-row
      // `record` overrides still take precedence over `features` etc.
      const evaluator = new ExpressionEvaluator({ ...scope, ...context });
      return evaluator.evaluate(expression);
    },
    [expression, context, scope]
  );
}

/**
 * Hook for evaluating conditional expressions
 * Returns a boolean value
 * 
 * @example
 * ```tsx
 * const isVisible = useCondition('${data.status === "active"}', { data });
 * ```
 */
/** One-time registry for fail-closed predicate warnings (see useCondition). */
const _warnedConditions = new Set<string>();

export function useCondition(
  condition: string | boolean | undefined | { dialect?: string; source?: string },
  context: Record<string, any> = {},
  options?: { throwOnError?: boolean; label?: string }
): boolean {
  const scope = usePredicateScope();
  // We evaluate directly without caching the evaluator to avoid issues with context changes
  return useMemo(
    () => {
      // No row-spelling detector on this tier (`83fe6e741` removed the
      // Phase-1 warning with the bindings): a retired bare-field / `data.*`
      // spelling against a `usePredicateRecordContext` bag is simply unbound
      // and faults like any other unknown variable, and each leg's existing
      // fault report below is what names it.
      const evaluator = new ExpressionEvaluator({ ...scope, ...context });
      if (options?.throwOnError) {
        // Fail-closed: a predicate that can't be evaluated hides/disables
        // rather than defaulting to visible — mirrors ActionEngine's
        // getActionsForLocation contract, opted into by callers gating a
        // real action rather than passive display content.
        try {
          return evaluator.evaluateCondition(condition, { throwOnError: true });
        } catch (err) {
          // A throwing predicate is almost always an authoring bug (wrong
          // scope variable, bare field reference) — warn once per
          // (label, predicate) so the silent hide is diagnosable (#2358)
          // without spamming re-renders.
          const src = typeof condition === 'string' ? condition : String(condition);
          const key = `${options?.label ?? ''}::${src}`;
          if (!_warnedConditions.has(key)) {
            _warnedConditions.add(key);
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(
              `[object-ui] ${options?.label ?? 'a component'} was hidden/disabled: ` +
              `its predicate threw — ${msg}. Predicate: ${src}.`,
            );
          }
          return false;
        }
      }
      return evaluator.evaluateCondition(condition);
    },
    [condition, context, scope, options?.throwOnError, options?.label]
  );
}

/**
 * Evaluate a **row-scoped predicate** (a row-action `visible` / `disabled`, or a
 * conditional-formatting `condition`) against a record on the canonical CEL
 * engine — the same engine the server uses (issue #1584 / ADR-0058).
 *
 * Unlike {@link useCondition} (schema/widget tier, legacy `${}` dialect), this
 * routes to `@object-ui/core`'s `evalRowPredicate`: a bare string is CEL (the
 * spec contract for `ActionSchema.visible`), a `{ dialect: 'cel', source }`
 * envelope is always CEL, and only a legacy-dialect string falls back to the
 * old engine (with a deprecation warning). The row is bound as `record.*` only
 * — the canon (objectui#5330; the bare-field and `data.*` spellings retired in
 * `83fe6e741` and fault here like any unknown variable); the ambient
 * predicate scope (`features` / `user` / …) is merged alongside so
 * deployment-level gates keep resolving.
 *
 * @param pred     The raw predicate: `boolean` (returned as-is), a CEL string,
 *                 an `{ dialect, source }` envelope, or `null`/`undefined`/`''`.
 * @param row      The row record to evaluate against.
 * @param options  `fallback` — value when the predicate is absent or faults
 *                 (default `true`); `warnOnError` — log when a present predicate
 *                 faults (fail-soft-but-logged, ADR-0058); `label` — for the log.
 */
export function useRowPredicate(
  pred: unknown,
  row: Record<string, any> | null | undefined,
  options?: {
    fallback?: boolean;
    warnOnError?: boolean;
    label?: string;
    /**
     * The object's field definitions. Supplying them binds a relation field as
     * the stored foreign key instead of whatever `$expand` substituted for it
     * on this surface, so `record.owner == os.user.id` reaches the server's
     * verdict — see `toPredicateRecord`.
     */
    fields?: unknown;
  },
): boolean {
  const scope = usePredicateScope();
  const fallback = options?.fallback ?? true;
  const fields = options?.fields;
  return useMemo(
    () => {
      // A boolean predicate short-circuits (no expression to evaluate).
      if (typeof pred === 'boolean') return pred;
      if (pred == null || pred === '') return fallback;
      return evalRowPredicate(pred as string | { dialect?: string; source: string }, row ?? {}, {
        fallback,
        scope,
        warnOnError: options?.warnOnError,
        label: options?.label,
        fields: fields as never,
      });
    },
    [pred, row, scope, fallback, options?.warnOnError, options?.label, fields],
  );
}
