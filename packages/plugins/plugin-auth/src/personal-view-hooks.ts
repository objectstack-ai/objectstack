// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write rule of `sys_personal_view`, a reader's own named list views
 * (ruling 6570568131 on #28971, letter C; the object's own docblock in
 * `@objectstack/platform-objects` says what the row is and is not).
 *
 * **The body is spec's `ListView` for the row's own object, judged on every
 * save.** A create, and an update that sends `config` or `object_name`, parse
 * the resulting body with `ListViewSchema` — the same schema a package's list
 * view is authored against — and a body that does not parse is refused with
 * `400 VALIDATION_FAILED` and one `fields[]` entry per issue, each path under
 * `config`. A body whose data source names an object (`data.object`) must name
 * the row's `object_name`: a view saved for one object never lists another
 * (`config.data.object`, code `object_mismatch`). Nothing is coerced or kept
 * half: a stored view is always one the list renderer can read for its own
 * object. A field the reader cannot read is NOT judged here: the existing
 * predicate guard refuses that filter when the list is queried, so this rule
 * does not grow a second copy of field security.
 *
 * **The owner is fixed when the view is saved.** An update that sends a
 * `user_id` other than the stored one is refused `403 PERMISSION_DENIED`, for
 * every caller but the system. The row scope alone does not hold this: for an
 * organization member, `member_default`'s `'*'` update floor
 * (`created_by == current_user.id`) is a held update policy, so the object's
 * declared default does not apply to an update, and the post-image of a
 * re-parent still carries the member's own `created_by`.
 *
 * Which view opens by default is not this object's: the reader's existing
 * per-object pin holds a view id (seat ruling 6587007982 on #29443).
 *
 * Registered by every plugin that registers the object (`AuthPlugin`, and
 * `IdentityObjectsPlugin` on a kernel without it), so the rule travels with the
 * table.
 */

import { ListViewSchema } from '@objectstack/spec/ui';
import { zodIssuesToFields } from '@objectstack/spec/api';
import { validationFailure } from '@objectstack/types';

/** The object these hooks guard. */
export const PERSONAL_VIEW_OBJECT = 'sys_personal_view';

/** The column holding the `ListView` body. */
const CONFIG_FIELD = 'config';

export interface PersonalViewHooksOptions {
  packageId: string;
  logger?: { info(msg: string): void };
}

/** A JSON column can arrive as text (a driver round trip, a form post): read it as JSON. */
function asJsonValue(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof value !== 'string') return { ok: true, value };
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

/**
 * Refuse a `config` that is not a `ListView`, or whose data source names an
 * object other than `objectName` (when one is known); return silently when it
 * is a `ListView` for that object.
 */
export function assertPersonalViewConfig(config: unknown, objectName?: unknown): void {
  const json = asJsonValue(config);
  if (!json.ok) {
    throw validationFailure(
      'The personal view\'s configuration is not valid JSON. Send the list configuration as a JSON object in spec\'s ListView shape.',
      [{ field: CONFIG_FIELD, code: 'invalid_json', message: 'Expected a JSON object in the ListView shape.' }],
    );
  }
  const parsed = ListViewSchema.safeParse(json.value);
  if (parsed.success) {
    const data = (parsed.data as { data?: { object?: unknown } }).data;
    const named = data && typeof data === 'object' ? data.object : undefined;
    if (typeof named === 'string' && typeof objectName === 'string' && objectName !== '' && named !== objectName) {
      throw validationFailure(
        `The personal view's configuration lists '${named}', but the view is saved for '${objectName}'. ` +
          'A personal view lists the object it is saved for: make `config.data.object` and `object_name` the same.',
        [{ field: `${CONFIG_FIELD}.data.object`, code: 'object_mismatch', message: `Expected '${objectName}'.` }],
      );
    }
    return;
  }
  const fields = zodIssuesToFields(parsed.error.issues, json.value).map((f) => ({
    ...f,
    field: f.field === '(body)' ? CONFIG_FIELD : `${CONFIG_FIELD}.${f.field}`,
  }));
  throw validationFailure(
    'The personal view\'s configuration is not a valid ListView. Fix the fields listed in `fields` and save again.',
    fields,
  );
}

/** The string form two stored ids are compared by (an echo of the stored owner is no change). */
function sameId(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  return norm(a) === norm(b);
}

/** The refusal for an update that would hand a view to another user: `PERMISSION_DENIED` / `403`. */
export function ownerChangeError(id: unknown): Error {
  const err = new Error(
    `Personal view ${String(id ?? '')} was not changed: a view's owner (user_id) is fixed when the view is saved, `
      + 'and nobody can hand a view to another user. Save a new view in that user\'s name instead. The view is unchanged.',
  ) as Error & { code?: string; status?: number };
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  return err;
}

const sets = (data: Record<string, unknown> | null | undefined, key: string): boolean =>
  !!data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, key);

/**
 * Register the rule on an ObjectQL engine. Re-binding after hot reload
 * follows the engine's standard contract: `engine.unregisterHooksByPackage(packageId)` first.
 */
export function registerPersonalViewHooks(engine: any, opts: PersonalViewHooksOptions): void {
  const validateOnInsert = async (ctx: any): Promise<void> => {
    if (ctx?.object !== PERSONAL_VIEW_OBJECT) return;
    const data = ctx.input?.data as Record<string, unknown> | undefined;
    // An absent body is the required-field rule's to refuse, with its own envelope.
    if (!sets(data, CONFIG_FIELD) || data![CONFIG_FIELD] === null || data![CONFIG_FIELD] === undefined) return;
    assertPersonalViewConfig(data![CONFIG_FIELD], data!.object_name);
  };
  const validateOnUpdate = async (ctx: any): Promise<void> => {
    if (ctx?.object !== PERSONAL_VIEW_OBJECT) return;
    const data = ctx.input?.data as Record<string, unknown> | undefined;
    // The row as it will be: what the write sends, over what is stored
    // (`ctx.previous`, present on the by-id path and per row on a multi-row update).
    const previous = (ctx.previous ?? undefined) as Record<string, unknown> | undefined;
    if (
      ctx?.session?.isSystem !== true
      && sets(data, 'user_id')
      && previous
      && !sameId(data!.user_id, previous.user_id)
    ) {
      throw ownerChangeError(previous.id ?? ctx.input?.id);
    }
    const sendsConfig = sets(data, CONFIG_FIELD);
    if (!sendsConfig && !sets(data, 'object_name')) return;
    const config = sendsConfig ? data![CONFIG_FIELD] : previous?.[CONFIG_FIELD];
    const objectName = sets(data, 'object_name') ? data!.object_name : previous?.object_name;
    if (sendsConfig || (config !== null && config !== undefined)) assertPersonalViewConfig(config, objectName);
  };

  engine.registerHook('beforeInsert', validateOnInsert, { object: PERSONAL_VIEW_OBJECT, packageId: opts.packageId });
  engine.registerHook('beforeUpdate', validateOnUpdate, { object: PERSONAL_VIEW_OBJECT, packageId: opts.packageId });
  opts.logger?.info(
    '[PersonalViewHooks] sys_personal_view hooks registered: a save is validated as a ListView '
      + 'for the row\'s own object, and a view\'s owner never changes',
  );
}
