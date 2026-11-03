// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The owner of a per-user row is fixed when the row is saved.** The one
 * spelling of that rule, shared by `sys_personal_view`
 * (`personal-view-hooks.ts`) and `sys_user_preference`
 * (`user-preference-hooks.ts`), whose owner column is `user_id`.
 *
 * An update that sends an owner other than the stored one is refused
 * `403 PERMISSION_DENIED`, for every caller but the system: a member, an
 * organization administrator and a platform administrator alike. An echo of
 * the stored owner is no change, and saves.
 *
 * A save rule is the one place that judges the CHANGE of owner; why the row
 * scope alone does not is row 26c of `content/docs/permissions/system-context.mdx`.
 *
 * The refusal names the row and the owner column, and never the id the write
 * sent.
 */

/** The string form two stored ids are compared by (an echo of the stored owner is no change). */
function sameId(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  return norm(a) === norm(b);
}

const sets = (data: unknown, key: string): boolean =>
  !!data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, key);

/**
 * Whether a `beforeUpdate` hook context is a non-system write handing a row to
 * another owner: it sends `ownerField` with a value other than the stored one
 * (`ctx.previous`, present on the by-id path and per row on a multi-row
 * update). A system write is never one: the platform's own writers are
 * trusted to mean it.
 */
export function isOwnerChange(ctx: any, ownerField = 'user_id'): boolean {
  if (ctx?.session?.isSystem === true) return false;
  const data = ctx?.input?.data;
  const previous = ctx?.previous;
  if (!sets(data, ownerField) || !previous || typeof previous !== 'object') return false;
  return !sameId((data as Record<string, unknown>)[ownerField], (previous as Record<string, unknown>)[ownerField]);
}

/** How a refusal names the row it guards. */
export interface OwnerFixedSubject {
  /** The row's kind as a sentence starts it: `Personal view`, `User preference`. */
  label: string;
  /** The row's kind inside a sentence: `view`, `preference`. */
  noun: string;
}

/** The refusal for an update that would hand a row to another user: `PERMISSION_DENIED` / `403`. */
export function ownerFixedError(subject: OwnerFixedSubject, id: unknown, ownerField = 'user_id'): Error {
  const { label, noun } = subject;
  const err = new Error(
    `${label} ${String(id ?? '')} was not changed: a ${noun}'s owner (${ownerField}) is fixed when the ${noun} is saved, `
      + `and nobody can hand a ${noun} to another user. Save a new ${noun} in that user's name instead. `
      + `The ${noun} is unchanged.`,
  ) as Error & { code?: string; status?: number };
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  return err;
}

/** Throw {@link ownerFixedError} when {@link isOwnerChange} holds for `ctx`. */
export function assertOwnerUnchanged(ctx: any, subject: OwnerFixedSubject, ownerField = 'user_id'): void {
  if (isOwnerChange(ctx, ownerField)) {
    throw ownerFixedError(subject, ctx?.previous?.id ?? ctx?.input?.id, ownerField);
  }
}
