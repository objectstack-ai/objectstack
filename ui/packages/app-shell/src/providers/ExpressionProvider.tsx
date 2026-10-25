/**
 * ExpressionContext Provider
 *
 * Provides expression evaluation context (user, app, data) to all child components.
 * Used by useCondition/useExpression hooks from @object-ui/react to evaluate
 * dynamic visibility, disabled, and hidden expressions in navigation items,
 * fields, and components.
 *
 * @example
 * ```tsx
 * <ExpressionProvider user={currentUser} app={activeApp}>
 *   <UnifiedSidebar activeAppName={activeApp.name} />
 * </ExpressionProvider>
 * ```
 */

import React, { createContext, useContext, useMemo } from 'react';
import { ExpressionEvaluator, bindSubjectCapabilities, bindSubjectPermissions } from '@object-ui/core';
import { PredicateScopeProvider, reportUnresolvableVisibilityPredicate, usePredicateScope } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { toEvalPermissions, type EvalPermissions, type EvalSystemPermissions } from '@objectstack/formula';

export interface ExpressionContextValue {
  /** Current authenticated user */
  user: Record<string, any>;
  /** Active application config */
  app: Record<string, any>;
  /** Additional data scope */
  data: Record<string, any>;
  /**
   * Deployment-level feature flags surfaced by `/api/v1/auth/config`
   * (e.g. `multiOrgEnabled`). Used by CEL/template predicates on
   * metadata actions and views to hide entries that would otherwise
   * hit a forbidden endpoint. Empty `{}` when auth config hasn't
   * loaded yet — predicates should default to "visible" in that case
   * (see `sys_organization.create_organization.visible`).
   */
  features: Record<string, any>;
  /** The evaluator instance (for imperative use) */
  evaluator: ExpressionEvaluator;
}

const ExprCtx = createContext<ExpressionContextValue | null>(null);

/** The inputs an app-shell surface has when it needs a predicate scope. */
export interface ExpressionScopeInput {
  user?: Record<string, any>;
  /**
   * ⛔ No `app`. It is not an input to the predicate scope, because the scope
   * does not bind it — objectui#8155, ruled 2026-09-07. Accepting an argument
   * this builder then discards is the declared-but-not-enforced shape the same
   * ruling exists to remove, so the parameter is gone rather than ignored.
   * `ExpressionProvider` still takes an `app` prop and still publishes it on
   * the React context value; that is a different thing from a CEL root.
   *
   * ⛔ No `data` either, and for the mirror-image reason — objectui#8166,
   * ruled 2026-09-10. `app` was BOUND HERE AND REFUSED by the engine; `data`
   * was BOUND HERE AND ACCEPTED by it, while naming something that is not the
   * record. Same remedy, same argument: the builder no longer takes an
   * argument it must not bind. `ExpressionProvider` still takes a `data` prop
   * and still publishes it on the React context value.
   */
  features?: Record<string, any>;
  /**
   * The caller's effective object permissions — the data
   * `current_user.can(object, verb)` is answered from (objectui#4421) — or
   * `undefined` while there is no LOADED payload to answer from. Take it from
   * {@link useExpressionPermissions}, which is what decides "loaded"; ⛔ never
   * pass `{}` for "not loaded yet": an empty map is a real answer ("holds
   * nothing"), and the engine refuses loudly precisely so that a missing
   * payload cannot pass for one.
   */
  permissions?: EvalPermissions;
  /**
   * The caller's held system capabilities — the `systemPermissions` list of
   * the same `/auth/me/permissions` answer, the data
   * `current_user.hasCapability(name)` is answered from (objectui#13006) — or
   * `undefined` while there is no loaded answer. Take it from
   * {@link useExpressionSystemPermissions}; ⛔ never pass `[]` for "not
   * loaded": an empty list is a real answer ("holds no capability").
   */
  systemPermissions?: EvalSystemPermissions;
}

