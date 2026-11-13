/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * How the console STARTS a flow from a click, and which door it knocks on
 * (objectui#12037). Module-internal: the two flow-launch handlers —
 * `useConsoleActionRuntime`'s and `RecordDetailView`'s — call
 * {@link launchConsoleFlow}, and nothing outside this package can import it
 * (it is not re-exported from `utils/index` or the package entry).
 *
 * ## Two doors, chosen by a lookup, not a guess
 *
 * A flow can be started two ways, and they do not apply the same gates:
 *
 * - **the action door**, `POST /api/v1/actions/:object/:action` — the server
 *   resolves the DECLARED action by name and runs every gate the declaration
 *   carries before the flow starts: its `requiredPermissions` (ADR-0066 D4,
 *   whose UI half only hides the button), its activation switch, its param
 *   contract, and a caller-scoped load of the subject record;
 * - **the trigger route**, `POST /api/v1/automation/:flow/trigger` — starts a
 *   flow by name. Ruling A (objectstack-ai/objectstack#22424) refuses a
 *   non-system caller an elevated self-triggered flow there exactly as at the
 *   action door; nothing else about an action applies, because there is none.
 *
 * A click goes through the action door EXACTLY when its object and its `name`
 * resolve to a declared action of type `flow` with the same target, in the
 * object metadata the console already holds ({@link findDeclaredFlowAction}).
 * Every other flow click stays on the trigger route. That is not a fallback
 * for a door that failed: a flow start that names no declared action has no
 * action gate to apply, so the trigger route IS its door. The spec authors two
 * such starts on purpose (triage ruling B on objectui#12037):
 *
 * - an inline page `action:button` (and its `action:icon` / `action:group` /
 *   `action:menu` siblings) with `actionType: 'flow'` and a `target`, whose
 *   `name` is optional ("an inline page button is not a registered object
 *   action") or names no declared action;
 * - a dashboard header action `{ actionType: 'flow', actionUrl }`, which the
 *   dashboard renderer dispatches as `{ name: actionUrl, target: actionUrl }`.
 *
 * ⚠️ **What the lookup cannot see, said rather than assumed.** The object
 * metadata carries an object's own `actions[]`, which since `defineStack`'s
 * bound-action merge includes every `defineAction({ objectName })` declared
 * beside it. It does NOT carry an object-LESS declared action, nor a
 * standalone authored action row that no object definition embeds. A click on
 * either takes the trigger route — what every flow click did before this
 * module existed, so it is no regression, and the elevation refusal above
 * still holds for it. Seeing those would take a click-time `action` metadata
 * fetch, which this module deliberately does not make.
 *
 * ## Who owns which half of the door's exchange
 *
 * The `/actions` REQUEST belongs to `@object-ui/core`'s dispatcher —
 * `createServerActionHandler` owns name-only identity (ADR-0110 D1), the
 * `{ recordId, params }` body and the `_rowRecord` strip, and app-shell names
 * that route nowhere else (`actions-envelope.ratchet.test.ts`). Its ANSWER is
 * not an action envelope, though: it is the flow's `AutomationResult`, and it
 * is read by the flow rule (`interpretFlowResponse` / `judgeFlowLaunch`), so a
 * paused screen run still opens `FlowRunner`, a refused end still opens the
 * Close-only notice, and a `FLOW_FAILED` still prefers the author's
 * `errorMessage`. The dispatcher's own reading (`interpretActionResponse`) has
 * none of those arms, so the transport is injected and the raw answer is read
 * here; the dispatcher's `ActionResult` is used only when no answer arrived.
 *
 * ## The one toast a launch speaks itself (objectui#12274)
 *
 * A run that goes straight through is closed by the ActionRunner's success
 * toast, which knows the action's copy and its own default and nothing else.
 * When the flow's own `successMessage` is the copy the run closes with — the
 * action declares none — the judgement says so (`successToast`, with a
 * `silent` result), and it is spoken here, once for both hosts, the way
 * `FlowRunner` speaks a paused run's closing copy. Which copy wins is not
 * decided here: see `flowSuccessCopy` in `utils/flowResponse`.
 *
 * ## The flow's own toasts reach the user in their language (objectstack#28054)
 *
 * The engine renders the flow's `successMessage` and `errorMessage` and picks
 * their `flows.FLOW.*` translations in the run's locale, so a launch speaks
 * them as served, exactly as a paused run's runner does. It is handed the
 * host's active language only for the permission line a refused write reads
 * (`interpretFlowResponse`).
 */

import { toast } from 'sonner';
import { createServerActionHandler } from '@object-ui/core';
import type { ActionDef, ActionResult, ServerActionFetch } from '@object-ui/core';
import {
  asDroppedFieldsNotice,
  isWireDroppedFieldsEntry,
  type DroppedFieldsNotice,
  type ObjectStackAdapter,
} from '@object-ui/data-objectstack';
import {
  emitWriteWarning,
  type FieldLabelFn,
  type TranslateFn,
  type WriteWarningSink,
} from '../providers/writeWarningToast.js';
import { interpretFlowResponse, judgeFlowLaunch, type FlowLaunchJudgement } from './flowResponse.js';

/*
 * ## The ONE reader of a flow run's `droppedFields` (objectstack#33009, the
 * console half of objectstack#32861)
 *
 * A flow's `update_record` / `create_record` step that writes a field the data
 * engine will not store (the #32666 case: 「提交审批」 writes `status`, which
 * is `readonly: true`) used to lose the value in silence: the step succeeded,
 * the run answered success, the record stayed 「草稿」 and the person who
 * clicked saw nothing. The run's answer now names those fields
 * (`AutomationResult.droppedFields`, objectstack#32861): the data engine's own
 * `DroppedFieldsEvent`s, one per object and reason, set only when a field was
 * dropped. {@link announceFlowDroppedFields} turns that member into the
 * same warning toast a record save shows for the same strip.
 *
 * Three hosts read a flow answer and all three come through here: the two
 * launch handlers (`useConsoleActionRuntime`, `RecordDetailView`) through
 * `launchConsoleFlow`, and `FlowRunner`'s resume of a paused screen run, whose
 * terminal answer is where a write after the pause reports its drop.
 *
 * - **Parse**: `@object-ui/data-objectstack`'s own wire gate and parser
 *   (`isWireDroppedFieldsEntry`, `asDroppedFieldsNotice`), with its skew arm
 *   for a `reason` this bundle's spec pin cannot name. ⛔ Never a second copy.
 * - **Speak**: `writeWarningToast.emitWriteWarning`, the record save's own
 *   message — the same title, the same per-reason sentence, the same field
 *   labels. The flow DID write the record, so its "Saved — but some fields did
 *   not take effect" title is true here too.
 * - **Labels**: from the host's `dataSource`, which in the console IS the
 *   `ObjectStackAdapter` (`useAdapter()`, cached `getObjectSchema`), so the
 *   label path is the one `AdapterProvider` hands the save toast. Each host
 *   already holds it (it is what renders its forms), so no host gains a new
 *   dependency. A data source without `getObjectSchema` (a test stub) names
 *   fields by api name, which is still the truthful answer.
 *
 * One event per object: a flow can write any object, and a label is looked up
 * on the object the entry names. Folding a second object's fields under the
 * clicked record's object would label `status` with that object's `status`.
 *
 * A PRESENT member is a drop; an ABSENT one is not proof of none. A `map`
 * item's run and a `subflow` child that paused do not roll their drops up yet
 * (objectstack#33019), so nothing here ever says "every field was written".
 */

/**
 * What an entry whose wire `object` is missing is attributed to: nothing.
 * The spec requires `object`, so only an off-spec answer reaches this; a flow
 * can write any object, so the clicked record's object would be a guess.
 * Falsy on purpose: `emitWriteWarning` skips the label lookup for an empty
 * resource and names the fields by api name.
 */
const UNATTRIBUTED_FLOW_DROP = '';

/** What the hosts hand the reader: the translator, the label convention, the data source. */
export interface FlowDroppedFieldsContext {
  t: TranslateFn;
  fieldLabel: FieldLabelFn;
  /** The host's data source; read for `getObjectSchema` only. */
  dataSource: unknown;
}

/**
 * The parsed `droppedFields` of a flow answer (`{ success, data: AutomationResult }`),
 * in wire order; empty when the answer carries none.
 */
export function flowAnswerDroppedFields(json: unknown): DroppedFieldsNotice[] {
  const wire = (json as { data?: { droppedFields?: unknown } } | null | undefined)?.data?.droppedFields;
  if (!Array.isArray(wire)) return [];
  return wire
    .filter(isWireDroppedFieldsEntry)
    .map((e) => asDroppedFieldsNotice(e, UNATTRIBUTED_FLOW_DROP));
}

function schemaSource(dataSource: unknown): Pick<ObjectStackAdapter, 'getObjectSchema'> | null {
  const ds = dataSource as { getObjectSchema?: unknown } | null | undefined;
  return ds && typeof ds.getObjectSchema === 'function'
    ? (ds as Pick<ObjectStackAdapter, 'getObjectSchema'>)
    : null;
}

/**
 * Warn the person who started the run about every field its write steps
 * dropped: one `emitWriteWarning` per object, nothing when the answer names
 * none. Never throws — the run already happened, and a failed label lookup
 * must not turn it into an error.
 */
export async function announceFlowDroppedFields(
  json: unknown,
  ctx: FlowDroppedFieldsContext,
  sink: WriteWarningSink = toast,
): Promise<void> {
  const byObject = new Map<string, DroppedFieldsNotice[]>();
  for (const notice of flowAnswerDroppedFields(json)) {
    const object = notice.object ?? UNATTRIBUTED_FLOW_DROP;
    byObject.set(object, [...(byObject.get(object) ?? []), notice]);
  }
  const adapter = schemaSource(ctx.dataSource);
  for (const [object, droppedFields] of byObject) {
    try {
      await emitWriteWarning(
        // `operation` is required by the event type and read only by a record
        // save surface's answer-warnings claim, which a flow event (no
        // `warnings`, no `notice`) never reaches; the toast does not show it.
        { operation: 'update', resource: object, droppedFields },
        ctx.t,
        adapter,
        ctx.fieldLabel,
        sink,
      );
    } catch (err) {
      console.warn('flowLaunch: could not announce dropped fields', err);
    }
  }
}

/** The door a flow click went through. */
export type ConsoleFlowLaunchDoor = 'action' | 'trigger';

/** The keys of a declared action the lookup reads. */
interface DeclaredActionShape {
  name?: unknown;
  type?: unknown;
  target?: unknown;
}

/**
 * The declared action a flow click names, or `undefined` when it names none.
 *
 * A match needs all four: the object is in `objects`, it declares an action
 * of this `name`, that action's `type` is `'flow'`, and its `target` is the
 * flow the click would start. A same-named action of another type, or one
 * aimed at another flow, is not the click's declaration — routing the click
 * to it would run something the click did not ask for.
 */
export function findDeclaredFlowAction(
  objects: readonly unknown[] | undefined,
  objectName: string | undefined,
  actionName: string | undefined,
  flowName: string,
): (DeclaredActionShape & { name: string; target: string }) | undefined {
  if (!objectName || !actionName || !Array.isArray(objects)) return undefined;
  const objectDef = objects.find(
    (o) => (o as { name?: unknown } | null | undefined)?.name === objectName,
  ) as { actions?: unknown } | undefined;
  const actions: unknown[] = Array.isArray(objectDef?.actions) ? objectDef.actions : [];
  const declared = actions.find(
    (a) => (a as DeclaredActionShape | null | undefined)?.name === actionName,
  ) as DeclaredActionShape | undefined;
  if (!declared || declared.type !== 'flow' || declared.target !== flowName) return undefined;
  return declared as DeclaredActionShape & { name: string; target: string };
}

export interface ConsoleFlowLaunchInput {
  /** The host's authenticated transport. */
  fetch: ServerActionFetch;
  baseUrl: string;
  /** The clicked action. Its flow is `target`, else its `name`. */
  action: ActionDef;
  /** The object the click acts on — the action's own, else the host's. */
  objectName: string | undefined;
  /** The record the click acts on, already resolved by the host. */
  recordId: unknown;
  /** The trigger route's params bag, `_rowRecord` already stripped. */
  triggerParams: Record<string, unknown>;
  /** The object metadata the host already holds. */
  objects: readonly unknown[] | undefined;
  /** The host's active language, which a refused write's permission line is read in. */
  language: string;
  /**
   * What the run's `droppedFields` warning is spoken with: the host's `t`,
   * its field-label convention and its data source (objectstack#33009).
   */
  droppedFields: FlowDroppedFieldsContext;
}

export interface ConsoleFlowLaunch<S = unknown> {
  door: ConsoleFlowLaunchDoor;
  /**
   * The flow the run belongs to — what `FlowRunner` resumes it under. On the
   * action door it is the declaration's `target`, which the lookup required to
   * equal the click's flow.
   */
  flowName: string;
  judged: FlowLaunchJudgement<S>;
}

/**
 * Hand the launch back to its host, first speaking the success toast the
 * ActionRunner cannot (see the header). The result is `silent` exactly when
 * `successToast` is set, so the user reads one toast either way.
 *
 * Then the answer's `droppedFields` (objectstack#33009): a write step that
 * dropped a read-only field ran and the run succeeded, so the user is warned
 * beside the success, not instead of it. Not on a failed launch: its toast
 * says the run failed, and "saved, but" beside it would contradict it.
 */
function settled<S>(
  launch: ConsoleFlowLaunch<S>,
  json: unknown,
  droppedFields: FlowDroppedFieldsContext,
): ConsoleFlowLaunch<S> {
  if (launch.judged.successToast) toast.success(launch.judged.successToast);
  // Not awaited: the label lookup must not hold the click's outcome (or its
  // refresh), and the reader never rejects.
  if (launch.judged.result.success !== false) void announceFlowDroppedFields(json, droppedFields);
  return launch;
}

/** Start the flow a click names, through the door {@link findDeclaredFlowAction} picks. */
export async function launchConsoleFlow<S = unknown>(
  input: ConsoleFlowLaunchInput,
): Promise<ConsoleFlowLaunch<S>> {
  const { action, objectName, recordId, baseUrl } = input;
  const clickedFlow = String(action.target || action.name || '');
  const declared = findDeclaredFlowAction(input.objects, objectName, action.name, clickedFlow);

  if (declared) {
    const flowName = declared.target;
    let answered: { res: { ok: boolean; status: number }; json: unknown } | undefined;
    const keepAnswer: ServerActionFetch = async (url, init) => {
      const res = await input.fetch(url, init);
      const json = await res.json().catch(() => null);
      answered = { res: { ok: res.ok, status: res.status }, json };
      return { ok: res.ok, status: res.status, json: async () => json };
    };
    const dispatch = createServerActionHandler({
      fetch: keepAnswer,
      baseUrl,
      // The host already resolved the record (its own selection and
      // record-page rules); the dispatcher must not re-derive it.
      resolveRecordId: () => ({ recordId }),
    });
    const dispatched: ActionResult = await dispatch({ ...action, objectName });
    if (!answered) {
      return { door: 'action', flowName, judged: { result: dispatched, refresh: false } };
    }
    return settled({
      door: 'action',
      flowName,
      judged: judgeFlowLaunch(
        interpretFlowResponse<S>(answered.res, answered.json, `Flow "${flowName}"`, input.language),
        action.refreshAfter,
        action.successMessage,
      ),
    }, answered.json, input.droppedFields);
  }

  const res = await input.fetch(
    `${baseUrl}/api/v1/automation/${encodeURIComponent(clickedFlow)}/trigger`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId, objectName, params: input.triggerParams }),
    },
  );
  const json = await res.json().catch(() => null);
  return settled({
    door: 'trigger',
    flowName: clickedFlow,
    judged: judgeFlowLaunch(
      interpretFlowResponse<S>(res, json, `Flow "${clickedFlow}"`, input.language),
      action.refreshAfter,
      action.successMessage,
    ),
  }, json, input.droppedFields);
}
