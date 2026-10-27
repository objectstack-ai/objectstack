/**
 * The list toolbar's affordances on the Console `ObjectView`
 * (`./ObjectView.tsx`): the environment list's entitlements, the object's list
 * actions and their localized toolbar copies, and the create and import
 * buttons' toolbar-scope predicates layered on the object-level verdicts,
 * moved out of `ObjectViewInner` verbatim (objectstack#25992, slice 7). The
 * verdicts themselves (`resolveAffordance`) stay in the component and are
 * passed in with every other input; the component reads the returned values.
 */

import { useMemo } from 'react';
import type { resolveAffordance } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
import type { usePermissions } from '@object-ui/permissions';
import { useRowPredicate, useCapabilityGate, usePredicateScope, type useActionTextLocalizer } from '@object-ui/react';
import type { RowCrudPredicates } from '../utils/crudAffordances.js';
import { listToolbarDrawsAction } from '../utils/managedByEmptyState.js';
import { mayReadObject } from '../utils/navObjectReadGate.js';
import { useEnvironmentEntitlements } from '../environment/useEnvironmentEntitlements.js';
import type { ConsoleActionRuntime } from '../hooks/useConsoleActionRuntime.js';
import type { ConsoleObjectViewProps } from './ObjectView.js';

export function useObjectViewToolbarAffordances({
    objectDef,
    dataSource,
    actionRuntime,
    refreshKey,
    perms,
    localizeActionTexts,
    newVerdict,
    importVerdict,
}: {
    objectDef: ConsoleObjectViewProps['objects'][number];
    dataSource: DataSource;
    actionRuntime: Pick<ConsoleActionRuntime, 'authFetch'>;
    refreshKey: number;
    perms: ReturnType<typeof usePermissions>;
    localizeActionTexts: ReturnType<typeof useActionTextLocalizer>;
    newVerdict: ReturnType<typeof resolveAffordance>;
    importVerdict: ReturnType<typeof resolveAffordance>;
}) {
    // Environment list (sys_environment) is entitlement- + state-aware: born
    // with one production env per org, its single `create_environment` action
    // means different things — "Set up your production environment", "Add
    // development environment", or a locked plan-tier mark linking to the
    // upgrade page (objectui#12190) — depending on org state.
    // Resolved org-side here; the hook is a no-op for every other object.
    const isEnvironmentList = objectDef.name === 'sys_environment';
    const environmentEntitlements = useEnvironmentEntitlements({
        enabled: isEnvironmentList,
        dataSource,
        authFetch: actionRuntime.authFetch,
        apiBase: (import.meta as any).env?.VITE_SERVER_URL || '',
        refreshKey,
    });
    // objectui#12109 — this object's list actions are drawn only for a caller
    // who may read the object. Every one of them is bound to it (an action's
    // `objectName` is what merges it into `objectDef.actions`), and a caller
    // without read gets the list's "You don't have access" under them, so a
    // drawn action could only end there. The verdict is the one the sidebar
    // prunes this object's navigation entry on (`mayReadObject`), so the entry
    // and its list actions go together. A boolean, read each render from the
    // provider's verdict, so the memo below keys on a primitive (AGENTS.md #10).
    const listActionsReadable = mayReadObject(perms.can, objectDef.name);
    const listActions = listActionsReadable ? objectDef.actions : undefined;
    // Localized `list_toolbar` actions, shared by the generic action bar and the
    // environment-aware toolbar (the action:bar renderer filters by location).
    // The header reads them through `headerToolbarActions`, which drops the
    // selection bar's duplicates once the active view is resolved (objectui#12462).
    const localizedToolbarActions = useMemo(
        () => (listActionsReadable ? objectDef.actions || [] : []).map((a: any) => localizeActionTexts(objectDef.name, a)),
        [objectDef, localizeActionTexts, listActionsReadable],
    );
    /**
     * [#5153] The object-list toolbar's CREATE predicates — the `create` half
     * of the toolbar-scope pair on THIS surface. #4646 (PR #5145) gave
     * `createPredicates` a consumer on the **related list**
     * (`RelatedRecordActionsBridge`); the standalone object-list page kept
     * gating its "New" on the object-level verdict alone, so one
     * `userActions.create` object form got two different verdicts depending on
     * which surface rendered the button — honoured on a record page's related
     * list, ignored here. `visibleWhen: false` (the objectui#3492 shape) did
     * not hide this "New".
     *
     * BINDING, LAYERING and the fail-CLOSED / fail-SOFT split are the import
     * half's, immediately below, verbatim — the spec types the two toolbar keys
     * identically and binds them in one breath. See that docblock for the
     * reasoning; the only thing that differs here is which affordance is gated.
     *
     * TWO RENDER POINTS, ONE VERDICT. The affordance surfaces twice on this
     * page — the PageHeader button (desktop) and the phone-only floating "+"
     * that stands in for it once the header is hidden. They are one affordance
     * rendered twice, so both consume these SAME two values; computing the
     * predicate once here is what keeps them from disagreeing with each other.
     */
    const objectCanCreate = newVerdict.allowed;
    const createPredicates: RowCrudPredicates | undefined = newVerdict.predicates;
    /** `visibleWhen` — fails CLOSED, declared-ness by `?? true`. As Import. */
    const createVisible = useRowPredicate(createPredicates?.visibleWhen ?? true, null, {
      fallback: false,
      warnOnError: true,
      label: 'builtin:create:visibleWhen',
    });
    /** `disabledWhen` — fails SOFT, `!= null` declared-ness OUTSIDE the eval. */
    const createDisabledPred = useRowPredicate(createPredicates?.disabledWhen, null, {
      fallback: false,
      warnOnError: true,
      label: 'builtin:create:disabledWhen',
    });
    const createDisabled = createPredicates?.disabledWhen != null && createDisabledPred;

    /**
     * objectui#11687 — does this page offer a way to add a row? The New button
     * above, or a `list_toolbar` action the schema-driven toolbar draws (Invite
     * User, Register OAuth Application, …), each by the verdict its own control
     * renders on. The managed-by empty state reads it: a `better-auth` list
     * must not say rows are "not added by hand here" beside such a button.
     * A boolean, computed each render from the payload (`objectDef.actions`),
     * so `renderListView` depends on a primitive, not a memoised identity
     * (AGENTS.md #10).
     */
    /**
     * objectui#13089 — the view's `addRecord` Add button opens this page's own
     * create (`actions.create`, the header New's), so it is offered exactly
     * where that New is offered and live: the object-level verdict, the
     * toolbar-scope `visibleWhen`, and not greyed by `disabledWhen` (`ListView`
     * draws no greyed Add button). A boolean, so `renderListView` depends on
     * a primitive (AGENTS.md #10).
     */
    const listAddRecordOpensCreate = objectCanCreate && createVisible && !createDisabled;
    const mayInvokeToolbarAction = useCapabilityGate();
    const toolbarPredicateScope = usePredicateScope();
    const pageOffersCreate =
        (objectCanCreate && createVisible) ||
        listToolbarDrawsAction(listActions, mayInvokeToolbarAction, toolbarPredicateScope);

    /**
     * [#5142] The object-list toolbar's IMPORT predicates — the `import` half
     * of the toolbar-scope pair the spec resolver emits, mirroring what
     * `RelatedRecordActionsBridge` does for `create` (objectui#4646).
     *
     * `@objectstack/spec@17.0.0` types `userActions.create` and
     * `userActions.import` identically and `resolveCrudAffordances` emits a
     * predicate envelope for each; the docblock binds them in one breath
     * ("`importPredicates` — same binding as `createPredicates`"). #4646 gave
     * `create` a consumer and left `import` declared-and-inert: an author could
     * write `userActions.import.visibleWhen`, have the spec accept it and the
     * resolver parse it, and watch this toolbar offer the CSV wizard anyway.
     *
     * BINDING (the spec docblock's, not an invention here). Unlike the ROW
     * predicates, a toolbar predicate evaluates ONCE per toolbar against the
     * record of the scope the toolbar sits in — the host parent record on a
     * related list, and **no record at all on a standalone object list**, which
     * is what this surface is. So `null` is passed deliberately below: a
     * predicate reading `record.*` has nothing to bind, faults, and — per the
     * fail-CLOSED rule — hides the button, exactly as the spec spells out.
     * Predicates over the host scope (`os.user.*` / `features.*`) bind normally
     * and are the meaningful shape here.
     *
     * LAYERING: surfaced only when the object-level verdict already passed —
     * the same posture the related-list bridge takes, because a predicate may
     * not RE-OPEN what the bucket, the effective API operations (objectstack#3391) or the
     * principal's grant have closed. The identity-import bypass below is a
     * different affordance entirely (it does not read the `listImport` row) and
     * is deliberately left outside this layer.
     */
    const objectCanImport = importVerdict.allowed;
    const importPredicates: RowCrudPredicates | undefined = importVerdict.predicates;
    /**
     * `visibleWhen` — fails CLOSED, and counts as DECLARED by `?? true` rather
     * than by truthiness, so `visibleWhen: false` hides Import instead of
     * reading as "ungated" (the objectui#3492 invariant). The `true` default is
     * a boolean, which the evaluator short-circuits without touching the engine
     * — an object with no import predicates pays no evaluation at all.
     */
    const importVisible = useRowPredicate(importPredicates?.visibleWhen ?? true, null, {
      fallback: false,
      warnOnError: true,
      label: 'builtin:import:visibleWhen',
    });
    /**
     * `disabledWhen` — fails SOFT (an unevaluable predicate must not grey a
     * button forever), with the `!= null` declared-ness gate OUTSIDE the
     * evaluation so `disabledWhen: ''` reads as "no condition" rather than as
     * "disable". Verbatim the posture of the record header (PR #4515), the
     * row kebab, and the related-list toolbar.
     */
    const importDisabledPred = useRowPredicate(importPredicates?.disabledWhen, null, {
      fallback: false,
      warnOnError: true,
      label: 'builtin:import:disabledWhen',
    });
    const importDisabled = importPredicates?.disabledWhen != null && importDisabledPred;
    return {
        isEnvironmentList,
        environmentEntitlements,
        listActions,
        localizedToolbarActions,
        objectCanCreate,
        createVisible,
        createDisabled,
        listAddRecordOpensCreate,
        pageOffersCreate,
        objectCanImport,
        importVisible,
        importDisabled,
    };
}