/**
 * The ONE predicate scope this tier binds — the single declaration of what an
 * app-shell expression can name.
 *
 * ADR-0068 D1: expose the SAME user object under the canonical `current_user`
 * plus the back-compat `user` alias, the server-RLS-parity `ctx.user` alias,
 * and the server-CEL-parity `os.user` alias (the spec's canonical identity
 * scope — `{{os.user.id}}` per @objectstack/spec expression docs), so a
 * predicate authored against any one form evaluates identically on client,
 * server-formula, and server-RLS (#2358 trap 1). D1 names a client `visible`
 * gate as one of the three surfaces that must agree.
 *
 * ## Why this is a function and not three literals
 *
 * It was three literals, and they drifted (objectui#6493). `ExpressionProvider`
 * built the full bag, while `RecordFormPage` and `AppContent` each built a
 * private `new ExpressionEvaluator({ user, app, data })` for the SAME kind of
 * gate — an object field's `visible` — beside the provider they never read.
 * Those bags bound `user` but not the other three spellings of the same object,
 * and not `features` at all, so ONE authored predicate meant two things
 * depending on which evaluator reached it: `current_user` resolved on a nav
 * item and FAULTED on a field, and a fault fails OPEN (`evaluateVisibility`
 * below), which is indistinguishable on screen from a gate that said yes.
 * A copy of the bag is how that recurs; a call is not.
 *
 * `features` is renderer-tier, not contract — the same posture `@objectstack/
 * spec`'s `page.zod.ts` documents for component `visibleWhen` ("the shipping
 * renderer additionally mounts `app`, `features`, `os.user` … renderer
 * behaviour, NOT contract-guaranteed"). It is bound here because it is what
 * THIS tier's own diagnostic advice tells an author they may name. That quote
 * still names `app`; this tier no longer mounts it — see below.
 *
 * ## Why there is no `app` root (objectui#8155, ruled 2026-09-07)
 *
 * There was one, and it was a root the protocol never declared. ADR-0068
 * declares `current_user` with the `user` / `ctx.user` aliases and nothing
 * named `app`; `@objectstack/formula`'s `SCOPE_ROOTS` (`cel-engine.ts`) has no
 * `app` either. So an authored `app.name == 'crm'` was bound HERE and refused
 * by the engine that lints it — an editor advertising a root its own linter
 * rejects, with the nonsense remedy `record.app` and no spelling that both
 * lints clean and resolves.
 *
 * The ruling is that the engine's `SCOPE_ROOTS` is the contract and this
 * consumer aligns to it, NOT that the engine grows a root to match this
 * consumer. Option A — widen the engine vocabulary — was the producer-side
 * card objectstack#16420, and the same ruling CLOSED it `not_planned`
 * (2026-09-07T04:16:22Z). Should a real need for a "current app" root ever be
 * measured, it is a fresh spec/engine vocabulary widening; there is no open
 * record waiting for it. ⛔ The other refused route was suppressing the
 * diagnostic in `celAuthoring.ts`: that is the lenient-fallback shape
 * AGENTS.md #0.1 bans.
 *
 * ## Why there is no `data` root either (objectui#8166, ruled 2026-09-10)
 *
 * `app` and `data` came off the same list producing OPPOSITE failures, and the
 * `data` half is the nastier one.
 *
 * `83fe6e741` (Phase 2 of the objectui#5330 canon) retired `data.*` on
 * runtime record surfaces: the row is bound as `record.*` and nothing else, and
 * `@object-ui/core`'s `evaluator/rowPredicateCanon.ts` records the server's
 * verdict for the retired spelling — `data.status` is `❌ Unknown variable:
 * data`. But `@objectstack/formula`'s `SCOPE_ROOTS` still contains `data`, so
 * at `scope: 'record'` the AUTHORING LINT accepts `data.status == 'x'`. An
 * ambient `data` bound HERE is what let that accepted-by-the-linter predicate
 * also resolve at runtime — against this bag rather than against the row.
 *
 * Measured on `origin/main` before the removal, one authored
 * `visibleWhen: "data.status == 'x'"` meant three different things depending on
 * which of this tier's bags reached it:
 *
 *   - against `data: {}` (what every `ExpressionProvider` mount passes, and
 *     what `RecordFormPage`'s own evaluator built) the engine answered
 *     `[runtime] No such key: status` — a fault, so the field-rule fallback
 *     applied: fail-OPEN for `visibleWhen`;
 *   - against `data: editingRecord` (what `AppContent`'s field-list evaluator
 *     built for the global record-form modal, in EDIT mode) it RESOLVED, with
 *     no diagnostic at all — the wrong-layer root silently answering from the
 *     host's record;
 *   - in CREATE mode on that same modal `editingRecord` is null, so the same
 *     predicate fell back to the first case.
 *
 * A root that answers three ways and is never the row is not a root. Removing
 * it collapses all three onto the engine's own verdict — `[type] Unknown
 * variable: data`, byte-identical in shape to the `app` diagnostic above — and
 * `record.*`, the canon, is unaffected.
 *
 * ⛔ Two routes the ruling refused. De-advertising `data` from an
 * advertised-roots list fixes nothing: it stops autocomplete RECOMMENDING the
 * root while the lint still ACCEPTS it, so every already-authored `data.*`
 * predicate stays green and stays wrong. And ⛔ filtering the diagnostic in
 * `celAuthoring.ts` is treating the wrong layer — there is no diagnostic to
 * filter, the absence of one is the defect. Splitting `SCOPE_ROOTS` per scope
 * is the producer-side half and lives in `@objectstack/formula`, not here.
 *
 * The one `data` that survives this tier is the metadata-admin form's, and it
 * is a different object one layer up: `views/metadata-admin/predicate.ts`
 * binds `data` = the DRAFT under edit through its own builder (ADR-0089 D3,
 * `CANONICAL_ROOT_BY_LAYER` = `{ runtime: 'record', metadata: 'data' }`), takes
 * only the identity roots from this bag, and assigns its own `data` last. It is
 * unaffected by this removal, by construction.
 *
 * Every root below is one the engine accepts AND one this tier can actually
 * answer, so the three surfaces — what this binds, what the editor advertises,
 * what the linter admits — now agree.
 *
 * ## Why `record` is not here either, and where an app page gets it
 *
 * `record` is the PAGE's row, not the tier's: `@objectstack/spec`'s
 * `PageSchema.record` (objectstack#24265) lets an `app` page declare one, and
 * every component `visibleWhen` on that page reads it as `record`. This builder
 * runs once for the whole shell, so it has no row to bind and binds none; an
 * app page that declares a binding adds its row BELOW this bag, through
 * {@link PageRecordScope} (objectui#12931). Every other surface, and an app page
 * with no binding, therefore sees exactly the roots listed here.
 */
