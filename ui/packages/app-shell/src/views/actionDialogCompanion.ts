/**
 * The host-composed panel an action's param dialog shows beside its params.
 *
 * A companion is console chrome, not authored metadata: the dialog's host
 * decides it from the platform action being run, the way it composes the
 * admin-override notice (objectui#5178). Both param-collection handlers
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
 */

/** The platform object whose ban action carries the assigned-work companion. */
export const USER_OBJECT = 'sys_user';

/** The platform action, on {@link USER_OBJECT}, that bans a user. */
export const BAN_USER_ACTION = 'ban_user';

/** What a param dialog draws beside its params; absent = nothing. */
export type ParamDialogCompanion = {
  kind: 'user-assigned-work';
  /** The user the action is run on. */
  userId: string;
};

/**
 * The companion for a param dialog, from the object the action runs on, the
 * action's name and the row it runs on. `undefined` when the action carries
 * none, or when the row names no record to describe.
 */
export function resolveParamDialogCompanion(
  objectName: string | undefined,
  actionName: string | undefined,
  row: Record<string, unknown> | undefined,
): ParamDialogCompanion | undefined {
  if (objectName !== USER_OBJECT || actionName !== BAN_USER_ACTION) return undefined;
  const id = row?.id;
  if ((typeof id !== 'string' || id === '') && typeof id !== 'number') return undefined;
  return { kind: 'user-assigned-work', userId: String(id) };
}
