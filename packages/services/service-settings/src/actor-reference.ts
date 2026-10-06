// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { renderValidationMessage } from '@objectstack/spec/system';
import { validationFailure } from '@objectstack/types';

/** The object every user reference below targets. */
export const USER_OBJECT = 'sys_user';

/**
 * Reads one `sys_user` row by id under the explicit system opt-in. Resolves
 * with the row, or with nothing when there is none. Throws when the read could
 * not run.
 */
export type UserProbe = (id: string) => Promise<unknown>;

/** The field a reference is written into, and its declared label. */
export interface UserReferenceField {
  object: string;
  field: string;
  /** The field's label as registered, or as declared when no schema is reachable. */
  label: string;
}

/**
 * [#21913] The dangling-user refusal, kept at the producer.
 *
 * `SettingsService.upsertRow`'s insert (`sys_setting.user_id`) and the
 * setting-audit write (`sys_setting_audit.actor_id`) carry the explicit system
 * opt-in, and the engine skips its referential-integrity check for an
 * `isSystem` write (`ObjectQL.assertReferencesResolve`; row 23 of the
 * `isSystem` census page). Before the opt-in both ran with no context, so a
 * user reference naming no `sys_user` row was REFUSED. A settings row or an
 * audit entry pointing at a user nobody can resolve is the wrong direction for
 * this lane, so the check the engine no longer runs is run here, with the
 * engine's own answer, before the write:
 *
 *  - the same probe: one `sys_user` read by id under the elevated context the
 *    engine's probe used for a context-less write;
 *  - the same verdict: refuse only when the probe RAN and found nothing. A
 *    probe that cannot run lets the write through, as the engine's fail-open
 *    does;
 *  - the same answer: `VALIDATION_FAILED` carrying one `reference_not_found`
 *    finding on the field, rendered from the same catalog entry and the
 *    field's label. It is built by `validationFailure` (`@objectstack/types`),
 *    the shared constructor for the shape every door serves as
 *    `400 VALIDATION_FAILED`, so this package stamps no code of its own. The
 *    differential pin holds it equal to the engine's refusal over a real
 *    engine.
 *
 * A write that names no user (`null`, `undefined`, `''`) is unchanged: the
 * engine never checked an empty reference either.
 */
export async function assertUserReferenceResolves(
  probe: UserProbe,
  ref: UserReferenceField,
  value: unknown,
): Promise<void> {
  if (value === null || value === undefined || value === '' || typeof value === 'object') return;
  let found: unknown;
  try {
    found = await probe(String(value));
  } catch {
    return;
  }
  if (found) return;
  const constraint = { target: USER_OBJECT };
  const message = renderValidationMessage({
    messageKey: 'reference_not_found',
    label: ref.label,
    field: ref.field,
    params: { ...constraint, value: String(value) },
  });
  throw validationFailure(message, [
    { field: ref.field, code: 'reference_not_found', message, label: ref.label, constraint, value: String(value) },
  ]);
}

/**
 * The label the engine would name `field` by: the registered schema's, when the
 * engine exposes one, else the label the object declares.
 */
export function registeredLabel(engine: unknown, ref: Omit<UserReferenceField, 'label'>, declared: string): string {
  const def = (engine as { getSchema?: (name: string) => { fields?: Record<string, { label?: string }> } | undefined })
    ?.getSchema?.(ref.object)?.fields?.[ref.field];
  const label = def?.label?.trim();
  return label && label.length > 0 ? label : declared;
}
