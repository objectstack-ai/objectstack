/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * DeclaredActionsBar — render + execute an object's SERVER-DECLARED actions for
 * a single record at a given location, with ZERO per-action host code.
 *
 * A bespoke page (e.g. the approvals inbox) that already has a record in hand
 * can drop this bar in to surface the actions the backend declares on that
 * object (`objectDef.actions[]`) — filtered to a `location`
 * (`record_section`, `record_header`, …) and each action's `visible` CEL —
 * and have them execute through the *same* console action runtime ObjectView /
 * RecordDetailView use: confirm dialogs, param-collection dialogs, result
 * dialogs, the authenticated api/flow/server handlers, and refresh-after.
 *
 * It is fully self-contained: it fetches the object definition through the
 * metadata provider (unless `actions` is passed explicitly), resolves the
 * `dataSource` from the adapter, and mounts its own `ActionProvider` +
 * runtime dialogs. Each button dispatches the declared action with the record
 * stashed under `params._rowRecord`, exactly the shape ObjectGrid row actions
 * and RelatedRecordActionsBridge use — so a `type:'api'` action whose target is
 * `/api/v1/approvals/requests/{id}/approve` resolves `{id}` from the record and
 * POSTs with any collected params (comment, to, …).
 *
 * Degrades gracefully: no matching declared actions → renders nothing.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Separator,
  cn,
  hasDeclaredVisibilityGate,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import {
  ActionProvider,
  MetadataCtx,
  useAction,
  useCapabilityGate,
  useCondition,
  toPredicateInput,
  usePredicateRecordContext,
  useActionTextLocalizer,
} from '@object-ui/react';
import type { ActionDef } from '@object-ui/core';
import type { ConsoleActionDispatch } from '../consoleActionDispatch.js';
import { useObjectTranslation } from '@object-ui/i18n';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useConsoleActionRuntime } from '../hooks/useConsoleActionRuntime.js';
import { useAdapter } from '../providers/AdapterProvider.js';
// Straight from `@object-ui/react`, NOT through `../providers/MetadataProvider`
// (which merely re-exports it). The provider module pulls in the console
// metadata client factory, and that module builds its shared authenticated
// fetch AT IMPORT TIME — so importing the hook by the convenient path drags an
// eager side effect into the module graph of every host that renders this bar.
// It surfaced when the record page started mounting the bar (objectui#3055):
// two RecordDetailView suites died at import with `Cannot access
// 'authFetchSpy' before initialization`, the side effect running inside the
// hoisted `@object-ui/auth` mock factory before the spy existed.
import { useMetadataItem } from '@object-ui/react';
import {
  decisionOutputDefs,
  decisionOutputParams,
  decisionOutputsReadRegistry,
  readDecisionOutputRegistry,
} from '../utils/decisionOutputParams.js';
import { getIcon } from '../utils/getIcon.js';
import { isOverrideDecision, bypassedApproverNames } from '../utils/approvalOverride.js';
import {
  approverCopyFrom,
  approverDisplay,
  unresolvedApproverRefs,
} from '../utils/approverIdentity.js';
import { useApproverDirectory } from '../hooks/useApproverDirectory.js';

export interface DeclaredActionsBarProps {
  /** Object whose declared actions to render (e.g. `sys_approval_request`). */
  objectName: string;
  /**
   * The record the actions run against. Stashed under `params._rowRecord`, so
   * `{token}` URL interpolation and `defaultFromRow` params resolve from it —
   * on the approvals inbox this is the `sys_approval_request` row itself, so
   * `{id}` resolves to the request id.
   */
  record: any;
  /** Action location to filter by (e.g. `record_section`). */
  location: string;
  /** Called after a successful action so the host can refresh. */
  onDone?: () => void;
  /**
   * Declared actions to render. When omitted, they are fetched from the
   * object's metadata definition. Passing them explicitly avoids the metadata
   * round-trip (and lets a host that already holds the object def reuse it).
   */
  actions?: ActionDef[];
  /**
   * Action names to drop from the rendered set. Use when the host renders a few
   * of the object's declared actions itself (e.g. the approvals inbox keeps
   * approve/reject in a richer composer with an attachment field) but wants the
   * bar to cover the rest — so the two never render duplicate buttons.
   */
  exclude?: string[];
  /** Extra classes for the toolbar wrapper. */
  className?: string;
  /**
   * Optional section label. When set, a divider + label is rendered above the
   * buttons — but ONLY when there are actions to show (the whole component
   * returns null when empty), so the host never gets an orphan divider.
   */
  label?: string;
}

