// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which executor an action's post-success hop, `onSuccess`, may sit beside:
 * ONE pair and ONE refusal text, read by `ActionSchema` (`action.zod.ts`) and
 * by the page action rows (`component.zod.ts`: `action:button`, `action:icon`
 * and each `action:group` / `action:menu` member).
 *
 * The console's action runner performs the hop after EVERY executor that
 * succeeds. Each branch of `ActionRunner.execute` (a host-registered handler,
 * a built-in, the declarative `operation: 'update'`) ends in
 * `handlePostExecution`, which hands `onSuccess` to `readOnSuccessNavigation`
 * and `navigateOnSuccess` (`core/src/actions/ActionRunner.ts:1384-1422` and
 * `:1639-1642` at the `.objectui-sha` pin `1fb1ced36243`; the file is
 * byte-identical at objectui `main` `72594f29`). So the rule is not that the
 * other executors leave the hop unread. None does. The rule is about what the
 * hop would follow:
 *
 * - `api` and `script` succeed with a result, the call's response or the
 *   handler's return, and `${result.*}` reads it. The hop is declared for
 *   these two ({@link ON_SUCCESS_EXECUTORS}).
 * - `url`, its runner alias `navigation`, and `form` are themselves
 *   navigations: `executeUrl` and `executeNavigation` hand off to
 *   `navigateTo`, and `executeForm` routes to the form view's `/forms/NAME`
 *   page. The hop is a second navigation, away from where the action went.
 * - `modal` opens a dialog, and its success is whatever the dialog's host
 *   answers. The console's dialog (app-shell `useActionModal`) answers when it
 *   closes: a saved form with the record, an OK with nothing, a dismissal as a
 *   failure. With no host the runner answers at once. None of it is a result
 *   the contract declares.
 * - `flow` starts a run, and the console's `flow` handler answers success when
 *   the run starts. A run paused at its first screen, or one that ended
 *   refused, answers `{ success: true, silent: true }` (`judgeFlowLaunch`,
 *   app-shell `utils/flowResponse.ts`), so the hop fires while that screen or
 *   the refusal notice is still open.
 *
 * `operation: 'update'` is read BEFORE any executor (`ActionRunner.execute`,
 * `:1384-1388` at the pin): the runner performs the declarative write through
 * the platform action route, runs no handler and no executor of its own, and
 * then hands the action to `handlePostExecution` like every other branch. So a
 * hop beside it follows the write, whose success carries neither a handler's
 * return nor a call's response for `${result.*}` to read.
 * `ActionSchema` refuses `onSuccess` beside `operation: 'update'` on every
 * `type`, and the page action rows refuse it the same way, with the one text
 * {@link onSuccessBesideUpdateOperationRefusal} prints.
 *
 * A page action row adds one case `ActionSchema` cannot have, because the
 * action's `type` defaults to `script`: a row that names no executor. The
 * runner dispatches it on nothing, so no executor's success is there for the
 * hop to follow.
 *
 * A name outside the runner's built-in table is a host-registered handler. The
 * runner hops after it too, and only the host knows whether its handler
 * navigates, so the rows leave it open, like the executor key itself. That
 * half lives in `component.zod.ts`, beside the rows' effective executor.
 *
 * Why a module of its own: `action-target-aliases.ts`'s reason. The two files
 * must read the SAME pair and the same text; `component.zod.ts` already imports
 * `action.zod.ts`, so neither can live in the rows' file; and exported from
 * `action.zod.ts` they would ride the `ui` barrel into the published API.
 * Reached by relative import only.
 */

/** The two executors the post-success hop is declared beside. */
export const ON_SUCCESS_EXECUTORS: ReadonlySet<string> = new Set(['api', 'script']);

/** What the hop is declared beside, and why: the second sentence of every refusal below. */
const DECLARED_BESIDE =
  '`onSuccess` is declared beside `api` and `script` only, whose success carries the result `${result.*}` '
  + "reads: the call's response, the handler's return.";