export function buildExpressionScope({
  user = {},
  features = {},
  permissions,
  systemPermissions,
}: ExpressionScopeInput = {}): Record<string, any> {
  // ONE subject object under all four spellings, and it is the one carrying the
  // permissions and the capability list: the engine answers `can` and
  // `hasCapability` only for a receiver IDENTICAL to the bound `current_user`,
  // so a second copy under any alias would be refused. Both ride under symbols
  // (`@object-ui/core` `subjectPermissions.ts`), so neither is a CEL root nor a
  // readable member of `current_user`.
  const subject = bindSubjectCapabilities(bindSubjectPermissions(user, permissions), systemPermissions);
  return { current_user: subject, user: subject, ctx: { user: subject }, os: { user: subject }, features };
}

/**
 * One adapted map per payload object, kept outside React (AGENTS.md #10): the
 * provider publishes the SAME `objects` object for the same response, so this
 * is keyed on the payload, never on a memoised identity. `null` records a
 * payload `toEvalPermissions` refused, so the refusal is reported once.
 */
const ADAPTED_PERMISSIONS = new WeakMap<object, EvalPermissions | null>();

function adaptEffectiveObjects(objects: object): EvalPermissions | undefined {
  let adapted = ADAPTED_PERMISSIONS.get(objects);
  if (adapted === undefined) {
    try {
      adapted = toEvalPermissions(objects);
    } catch (err) {
      // Refused, not repaired: the formula package's adapter has no lenient
      // arm, and neither does this one. The binding stays UNBOUND, so every
      // `current_user.can(...)` faults (and each surface applies its own fault
      // policy) instead of answering from a map that is not the contract.
      console.error(
        '[object-ui] current_user.can(object, verb) is not bound: the permissions '
          + `payload was refused — ${err instanceof Error ? err.message : String(err)}`,
      );
      adapted = null;
    }
    ADAPTED_PERMISSIONS.set(objects, adapted);
  }
  return adapted ?? undefined;
}

/**
 * The effective object permissions the predicate scope binds for
 * `current_user.can(object, verb)` (objectui#4421), or `undefined` when there
 * is no loaded payload to answer from.
 *
 * ## Rider 1: absent while not loaded, never "empty"
 *
 * The maintainer's ruling makes a permission-shaped binding fail-CLOSED while
 * the permissions payload has not loaded. The map is therefore handed on only
 * when `usePermissions().isLoaded` is true AND the provider holds an
 * `/auth/me/permissions` answer; otherwise nothing is bound and the engine
 * REFUSES `can` (`ok: false`, a fault naming the missing input). What happens
 * next is the evaluating surface's own FAULT policy, unchanged by this binding:
 * a leg that evaluates fail-closed (`throwOnError: true` on `useCondition`,
 * `fallback: false` on `evalRowPredicate`) hides the action, a fail-soft leg
 * does not. Which legs are which is deliberately not listed here (AGENTS.md
 * #9); `providers/__tests__/currentUserCan-4421.render.test.tsx` re-measures
 * the three states on the surfaces it pins. ⛔ No `{}` stand-in: it would
 * answer "holds nothing" — a quiet `false` indistinguishable from a real
 * denial, which the engine's contract forbids a caller to fabricate.
 *
 * `isLoaded` is the gate rather than "some map is present" because a
 * refetching `MePermissionsProvider` still holds its previous map while
 * `isLoaded` is false; the ruling's "has not loaded" is read as the provider's
 * own flag.
 *
 * ## Why the global no-provider default is not involved
 *
 * `usePermissions()` with no provider answers `can: () => true` (fail-open, the
 * built-in affordances' standalone-embed contract). This binding never calls
 * it: it reads `effectiveObjects`, which the no-provider answer does not carry,
 * so under no provider `current_user.can(...)` faults — it does not inherit
 * that `true`.
 */