/**
 * Which approvals lever a declared action pulls, read off the route its
 * `target` names (`…/requests/{id}/approve`, `…/reject`, `…/reassign`,
 * `…/recall`).
 *
 * The route is the server's own name for what the action does, so it answers
 * the bar's two questions about a lever without an action-name list: which
 * decision a click records (the decision-output params), and what an override
 * notice may say the click does (objectui#13164, objectui#13225). Any other
 * route reads `undefined`.
 */
type ApprovalRouteVerb = 'approve' | 'reject' | 'reassign' | 'recall';
const APPROVAL_ROUTE_VERB = /\/(approve|reject|reassign|recall)$/;
function approvalRouteVerb(action: ActionDef): ApprovalRouteVerb | undefined {
  const match = APPROVAL_ROUTE_VERB.exec(String(action.target ?? ''));
  return match ? (match[1] as ApprovalRouteVerb) : undefined;
}

/**
 * One declared-action button. Extracted so the `visible` CEL predicate can be
 * evaluated with a hook (rules-of-hooks) and so the dispatch can carry the
 * record. Mirrors `action:button` (fail-closed `visible`) but injects the
 * record under `params._rowRecord` — which `action:button` does NOT do, and
 * which the api handler needs to resolve `{id}` and inject the record id.
 */