/** The runtime fact every refusal below rests on. */
const HOPS_AFTER_EVERY_EXECUTOR =
  "the console's action runner performs the post-success hop after every executor that succeeds";

/** The prescription for an executor whose success carries no declared result. */
const MOVE_THE_HOP =
  'Drop `onSuccess`, or move the hop onto an `api` or `script` action, whose result it reads.';

/**
 * The refusal of an `onSuccess` beside `executor`: a built-in other than `api`
 * / `script`, or `undefined` for a page action row that names no executor.
 * `subject` opens it ("A `type: 'url'` action's `onSuccess`"), and
 * `executorKey` spells the executor the no-executor prescription asks for
 * (`actionType` on a page node, `type` on a member).
 */
export function onSuccessBesideExecutorRefusal(
  subject: string,
  executor: string | undefined,
  executorKey: 'type' | 'actionType',
): string {
  switch (executor) {
    case 'url':
    case 'navigation': {
      const itself = executor === 'url'
        ? 'a `url` action is itself the navigation'
        : "`navigation`, the runner's alias of `url`, is itself the navigation";
      return `${subject} would navigate a second time: ${itself}, and ${HOPS_AFTER_EVERY_EXECUTOR}. `
        + `${DECLARED_BESIDE} Put the destination in \`target\`, with the tab in the top-level \`openIn\`, `
        + 'and drop `onSuccess`.';
    }
    case 'form':
      return `${subject} would navigate a second time: a \`form\` action is itself a navigation, to the form `
        + `view's \`/forms/\` page, and ${HOPS_AFTER_EVERY_EXECUTOR}, so it would leave the form before it is `
        + `filled in. ${DECLARED_BESIDE} Drop \`onSuccess\`, and declare where a submitted form goes in the form `
        + "view's `submitBehavior`.";
    case 'modal':
      return `${subject} would follow a result the contract does not declare: a \`modal\` action opens a `
        + `dialog, whose success is whatever the dialog's host answers, and ${HOPS_AFTER_EVERY_EXECUTOR}. `
        + `${DECLARED_BESIDE} ${MOVE_THE_HOP}`;
    case 'flow':
      return `${subject} would follow the flow's start, not a result: the console answers a \`flow\` action's `
        + 'success when the run starts, even for a run paused at its first screen or one that ended refused, and '
        + `${HOPS_AFTER_EVERY_EXECUTOR}, so the hop fires while that screen or the refusal notice is still open. `
        + `${DECLARED_BESIDE} ${MOVE_THE_HOP}`;
    case undefined:
      return `${subject} has no executor to follow: the row names none, and the console's action runner `
        + 'performs the post-success hop after the executor it runs succeeds. '
        + `${DECLARED_BESIDE} Declare the executor whose success the hop follows, \`${executorKey}: 'api'\` or `
        + `\`${executorKey}: 'script'\`, or drop \`onSuccess\`.`;
    default:
      return `${subject} would follow a result the contract does not declare: a \`${executor}\` action's `
        + `success carries none, and ${HOPS_AFTER_EVERY_EXECUTOR}. ${DECLARED_BESIDE} ${MOVE_THE_HOP}`;
  }
}

/**
 * The refusal of an `onSuccess` beside `operation: 'update'`, on `ActionSchema`
 * and on a page action row alike: the runner reads `operation` before any
 * executor, so the hop would follow the declarative write, and whatever
 * executor the action or row names is never run. `subject` opens it ("An
 * `operation: 'update'` action's `onSuccess`").
 */
export function onSuccessBesideUpdateOperationRefusal(subject: string): string {
  return `${subject} would follow a result the contract does not declare: the console's action runner reads `
    + "`operation` before any executor, so an `operation: 'update'` action runs no handler and no executor of its "
    + 'own (the platform action route writes `patch` to the current record as the caller), and the runner then '
    + 'performs the post-success hop after that write succeeds. `${result.*}` reads a handler\'s return or a '
    + "call's response, and the declarative write declares neither. Drop `onSuccess`; post-success navigation "
    + 'after the declarative write is a spec proposal, not a silent key.';
}