export function useExpressionPermissions(): EvalPermissions | undefined {
  const { isLoaded, effectiveObjects } = usePermissions();
  return isLoaded && effectiveObjects ? adaptEffectiveObjects(effectiveObjects) : undefined;
}

/**
 * The caller's held system capabilities the predicate scope binds for
 * `current_user.hasCapability(name)` (objectui#13006), or `undefined` when
 * there is no loaded answer to read them from.
 *
 * The list is the `systemPermissions` of the SAME `/auth/me/permissions`
 * answer `usePermissions()` holds — the one the action gate checks
 * `requiredPermissions` against — so there is no second fetch. It is handed on
 * on exactly the terms {@link useExpressionPermissions} hands on the object
 * map, and only when that map is bound too:
 *
 *  - not loaded, no provider, or a backend that never reported
 *    `systemPermissions` (a deployment predating ADR-0066): `undefined`, and
 *    the engine REFUSES `hasCapability` loudly. ⛔ Never `[]`: an empty list is
 *    a real answer and would read as a quiet denial.
 *  - a loaded answer whose object map the formula adapter refused: `undefined`
 *    as well. One answer binds both halves or neither, so the subject's
 *    capability list can never change while its permissions map stays the
 *    same object — the pair `packages/react` re-binds the runner's
 *    `current_user` on (`JSON.stringify` cannot see a symbol-keyed list).
 *    `providers/__tests__/hasCapability-13006.render.test.tsx` pins it.
 */
export function useExpressionSystemPermissions(): EvalSystemPermissions | undefined {
  const { systemPermissions } = usePermissions();
  const permissions = useExpressionPermissions();
  return permissions !== undefined ? systemPermissions : undefined;
}

/**
 * An `ExpressionEvaluator` over {@link buildExpressionScope}.
 *
 * Every app-shell site that needs an evaluator imperatively (i.e. one it cannot
 * take from `useExpressionContext()`, because it builds the field list ABOVE
 * the provider it mounts) calls this instead of `new ExpressionEvaluator(...)`
 * with a hand-written bag.
 */
export function createExpressionEvaluator(input: ExpressionScopeInput = {}): ExpressionEvaluator {
  return new ExpressionEvaluator(buildExpressionScope(input));
}

interface ExpressionProviderProps {
  children: React.ReactNode;
  user?: Record<string, any>;
  app?: Record<string, any>;
  data?: Record<string, any>;
  features?: Record<string, any>;
}

export function ExpressionProvider({ children, user = {}, app = {}, data = {}, features = {} }: ExpressionProviderProps) {
  // objectui#4421 — read HERE, once, so every mount of this provider (and every
  // surface under it) binds `current_user.can(...)` from the same payload with
  // no prop to thread and no per-surface copy of the hand-off.
  const permissions = useExpressionPermissions();
  // objectui#13006 — the capability list `current_user.hasCapability(name)`
  // reads, from the same answer, bound with the map or not at all.
  const systemPermissions = useExpressionSystemPermissions();
  const value = useMemo(() => {
    const evaluator = createExpressionEvaluator({ user, features, permissions, systemPermissions });
    // `app` and `data` are still published on the context value — `DashboardView`
    // reads `app` as a plain value. Neither is handed to the evaluator:
    // objectui#8155 (`app`), objectui#8166 (`data`).
    return { user, app, data, features, evaluator };
  }, [user, app, data, features, permissions, systemPermissions]);

  // Also feed the predicate scope used by useCondition/useExpression in
  // @object-ui/react so action visibility predicates (e.g. on toolbar
  // buttons) can see deployment-level flags like features.multiOrgEnabled.
  // The SAME bag the evaluator above got — one builder, so the imperative and
  // the hook-driven halves of this provider cannot drift apart either.
  const scope = useMemo(
    () => buildExpressionScope({ user, features, permissions, systemPermissions }),
    [user, features, permissions, systemPermissions],
  );

  return (
    <ExprCtx.Provider value={value}>
      <PredicateScopeProvider scope={scope}>{children}</PredicateScopeProvider>
    </ExprCtx.Provider>
  );
}

