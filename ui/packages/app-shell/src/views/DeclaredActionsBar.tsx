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
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
  cn,
  hasDeclaredVisibilityGate,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import type { RecordHeaderGroupParts } from '@object-ui/components';
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
import { isActionSwitchedOff, type ActionDef } from '@object-ui/core';
import type { ConsoleActionDispatch } from '../consoleActionDispatch.js';
import { useObjectTranslation } from '@object-ui/i18n';
import { ChevronDown, Loader2, MoreHorizontal, ShieldAlert } from 'lucide-react';
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
import {
  actionAdmittedByOverride,
  bypassedApproverNames,
  isOverrideDecision,
  isOverrideOnlyViewer,
} from '../utils/approvalOverride.js';
import { currentStepNumber, isActingApprover, isLeadDecision } from '../utils/approvalDecisionFold.js';
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
  /**
   * Fold the admin-override levers into one menu for a viewer who holds no
   * approver slot but may override (objectstack#25877).
   *
   * For that viewer every lever the override flag admits — approve, reject,
   * reassign, and recall, whose gate ORs the flag in too — is the exception
   * path, and a row of them drawn as buttons is the most prominent thing on
   * the page. With this set, such a viewer sees one status line instead
   * (pending, and who the step waits on), the levers the override flag does
   * NOT admit (reply) as buttons, and the folded ones behind a single marked
   * menu. The set is read off each action's own `visible` gate
   * (`actionAdmittedByOverride`), not off a name list, so a lever shipped as
   * metadata alone folds the same way.
   *
   * Placement only: every folded lever keeps its own `visible` / `disabled` /
   * capability gates, its override framing and its dialog, and the request it
   * sends is unchanged. A viewer who CAN act (the approver) and any viewer the
   * server sent no `viewer` block for render exactly as without it.
   */
  foldOverrides?: boolean;
  /**
   * Fold the approver's own band (objectstack#34361, ruling A): for a viewer
   * the server says can act (`viewer.can_act === true`) and more than two
   * shown actions, one status line naming the task, the step and the
   * submitter, the decisions as the only buttons, and every other lever
   * behind one neutral menu.
   *
   * "The decisions" are the actions whose declared `variant` is `primary` or
   * `danger` (`isLeadDecision`), not a name list, so an action shipped as
   * metadata alone lands in the menu. Placement only, like `foldOverrides`:
   * every folded lever keeps its own gates and dialog, and the request it
   * sends is unchanged. A viewer who cannot act (the submitter alone, the
   * override-only administrator, a backend that sent no `viewer` block)
   * renders exactly as without it.
   */
  foldDecisions?: boolean;
  /**
   * Told which declared actions the bar DRAWS for this viewer, by name, each
   * time that set changes, and an empty list when the bar goes away
   * (objectstack#25877). "Drawn" is after the capability gate and the action's
   * own `visible` verdict — a button on the bar or an item in the folded
   * menu — so a host can yield a lever it would otherwise draw itself exactly
   * when the bar really draws it, and not merely when the bar is mounted (the
   * request's definition may not have loaded, or a backend too old to send a
   * `viewer` block fails every gate closed). Pass a stable function.
   */
  onDrawnActionsChange?: (names: string[]) => void;
  /**
   * Draw the request's levers as the record header's ONE button group
   * (objectstack#35593) instead of as a band of their own. The header hands
   * its own pieces (`RecordHeaderGroupParts`), and the group is, by the
   * server's `viewer` block:
   *
   * - an approver (`can_act`): the decisions (`isLeadDecision`) as the only
   *   buttons, the approve one the page's one filled button, then one `⋯`
   *   holding the other levers, a separator, and the record's own actions;
   * - the submitter (`is_submitter`, no slot): the submitter's levers —
   *   resubmit, recall, remind, read off their routes — as buttons, then the
   *   same `⋯`;
   * - an override-only administrator: the override levers behind their one
   *   marked menu, ahead of the group the rest of their levers make (the
   *   submitter's, when they raised the request; the record's row otherwise);
   * - anyone else, or before the request's definition has loaded: the
   *   record's row unchanged.
   *
   * Placement only: every lever keeps its own gates and dialog.
   */
  headerParts?: RecordHeaderGroupParts;
  /**
   * The reject decision asks for its reason before it is sent
   * (objectstack#35593): the record page's reject dialog requires its
   * `comment`. The request the decision sends is unchanged.
   */
  requireRejectReason?: boolean;
}