const DeclaredActionButton: React.FC<{
  action: ActionDef;
  objectName: string;
  record: any;
}> = ({ action, objectName, record }) => {
  const { execute } = useAction();
  const [loading, setLoading] = useState(false);
  // Localize the SERVER-DECLARED strings through the `_actions.<name>.*`
  // translation convention (objectui#2762 P0-3) — the metadata's literal
  // label/confirmText/successMessage are the fallback, exactly like
  // ObjectView/RecordDetailView do for their toolbars. Since objectui#4265 the
  // three keys go through ONE call, so no surface can localize the button and
  // leave the confirm dialog behind. The param dialog's labels localize
  // downstream in useConsoleActionRuntime.
  const localizeActionTexts = useActionTextLocalizer();
  // Chrome strings the bar itself authors — as opposed to the declared metadata
  // above — go through the normal locale bundle. The decision-output params are
  // synthesized here from `decision_output_defs`, so their key path is dynamic
  // and no `_actions.<action>.params.*` entry can ever exist for them; the
  // literal IS what renders, which is how English help text survived in a zh-CN
  // workspace (objectui#2762 P0-3).
  const { t } = useObjectTranslation();
  // The console's metadata store, or `null` outside a `<MetadataProvider>` —
  // the reader a catalog-kind decision output (`position`) lists the registry
  // through (objectui#7611). Read raw rather than through `useMetadata()`,
  // whose no-provider fallback answers every type with `[]`: an empty registry
  // and an absent reader are different facts (`DecisionOutputRegistry`). Held
  // in a ref and read at click time, so no callback keys on the store's
  // context identity, which is rebuilt whenever any type it caches settles
  // (AGENTS.md #10). The ref is synced after each commit rather than during
  // render; a click always lands after one.
  const metadataStore = React.useContext(MetadataCtx);
  const metadataStoreRef = React.useRef(metadataStore);
  React.useEffect(() => {
    metadataStoreRef.current = metadataStore;
  });

  const recordData = record != null && typeof record === 'object' ? (record as Record<string, any>) : {};
  /**
   * The predicate scope, with the record bound the THREE ways the platform's
   * row surfaces bind it (objectui#3055) — through the ONE named helper that
   * states the rule, not a local restatement of it (objectui#4080).
   *
   * The rationale lives with the definition (`usePredicateRecordContext` in
   * `@object-ui/react`): why the `record.` root is canonical, why `record` /
   * `data` are written after the spread, and why a surface with no row of its
   * own binds NOTHING rather than an empty row. The bar carried an inline copy
   * of that expression from objectui#4077 until the four generic action
   * renderers gave the rule its name in objectui#4079; two implementations of
   * one binding rule is the shape objectui#3367 / #3842 rule against, and this
   * family has already paid for it once at the `toPredicateInput` level
   * (objectui#3314 — two normalizations drifted and the same `visible:`
   * predicate reached different verdicts).
   *
   * What is specific to this bar is the cost of getting it wrong: EVERY
   * declared action on `sys_approval_request` gates on `record.viewer.*`
   * (framework#3310 / objectstack-ai/objectstack#3424), so under a root-only bag the whole
   * server-declared decision set was invisible on every surface this bar
   * renders — `record.viewer.can_act` does not read as false there, it throws
   * `record is not defined` and `throwOnError` turns that into "hidden".
   */
  const predicateRecord = usePredicateRecordContext(record);
  // `visible` fails CLOSED on a throwing predicate — mirrors action:button and
  // ActionEngine.getActionsForLocation: a guard that can't be evaluated hides
  // the action rather than exposing one whose precondition is broken.
  const isVisible = useCondition(toPredicateInput(action.visible), predicateRecord, {
    throwOnError: true,
    label: `declared action "${action.name ?? action.label ?? 'action'}" (visible)`,
  });
  // Spec `disabled` — the same three arms as `visible` (`boolean | CEL string |
  // { dialect, source }`, disabled when TRUE), evaluated against the same record
  // context. objectstack-ai/objectstack#1885 wired it in action-button only; this bar ignored it, so a
  // spec-authored `disabled` guard on a declared action did nothing here. (No
  // legacy `enabled` fallback: server-declared actions are spec-shaped and never
  // carried the non-spec key.)
  //
  // Read straight off the typed def since objectstack#4075 step 3: both keys are
  // now derived from the spec's unified shape, so the `(action as any)` casts
  // these two lines carried — which existed only because `ActionDef.disabled`
  // could not describe the envelope arm — have nothing left to reach around.
  const isDisabledPred = useCondition(toPredicateInput(action.disabled), predicateRecord);
  // Called up here with the other hooks: the `visible` gate below returns early.
  const reasonId = React.useId();

  /**
   * Is the button this viewer is looking at an ADMIN OVERRIDE (objectui#5178)?
   *
   * `can_act:false && can_override:true` on the record, and an action whose own
   * `visible` gate ORs in `can_override` — so the flag is the only term that
   * can have made this button visible. The rule and its fail-safe direction
   * live in `utils/approvalOverride`; this is one call, not a restatement.
   *
   * Nothing here is a permission decision: the server remains the sole
   * authority on who may act, and this branch changes no request the console
   * sends. It changes only what the viewer is told they are about to do.
   */
  const isOverride = useMemo(() => isOverrideDecision(action, record), [action, record]);
  /**
   * The approvers this override would bypass, by name — the load-bearing half
   * of the warning. objectui#5178's report turns on a click that a warning
   * naming *who* was about to be bypassed would have stopped, so the empty case
   * (the unstaffed-position rescue the override path exists for) gets its own
   * wording rather than an empty list.
   *
   * `77f846a8b` — and those names must be NAMES. `bypassedApproverNames`
   * defaults its formatter to identity, so an engine reference reached this
   * dialog raw: a paragraph of plain governance prose ending
   * `—— position:sales_manager`. Resolution is gated on `isOverride`, so an
   * ordinary record page asks the directory nothing, and the shared cache in
   * `useApproverDirectory` means the panel and every button on the same request
   * resolve one slate once.
   */
  const bypassedRefs = useMemo(
    () => (isOverride ? unresolvedApproverRefs(record) : []),
    [isOverride, record],
  );
  const approverDirectory = useApproverDirectory(bypassedRefs);
  const bypassed = useMemo(() => {
    const copy = approverCopyFrom(t as unknown as Parameters<typeof approverCopyFrom>[0]);
    return bypassedApproverNames(record, (id) => {
      const shown = approverDisplay(id, { resolved: approverDirectory[id], copy });
      return shown.detail ? `${shown.label} · ${shown.detail}` : shown.label;
    });
  }, [record, approverDirectory, t]);
  // The declared label, localized — resolved ONCE here so the button text, the
  // param dialog's title and the override framing below can never come from
  // different bundle reads (objectui#4265).
  const declaredLabel = (localizeActionTexts(objectName, action as Record<string, any>).label as string) || '';
  /**
   * The override framing wrapped around the declared label. A placeholder
   * rather than a hard-coded prefix so a translator can reorder it — `Approve`
   * / `拒绝` / `再割り当て` sit differently in different languages.
   */
  const overrideLabel = String(t('approvalsInbox.overrideActionLabel', {
    defaultValue: 'Override {{action}}',
    action: declaredLabel,
  }));
  /**
   * The notice states what THIS lever does, not what an approval does
   * (objectui#13164). `isOverrideDecision` admits every lever whose declared
   * `visible` ORs in `can_override` — approve, reject AND reassign — and the
   * notice used to give all of them the decision sentence, so an admin about
   * to reassign was told the step "finalises immediately". An override
   * reassign finalises nothing: the server hands the whole pending slate to
   * the person picked (`ApprovalService.reassign`, the `next = [to]` branch
   * for a caller who holds no slot), the request stays `pending` and waits on
   * them, and the action row is written with `via_override: true`.
   *
   * A recall is not a decision either, and records no override
   * (objectui#13225). The admin who reaches it through the override arm did
   * not submit the request (a submitter reaches it through their own arm, and
   * `isOverrideDecision` leaves that the plain Recall). `ApprovalService.recall`
   * withdraws the request: status `recalled`, its pending approvers cleared so
   * none of them can act, the record's approval-status mirror (when one is
   * configured) set to `recalled`, and the owning run resumed with
   * `decision: 'recall'`. Its action row is written with `action: 'recall'` and
   * no `via_override`. So the recall notice says the request is withdrawn, its
   * approvers can no longer act and the record is unlocked, and it claims
   * neither a finalised step nor an override record.
   *
   * The lever is read off the declared `target` route, the same reading the
   * click handler's decision-output branch makes (`approvalRouteVerb`) — not
   * off an action-name list, which a ninth lever shipped as metadata would
   * miss. Every lever that is not a reassign or a recall keeps the decision
   * sentence unchanged.
   */
  const overrideVerb = isOverride ? approvalRouteVerb(action) : undefined;
  const recallOverrideNotice = overrideVerb !== 'recall'
    ? undefined
    : bypassed.length > 0
      ? String(t('approvalsInbox.overrideRecallNoticeWho', {
        defaultValue:
          'You did not submit this request. Continuing uses your admin override: the request is withdrawn, the record is unlocked, and the approvers who have not acted can no longer act on it — {{who}}.',
        who: bypassed.join(', '),
      }))
      : String(t('approvalsInbox.overrideRecallNotice', {
        defaultValue:
          'You did not submit this request. Continuing uses your admin override: the request is withdrawn, any approver who has not acted can no longer act on it, and the record is unlocked.',
      }));
  const isReassignOverride = overrideVerb === 'reassign';
  const overrideNotice = !isOverride
    ? undefined
    : overrideVerb === 'recall'
    ? recallOverrideNotice
    : isReassignOverride
      ? bypassed.length > 0
        ? String(t('approvalsInbox.overrideReassignNoticeWho', {
          defaultValue:
            'You hold no approver slot on this step. Continuing uses your admin override: the step moves to the new approver you pick, replacing the approvers who have not acted — {{who}}. The request stays pending and waits on the new approver. The reassignment is recorded as an admin override.',
          who: bypassed.join(', '),
        }))
        : String(t('approvalsInbox.overrideReassignNotice', {
          defaultValue:
            'You hold no approver slot on this step. Continuing uses your admin override: the step moves to the new approver you pick, replacing any approver who has not acted. The request stays pending and waits on the new approver. The reassignment is recorded as an admin override.',
        }))
      : bypassed.length > 0
        ? String(t('approvalsInbox.overrideNoticeWho', {
          defaultValue:
            'You hold no approver slot on this step. Continuing uses your admin override: it finalises the step immediately and bypasses the approvers who have not acted — {{who}}. The decision is recorded as an admin override.',
          who: bypassed.join(', '),
        }))
        : String(t('approvalsInbox.overrideNotice', {
          defaultValue:
            'You hold no approver slot on this step. Continuing uses your admin override: it finalises the step immediately, bypassing any approver who has not acted. The decision is recorded as an admin override.',
        }));

  const handleClick = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Same dispatch shape as ObjectGrid.onActionDef / RelatedRecordActionsBridge:
      // forward the full def (type/target/recordIdParam/bodyShape/refreshAfter/…),
      // surface a `params` ARRAY as `actionParams` (the runner's param-dialog
      // input), and reserve `params` for the `_rowRecord` stash the api handler
      // reads for `{id}` interpolation + record-id injection.
      const { params: rawParams, ...rest } = action as ActionDef & { params?: unknown };
      // objectstack-ai/objectstack#3447: an approval decision may carry author-declared structured
      // outputs. The key set is PER-REQUEST (each approval node declares its
      // own `decisionOutputs`, surfaced on the row as `decision_output_defs`),
      // so it cannot be a static action param — synthesize one param per key
      // for the decide actions. Params are named `outputs.<key>`; the api
      // handler folds them into the nested `outputs` body the decide route
      // expects. A free-text output accepts comma-separated values (the
      // service accepts CSV for multi-id outputs).
      // Which decision this action records — `required` outputs are enforced
      // on approve only (server and dialog agree), so the reject dialog offers
      // the same fields without blocking on them.
      const routeVerb = approvalRouteVerb(action);
      const decision = routeVerb === 'approve' || routeVerb === 'reject' ? routeVerb : undefined;
      // Widget mapping (typed picker vs free text) lives in the shared helper,
      // so the record header's Approve/Reject renders the same controls
      // (objectui#2955).
      //
      // A catalog kind (`position`) lists the registry, so its items are read
      // before the params are built — once per type, from the store's
      // session cache after the first read (objectui#7611). Only a decision
      // that HAS a catalog output awaits that read; every other decision
      // dispatches in the click's own tick, as before.
      const outputDefs = decision ? decisionOutputDefs(recordData) : [];
      const metadataStoreNow = metadataStoreRef.current;
      const registry = metadataStoreNow && decisionOutputsReadRegistry(outputDefs)
        ? await readDecisionOutputRegistry(outputDefs, metadataStoreNow)
        : undefined;
      const outputParams = decision
        ? decisionOutputParams(outputDefs, t, { decision, registry })
        : [];
      // Typed as the SEAM's contract, not as `any` and not cast to `ActionDef`
      // on the way out (objectui#5611). `overrideNotice` below is host-composed
      // chrome, not authorable metadata, so it is declared on
      // `ConsoleActionDispatch` rather than on the authored-metadata mirror —
      // maintainer ruling 2026-08-22, reasoning at the type's own docblock.
      // What the annotation buys: the key now passes through ONE declaration
      // that its reader also imports, so a rename on either side is a compile
      // error instead of a notice that silently stops appearing.
      const dispatch: ConsoleActionDispatch = {
        // Localized copies ride the dispatch: the runner reads `label` for the
        // param-dialog title, `confirmText` for the confirm prompt and
        // `successMessage` for the toast. A nameless action has no translation
        // key, so it keeps its literal strings — that rule lives in the
        // localizer now rather than being re-spelled per surface.
        ...localizeActionTexts(objectName, rest as Record<string, any>),
        objectName,
        params: { _rowRecord: record },
      };
      if (overrideNotice) {
        // objectui#5178 — an override decision must SAY so before it runs, and
        // it gets exactly ONE dialog to say it in.
        //
        // These decision actions collect params (comment, attachments), so the
        // runtime opens the param dialog and nothing is POSTed until its own
        // Confirm. That dialog IS the confirm — chaining a `confirmText` in
        // front of it would put up a first dialog that already reads as "the
        // action ran" (framework#7278, maintainer ruling 2026-08-10). So the
        // warning rides the dialog's own title and description instead.
        //
        // `overrideNotice` is a separate key, NOT a rewritten `description`,
        // and that is load-bearing: the runtime resolves `description` through
        // `_actions.<name>.description`, and `plugin-approvals` SHIPS a bundle
        // entry there for `approval_reject`. Folding the warning into
        // `description` would let that entry replace it — a translation bundle
        // silently deleting the safety copy, in every locale that has one.
        dispatch.overrideNotice = overrideNotice;
        dispatch.label = overrideLabel;
      }
      const staticParams = Array.isArray(rawParams) ? rawParams : [];
      if (staticParams.length > 0 || outputParams.length > 0) {
        dispatch.actionParams = [...staticParams, ...outputParams];
      }
      await execute(dispatch);
    } finally {
      setLoading(false);
    }
  }, [action, execute, loading, objectName, record, localizeActionTexts, t, overrideNotice, overrideLabel]);

  // Does the action DECLARE a `visible` gate? `hasDeclaredVisibilityGate`
  // (`!= null && !== ''`) is the one definition on the question, imported rather
  // than re-spelled. This gate used to ask truthiness, which classified
  // `visible: false` — the most explicit "never show this" an author can write —
  // as "no gate declared", skipped the verdict, and rendered the action for
  // everyone (objectui#3835, the fifth member of the objectui#3492 family).
  //
  // The stakes here are the highest of the family: the actions are
  // SERVER-declared (`objectDef.actions[]`), so "the spec's `visible` has no
  // boolean member, `objectstack build` cannot emit one" does not apply, and this
  // bar is mounted as plain JSX by its hosts — `packages/react`'s
  // `SchemaRenderer`, which hides a `visible`-carrying node before its component
  // mounts, is not on this path. This is the only gate on it, in front of the
  // approvals inbox's Approve / Reject buttons.
  //
  // The verdict stays with the evaluation entry above: `toPredicateInput` passes
  // a boolean through untouched and `useCondition` short-circuits it instead of
  // calling the expression engine, so a declared `false` is `false`.
  if (hasDeclaredVisibilityGate(action.visible) && !isVisible) return null;

  const iconName = typeof (action as any).icon === 'string' ? (action as any).icon as string : undefined;
  // Map the spec's action `variant` enum (primary|secondary|danger|ghost|link)
  // onto the Button's variants. `primary` → the filled default, `danger` →
  // `destructive` (the two names the enum and the Button component spell
  // differently); the rest pass through, and an undeclared variant stays
  // `outline` so a plain declared action still reads as a secondary button.
  const declaredVariant = (action as any).variant;
  // objectui#5178 — an override decision does NOT wear its declared variant.
  // The declared enum describes the action for the approver it was designed
  // for: `approval_approve` is `primary` (a filled Approve) and
  // `approval_reject` is `danger`. Rendering those to a viewer who holds no
  // slot is the defect: the privileged branch looked exactly like the ordinary
  // one. Overrides take one warning treatment instead, the SAME for approve /
  // reject / reassign — the point being that it reads as "override", not as
  // "the decision you were assigned".
  const variant = isOverride
    ? 'outline'
    : declaredVariant === 'primary'
      ? 'default'
      : declaredVariant === 'danger'
        ? 'destructive'
        : (declaredVariant || 'outline');
  // Same resolver as the dispatch above, so the button text and the confirm
  // dialog body can never come from different bundle reads (objectui#4265).
  const label = isOverride ? overrideLabel : declaredLabel;

  // Is a `disabled` gate DECLARED? The same question the `visible` gate
  // above asks, so it reads the same definition rather than re-spelling it.
  // The name is historic — objectui#3492 arrived through `visible` — and the
  // predicate is key-neutral: "declared" is `!= null && !== ''`, because an
  // empty predicate is nothing to evaluate. Kept under that name
  // deliberately (objectui#3842 ruling): one implementation behind two names
  // is a dialect, not a clarification.
  //
  // `!= null` alone was a real defect here, and NOT for the reason it was on
  // `visible`: the evaluation entry reads an empty predicate as "no
  // condition → true", which on `visible` means SHOW (so an over-broad
  // "declared" test cancels out and `''` renders either way), but here means
  // DISABLE. A `disabled: ''` on a server-declared approval action rendered
  // a permanently greyed-out Approve / Reject — the mirror image of
  // objectui#3835 on the same surface, and equally impossible to tell from
  // deliberate metadata by looking at it.
  //
  // Held apart from `loading` (objectui#11811): only the declared predicate is
  // a fact about the record, so only it earns the "not available" reason. A
  // button greyed out while its own action runs already says why — the spinner.
  const disabledByPredicate = hasDeclaredVisibilityGate(action.disabled) ? isDisabledPred : false;
  // The generic reason (objectui#11811). An author-written reason beside the
  // predicate would be a spec key, which is objectstack's to declare — not one
  // this bar may invent — so every predicate-disabled action says the same
  // thing for now.
  const disabledReason = disabledByPredicate
    ? String(t('actions.notAvailableForRecord', { defaultValue: 'Not available for this record' }))
    : undefined;

  const button = (
    <Button
      type="button"
      size="sm"
      variant={variant as any}
      disabled={disabledByPredicate || loading}
      aria-describedby={disabledReason ? reasonId : undefined}
      onClick={handleClick}
      // Amber warning treatment for an override (objectui#5178) — the same
      // palette the approvals surfaces already use for "waiting / attention",
      // via `cn()` over the outline variant rather than a new Button variant
      // (`packages/components/src/ui/**` is a no-touch Shadcn zone).
      className={cn(isOverride
        && 'border-amber-500/60 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-500/10 dark:hover:text-amber-300')}
      data-testid={`declared-action-${action.name}`}
      // Pinnable, and readable by an E2E/QA pass without matching on copy.
      data-override-decision={isOverride ? 'true' : undefined}
    >
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {/* An override replaces the declared icon: the declared one describes the
          ordinary decision (a check for approve), which is precisely the
          resemblance objectui#5178 is about. */}
      {!loading && isOverride
        ? <ShieldAlert className={cn('h-4 w-4', label && 'mr-2')} />
        : null}
      {/* `getIcon` returns a (memoised) component — instantiate it via
          createElement so it is not a component "created during render" in JSX
          position (react-hooks/static-components), mirroring ObjectDataPage. */}
      {!loading && !isOverride && iconName
        ? React.createElement(getIcon(iconName), { className: cn('h-4 w-4', label && 'mr-2') })
        : null}
      {label}
    </Button>
  );
  if (!disabledReason) return button;
  // A natively `disabled` button fires no pointer or focus events, and the
  // Button primitive adds `disabled:pointer-events-none` on top — so a tooltip
  // (or a native `title`) on the button itself never opens: hovering or
  // focusing it showed nothing (objectui#11811). The wrapping span is the
  // trigger instead, the idiom Radix documents for a disabled button: it takes
  // the hover, and `tabIndex={0}` lets a keyboard user focus it, which opens
  // the tooltip too. The reason is ALSO a persistent accessible description
  // (`aria-describedby` on both the button and the span, onto an `sr-only`
  // copy), so a screen reader reaching either one hears it with the tooltip
  // closed. Same shape as `record:quick_actions`' button.
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-describedby={reasonId}
            data-disabled-reason=""
            className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {button}
            <span id={reasonId} className="sr-only">{disabledReason}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/**
 * The located set, capability-gated — and the toolbar it draws.
 *
 * ## Why this is a component at all, and why it lives HERE
 *
 * [ADR-0066 D4 / objectui#9572] `@objectstack/spec` declares
 * `requiredPermissions` as "enforced with 403 on the platform action route …
 * and mirrored as a UI hide". This bar filters its own action list instead of
 * routing through `ActionEngine.getActionsForLocation`, so the engine's gate
 * never reached it and the declared key was INERT on every action it draws —
 * the one object-bound surface that did not mirror it, after `action:bar`, the
 * grid row menu, the selection bar and (objectui#9623) the data-table row menu.
 *
 * ⛔ A UI MIRROR of a decision the SERVER still enforces, and nothing more.
 * Unknown capabilities fail OPEN (see `useCapabilityGate`), an EMPTY held set
 * means "holds nothing" and gates normally, and the request this bar sends is
 * byte-identical either way. ⛔ No enforcement moves into the console.
 *
 * ⭐ PLACEMENT is load-bearing. `useCapabilityGate` reads the nearest
 * `<ActionProvider>` ABOVE its caller, and this bar is self-contained: it
 * mounts its OWN provider, seeded by `useConsoleActionRuntime` with the same
 * `user.systemPermissions` the engine reads. Calling the gate in the bar's
 * outer body would therefore read a DIFFERENT provider — the host's, if it has
 * one at all — and in a standalone host would read none and fail open on every
 * action forever: a gate that compiles, reviews as correct, and mirrors
 * nothing. Evaluated here, under this bar's own provider, it mirrors exactly
 * the capabilities the dispatch it is about to make will carry.
 * `DeclaredActionsBar.capabilityGate-9572.test.tsx` supplies the held set
 * through that provider ALONE, so the outer placement fails it.
 *
 * ## Why ONCE, over the list
 *
 * The objectui#3562 invariant: the chrome and the items must read one filtered
 * source. Gating per button would leave a host holding a divider + section
 * label with nothing under it whenever the whole declared set is denied —
 * exactly the orphan divider `label` is documented never to produce.
 *
 * ## How it composes with the two gates already here
 *
 * `visible` (fail-CLOSED) and `disabled` are evaluated per button, downstream
 * of this filter, and the three are ANDed. The composition is therefore
 * MONOTONE: it can only ever hide more than before, never show something that
 * was hidden — which is what makes a fail-OPEN gate safe to put in front of a
 * fail-CLOSED one. The approvals `can_override` arm (objectui#5178) is
 * untouched by construction: `can_override` is a per-RECORD viewer flag an
 * action's own `visible` CEL reads, `requiredPermissions` is a per-CALLER
 * capability list, and `isOverrideDecision` still runs unchanged on every
 * action that survives. An override-only viewer gets no exemption from a
 * declared capability, and gets no new exposure either.
 */
