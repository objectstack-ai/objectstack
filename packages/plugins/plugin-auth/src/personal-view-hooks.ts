// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two write rules of `sys_personal_view`, a reader's own named list views
 * (ruling 6570568131 on #28971, letter C; the object's own docblock in
 * `@objectstack/platform-objects` says what the row is and is not).
 *
 * 1. **The body is spec's `ListView`, judged on every save.** A create, and an
 *    update that sends `config`, parse it with `ListViewSchema` — the same
 *    schema a package's list view is authored against — and a body that does
 *    not parse is refused with `400 VALIDATION_FAILED` and one `fields[]`
 *    entry per issue, each path under `config`. Nothing is coerced or kept
 *    half: a stored view is always one the list renderer can read. A field the
 *    reader cannot read is NOT judged here: the existing predicate guard
 *    refuses that filter when the list is queried, so this rule does not grow
 *    a second copy of field security.
 * 2. **At most one default per owner and object.** A write that makes a row
 *    the owner's default (`is_default: true`) clears the flag on the owner's
 *    other rows for the same object, inside the same write — the shape the
 *    console's existing "set as default" gesture already has for saved views
 *    (clear the others, then set this one), moved to the server so two tabs
 *    cannot leave two defaults. The clear runs through the hook's own scoped
 *    API, so it reaches only rows the writer may write: the owner's own, inside
 *    the organization wall.
 *
 * Registered by every plugin that registers the object (`AuthPlugin`, and
 * `IdentityObjectsPlugin` on a kernel without it), so the rules travel with the
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

/** Refuse a `config` that is not a `ListView`; return silently when it is one. */
export function assertPersonalViewConfig(config: unknown): void {
  const json = asJsonValue(config);
  if (!json.ok) {
    throw validationFailure(
      'The personal view\'s configuration is not valid JSON. Send the list configuration as a JSON object in spec\'s ListView shape.',
      [{ field: CONFIG_FIELD, code: 'invalid_json', message: 'Expected a JSON object in the ListView shape.' }],
    );
  }
  const parsed = ListViewSchema.safeParse(json.value);
  if (parsed.success) return;
  const fields = zodIssuesToFields(parsed.error.issues, json.value).map((f) => ({
    ...f,
    field: f.field === '(body)' ? CONFIG_FIELD : `${CONFIG_FIELD}.${f.field}`,
  }));
  throw validationFailure(
    'The personal view\'s configuration is not a valid ListView. Fix the fields listed in `fields` and save again.',
    fields,
  );
}

const sets = (data: Record<string, unknown> | null | undefined, key: string): boolean =>
  !!data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, key);

const isTrue = (v: unknown): boolean => v === true || v === 1 || v === 'true' || v === '1';

/**
 * Clear the default flag on the owner's other rows for the row's object. Reads
 * the row back through the hook's scoped API, so the owner and object are the
 * stored ones, not whatever the payload carried.
 */
async function clearOtherDefaults(ctx: any, id: unknown): Promise<void> {
  if (id === undefined || id === null || id === '') return;
  const repo = ctx.api.object(PERSONAL_VIEW_OBJECT);
  const row = await repo.findOne({ where: { id }, fields: ['id', 'user_id', 'object_name', 'is_default'] });
  if (!row || !isTrue(row.is_default)) return;
  const others: Array<{ id: unknown }> = await repo.find({
    where: { user_id: row.user_id, object_name: row.object_name, is_default: true },
    fields: ['id'],
  });
  for (const other of others) {
    if (other.id === row.id) continue;
    await repo.updateById(other.id as string, { is_default: false });
  }
}

/**
 * Register both rules on an ObjectQL engine. Re-binding after hot reload
 * follows the engine's standard contract: `engine.unregisterHooksByPackage(packageId)` first.
 */
export function registerPersonalViewHooks(engine: any, opts: PersonalViewHooksOptions): void {
  const validateOnInsert = async (ctx: any): Promise<void> => {
    if (ctx?.object !== PERSONAL_VIEW_OBJECT) return;
    const data = ctx.input?.data as Record<string, unknown> | undefined;
    // An absent body is the required-field rule's to refuse, with its own envelope.
    if (!sets(data, CONFIG_FIELD) || data![CONFIG_FIELD] === null || data![CONFIG_FIELD] === undefined) return;
    assertPersonalViewConfig(data![CONFIG_FIELD]);
  };
  const validateOnUpdate = async (ctx: any): Promise<void> => {
    if (ctx?.object !== PERSONAL_VIEW_OBJECT) return;
    const data = ctx.input?.data as Record<string, unknown> | undefined;
    if (!sets(data, CONFIG_FIELD)) return;
    assertPersonalViewConfig(data![CONFIG_FIELD]);
  };
  const keepOneDefault = async (ctx: any): Promise<void> => {
    if (ctx?.object !== PERSONAL_VIEW_OBJECT) return;
    const data = ctx.input?.data as Record<string, unknown> | undefined;
    if (!sets(data, 'is_default') || !isTrue(data!.is_default)) return;
    await clearOtherDefaults(ctx, ctx.result?.id ?? ctx.input?.id);
  };

  engine.registerHook('beforeInsert', validateOnInsert, { object: PERSONAL_VIEW_OBJECT, packageId: opts.packageId });
  engine.registerHook('beforeUpdate', validateOnUpdate, { object: PERSONAL_VIEW_OBJECT, packageId: opts.packageId });
  engine.registerHook('afterInsert', keepOneDefault, { object: PERSONAL_VIEW_OBJECT, packageId: opts.packageId });
  engine.registerHook('afterUpdate', keepOneDefault, { object: PERSONAL_VIEW_OBJECT, packageId: opts.packageId });
  opts.logger?.info(
    '[PersonalViewHooks] sys_personal_view hooks registered: a save is validated against ListView, '
      + 'and a new default clears the owner\'s other default for the same object',
  );
}
