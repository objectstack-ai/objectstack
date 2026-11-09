// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 rows R1 and R3] The write seam: every write that names a
 * permission set in `sys_user_permission_set.permission_set` (a grant, R1) or
 * `sys_audience_binding_suggestion.permission_set_name` (a suggestion, R3)
 * stamps `permission_set_package` with the package that holds the set — the
 * same column the boot backfill fills, by the same rule.
 *
 * ## Why one seam
 *
 * A grant is written from many places (the platform-admin promotion, the
 * organization-admin reconcile, Setup's grant form through the data door, the
 * identity-provider and SCIM projections, demo staff, the upgrade ceremony),
 * and every one of them knows the set's name and nothing else. So the column
 * is stamped once, here, in the engine's `beforeInsert` / `beforeUpdate`
 * phase, for every writer and every door — system writes included — rather
 * than taught to each writer.
 *
 * ## The answer, and who asks
 *
 * The one rule (`permissionSetHolderOf`, the backfill's), asked from the
 * package that wrote the reference (ADR-0150 D3): a grant is the
 * environment's row, so it is asked with no package; a suggestion is asked
 * from its own `package_id` (epic review 6735731423). A package holder is
 * stamped; the environment's own set, the platform's, a refusal (two holders,
 * or none in the caller's reach) and a miss all leave the column null — the
 * reader then resolves the row by the rule, so a refused name confers nothing
 * and is never picked, and the operator binds it after review
 * (`os migrate stored-references bind`).
 *
 * ## When it does not answer
 *
 * Before the registry seals its bare-name holders (`kernel:bootstrapped`), a
 * package of this boot can still register and change who holds a name, so an
 * answer then is one the boot can still contradict: the column is left null
 * and the boot backfill binds it once the holders are sealed. A registry
 * without the holder reads (a test stand-in) stamps nothing either.
 *
 * ## Where the column is not declared
 *
 * A composition may register either table without the column (a host's own
 * definition, a test rig's minimal one). There the seam does not touch the
 * payload at all: writing an undeclared key would turn every write of the
 * table into an unknown-field refusal. The column is read from the object's
 * registered schema on each write, so a table that gains it is stamped from
 * then on. A null answer writes the key only to replace a value the writer
 * sent; otherwise the column is left to its default.
 *
 * ## What a write keeps
 *
 * - **An insert** is stamped from its name, whoever writes it: a value the
 *   writer sent is replaced — the column is `readonly`, and what it names is
 *   what the authorization resolver reads. No writer today knows more than the
 *   name; binding a refused name is the operator's reviewed bind, an update.
 * - **An update** is stamped only when it changes what the reference names:
 *   the set's name, or (R3) the package that wrote it. A rename never keeps the
 *   old package. An update that touches neither — the backfill's and the
 *   reviewed bind's, which write the column alone — is left as it is.
 */

import { isPlainRecord } from '@objectstack/spec/data';
import {
  isPermissionSetHolderRegistry,
  permissionSetHolderOf,
  STORED_PERMISSION_SET_REFERENCES,
  type StoredPermissionSetReference,
} from './stored-permission-set-package-backfill.js';

/** The `packageId` both hooks register under, so they bind and unbind as one. */
export const PERMISSION_SET_PACKAGE_STAMP_HOOK_PACKAGE = 'plugin-security:permission-set-package-stamp';

/** After the grant-name refusals (priority 30): a refused write is never stamped. */
const HOOK_PRIORITY = 40;

interface StampEngine {
  registry?: unknown;
  getSchema?: (object: string) => unknown;
  registerHook?: (
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ) => void;
  unregisterHooksByPackage?: (packageId: string) => number;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** A non-blank string, trimmed; anything else names nothing. */
const named = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v === '' ? null : v;
};

/**
 * The package to stamp for `name` written by `caller` (`null`: no package), or
 * `null`: no package holds it for that caller, or the holders are not sealed
 * yet (module doc).
 */
function stampFor(engine: StampEngine, name: string, caller: string | null): string | null {
  const registry = engine.registry;
  if (!isPermissionSetHolderRegistry(registry)) return null;
  if ((registry as { bareNameHoldersAreSealed?: unknown }).bareNameHoldersAreSealed !== true) return null;
  const holder = permissionSetHolderOf(registry)(name, caller);
  return holder.kind === 'package' ? holder.packageId : null;
}

/** Whether the object as registered declares the package column (module doc, "Where the column is not declared"). */
function declaresColumn(engine: StampEngine, reference: StoredPermissionSetReference): boolean {
  if (typeof engine.getSchema !== 'function') return false;
  let schema: unknown;
  try {
    schema = engine.getSchema(reference.object);
  } catch {
    return false;
  }
  const fields = isPlainRecord(schema) ? schema.fields : undefined;
  return isPlainRecord(fields) && hasOwn(fields, reference.packageColumn);
}

/** Write the answer; a null one only where it replaces a value the writer sent (module doc). */
function stamp(data: Record<string, unknown>, column: string, value: string | null): void {
  if (value === null && !hasOwn(data, column)) return;
  data[column] = value;
}

/** The package that wrote the reference: R3's `package_id`, `null` for R1 (module doc). */
function writerOf(reference: StoredPermissionSetReference, row: Record<string, unknown>): string | null {
  return reference.callerColumn ? named(row[reference.callerColumn]) : null;
}

/** `beforeInsert`: one dispatch per row (module doc, "What a write keeps"). */
function onInsert(engine: StampEngine, reference: StoredPermissionSetReference, ctx: any): void {
  if (ctx?.object !== reference.object) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  const name = named(data[reference.nameColumn]);
  if (name === null || !declaresColumn(engine, reference)) return;
  stamp(data, reference.packageColumn, stampFor(engine, name, writerOf(reference, data)));
}

/** `beforeUpdate`: one dispatch per matched row, `previous` bound (module doc). */
function onUpdate(engine: StampEngine, reference: StoredPermissionSetReference, ctx: any): void {
  if (ctx?.object !== reference.object) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  const previous = isPlainRecord(ctx?.previous) ? ctx.previous : {};
  const touchesName = hasOwn(data, reference.nameColumn)
    && named(data[reference.nameColumn]) !== named(previous[reference.nameColumn]);
  const touchesWriter = reference.callerColumn !== undefined && hasOwn(data, reference.callerColumn)
    && named(data[reference.callerColumn]) !== named(previous[reference.callerColumn]);
  if ((!touchesName && !touchesWriter) || !declaresColumn(engine, reference)) return;
  const after = { ...previous, ...data };
  const name = named(after[reference.nameColumn]);
  // A rename always writes the key: the old package must not survive it.
  data[reference.packageColumn] = name === null ? null : stampFor(engine, name, writerOf(reference, after));
}

/**
 * Bind the seam on both tables. Returns `false` when the engine exposes no
 * hook registry (a test double), so the caller can say so.
 */
export function registerPermissionSetPackageStamp(engine: StampEngine | null | undefined): boolean {
  if (!engine || typeof engine.registerHook !== 'function') return false;
  for (const reference of STORED_PERMISSION_SET_REFERENCES) {
    const options = { object: reference.object, priority: HOOK_PRIORITY, packageId: PERMISSION_SET_PACKAGE_STAMP_HOOK_PACKAGE };
    engine.registerHook('beforeInsert', (ctx: any) => onInsert(engine, reference, ctx), options);
    engine.registerHook('beforeUpdate', (ctx: any) => onUpdate(engine, reference, ctx), options);
  }
  return true;
}

/** Unbind the seam (plugin teardown). */
export function unregisterPermissionSetPackageStamp(engine: StampEngine | null | undefined): void {
  if (engine && typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(PERMISSION_SET_PACKAGE_STAMP_HOOK_PACKAGE);
  }
}