/**
 * The row an `app` page binds, published as `record` in that page's predicate
 * scope (objectui#12931, the renderer half of objectstack#24265).
 *
 * The page's components read their `visibleWhen` against the ambient predicate
 * scope (`SchemaRenderer`'s `buildNodeEvaluationScope` spreads it first), so
 * the row joins that scope here: the ambient bag {@link ExpressionProvider}
 * published, plus `record`, and nothing else. No new root: `record` is the root
 * the spec already binds for a component predicate, and a count or a plan is a
 * FIELD on the row (`record.environment_count > 1`, `record.plan != 'free'`).
 *
 * `null` is the bound set with no row, or a row the caller may not read: the
 * page HAS a binding and it answered nothing, so `record == null` holds and a
 * read of a field on it faults, which a fail-soft `visibleWhen` renders — the
 * same verdict the spec gives an unbound row.
 *
 * Only the page's own host mounts this, and only when the page declares a
 * binding; a page with none keeps the ambient bag untouched.
 *
 * Why the ambient scope rather than `RecordContextProvider`: that context is
 * the RECORD PAGE's, and the `record:*` blocks read their body from it. Put
 * there, the page's row would become the record of every unbound record block
 * on the page — a binding the spec does not give (a block's own `dataSource`
 * decides its body). A record block that binds its own row still provides it
 * through `RecordContextProvider`, and that row wins for its own subtree, as
 * `buildNodeEvaluationScope` writes `record` after the ambient spread.
 */
export function PageRecordScope({
  record,
  children,
}: {
  record: Record<string, unknown> | null;
  children: React.ReactNode;
}) {
  const ambient = usePredicateScope();
  // Memoised for cost only (AGENTS.md #10): every consumer evaluates against
  // the values in it, never against this object's identity.
  const scope = useMemo(() => ({ ...ambient, record }), [ambient, record]);
  return <PredicateScopeProvider scope={scope}>{children}</PredicateScopeProvider>;
}

/**
 * Hook to access the expression context.
 * Returns the full context value or a default empty context.
 */
export function useExpressionContext(): ExpressionContextValue {
  const ctx = useContext(ExprCtx);
  if (!ctx) {
    // Return a safe default so components can be used outside the provider.
    // Through the same builder: the hand-written version gave `current_user`,
    // `ctx.user` and `os.user` three DIFFERENT empty objects, which ADR-0068 D1
    // spells as aliases "pointing at the same object".
    //
    // The scope input and the context value are no longer the same object:
    // `app` (objectui#8155) and `data` (objectui#8166) are readable context
    // FIELDS but not CEL roots, so handing this bag straight to the builder
    // would smuggle back the very bindings those rulings removed.
    // Left UNANNOTATED on purpose: annotating it `ExpressionScopeInput` widens
    // every member to optional, and the spread below then fails to satisfy
    // `ExpressionContextValue`, whose members are required.
    const scope = { user: {}, features: {} };
    return { ...scope, app: {}, data: {}, evaluator: createExpressionEvaluator(scope) };
  }
  return ctx;
}

