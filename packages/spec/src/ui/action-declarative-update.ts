// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { z } from 'zod';
import { onSuccessBesideUpdateOperationRefusal } from './action-on-success-executor';

/**
 * The mixing rule between the declarative single-record field write,
 * `operation: 'update'` (#14092), and the rest of the action vocabulary: ONE
 * judge and ONE set of refusal texts, read by `ActionSchema` (`action.zod.ts`)
 * and by the page action rows (`component.zod.ts`: `action:button`,
 * `action:icon` and each `action:group` / `action:menu` member). Designed with
 * the PR that landed the operation and pinned in `action-row-update.test.ts`;
 * the rows' half is pinned in `component-action-row-declarative-update.test.ts`.
 *
 * Both runtimes read `operation` before the executor. The console's action
 * runner (`ActionRunner.execute`, `core/src/actions/ActionRunner.ts:1384-1388`
 * at the `.objectui-sha` pin `b9814b334`, byte-identical at objectui `main`
 * `524136e`) posts the write through its registered `script` dispatch and runs
 * no executor of its own, whatever executor the action or row names. The
 * platform action route treats an action carrying `operation: 'update'` as the
 * write "whatever `type` says" (`isDeclarativeUpdateAction`,
 * `packages/runtime/src/action-execution.ts`). So beside the operation, the
 * executor and every key that binds or shapes an executor's dispatch are never
 * read. The rules, in the order the issues are raised:
 *
 *  1. `patch` without `operation: 'update'` is refused (it would be silently
 *     dropped — ADR-0078).
 *  2. Beside `operation: 'update'`, an executor other than `'script'` — the
 *     route the write is posted to — is refused at the executor key
 *     ({@link updateOperationExecutorRefusal}). An explicit `'script'` names
 *     that route and is accepted; on `ActionSchema` it is also
 *     indistinguishable from the materialized default (a `.default()` has
 *     already run by the time a refinement sees the object — the #13897
 *     asymmetry).
 *  3. Every key that names or shapes a dispatch the update does not make is
 *     refused at its own path ({@link DECLARATIVE_UPDATE_REFUSED_KEYS}).
 *  4. `operation: 'update'` with nothing to write is refused at `patch`.
 *  5. A `list_toolbar` location is refused: no current record there.
 *
 * Deliberately NOT judged here: `objectName`. `ActionSchema` parses an action
 * embedded on an object (object implicit) and a standalone one in
 * `stack.actions` (only `objectName` can say), so the standalone form is judged
 * where standalone-ness is knowable — `defineStack`'s cross-reference walk
 * (`stack.zod.ts`, `collectGlobalUpdateActionErrors`). A page action row acts on
 * its own `objectName` or on the page's object, which the row cannot see either.
 *
 * What differs between an action and a row is only what a
 * {@link DeclarativeUpdateSurface} says: the key that spells the executor,
 * whether that key has a default, the subject the `onSuccess` refusal opens
 * with, and whether `params` has an object form the write reads. Every rule and
 * every text is the same function of it. On `ActionSchema`'s surface each text
 * is byte-for-byte the action's own.
 *
 * Why a module of its own: `action-on-success-executor.ts`'s reason. The two
 * schema files must apply the SAME judge; `component.zod.ts` already imports
 * `action.zod.ts`, so the judge cannot live in the rows' file, and exported from
 * `action.zod.ts` it would ride the `ui` barrel into the published API. Reached
 * by relative import only.
 */

/** What one surface tells the declarative-update judge. */
export interface DeclarativeUpdateSurface {
  /**
   * The key that names the executor: `type` on an action and on an
   * `action:group` / `action:menu` member, `actionType` on a page node.
   */
  readonly executorKey: 'type' | 'actionType';
  /**
   * `true` on `ActionSchema`, whose `type` defaults to `'script'`, the route the
   * write is posted to. A row's executor key has no default.
   */
  readonly executorDefaultsToScript: boolean;
  /** Opens the refusal of `onSuccess` beside the operation ({@link onSuccessBesideUpdateOperationRefusal}). */
  readonly onSuccessSubject: string;
  /**
   * `true` where a non-empty OBJECT `params` holds static field values the
   * write merges in, besides the array the dialog collects: an `action:button`
   * / `action:icon` node, whose `params` IS `properties.params`, the static
   * values the renderer forwards (`readStaticParamValues`) and the runner's
   * update merges OVER `patch` (`executeUpdateOperation`). An action's
   * `params` is the input list only, and so is a container member's, whose
   * object `params` never reaches a non-`api` executor.
   */
  readonly staticParams: boolean;
}

