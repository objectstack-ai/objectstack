/**
 * The host-composed panel an action's param dialog shows beside its params.
 *
 * A companion is one of two kinds. The host-chrome kind is console chrome, not
 * authored metadata: the dialog's host decides it from the platform action
 * being run, the way it composes the admin-override notice (objectui#5178).
 * The declared kind is the action's authored `preflight` (below). Both param-collection handlers
 * (`useConsoleActionRuntime` and `RecordDetailView`) ask
 * {@link resolveParamDialogCompanion}, so the two runtimes cannot disagree on
 * which dialog carries one.
 *
 * ## The one companion today: a banned user's open work (objectstack#30205)
 *
 * The platform's `ban_user` action on `sys_user` opens a dialog that shows how
 * many records the person owns and is assigned, and offers one optional bulk
 * hand-over (`UserAssignedWorkPanel`). The ban never waits for it: the
 * dialog's Confirm stays the ban, and the panel neither gates nor runs it.
 *
 * ## The declared companion: an action's `preflight` read (objectstack#31808)
 *
 * The spec's `ActionSchema.preflight` (objectstack#31840) is the AUTHORED
 * kind: one same-origin `GET` the dialog sends before submit, whose answer it
 * shows above the params and seeds the params it names from. It shares the
 * slot with the host chrome above, and the same resolver picks it, so "one
 * mechanism" holds at the slot (amendment 6733780864 on objectstack#31808).
 * The ban panel stays host chrome: its hand-over is a repeatable write, which
 * a read-only declaration cannot carry. Should an action ever carry both, the
 * declared read is drawn first and the host panel after it
 * ({@link PreflightCompanion.hostChrome}); none does today.
 *
 * A stored action reaches the console UNPARSED, so the declaration is judged
 * again here with the spec's own `ActionSchema` ({@link judgeActionPreflight})
 * before the dialog sends anything: a block the spec refuses is drawn as a
 * refusal and never read.
 */

import { ActionSchema } from '@objectstack/spec/ui';
import type { ActionDef, ActionParamDef, PreflightReadFiller } from '@object-ui/core';

/** The platform object whose ban action carries the assigned-work companion. */
export const USER_OBJECT = 'sys_user';

/** The platform action, on {@link USER_OBJECT}, that bans a user. */
export const BAN_USER_ACTION = 'ban_user';

/** The ban dialog's host chrome: the user's open work and its hand-over. */
export interface UserAssignedWorkCompanion {
  kind: 'user-assigned-work';
  /** The user the action is run on. */
  userId: string;
}

/** The action's `preflight` block, as the spec declares it. */
export type DeclaredPreflight = NonNullable<ActionDef['preflight']>;

/**
 * The declared kind: the action's `preflight` read, judged. `judged` is the
 * spec's verdict on the stored block: `ok` with the parsed block, or the
 * spec's refusal text. `interpolateRead` is the runner's filler for
 * `read.url` (`ParamCollectionHandler`'s fifth argument); absent, nothing can
 * be filled and the dialog sends nothing.
 */
export interface PreflightCompanion {
  kind: 'preflight';
  judged: { ok: true; preflight: DeclaredPreflight } | { ok: false; refusal: string };
  interpolateRead?: PreflightReadFiller;
  /** Host chrome the same action also carries, drawn after the read. */
  hostChrome?: UserAssignedWorkCompanion;
}

/** What a param dialog draws beside its params; absent = nothing. */
export type ParamDialogCompanion = UserAssignedWorkCompanion | PreflightCompanion;

/**
 * Judge a stored `preflight` block with the spec's own `ActionSchema`
 * (objectstack#31808). The block is parsed on a probe action carrying the
 * dispatch's params, as the keys the cross-key refusals read (the name and the
 * three other sources of a value), so the refusals the spec raises at
 * authoring time against the params are raised here too. The probe carries no
 * `execution`: the refusal beside `execution: 'aggregate'` concerns the grid's
 * bulk dialog, which these handlers never open. Only issues under `preflight`
 * count: the probe is not the action, and the spec judges the rest of it
 * elsewhere.
 */
export function judgeActionPreflight(
  preflight: unknown,
  params: readonly ActionParamDef[],
): PreflightCompanion['judged'] {
  const probe = {
    name: 'preflight_probe',
    label: 'Preflight probe',
    type: 'url',
    target: '/',
    params: params.map((param) => {
      // The runner hands over the params as stored, so a field-backed param
      // may be named by `field` and carry `defaultFromRow`, neither of which
      // `ActionParamDef` declares.
      const raw = param as ActionParamDef & { field?: unknown; defaultFromRow?: unknown };
      const name = typeof raw.name === 'string' && raw.name ? raw.name : raw.field;
      return {
        name,
        type: 'text',
        ...(raw.defaultValue !== undefined ? { defaultValue: raw.defaultValue } : {}),
        ...(raw.defaultFromRow === true ? { defaultFromRow: true } : {}),
        ...(raw.carryOver === true ? { carryOver: true } : {}),
      };
    }),
    preflight,
  };
  const parsed = ActionSchema.safeParse(probe);
  const issues = parsed.success
    ? []
    : parsed.error.issues.filter((issue) => issue.path[0] === 'preflight');
  if (issues.length > 0) {
    return { ok: false, refusal: issues.map((issue) => issue.message).join(' ') };
  }
  const block = parsed.success ? parsed.data.preflight : undefined;
  // A probe the spec refused elsewhere still answers the block as authored:
  // nothing under `preflight` was refused, so the stored block IS the parse.
  return { ok: true, preflight: (block ?? preflight) as DeclaredPreflight };
}

/**
 * The companion for a param dialog, from the object the action runs on, the
 * action's name and the row it runs on, and (`declared`) the dispatched
 * action's `preflight` block with the params and filler the runner handed the
 * handler. An action that declares `preflight` gets the declared kind, judged,
 * with any host chrome beside it; otherwise the host chrome alone. `undefined` when the action
 * carries neither, or when the ban's row names no record to describe.
 */
export function resolveParamDialogCompanion(
  objectName: string | undefined,
  actionName: string | undefined,
  row: Record<string, unknown> | undefined,
  declared?: {
    /** The dispatched action's `preflight` block, as stored. */
    preflight?: ActionDef['preflight'];
    /** The params the dialog collects, as the runner handed them over. */
    params?: readonly ActionParamDef[];
    /** The runner's `read.url` filler. */
    interpolateRead?: PreflightReadFiller;
  },
): ParamDialogCompanion | undefined {
  const hostChrome = resolveHostChrome(objectName, actionName, row);
  const preflight = declared?.preflight;
  if (preflight === undefined || preflight === null) return hostChrome;
  return {
    kind: 'preflight',
    judged: judgeActionPreflight(preflight, declared?.params ?? []),
    ...(declared?.interpolateRead ? { interpolateRead: declared.interpolateRead } : {}),
    ...(hostChrome ? { hostChrome } : {}),
  };
}

/** The host-chrome companion alone: the ban dialog's assigned-work panel. */
function resolveHostChrome(
  objectName: string | undefined,
  actionName: string | undefined,
  row: Record<string, unknown> | undefined,
): UserAssignedWorkCompanion | undefined {
  if (objectName !== USER_OBJECT || actionName !== BAN_USER_ACTION) return undefined;
  const id = row?.id;
  if ((typeof id !== 'string' || id === '') && typeof id !== 'number') return undefined;
  return { kind: 'user-assigned-work', userId: String(id) };
}