/**
 * Which approvals lever a declared action pulls, read off the route its
 * `target` names (`…/requests/{id}/approve`, `…/reject`, `…/reassign`,
 * `…/recall`).
 *
 * The route is the server's own name for what the action does, so it answers
 * the bar's two questions about a lever without an action-name list: which
 * decision a click records (the decision-output params), and what an override
 * notice may say the click does (objectui#13164, objectui#13225), and which
 * of the submitter's levers lead the record header's group (`remind`,
 * `resubmit`, objectstack#35593). Any other route reads `undefined`.
 */
type ApprovalRouteVerb = 'approve' | 'reject' | 'reassign' | 'recall' | 'remind' | 'resubmit';
const APPROVAL_ROUTE_VERB = /\/(approve|reject|reassign|recall|remind|resubmit)$/;
function approvalRouteVerb(action: ActionDef): ApprovalRouteVerb | undefined {
  const match = APPROVAL_ROUTE_VERB.exec(String(action.target ?? ''));
  return match ? (match[1] as ApprovalRouteVerb) : undefined;
}

/**
 * Is this declared action SHOWN to the viewer? The one evaluation of its
 * `visible` gate, shared by the button and by the visibility probe the folded
 * override menu reports through (objectstack#25877), so the two cannot reach
 * different verdicts on one action.
 *
 * `visible` fails CLOSED on a throwing predicate — mirrors action:button and
 * ActionEngine.getActionsForLocation: a guard that can't be evaluated hides
 * the action rather than exposing one whose precondition is broken.
 *
 * Does the action DECLARE a `visible` gate? `hasDeclaredVisibilityGate`
 * (`!= null && !== ''`) is the one definition on the question, imported rather
 * than re-spelled. This gate used to ask truthiness, which classified
 * `visible: false` — the most explicit "never show this" an author can write —
 * as "no gate declared", skipped the verdict, and rendered the action for
 * everyone (objectui#3835, the fifth member of the objectui#3492 family).
 *
 * The stakes here are the highest of the family: the actions are
 * SERVER-declared (`objectDef.actions[]`), so "the spec's `visible` has no
 * boolean member, `objectstack build` cannot emit one" does not apply, and this
 * bar is mounted as plain JSX by its hosts — `packages/react`'s
 * `SchemaRenderer`, which hides a `visible`-carrying node before its component
 * mounts, is not on this path. This is the only gate on it, in front of the
 * approvals inbox's Approve / Reject buttons.
 *
 * The verdict stays with the evaluation entry: `toPredicateInput` passes a
 * boolean through untouched and `useCondition` short-circuits it instead of
 * calling the expression engine, so a declared `false` is `false`.
 */
function useDeclaredActionShown(action: ActionDef, predicateRecord: ReturnType<typeof usePredicateRecordContext>): boolean {
  const isVisible = useCondition(toPredicateInput(action.visible), predicateRecord, {
    throwOnError: true,
    label: `declared action "${action.name ?? action.label ?? 'action'}" (visible)`,
  });
  return !(hasDeclaredVisibilityGate(action.visible) && !isVisible);
}

/**
 * The reader's own state (`ActionSchema.pressed`, objectstack#27946): does the
 * action DECLARE a pressed predicate, and does it hold for this record?
 *
 * `undefined` = no predicate, so the lever is a plain button and carries no
 * `aria-pressed`; otherwise the verdict, drawn as `aria-pressed` and the
 * pressed face. Same entry and record binding as `visible` above, with
 * `throwOnError` so a predicate that cannot be evaluated answers `false` — the
 * plain button, never a claim that the reader acted — and is reported once. A
 * boolean is refused by the spec at parse (a constant is a style, not a
 * reader's state), so it gets no reading here. Display only: the verdict never
 * gates, greys or routes the action.
 */
function useDeclaredActionPressed(action: ActionDef, predicateRecord: ReturnType<typeof usePredicateRecordContext>): boolean | undefined {
  const declared = typeof action.pressed !== 'boolean' && hasDeclaredVisibilityGate(action.pressed);
  const isPressed = useCondition(declared ? toPredicateInput(action.pressed) : undefined, predicateRecord, {
    throwOnError: true,
    label: `declared action "${action.name ?? action.label ?? 'action'}" (pressed)`,
  });
  return declared ? isPressed : undefined;
}