/** `` `type: 'api'` `` on an action or a member, `` `actionType: 'api'` `` on a page node. */
const spell = (surface: DeclarativeUpdateSurface, executor: string): string =>
  `\`${surface.executorKey}: '${executor}'\``;

/** {@link spell} with its indefinite article: `actionType` takes `an`. */
const aSpelled = (surface: DeclarativeUpdateSurface, executor: string): string =>
  `${surface.executorKey === 'actionType' ? 'an' : 'a'} ${spell(surface, executor)}`;

/** {@link aSpelled}, opening a sentence. */
const ASpelled = (surface: DeclarativeUpdateSurface, executor: string): string =>
  `${surface.executorKey === 'actionType' ? 'An' : 'A'} ${spell(surface, executor)}`;

/**
 * The refusal of an executor other than `'script'` beside `operation:
 * 'update'`, at the executor key. On `ActionSchema` the key stays at its
 * default; a row's key has none, so it names that route or nothing.
 */
function updateOperationExecutorRefusal(surface: DeclarativeUpdateSurface, executor: string): string {
  const keep = surface.executorDefaultsToScript
    ? `\`${surface.executorKey}\` stays at its default \`'script'\``
    : `\`${surface.executorKey}\` names that route or nothing`;
  return "`operation: 'update'` is performed by the platform action route — the route "
    + `${aSpelled(surface, 'script')} action posts to — so ${keep}; leave it off. `
    + `${ASpelled(surface, executor)} action dispatches on \`target\` (\`api\` makes the browser call the endpoint itself) `
    + 'and never performs the write.';
}

/**
 * The keys an `operation: 'update'` action must not carry, each with the
 * sentence that names the executor the key belongs to. A table rather than a
 * chain of `.refine()`s so every combination gets ONE issue at ITS key's path
 * — the same shape `BulkActionDefSchema`'s refinements use for the def side.
 *
 * A key a surface does not declare never reaches the judge: a page action row
 * is a strict object, so it refuses `body`, `recordIdParam`,
 * `outcomeMessages`, `opensInNewTab` and `newTabUrl` (and `recordIdField` on
 * every row but `action:button`) as unknown keys before any refinement runs.
 */
const DECLARATIVE_UPDATE_REFUSED_KEYS: ReadonlyArray<
  readonly [key: string, why: (surface: DeclarativeUpdateSurface) => string]