const DeclaredActionsToolbar: React.FC<
  Pick<DeclaredActionsBarProps, 'objectName' | 'record' | 'className' | 'label'> & {
    /** The located set, pre-filtered by `location` / `exclude`, ungated. */
    actions: ActionDef[];
  }
> = ({ actions, objectName, record, className, label }) => {
  const { t } = useObjectTranslation();
  const mayInvoke = useCapabilityGate();
  const permitted = useMemo(
    () => actions.filter((action) => mayInvoke(action.requiredPermissions)),
    [actions, mayInvoke],
  );

  // Nothing this viewer may invoke renders nothing — no toolbar chrome, no
  // orphan divider, same degrade as "nothing declared at this location".
  if (permitted.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <>
          <Separator />
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
        </>
      )}
      <div role="toolbar" aria-label={label || t('common.actions')} className="flex flex-row flex-wrap items-center gap-2">
        {permitted.map((action) => (
          <DeclaredActionButton
            key={action.name}
            action={action}
            objectName={objectName}
            record={record}
          />
        ))}
      </div>
    </div>
  );
};

export function DeclaredActionsBar({
  objectName,
  record,
  location,
  onDone,
  actions: actionsProp,
  exclude,
  className,
  label,
}: DeclaredActionsBarProps) {
  const dataSource = useAdapter();
  // Fetch the object def (and its declared actions) unless the host passed
  // them in. `useMetadataItem` no-ops when `name` is undefined.
  const { item: objectDef } = useMetadataItem('object', actionsProp ? undefined : objectName);

  const allActions: ActionDef[] = useMemo(
    () => (actionsProp ?? (objectDef as any)?.actions ?? []) as ActionDef[],
    [actionsProp, objectDef],
  );

  const located = useMemo(
    () => {
      const drop = exclude && exclude.length ? new Set(exclude) : null;
      return allActions.filter(
        (a: any) =>
          Array.isArray(a?.locations) &&
          a.locations.includes(location) &&
          !(drop && drop.has(a?.name)),
      );
    },
    [allActions, location, exclude],
  );

  // Mount the shared console action runtime — confirm/param/result dialogs, the
  // authenticated api/flow/server handlers, SPA nav, paused-flow runner. Its
  // `onRefresh` fires on any refresh-requesting success (the default), which is
  // exactly the host's `onDone`. The object def is threaded through `objects`
  // so field-backed params resolve their labels/defaults.
  const runtime = useConsoleActionRuntime({
    dataSource,
    objects: objectDef ? [objectDef] : [],
    objectName,
    onRefresh: onDone,
  });

  // Degrade gracefully — nothing declared at this location renders nothing (no
  // toolbar chrome, no provider churn). This early exit stays on the LOCATION
  // filter alone, deliberately: the capability gate below needs this provider
  // above it, so it cannot also decide whether to mount it. A set that is
  // located but wholly denied therefore mounts an inert provider and its
  // (closed) dialogs, and draws no chrome — see `DeclaredActionsToolbar`.
  if (located.length === 0) return null;

  return (
    <ActionProvider {...runtime.actionProviderProps}>
      {/* The capability gate runs INSIDE this provider — see the toolbar's own
          docblock for why the placement is the whole point. */}
      <DeclaredActionsToolbar
        actions={located}
        objectName={objectName}
        record={record}
        className={className}
        label={label}
      />
      {runtime.dialogs}
    </ActionProvider>
  );
}

export default DeclaredActionsBar;