/**
 * Report whether a declared action is drawn, and withdraw the report when the
 * reporter unmounts (objectstack#25877). `onDrawn` is the toolbar's stable
 * setter, so the effect re-runs only when the verdict or the name moves.
 */
function useReportDrawn(
  name: string | undefined,
  drawn: boolean,
  onDrawn: ((name: string, drawn: boolean) => void) | undefined,
): void {
  React.useEffect(() => {
    if (!onDrawn || !name) return undefined;
    onDrawn(name, drawn);
    return () => onDrawn(name, false);
  }, [name, drawn, onDrawn]);
}

/** Own-key presence on a plain record, never the prototype chain. */
function hasOwnKey(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
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
  /**
   * Draw the lever as an item of the override menu instead of a button
   * (objectstack#25877). Every gate, label and dispatch above the render is
   * shared, so the two forms cannot disagree about what the lever does.
   */
  asMenuItem?: boolean;
  /** The toolbar's drawn-set reporter (objectstack#25877). */
  onDrawn?: (name: string, drawn: boolean) => void;
  /**
   * Share the row's width below `sm` (objectstack#34361): the approver band's
   * decisions sit side by side at equal width on a phone.
   */
  fill?: boolean;
  /**
   * The record header's group (objectstack#35593): `primary` keeps a declared
   * `primary` variant as the page's one filled button, and every other lever
   * is drawn as an outline button, a `danger` one in the destructive text
   * colour, so one header never shows two filled buttons. Sized for the
   * header row.
   */
  headerTone?: 'primary' | 'secondary';
  /** The reject dialog requires its `comment` (`requireRejectReason`). */
  requireReason?: boolean;
}> = ({ action, objectName, record, asMenuItem = false, onDrawn, fill = false, headerTone, requireReason = false }) => {
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
  // The `visible` verdict — one evaluation, shared with the folded menu's
  // visibility probe (`useDeclaredActionShown` states the rule).
  const shown = useDeclaredActionShown(action, predicateRecord);
  // A menu item does not report: it is mounted only while its menu is open,
  // so its unmount would read as "not drawn". The probe reports for it.
  useReportDrawn(action.name, shown, asMenuItem ? undefined : onDrawn);
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
  const pressed = useDeclaredActionPressed(action, predicateRecord);
  // Called up here with the other hooks: the `visible` gate below returns early.
  const reasonId = React.useId();
  const labelId = React.useId();

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
  // different bundle reads (objectui#4265). The greyed button's declared
  // reason (objectstack#26619) comes off the same localized copy.
  const localizedTexts = localizeActionTexts(objectName, action as Record<string, any>);
  const declaredLabel = (localizedTexts.label as string) || '';
  const declaredReason = typeof localizedTexts.disabledReason === 'string' ? localizedTexts.disabledReason : '';
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
      // objectstack#35593 — on the record page a rejection names its reason:
      // the dialog requires the declared `comment` before Confirm.
      const declaredParams = Array.isArray(rawParams) ? rawParams : [];
      const staticParams = requireReason && routeVerb === 'reject'
        ? declaredParams.map((param: any) => (param?.name === 'comment' ? { ...param, required: true } : param))
        : declaredParams;
      if (staticParams.length > 0 || outputParams.length > 0) {
        dispatch.actionParams = [...staticParams, ...outputParams];
      }
      await execute(dispatch);
    } finally {
      setLoading(false);
    }
  }, [action, execute, loading, objectName, record, localizeActionTexts, t, overrideNotice, overrideLabel, requireReason]);

  // The declared `visible` gate (`useDeclaredActionShown` above).
  if (!shown) return null;

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
    : headerTone === 'secondary'
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
  // The action's declared `disabledReason` (objectstack#26619), localized
  // above, else the generic reason (objectui#11811).
  const disabledReason = disabledByPredicate
    ? (declaredReason.trim() !== ''
      ? declaredReason
      : String(t('actions.notAvailableForRecord', { defaultValue: 'Not available for this record' })))
    : undefined;

  if (asMenuItem) {
    // The menu form of the same lever (objectstack#25877). Shaped like the
    // page header's overflow items (`PageHeaderActions`): `preventDefault` on
    // select keeps the menu mounted while the action's own dialog takes over,
    // and a disabled item states its reason as a visible second line, because
    // a tooltip inside a menu is unreachable from the keyboard (a disabled
    // item is skipped by arrow-key focus).
    return (
      <DropdownMenuItem
        disabled={disabledByPredicate || loading}
        aria-labelledby={disabledReason ? labelId : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        onSelect={(event) => {
          event.preventDefault();
          void handleClick();
        }}
        className={cn(
          'gap-2',
          isOverride && 'text-amber-700 focus:text-amber-800 dark:text-amber-400 dark:focus:text-amber-300',
        )}
        data-testid={`declared-action-${action.name}`}
        data-override-decision={isOverride ? 'true' : undefined}
      >
        {loading
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : isOverride
            ? <ShieldAlert className="h-4 w-4" />
            : iconName
              ? React.createElement(getIcon(iconName), { className: 'h-4 w-4' })
              : null}
        {disabledReason ? (
          <span className="flex min-w-0 flex-col">
            <span id={labelId}>{label}</span>
            <span id={reasonId} className="text-xs text-muted-foreground">{disabledReason}</span>
          </span>
        ) : (
          <span>{label}</span>
        )}
      </DropdownMenuItem>
    );
  }

  const button = (
    <Button
      type="button"
      size="sm"
      variant={variant as any}
      disabled={disabledByPredicate || loading}
      aria-describedby={disabledReason ? reasonId : undefined}
      aria-pressed={pressed}
      onClick={handleClick}
      // Amber warning treatment for an override (objectui#5178) — the same
      // palette the approvals surfaces already use for "waiting / attention",
      // via `cn()` over the outline variant rather than a new Button variant
      // (`packages/components/src/ui/**` is a no-touch Shadcn zone).
      // The pressed face is Shadcn's toggle-on colours keyed off the attribute,
      // the record header's spelling (`PageHeaderActions`).
      // Below `sm` a 44 px touch target (objectstack#29071).
      className={cn(
        headerTone ? 'h-11 sm:h-8' : 'h-11 sm:h-9',
        fill && (disabledReason ? 'w-full sm:w-auto' : 'flex-1 sm:flex-none'),
        headerTone === 'secondary' && declaredVariant === 'danger' && !isOverride
          && 'text-destructive hover:text-destructive',
        isOverride
          && 'border-amber-500/60 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-500/10 dark:hover:text-amber-300',
        pressed !== undefined && 'aria-pressed:bg-accent aria-pressed:text-accent-foreground hover:aria-pressed:bg-accent',
      )}
      data-testid={`declared-action-${action.name}`}
      // Pinnable, and readable by an E2E/QA pass without matching on copy.
      data-override-decision={isOverride ? 'true' : undefined}
      data-header-tone={headerTone}
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
            className={cn(
              'inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              fill && 'flex-1 sm:flex-none',
            )}
          >
            {button}
            <span id={reasonId} className="sr-only">{disabledReason}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{disabledReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/**
 * The submitter's levers that lead the record header's group
 * (objectstack#35593), in their order: on a returned request resubmit and
 * recall, on a pending one recall and remind (each lever's own `visible` gate
 * decides which of them a request shows).
 */
const SUBMITTER_LEAD_VERBS: readonly ApprovalRouteVerb[] = ['resubmit', 'recall', 'remind'];

/**
 * Is this viewer the request's submitter, holding no approver slot on it? The
 * server's `viewer.is_submitter`, strictly, like `isActingApprover`.
 */
function isSubmitterViewer(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const viewer = (record as { viewer?: unknown }).viewer;
  if (!viewer || typeof viewer !== 'object') return false;
  return (viewer as { is_submitter?: unknown }).is_submitter === true;
}

/**
 * The status line that replaces the override levers for a viewer who holds no
 * approver slot (objectstack#25877): the request is pending, and who the step
 * waits on, by name.
 *
 * The names are the same slate, resolved the same way, as the override notice
 * each folded lever shows (`bypassedApproverNames` over the shared approver
 * directory), so the line and the dialog never name different people. An
 * unstaffed step has no one to name, and then the line says pending alone.
 *
 * `forApprover` is the approver band's line (objectstack#34361): the task is
 * theirs, so it names the task, the step (its number on the served route and
 * its label) and who submitted, instead of who the step waits on.
 */
const ApprovalWaitingStatus: React.FC<{ record: any; forApprover?: boolean }> = ({ record, forApprover = false }) => {
  if (forApprover) return <ApproverTaskStatus record={record} />;
  return <OverrideWaitingStatus record={record} />;
};

/**
 * The approver band's status line: 「待你审批 · 第 N 步 · STEP · 提交人 NAME」.
 * Every part but the first is drawn only when the served row carries it: the
 * step number off `flow_route` (`currentStepNumber`), the step's label off
 * `step_label`, and the submitter as "you" when the server's `viewer` block
 * says so, else by the name the server resolved.
 */
const ApproverTaskStatus: React.FC<{ record: any }> = ({ record }) => {
  const { t } = useObjectTranslation();
  const row = record != null && typeof record === 'object' ? (record as Record<string, any>) : {};
  const stepNumber = currentStepNumber(row);
  const stepLabel = typeof row.step_label === 'string' ? row.step_label.trim() : '';
  const submitterName = typeof row.submitter_name === 'string' ? row.submitter_name.trim() : '';
  const submittedByViewer = row.viewer?.is_submitter === true;
  const parts: Array<{ key: string; text: string }> = [];
  if (stepNumber !== undefined) {
    parts.push({
      key: 'step',
      text: String(t('approvalsInbox.stepNumber', { defaultValue: 'Step {{n}}', n: stepNumber })),
    });
  }
  if (stepLabel) parts.push({ key: 'label', text: stepLabel });
  if (submittedByViewer) {
    parts.push({ key: 'submitter', text: String(t('approvalsInbox.submittedByYou', { defaultValue: 'You submitted this' })) });
  } else if (submitterName) {
    parts.push({
      key: 'submitter',
      text: String(t('approvalsInbox.submittedByName', { defaultValue: 'Submitted by {{name}}', name: submitterName })),
    });
  }
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      data-testid="declared-actions-approval-status"
      data-approval-status="approver"
    >
      <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
        {String(t('approvalsInbox.awaitingYourDecision', { defaultValue: 'Awaiting your approval' }))}
      </Badge>
      {parts.map((part) => (
        <React.Fragment key={part.key}>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span className="min-w-0 text-muted-foreground" data-approval-status-part={part.key}>{part.text}</span>
        </React.Fragment>
      ))}
    </div>
  );
};

/** The override-only viewer's line (objectstack#25877): pending, and who the step waits on. */
const OverrideWaitingStatus: React.FC<{ record: any }> = ({ record }) => {
  const { t } = useObjectTranslation();
  const refs = useMemo(() => unresolvedApproverRefs(record), [record]);
  const directory = useApproverDirectory(refs);
  const names = useMemo(() => {
    const copy = approverCopyFrom(t as unknown as Parameters<typeof approverCopyFrom>[0]);
    const shown = bypassedApproverNames(record, (id) => {
      const display = approverDisplay(id, { resolved: directory[id], copy });
      return display.detail ? `${display.label} · ${display.detail}` : display.label;
    });
    return Array.from(new Set(shown));
  }, [record, directory, t]);
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      data-testid="declared-actions-approval-status"
    >
      <Badge
        variant="outline"
        className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
      >
        {String(t('approvalsInbox.statusPending', { defaultValue: 'Pending' }))}
      </Badge>
      {names.length > 0 && (
        <span className="min-w-0 text-muted-foreground">
          {String(t('approvalsInbox.waitingOn', { defaultValue: 'Waiting on' }))}{' '}
          <span className="text-foreground">
            {names.join(String(t('approvalsInbox.approverNameSeparator', { defaultValue: ', ' })))}
          </span>
        </span>
      )}
    </div>
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
/**
 * Evaluates a folded lever's `visible` gate while its menu is closed and its
 * item is not mounted, and reports the verdict (objectstack#25877). Draws
 * nothing.
 */
const DeclaredActionVisibilityProbe: React.FC<{
  action: ActionDef;
  record: any;
  onDrawn: (name: string, drawn: boolean) => void;
}> = ({ action, record, onDrawn }) => {
  const predicateRecord = usePredicateRecordContext(record);
  const shown = useDeclaredActionShown(action, predicateRecord);
  useReportDrawn(action.name, shown, onDrawn);
  return null;
};

const DeclaredActionsToolbar: React.FC<
  Pick<
    DeclaredActionsBarProps,
    'objectName' | 'record' | 'className' | 'label' | 'foldOverrides' | 'foldDecisions' | 'onDrawnActionsChange'
    | 'headerParts' | 'requireRejectReason'
  > & {
    /** The located set, pre-filtered by `location` / `exclude`, ungated. */
    actions: ActionDef[];
  }
> = ({ actions, objectName, record, className, label, foldOverrides, foldDecisions, onDrawnActionsChange, headerParts, requireRejectReason }) => {
  const { t } = useObjectTranslation();
  const mayInvoke = useCapabilityGate();
  const permitted = useMemo(
    () => actions.filter((action) => mayInvoke(action.requiredPermissions) && !isActionSwitchedOff(action)),
    [actions, mayInvoke],
  );
  // objectstack#25877 — which of the permitted levers fold into the override
  // menu. Only for a viewer admitted through the override door alone
  // (`can_act: false`, `can_override: true`), and only the levers whose own
  // gate ORs that flag in; everything else stays a button. The split runs on
  // the capability-gated set, so a lever the gate removed is in neither half.
  const folded = useMemo(
    () => (foldOverrides && isOverrideOnlyViewer(record)
      ? permitted.filter((action) => actionAdmittedByOverride(action))
      : []),
    [foldOverrides, record, permitted],
  );

  // objectstack#25877 — which declared actions are DRAWN, by name. Each bar
  // button and each folded lever's probe reports its own `visible` verdict;
  // the set is read against `permitted`, so a lever the capability gate
  // removed never counts however it last reported.
  const [drawnByName, setDrawnByName] = useState<Readonly<Record<string, boolean>>>({});
  // A `false` verdict is recorded too, so "every lever has reported" can be
  // read off the keys (the approver fold below waits on it).
  const reportDrawn = useCallback((name: string, isDrawn: boolean) => {
    setDrawnByName((prev) => (hasOwnKey(prev, name) && prev[name] === isDrawn ? prev : { ...prev, [name]: isDrawn }));
  }, []);
  const drawnNames = permitted
    .map((action) => action.name)
    .filter((name): name is string => !!name && drawnByName[name] === true);
  // Keyed on the names themselves, not on an array identity (AGENTS.md #10).
  const drawnKey = drawnNames.join('\n');
  const onDrawnRef = React.useRef(onDrawnActionsChange);
  onDrawnRef.current = onDrawnActionsChange;
  React.useEffect(() => {
    onDrawnRef.current?.(drawnKey ? drawnKey.split('\n') : []);
  }, [drawnKey]);
  React.useEffect(() => () => onDrawnRef.current?.([]), []);
  const foldedDrawn = folded.some((action) => !!action.name && drawnByName[action.name] === true);

  // objectstack#34361 (ruling A) — the approver's band. For a viewer the
  // server says can act, the decisions (`isLeadDecision`: a `primary` or
  // `danger` variant) stay buttons and every other permitted lever folds into
  // one menu, once more than two levers are shown. Until every lever has
  // reported its `visible` verdict the count is unknown and the band folds,
  // so the common case never paints a flat row first. Disjoint from the
  // override fold by construction: that viewer's `can_act` is `false`.
  const decisionLeads = foldDecisions && folded.length === 0 && isActingApprover(record)
    ? permitted.filter((action) => isLeadDecision(action))
    : [];
  const decisionBand = decisionLeads.length > 0;
  const decisionOthers = decisionBand ? permitted.filter((action) => !decisionLeads.includes(action)) : [];
  const everyLeverReported = permitted.every((action) => !action.name || hasOwnKey(drawnByName, action.name));
  const foldDecisionOthers = decisionOthers.length > 0 && (!everyLeverReported || drawnNames.length > 2);
  const decisionOthersDrawn = decisionOthers.some((action) => !!action.name && drawnByName[action.name] === true);

  // objectstack#35593 — the record header's ONE group. Which levers lead it
  // is read off the server's `viewer` block (see `headerParts`), among the
  // levers the override fold left as buttons; the rest of those go into the
  // group's `⋮` ahead of the record's own. An override-only viewer's folded
  // levers keep their one marked menu, ahead of the group.
  const unfolded = headerParts ? permitted.filter((action) => !folded.includes(action)) : [];
  const headerLeads = !headerParts
    ? []
    : isActingApprover(record)
      ? unfolded.filter((action) => isLeadDecision(action))
      : isSubmitterViewer(record)
        ? unfolded
            .filter((action) => SUBMITTER_LEAD_VERBS.includes(approvalRouteVerb(action) as ApprovalRouteVerb))
            .sort((a, b) => SUBMITTER_LEAD_VERBS.indexOf(approvalRouteVerb(a)!) - SUBMITTER_LEAD_VERBS.indexOf(approvalRouteVerb(b)!))
        : [];
  const headerOthers = headerLeads.length > 0 ? unfolded.filter((action) => !headerLeads.includes(action)) : [];
  const headerOthersDrawn = headerOthers.some((action) => !!action.name && drawnByName[action.name] === true);

  if (headerParts) {
    const barFace = headerParts.face === 'bar';
    const overrideMenuLabel = String(t('approvalsInbox.viaOverrideChip', { defaultValue: 'Admin override' }));
    const overrideMenu = folded.length > 0 ? (
      <>
        {folded.map((action) => (
          <DeclaredActionVisibilityProbe key={action.name} action={action} record={record} onDrawn={reportDrawn} />
        ))}
        {foldedDrawn && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  'gap-1 px-2 border-amber-500/60 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-500/10 dark:hover:text-amber-300',
                  barFace ? 'h-11 shrink-0' : 'h-8',
                )}
                aria-label={overrideMenuLabel}
                title={overrideMenuLabel}
                data-testid="declared-actions-override-menu"
              >
                <ShieldAlert className="h-4 w-4" />
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {folded.map((action) => (
                <DeclaredActionButton key={action.name} action={action} objectName={objectName} record={record} asMenuItem requireReason={requireRejectReason} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </>
    ) : null;
    if (headerLeads.length === 0) {
      // None of the request's levers leads for this viewer: the record's own
      // row, after the override menu when the viewer holds one.
      return (
        <>
          {overrideMenu}
          {headerParts.recordRow}
        </>
      );
    }
    const moreLabel = String(t('detail.moreActions', { defaultValue: 'More actions' }));
    const hasRecordItems = headerParts.recordMenuItems !== null && headerParts.recordMenuItems !== undefined;
    return (
      <>
        {overrideMenu}
        {headerLeads.map((action) => (
          <DeclaredActionButton
            key={action.name}
            action={action}
            objectName={objectName}
            record={record}
            onDrawn={reportDrawn}
            headerTone={action.variant === 'primary' ? 'primary' : 'secondary'}
            requireReason={requireRejectReason}
            fill={barFace}
          />
        ))}
        {headerOthers.map((action) => (
          <DeclaredActionVisibilityProbe key={action.name} action={action} record={record} onDrawn={reportDrawn} />
        ))}
        {(headerOthersDrawn || hasRecordItems) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={barFace ? 'h-11 w-11 shrink-0 px-0' : 'h-8 gap-1 px-2'}
                aria-label={moreLabel}
                data-testid="declared-actions-header-menu"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48" data-testid="declared-actions-header-menu-content">
              {headerOthers.map((action) => (
                <DeclaredActionButton key={action.name} action={action} objectName={objectName} record={record} asMenuItem requireReason={requireRejectReason} />
              ))}
              {headerOthersDrawn && hasRecordItems && (
                <DropdownMenuSeparator data-testid="declared-actions-header-menu-separator" />
              )}
              {headerParts.recordMenuItems}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </>
    );
  }

  // Nothing this viewer may invoke renders nothing — no toolbar chrome, no
  // orphan divider, same degrade as "nothing declared at this location".
  if (permitted.length === 0) return null;

  if (decisionBand) {
    const moreLabel = String(t('approvalsInbox.moreDecisionActions', { defaultValue: 'More approval actions' }));
    return (
      <div className={cn('space-y-2', className)} data-approval-decision-folded="">
        {label && (
          <>
            <Separator />
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
          </>
        )}
        {/* Phone: the status line on top, then one row — the decisions at
            equal width and the menu at its end. From `sm` up: one row, the
            line at the start and the levers at the end. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <ApprovalWaitingStatus record={record} forApprover />
          <div
            role="toolbar"
            aria-label={label || t('common.actions')}
            className="flex w-full flex-row flex-wrap items-center gap-2 sm:ml-auto sm:w-auto"
          >
            {decisionLeads.map((action) => (
              <DeclaredActionButton
                requireReason={requireRejectReason}
                key={action.name}
                action={action}
                objectName={objectName}
                record={record}
                onDrawn={reportDrawn}
                fill
              />
            ))}
            {decisionOthers.map((action) => (foldDecisionOthers ? (
              <DeclaredActionVisibilityProbe
                key={action.name}
                action={action}
                record={record}
                onDrawn={reportDrawn}
              />
            ) : (
              <DeclaredActionButton
                requireReason={requireRejectReason}
                key={action.name}
                action={action}
                objectName={objectName}
                record={record}
                onDrawn={reportDrawn}
              />
            )))}
            {/* As in the override fold: the trigger appears once a folded
                lever is actually shown, so no empty menu is left behind. A
                neutral control — the amber shield marks the exception path
                only.

                objectstack#35016 — the entry is NAMED, at every width, with a
                disclosure chevron and no `⋯`: the record page's header row
                (and, on a phone, its bottom bar) keeps the page's one `⋯`, so
                the two menus on one screen are told apart by look before
                either is opened. */}
            {foldDecisionOthers && decisionOthersDrawn && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 shrink-0 gap-1 px-3 sm:h-9"
                    data-testid="declared-actions-decision-menu"
                  >
                    <span>{moreLabel}</span>
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  {decisionOthers.map((action) => (
                    <DeclaredActionButton
                      requireReason={requireRejectReason}
                      key={action.name}
                      action={action}
                      objectName={objectName}
                      record={record}
                      asMenuItem
                    />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (folded.length > 0) {
    const inline = permitted.filter((action) => !folded.includes(action));
    const overrideMenuLabel = String(t('approvalsInbox.viaOverrideChip', { defaultValue: 'Admin override' }));
    return (
      <div className={cn('space-y-2', className)} data-approval-override-folded="">
        {label && (
          <>
            <Separator />
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
          </>
        )}
        <div className="flex flex-row flex-wrap items-center gap-2">
          <ApprovalWaitingStatus record={record} />
          <div
            role="toolbar"
            aria-label={label || t('common.actions')}
            className="ml-auto flex flex-row flex-wrap items-center gap-2"
          >
            {inline.map((action) => (
              <DeclaredActionButton
                requireReason={requireRejectReason}
                key={action.name}
                action={action}
                objectName={objectName}
                record={record}
                onDrawn={reportDrawn}
              />
            ))}
            {folded.map((action) => (
              <DeclaredActionVisibilityProbe
                key={action.name}
                action={action}
                record={record}
                onDrawn={reportDrawn}
              />
            ))}
            {/* The trigger appears once a folded lever is actually shown, so a
                set whose every gate said no leaves no empty menu behind. */}
            {foldedDrawn && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  {/* One marked control for the whole exception path: the
                      override shield the folded levers wear, in the same amber,
                      beside the overflow glyph. */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 gap-1 px-2 sm:h-9 border-amber-500/60 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-500/10 dark:hover:text-amber-300"
                    aria-label={overrideMenuLabel}
                    title={overrideMenuLabel}
                    data-testid="declared-actions-override-menu"
                  >
                    <ShieldAlert className="h-4 w-4" />
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  {folded.map((action) => (
                    <DeclaredActionButton
                      requireReason={requireRejectReason}
                      key={action.name}
                      action={action}
                      objectName={objectName}
                      record={record}
                      asMenuItem
                    />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    );
  }

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
            requireReason={requireRejectReason}
            key={action.name}
            action={action}
            objectName={objectName}
            record={record}
            onDrawn={reportDrawn}
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
  foldOverrides,
  foldDecisions,
  onDrawnActionsChange,
  headerParts,
  requireRejectReason,
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
  // A header group with nothing declared (or not loaded yet) is the record's
  // row: the group never takes the header's buttons away.
  if (located.length === 0) return headerParts ? <>{headerParts.recordRow}</> : null;

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
        foldOverrides={foldOverrides}
        foldDecisions={foldDecisions}
        onDrawnActionsChange={onDrawnActionsChange}
        headerParts={headerParts}
        requireRejectReason={requireRejectReason}
      />
      {runtime.dialogs}
    </ActionProvider>
  );
}

export default DeclaredActionsBar;