/**
 * The `type` slot of the shared visibility-fault reporter, for THIS surface
 * (objectui#6443).
 *
 * ## Why the slot needed a decision at all
 *
 * `reportUnresolvableVisibilityPredicate` (@object-ui/react, objectui#6038)
 * dedupes on `(type, key, predicate source)` — `id` rides along in the printed
 * line but is deliberately NOT in the key. So whatever goes in `type` sets this
 * site's RATE LIMIT, and a nav item is not a schema node: there is no
 * `schema.type` to hand over.
 *
 * ## Why a CONSTANT, and not the item's identity
 *
 * The choice is between a constant (one line per distinct authored predicate
 * SOURCE) and something per-item (one line per menu entry). Measured against
 * the three cases that can actually occur:
 *
 *   - two entries, two different broken predicates -> BOTH keys already differ
 *     on `source`, so both report either way. No difference.
 *   - two entries sharing ONE broken predicate (the copy-pasted role gate, the
 *     common shape) -> a constant reports ONCE, which is correct: it is one
 *     authoring mistake, in one string, fixed in one edit. A per-item key would
 *     report once per entry and add no information — same text, same reason.
 *   - one entry, evaluated many times -> both dedupe. This site is re-entered
 *     more than a node gate is: `hasVisibleNavigationItems` re-runs every item
 *     predicate to DERIVE area visibility (objectui#3311) before
 *     `NavigationRenderer` runs them again to render, and both re-run on every
 *     sidebar re-render.
 *
 * A per-item key is therefore never better and sometimes much worse. It is also
 * unreachable without widening `VisibilityEvaluator` (@object-ui/layout), whose
 * whole signature is `(expression) => boolean` — a cross-package public type
 * change this diagnostics-only card does not get to make. The predicate SOURCE
 * is the locator instead, and it is in both the key and the printed line: it is
 * the string an author greps their metadata for, and it is unique to the bug in
 * a way an item id is not.
 *
 * ## Why this spelling
 *
 * Namespaced with a colon, like `page:tabs` (the other non-node surface wired to
 * this reporter). It names the app-shell `visible` GATE, not a component key —
 * `app-shell` is deliberately NOT a registry key (objectui#4841), and the colon
 * keeps this label out of that bare namespace so a diagnostic can never be read
 * as claiming one.
 *
 * It is deliberately NOT `nav:item`, even though this card is written about nav
 * and area items: `evaluateVisibility` is also the gate `RecordFormPage` runs
 * over an object's field visibility predicates, and labelling those "nav" would
 * be false.
 *
 * The stated consequence — a nav item and a form field carrying the IDENTICAL
 * broken predicate text sharing one dedupe entry — no longer arises, and the
 * reason is worth keeping rather than deleting. Since objectui#6514 the two
 * sites report under DIFFERENT authored keys (`visible` for nav and area items,
 * `visibleWhen` for an object field), and `key` is part of the dedupe tuple, so
 * the same broken string now produces one line per surface. That is a strictly
 * better outcome than the one accepted here, and it is a side effect of naming
 * the key honestly, not a goal: the line still names the predicate SOURCE,
 * which is what both sites are grepped by.
 */
const APP_SHELL_VISIBLE_SURFACE = 'app-shell:visible';

/**
 * Report one faulting app-shell `visible` predicate, through the shared
 * reporter, under this surface's constant `type`.
 */
function reportAppShellVisibleFault(
  // The key the AUTHOR wrote, which is what the printed line tells them to
  // grep for. Nav and area items carry `visible`, the default; an object
  // field's predicate is `visibleWhen` (objectui#6514), and naming it
  // `visible` there would send an author to a key `FieldSchema` REFUSES.
  authoredKey: string,
  expression: unknown,
  reason: unknown,
  // What the surface's fault policy DID with the entry: `'visibility'` where a
  // fault is answered fail-open, `'withholding'` where it is answered
  // fail-closed (the navigation gate, objectui#12700).
  gate: 'visibility' | 'withholding',
): void {
  reportUnresolvableVisibilityPredicate(
    APP_SHELL_VISIBLE_SURFACE,
    undefined,
    authoredKey,
    expression,
    reason,
    // objectui#6487. Until this argument existed the line closed with the
    // NODE tier's advice, telling an author whose nav predicate faulted to
    // check `record` and `page.<var>` — two roots the bag built in
    // `ExpressionProvider` above does not contain at all — while the identity
    // aliases and `features` that it DOES contain went unnamed. (`app` was in
    // that list until objectui#8155 removed the root; the advice no longer
    // names it either.)
    'app-shell',
    gate,
  );
}

/**
 * Evaluate a visibility expression.
 * Supports:
 * - boolean: true/false
 * - string "true"/"false"
 * - template expression: "${user.role === 'admin'}"
 * - `{ dialect: 'cel', source }` envelopes — the shape the spec's
 *   `ExpressionInputSchema` normalizes every authored `visible` string into,
 *   which is what nav/area items carry after the server serves the app schema
 * - bare expression strings (evaluated as one boolean expression)
 *
 * Everything non-literal is delegated to `evaluator.evaluateCondition`, which
 * routes CEL envelopes to the canonical `@objectstack/formula` engine. The
 * envelope and bare-string shapes used to fall through to a blanket
 * `return true`, so a constant-false nav `visible` predicate (e.g.
 * ``P`'org_admin' in current_user.positions` ``) still rendered for everyone —
 * the app author had no working way to hide a menu item by role.
 *
 * Returns true if the item should be visible (fail-open on evaluation errors,
 * matching the evaluator's own default). A NAVIGATION entry is not gated here:
 * it goes through {@link evaluateNavigationVisibility}, which withholds on a
 * fault (objectui#12700). This fail-open answer is the object-field gate's
 * (`isObjectFieldVisible`) and the published export's.
 */