> = [
  ['target', (s) =>
    "`target` names a handler, URL, page, flow or endpoint — an `operation: 'update'` action dispatches on "
    + 'none of them: the platform action route writes `patch` to the current record. Drop `target`; to call '
    + `an endpoint of your own instead, use ${spell(s, 'api')} without \`operation\`.`],
  ['body', (s) =>
    `\`body\` is the inline handler of ${aSpelled(s, 'script')} action — an \`operation: 'update'\` action has no `
    + 'handler: the write IS the `patch`, performed by the platform as the caller. Drop `body`; to write '
    + 'through a handler of your own (system-elevated `ctx.api`), drop `operation` and `patch` instead.'],
  ['method', (s) =>
    `\`method\` is the HTTP verb of ${aSpelled(s, 'api')} request — an \`operation: 'update'\` action makes no request `
    + 'of its own: the platform performs the write on the data plane. Drop `method`.'],
  ['bodyExtra', (s) =>
    `\`bodyExtra\` is the static request body of ${aSpelled(s, 'api')} action — on an \`operation: 'update'\` action `
    + 'the static field values go in `patch`. Move them there and drop `bodyExtra`.'],
  ['bodyShape', (s) =>
    `\`bodyShape\` shapes ${aSpelled(s, 'api')} request body — an \`operation: 'update'\` action sends no request body `
    + 'of its own. Drop `bodyShape`.'],
  ['recordIdParam', () =>
    "`recordIdParam` injects the row id into a request body — an `operation: 'update'` action binds the "
    + 'current record from the invocation context and has no body to inject into. Drop `recordIdParam`.'],
  ['recordIdField', () =>
    "`recordIdField` seeds `recordIdParam` — an `operation: 'update'` action binds the current record from "
    + 'the invocation context and injects nothing. Drop `recordIdField`.'],
  // One text with the executor half of the rows' `onSuccess` rule
  // (`action-on-success-executor.ts`).
  ['onSuccess', (s) => onSuccessBesideUpdateOperationRefusal(s.onSuccessSubject)],
  ['outcomeMessages', () =>
    "`outcomeMessages` picks success copy by the `outcome` a handler returns — an `operation: 'update'` "
    + 'action has no handler: the platform performs the write and reports no outcome, so no entry could '
    + 'ever be chosen. Drop it; a fixed confirmation for the write is `successMessage`.'],
  ['opensInNewTab', () =>
    "`opensInNewTab` pre-opens a tab for a handler-returned `{ redirectUrl }` — an `operation: 'update'` "
    + 'action has no handler and returns no redirect. Drop it.'],
  ['newTabUrl', () =>
    "`newTabUrl` is the zero-roundtrip target of the pre-opened-tab flow — an `operation: 'update'` action "
    + 'has no such flow. Drop it.'],
];

/** Whether `params` gives the write field values on `surface` (rule 4). */
function paramsWrite(surface: DeclarativeUpdateSurface, params: unknown): boolean {
  if (Array.isArray(params)) return params.length > 0;
  return surface.staticParams && params !== null && typeof params === 'object' && Object.keys(params).length > 0;
}

/**
 * The declarative-update judge for `surface`: the five rules above, as one
 * refinement. `ActionSchema` and each page action row pass it to
 * `superRefine` with their own {@link DeclarativeUpdateSurface}.
 */
export function refuseDeclarativeUpdateContradictions(surface: DeclarativeUpdateSurface) {
  return (data: Record<string, unknown>, ctx: z.core.$RefinementCtx): void => {
    if (data.operation !== 'update') {
      if (data.patch !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['patch'],
          message:
            "`patch` only applies to `operation: 'update'` — without it the action never writes fields, so "
            + "these values would be silently dropped. Add `operation: 'update'`, or for the static request "
            + `body of ${aSpelled(surface, 'api')} action use \`bodyExtra\`.`,
        });
      }
      return;
    }

    // An empty row executor key names nothing, as the rows read it everywhere
    // else (`effectiveRowExecutor`); `ActionSchema`'s `type` is never empty.
    const executor = data[surface.executorKey];
    if (typeof executor === 'string' && executor !== '' && executor !== 'script') {
      ctx.addIssue({
        code: 'custom',
        path: [surface.executorKey],
        message: updateOperationExecutorRefusal(surface, executor),
      });
    }

    for (const [key, why] of DECLARATIVE_UPDATE_REFUSED_KEYS) {
      if (data[key] !== undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: why(surface) });
      }
    }

    if (data.patch === undefined && !paramsWrite(surface, data.params)) {
      ctx.addIssue({
        code: 'custom',
        path: ['patch'],
        message:
          "An `operation: 'update'` action has nothing to write: declare a static `patch` (`{ status: 'done' }`), "
          + 'or `params` so the dialog collects the values, or both — the patch is merged UNDER the collected params.',
      });
    }

    if (Array.isArray(data.locations)) {
      data.locations.forEach((location, index) => {
        if (location !== 'list_toolbar') return;
        ctx.addIssue({
          code: 'custom',
          path: ['locations', index],
          message:
            "`list_toolbar` has no current record — an `operation: 'update'` action writes ONE record, the one it "
            + 'runs on. Use a record location (`list_item`, `record_header`, `record_more`, `record_section`) or, '
            + "for the selection bar, a `bulkActionDefs` entry on the list view (`{ operation: 'update', patch }`).",
        });
      });
    }
  };
}
