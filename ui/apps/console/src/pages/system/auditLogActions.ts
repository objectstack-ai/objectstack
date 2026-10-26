/**
 * The Audit Log's `sys_audit_log.action` helpers (the Action filter's choices
 * and the action badge's tone), split into their own module — rather than
 * living inline in AuditLogPage.tsx — so they can be imported by tests
 * without pulling a component export into a non-component file (React Fast
 * Refresh wants component files to only export components).
 *
 * Nothing here names the actions the filter offers (objectui#13175). The
 * choices are `sys_audit_log.action`'s declared options, read from the object
 * document the console's metadata serves — the same `useMetadata().objects`
 * read the page's presets and Object filter draw from. The filter used to be a
 * hand-kept list that claimed to mirror the server's declaration and had
 * fallen behind it: actions the server declares and writes (`read`,
 * `platform_admin_standing_change`, `login_failed`, `account_locked`) could
 * not be picked. Declaring an action on the server is now all it takes to
 * offer it.
 */

/** One choice of the Action filter. */
export interface ActionFilterOption {
  /** The stored action, which the list fetch matches exactly. */
  value: string;
  /** The option's label as the server declares it. */
  label: string;
}

/**
 * The Action filter's choices: `sys_audit_log.action`'s declared `options`, in
 * declared order, each valued by its stored value and labelled as declared.
 *
 * `objectDef` is the served `sys_audit_log` document, or `undefined` while the
 * metadata has not answered. No declared options means no choices: the
 * filter then offers only "All actions", never a list of its own.
 *
 * An option with no value is skipped, because a select item cannot carry an
 * empty value. A blank label falls back to the value, so no choice renders
 * empty.
 */
export function actionFilterOptionsOf(objectDef: unknown): ActionFilterOption[] {
  const fields = (objectDef as { fields?: unknown } | null | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return [];
  const action = (fields as Record<string, unknown>).action as { options?: unknown } | null | undefined;
  if (!action || typeof action !== 'object' || !Array.isArray(action.options)) return [];
  const options: ActionFilterOption[] = [];
  for (const raw of action.options) {
    const option = raw as { value?: unknown; label?: unknown } | null | undefined;
    if (!option || typeof option.value !== 'string' || !option.value) continue;
    const label = typeof option.label === 'string' && option.label.trim() ? option.label : option.value;
    options.push({ value: option.value, label });
  }
  return options;
}

export type ActionBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/**
 * Local badge tones for the actions that have one. This is a lookup, not a
 * list of actions: an action it does not name — any action the server
 * declares later included — gets the neutral `outline` badge from
 * `actionBadgeVariant`, never a hidden row or a dropped option.
 */
const ACTION_VARIANT: Readonly<Record<string, ActionBadgeVariant>> = {
  create: 'default',
  update: 'secondary',
  delete: 'destructive',
  login: 'outline',
  logout: 'outline',
  config_change: 'secondary',
  import: 'outline',
};

/** The badge tone for a row's action: its local tone, else the neutral `outline`. */
export function actionBadgeVariant(action: string | null | undefined): ActionBadgeVariant {
  return action && Object.prototype.hasOwnProperty.call(ACTION_VARIANT, action) ? ACTION_VARIANT[action] : 'outline';
}