export function evaluateVisibility(
  expression: string | boolean | { dialect?: string; source?: string } | undefined,
  evaluator: ExpressionEvaluator,
  authoredKey: string = 'visible',
): boolean {
  if (expression === undefined || expression === null) return true;
  if (expression === true || expression === 'true') return true;
  if (expression === false || expression === 'false') return false;

  // objectui#6443 — the fault is REPORTED now, and the verdict is untouched.
  //
  // `evaluateCondition` is fail-soft: it answers an unevaluable predicate with
  // `true` from its OWN catch and does not throw, so the `catch` below never
  // saw a predicate fault and this site swallowed every one of them in
  // silence — in production AND in development, which is what made it worse
  // than the node gate objectui#6038 fixed. `onFault` is the only channel that
  // reaches that swallowed fault, and it costs nothing: no `throwOnError`
  // second evaluation, same single engine call as before.
  //
  // FAIL-OPEN here, deliberately: a predicate that cannot be evaluated still
  // returns `true`. This function is the object-field gate's and the published
  // export's; the NAVIGATION gate moved to `evaluateNavigationVisibility`,
  // which withholds on a fault (objectui#12700, ruled). objectui#6443 made the
  // fault loud and left the verdict alone.
  const report = (reason: unknown): void =>
    reportAppShellVisibleFault(authoredKey, expression, reason, 'visibility');

  try {
    return evaluator.evaluateCondition(expression, { onFault: report });
  } catch (err) {
    // Defensive, and now loud too: `evaluateCondition` handles its own faults,
    // so reaching here means the evaluator itself threw. That path returned the
    // same fail-open `true` in silence; it no longer does.
    report(err);
    return true; // Default to visible on error
  }
}

/**
 * Should this NAVIGATION entry be drawn? — the gate every navigation surface of
 * the shell asks of an entry's (or an area's) authored `visible`: the sidebar,
 * the app root's landing and the activity roster (all through
 * `useNavMemberGates`), the `nav:menu` block and the command palette's
 * navigation list (objectui#12700).
 *
 * The verdict is {@link evaluateVisibility}'s on every predicate that
 * evaluates. It differs on a FAULT only: a predicate this evaluator cannot
 * answer WITHHOLDS the entry instead of drawing it for everyone. The case that
 * made this a ruling is `current_user.can(object, verb)` asked where no
 * permissions payload is bound — outside `MePermissionsProvider`, or before it
 * holds an answer: the engine refuses (`useExpressionPermissions` binds
 * nothing rather than `{}`), and the fail-open default turned that refusal into
 * "shown", so permission-gated navigation hid nothing. A navigation gate is
 * hidden until known. The refusal stays loud: the fault is reported once per
 * predicate, with the engine's reason and the `'withholding'` consequence line.
 *
 * Only a FAULT withholds. A blank gate is "no gate" in every mode of the
 * evaluator (ADR-0137 D4) and is still drawn: when a first, fail-soft
 * evaluation reports a fault, the predicate is asked once more on the
 * evaluator's own fail-closed seam (`throwOnError`), and only a throw there
 * withholds. A predicate that evaluates never pays that second call.
 *
 * ⛔ This is UI gating, not a security boundary: the server enforces what a
 * member may read whatever the shell draws.
 *
 * Internal to the package: not re-exported by the package entry.
 */
export function evaluateNavigationVisibility(
  expression: string | boolean | { dialect?: string; source?: string } | undefined,
  evaluator: ExpressionEvaluator,
): boolean {
  if (expression === undefined || expression === null) return true;
  if (expression === true || expression === 'true') return true;
  if (expression === false || expression === 'false') return false;

  let reason: unknown;
  let faulted = false;
  try {
    const verdict = evaluator.evaluateCondition(expression, {
      onFault: (r) => {
        faulted = true;
        reason = r;
      },
    });
    if (!faulted) return verdict;
  } catch (err) {
    // The evaluator itself threw: no answer at all, so the entry is withheld.
    reportAppShellVisibleFault('visible', expression, err, 'withholding');
    return false;
  }

  try {
    const verdict = evaluator.evaluateCondition(expression, { throwOnError: true });
    // Not a fault on the fail-closed seam: the blank gate, drawn as before and
    // reported with the fail-open consequence it actually had.
    reportAppShellVisibleFault('visible', expression, reason, 'visibility');
    return verdict;
  } catch {
    reportAppShellVisibleFault('visible', expression, reason, 'withholding');
    return false;
  }
}

