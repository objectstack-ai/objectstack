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
 * ## The flow's own toasts reach the user in their language (objectui#12075)
 *
 * A launch is handed the host's i18next instance and active language, reads
 * the `flows` bundle for the flow the run belongs to (`activeFlowsBundle`, the
 * same reader `FlowRunner` uses), and hands it to `interpretFlowResponse`,
 * which translates the flow's `successMessage` and `errorMessage` against
 * `flows.FLOW.successMessage` / `flows.FLOW.errorMessage`. So the toast a
 * straight-through run closes on, and the error a failed launch hands the
 * ActionRunner, are the words a paused run's runner shows.
 */

import { toast } from 'sonner';
import { createServerActionHandler } from '@object-ui/core';
import type { ActionDef, ActionResult, ServerActionFetch } from '@object-ui/core';
import { interpretFlowResponse, judgeFlowLaunch, type FlowCopyLocale, type FlowLaunchJudgement } from './flowResponse.js';
import { activeFlowsBundle, type TranslationResourceReader } from './flowsBundle.js';

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
  /**
   * The host's i18next instance and active language, which the flow's own
   * toasts are translated in (objectui#12075 — see the header).
   */
  translation: { i18n: TranslationResourceReader | undefined; language: string };
}

/** The translation `interpretFlowResponse` applies to `flowName`'s own toasts. */
function flowCopyLocale(input: ConsoleFlowLaunchInput, flowName: string): FlowCopyLocale {
  const { i18n, language } = input.translation;
  return { flowName, bundle: activeFlowsBundle(i18n, language, flowName), locale: language };
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
 */
function settled<S>(launch: ConsoleFlowLaunch<S>): ConsoleFlowLaunch<S> {
  if (launch.judged.successToast) toast.success(launch.judged.successToast);
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
        interpretFlowResponse<S>(answered.res, answered.json, `Flow "${flowName}"`, flowCopyLocale(input, flowName)),
        action.refreshAfter,
        action.successMessage,
      ),
    });
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
      interpretFlowResponse<S>(res, json, `Flow "${clickedFlow}"`, flowCopyLocale(input, clickedFlow)),
      action.refreshAfter,
      action.successMessage,
    ),
  });
}