/**
 * The two field-visibility keys `@objectstack/spec`'s `FieldSchema` DECLARES.
 *
 * There is deliberately no `visible` here (objectui#6514). `FieldSchema` is a
 * `strictObject` and `visible` is not one of its keys: it appears in
 * `FIELD_KEY_GUIDANCE` as prose that REFUSES the spelling, and deliberately not
 * as an alias, because — quoting the guidance's own comment — "this surface
 * declares BOTH forms and the two answers have opposite polarity: renaming onto
 * `visibleWhen` sends `visible: false` to a slot that wants a CEL string, and
 * renaming onto `hidden` silently inverts the value the author already wrote."
 * Reading the refused key here would be a second, renderer-side contract for a
 * spelling the platform tells authors not to write (AGENTS.md #0.1).
 */
export interface FieldVisibilityDeclaration {
  /**
   * Static, and INVERTED relative to the `visible` it replaces: `visible: false`
   * is `hidden: true`. Declared `z.boolean().default(false)`, so validated
   * metadata carries an explicit `false` on every field that is not hidden.
   *
   * `=== true` is the whole read, and no coercion belongs here: a string
   * `'true'` is not spec-valid field metadata, and making it work would
   * fossilize a second dialect for the one key whose polarity is already the
   * easiest thing on this surface to get backwards.
   */
  hidden?: boolean;
  /** Per-record CEL predicate — the field is shown only when TRUE, else hidden. */
  visibleWhen?: string | boolean | { dialect?: string; source?: string };
}

/**
 * Should this object field be rendered? — the app-shell's field-list gate.
 *
 * The name is `isObjectFieldVisible` and not the shorter `isFieldVisible`,
 * because that shorter name is twice taken in this repo by functions answering
 * different questions: `views/metadata-admin/inspectors/flow-node-config.ts`
 * gates a flow node's CONFIG inputs on the node's type, and `apps/console`'s
 * `FormPage` evaluates the VIEW-level field predicate — "different authoring
 * slots with different owners", in that file's own words. Neither reads an
 * object field's declared metadata keys, which is the only thing this one does;
 * one shared name across the three would blur exactly the distinction those
 * files keep.
 *
 * ## The keys, and the one that is NOT read
 *
 * Both call sites (`RecordFormPage`, and `AppContent`'s global record-form
 * modal) used to gate on `evaluateVisibility(f.visible, …)`. That key is
 * refused by `FieldSchema`, so the gate was unreachable through the authoring
 * surface — a field `visible` never survives validation, and a census over the
 * framework's 113 `*.object.*` files found zero of them. Maintainer ruling,
 * 2026-08-27 (objectui#6514, Option A): read the DECLARED keys instead and
 * DELETE the dead read. `visible` is not consulted, in either polarity.
 *
 * ## Why the two keys compose as AND
 *
 * `hidden` is the static gate; `visibleWhen` is documented as "shown only when
 * TRUE (else hidden)" — a NECESSARY condition, never a licence to un-hide a
 * statically hidden field. So a field shows only when it is not `hidden` AND
 * its predicate holds. This is the same shape `@object-ui/core`'s
 * `resolveFieldRuleState` already uses one tier down, where the static and the
 * predicate OR into the restrictive verdict (`readonly || readonlyWhen`,
 * `required || requiredWhen`).
 *
 * ## Scope: no `current_user` binding is ADDED here
 *
 * Field-level visibility keeps the contract's current scope (ruling
 * sub-clause, 2026-08-27). This helper adds no roots: it hands `visibleWhen` to
 * `evaluateVisibility` over whatever evaluator the caller already built, and
 * the fail-open on a faulting predicate is the shipped, documented behaviour of
 * this tier (objectui#6443 / #6487) — unchanged. Per-user field hiding is the
 * option/form layers' job, because those bind the user.
 */
export function isObjectFieldVisible(
  field: FieldVisibilityDeclaration | undefined,
  evaluator: ExpressionEvaluator,
): boolean {
  // INVERTED. `hidden: true` means "do not render"; `false` and absent both
  // mean "render". Read it backwards and nothing goes red — a field either
  // vanishes with no diagnostic, or leaks to a principal it was hidden from.
  if (field?.hidden === true) return false;
  return evaluateVisibility(field?.visibleWhen, evaluator, 'visibleWhen');
}
