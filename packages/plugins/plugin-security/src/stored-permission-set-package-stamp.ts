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
 * ## What a write keeps (ADR-0150 D3/D8, #32164)
 *
 * A writer that NAMES a package (a non-blank `permission_set_package` in its
 * payload) has said which set it means, so the seam never picks for it:
 *
 * - **the package holds the name** (a registry holder of `(permission, name)`
 *   for the reference's writer) ⇒ kept as written — even where the bare name
 *   is refused (two holders), which is how a grant of either package's set is
 *   written at all;
 * - **it does not** ⇒ refused, `409 RESOURCE_CONFLICT`, core's
 *   `PackageScopedNameRefusedError`, reason `not-held-by-qualifier`, naming
 *   every holder — at ANY holder count, never re-stamped to the holder it
 *   did not name (epic red line 1). One holder included: before #32164 such a
 *   write was re-stamped to the one holder without a word;
 * - **nothing holds the name** ⇒ kept unjudged: there is no holder to name and
 *   nothing to contradict it, and the reader reads a column naming a package
 *   that does not serve the set as no package (`storedPermissionSetScope`), so
 *   it confers nothing. A system writer may write a grant before the set it
 *   names is registered — the stand-down the grant-name hook takes.
 *
 * A writer that names none is stamped by the rule:
 *
 * - **An insert** is stamped from its name, whoever writes it. No first-party
 *   writer names a package (measured on #32164: the stamp, the boot backfill
 *   and the reviewed bind are the column's only writers).
 * - **An update** is stamped only when it changes what the reference names:
 *   the set's name, or (R3) the package that wrote it. A rename never keeps the
 *   old package. An update that touches neither is left as it is.
 *
 * An update that writes the column itself — the backfill's and the reviewed
 * bind's, which write it alone, or a rename that names its package — is judged
 * as above when a SYSTEM writer sends it. A value equal to the one the row
 * already stores is an echo (a whole-row write), not a choice, and is not
 * judged. A non-system caller's value of the
 * `readonly` column is stripped by the engine after the before-phase, so the
 * seam neither judges nor keeps it: a non-system update is stamped by the rule.
 *
 * Before the holders are sealed nothing is judged: a named package is kept as
 * written (a stale one reads as no package), and a name with none is left null.
 *
 * A suggestion (R3) names a package for the package that suggested it, so the
 * package it names must be in that package's reach: itself, or a package of its
 * declared dependency closure (ADR-0141, the closure the rule reads the
 * suggestion's name in). A holder outside that reach is refused,
 * `outside-closure`, naming the holder (epic review 6735731423: such a
 * suggestion is never bound).
 *
 * ## One grant of a set per user and organization (#32164)
 *
 * The grant's declared key is `(user_id, permission_set,
 * permission_set_package, organization_id)`, so one user may hold two
 * packages' sets of one name, and the package-less guard keeps grants that
 * name no package to one per `(user_id, permission_set, organization_id)`.
 * Neither index sees a grant beside another of the same user, set and
 * organization when one of the two names no package, or names a package that
 * does not hold the name: the key the grant had before #32164,
 * `(user_id, permission_set, organization_id)`, refused every such second row.
 * So this seam refuses it, once the column is stamped: a grant write that
 * leaves a row of the same `(user_id, permission_set, organization_id)` beside
 * another is refused unless the two rows name two DIFFERENT packages that each
 * hold the name (the one pair the wider key exists to admit). The refusal is
 * the one the old key's database answered through the engine: the engine's
 * duplicate-record envelope (`DuplicateRecordError`, `code`
 * `DUPLICATE_RECORD`, `status` `409`, the same user-facing sentence naming the
 * object by its declared label), which every HTTP door reports as `409`
 * `UNIQUE_VIOLATION`, "A record with this value already exists". It is built
 * here in that shape, the seam's own diagnosis on `cause`, because this
 * package does not depend on the engine at runtime.
 * Read under the system context, in the writer's transaction. A write with no
 * organization on the row and none in its session is not judged here (the
 * driver fills the organization after this phase), and a write made below the
 * engine, two writes racing, or two rows of one batch insert, are held by the
 * two indexes alone.
 *
 * The check runs at priority 50, after every refusal of the grant table's
 * hooks (30, 35, 40, 45), which keep their answer as while the store's key
 * answered last; and it steps aside, as they do, on a holder a non-system
 * write NAMES that the caller's own read door does not return, which the
 * engine's reference check answers as a user that does not exist (#29029,
 * `holderLeftToReferenceCheck`). Record validation runs after every hook, so a
 * second grant it would also refuse is answered here (declared).
 */

import { PackageScopedNameRefusedError, packageScopedRefusalMessage, type PackageScopedHolder } from '@objectstack/core';
import { packageResolutionClosure } from '@objectstack/metadata-core';
import { isPlainRecord } from '@objectstack/spec/data';
import { holderLeftToReferenceCheck } from './grant-holder-membership-refusal.js';
import {
  GRANT_HOLDER_COLUMN as GRANT_HOLDER,
  GRANT_OBJECT,
  GRANT_ORGANIZATION_COLUMN as GRANT_ORGANIZATION,
  grantKeyOf as keyOf,
  isPermissionSetHolderRegistry,
  isSecondGrant,
  otherGrantsOf,
  permissionSetHolderOf,
  sealedPackageHoldersOf,
  STORED_PERMISSION_SET_REFERENCES,
  type StoredPermissionSetReference,
} from './stored-permission-set-package-backfill.js';

/** The `packageId` both hooks register under, so they bind and unbind as one. */
export const PERMISSION_SET_PACKAGE_STAMP_HOOK_PACKAGE = 'plugin-security:permission-set-package-stamp';

/** After the grant-name refusals (priority 30): a refused write is never stamped. */
const HOOK_PRIORITY = 40;

/** The one-grant check: after the agent-account refusal (45), before the default-priority hooks (module doc). */
const ONE_GRANT_HOOK_PRIORITY = 50;

interface StampEngine {
  registry?: unknown;
  getSchema?: (object: string) => unknown;
  registerHook?: (
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ) => void;
  unregisterHooksByPackage?: (packageId: string) => number;
  find?: (object: string, query?: any) => Promise<unknown>;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** A non-blank string, trimmed; anything else names nothing. */
const named = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v === '' ? null : v;
};

/** The registry's holder reads, once its bare-name holders are sealed; `undefined` before that, or without them. */
function sealedHolderRegistry(engine: StampEngine) {
  const registry = engine.registry;
  if (!isPermissionSetHolderRegistry(registry)) return undefined;
  if ((registry as { bareNameHoldersAreSealed?: unknown }).bareNameHoldersAreSealed !== true) return undefined;
  return registry;
}

/**
 * The package to stamp for `name` written by `caller` (`null`: no package), or
 * `null`: no package holds it for that caller, or the holders are not sealed
 * yet (module doc).
 */
function stampFor(engine: StampEngine, name: string, caller: string | null): string | null {
  const registry = sealedHolderRegistry(engine);
  if (!registry) return null;
  const holder = permissionSetHolderOf(registry)(name, caller);
  return holder.kind === 'package' ? holder.packageId : null;
}

/**
 * [#32164] Judge a package a writer named beside `name` (module doc, "What a
 * write keeps"): returns when it is kept, throws the `not-held-by-qualifier`
 * refusal naming every holder when it is not.
 */
function assertNamedPackageHolds(engine: StampEngine, name: string, named: string, caller: string | null): void {
  const registry = sealedHolderRegistry(engine);
  if (!registry) return;
  const packageHolders = registry.packageScopedHoldersOf('permission', name, caller) ?? [];
  if (packageHolders.includes(named)) {
    // A suggestion's package names the set for the package that suggested it:
    // a holder outside that package's reach is never bound (module doc).
    if (caller === null || named === caller || packageResolutionClosure(registry, caller).has(named)) return;
    const outside = {
      status: 'refused' as const,
      reason: 'outside-closure' as const,
      type: 'permission' as const,
      name,
      callerPackageId: caller,
      candidates: [{ kind: 'package' as const, packageId: named }],
    };
    throw new PackageScopedNameRefusedError({ ...outside, message: packageScopedRefusalMessage(outside) });
  }
  const candidates: PackageScopedHolder[] = packageHolders.map((packageId) => ({ kind: 'package' as const, packageId }));
  if (registry.getEnvironmentScopedItem('permission', name) !== undefined) candidates.push({ kind: 'environment' });
  if (candidates.length === 0) return;
  const refusal = {
    status: 'refused' as const,
    reason: 'not-held-by-qualifier' as const,
    type: 'permission' as const,
    name,
    callerPackageId: named,
    candidates,
  };
  throw new PackageScopedNameRefusedError({ ...refusal, message: packageScopedRefusalMessage(refusal) });
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

/**
 * The refusal the grant's key before #32164 answered for a second grant of
 * one user, set and organization: the engine's duplicate-record envelope
 * (module doc, "One grant of a set per user and organization"). `label` is
 * the object's declared label, the name the user-facing sentence uses.
 */
function secondGrantRefusal(object: string, label: string | null): Error {
  // The seam's diagnosis. Its sentence is one the platform's unique-violation
  // predicate (`isUniqueViolationError`, `@objectstack/types`) reads, so a
  // caller that asks it of the refusal gets the answer the store's own
  // violation gave.
  const cause = new Error(
    `Unique violation on \`${object}\`, refused by the one-grant check: this user already holds this permission set ` +
      'in this organization through another grant, and the two do not name two different packages that each hold it.',
  );
  const err = new Error(
    `Duplicate record refused on '${label ?? object}': a unique constraint already holds these values. No record was written.`,
  );
  err.name = 'DuplicateRecordError';
  return Object.assign(err, {
    code: 'DUPLICATE_RECORD',
    status: 409,
    httpStatus: 409,
    object,
    cause,
    developerMessage:
      `Duplicate record refused on object '${object}'. ${cause.message} Branch on the platform code (ADR-0112): ` +
      `over the HTTP API this refusal is reported as \`code === 'UNIQUE_VIOLATION'\`; inside the engine the thrown ` +
      `error carries \`code === 'DUPLICATE_RECORD'\`.`,
  });
}

/** The object's declared label, when its schema declares one. */
function labelOf(engine: StampEngine, object: string): string | null {
  try {
    const schema = engine.getSchema?.(object) as { label?: unknown } | undefined;
    return named(schema?.label);
  } catch {
    return null;
  }
}

/**
 * [#32164] Refuse a grant row `image` (`id`: the row an update writes) that
 * would stand beside another grant of the same user, set and organization,
 * unless the two name two different packages that each hold the name (module
 * doc, "One grant of a set per user and organization").
 */
async function assertOneGrantPerSet(
  engine: StampEngine,
  reference: StoredPermissionSetReference,
  ctx: any,
  image: Record<string, unknown>,
  id: string | null,
): Promise<void> {
  const user = keyOf(image[GRANT_HOLDER]);
  const name = named(image[reference.nameColumn]);
  const organization = keyOf(image[GRANT_ORGANIZATION]) ?? keyOf(ctx?.session?.organizationId);
  if (user === null || name === null || organization === null) return;
  const others = await otherGrantsOf(engine, reference, { user, name, organization, id }, ctx?.transaction);
  if (!isSecondGrant(others, reference.packageColumn, image[reference.packageColumn], sealedPackageHoldersOf(engine.registry, name))) return;
  throw secondGrantRefusal(reference.object, labelOf(engine, reference.object));
}

/** A holder a non-system write names that the caller cannot read: the engine's reference check answers it (module doc). */
async function holderLeftToEngine(engine: StampEngine, ctx: any, holder: unknown): Promise<boolean> {
  if (ctx?.session?.isSystem === true) return false;
  // The holder's id as written: the reading the grant table's other hooks share.
  return keyOf(holder) !== null && (await holderLeftToReferenceCheck(engine, ctx, holder, String(holder)));
}

/** The one-grant check of an insert (module doc, "One grant of a set per user and organization"). */
async function oneGrantOnInsert(engine: StampEngine, reference: StoredPermissionSetReference, ctx: any): Promise<void> {
  if (ctx?.object !== GRANT_OBJECT || reference.object !== GRANT_OBJECT) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data) || !declaresColumn(engine, reference)) return;
  if (await holderLeftToEngine(engine, ctx, data[GRANT_HOLDER])) return;
  // A row whose own id the store already holds is the store's own refusal, not a second grant.
  await assertOneGrantPerSet(engine, reference, ctx, data, keyOf(data.id));
}

/** The one-grant check of an update (module doc). */
async function oneGrantOnUpdate(engine: StampEngine, reference: StoredPermissionSetReference, ctx: any): Promise<void> {
  if (ctx?.object !== GRANT_OBJECT || reference.object !== GRANT_OBJECT) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data) || !declaresColumn(engine, reference)) return;
  const previous = isPlainRecord(ctx?.previous) ? ctx.previous : {};
  const system = ctx?.session?.isSystem === true;
  // Only a holder the payload NAMES anew: the reference check forgives one the row already stores.
  if (hasOwn(data, GRANT_HOLDER) && keyOf(data[GRANT_HOLDER]) !== keyOf(previous[GRANT_HOLDER])
    && (await holderLeftToEngine(engine, ctx, data[GRANT_HOLDER]))) return;
  const renamed = hasOwn(data, reference.nameColumn)
    && named(data[reference.nameColumn]) !== named(previous[reference.nameColumn]);
  // The package the row stores after the write: a system writer's value; a
  // re-name's stamp; otherwise the stored one (a non-system caller's value of
  // the readonly column is stripped after the before-phase).
  const pkg = (system || renamed) && hasOwn(data, reference.packageColumn)
    ? data[reference.packageColumn]
    : previous[reference.packageColumn];
  const image: Record<string, unknown> = { ...previous, ...data, [reference.packageColumn]: pkg };
  const moved = [GRANT_HOLDER, reference.nameColumn, GRANT_ORGANIZATION]
    .some((column) => keyOf(image[column]) !== keyOf(previous[column]))
    || named(pkg) !== named(previous[reference.packageColumn]);
  if (!moved) return;
  await assertOneGrantPerSet(engine, reference, ctx, image, keyOf(previous.id) ?? keyOf(ctx?.input?.id));
}

/** `beforeInsert`: one dispatch per row (module doc, "What a write keeps"). */
function onInsert(engine: StampEngine, reference: StoredPermissionSetReference, ctx: any): void {
  if (ctx?.object !== reference.object) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  const name = named(data[reference.nameColumn]);
  if (name === null || !declaresColumn(engine, reference)) return;
  const writer = writerOf(reference, data);
  const chosen = named(data[reference.packageColumn]);
  if (chosen !== null) {
    // [#32164] The writer named its package: kept when it holds the name,
    // refused when it does not — never re-stamped (module doc).
    assertNamedPackageHolds(engine, name, chosen, writer);
    data[reference.packageColumn] = chosen;
    return;
  }
  stamp(data, reference.packageColumn, stampFor(engine, name, writer));
}

/** `beforeUpdate`: one dispatch per matched row, `previous` bound (module doc). */
function onUpdate(engine: StampEngine, reference: StoredPermissionSetReference, ctx: any): void {
  if (ctx?.object !== reference.object) return;
  const data = ctx?.input?.data;
  if (!isPlainRecord(data)) return;
  const previous = isPlainRecord(ctx?.previous) ? ctx.previous : {};
  // [#32164] Only a system writer's value of the readonly column is stored;
  // a non-system caller's is stripped after this phase (module doc). An echo
  // of the stored value (a whole-row write) chooses nothing new.
  const sent = ctx?.session?.isSystem === true && hasOwn(data, reference.packageColumn)
    ? named(data[reference.packageColumn])
    : null;
  const chosen = sent !== null && sent !== named(previous[reference.packageColumn]) ? sent : null;
  const touchesName = hasOwn(data, reference.nameColumn)
    && named(data[reference.nameColumn]) !== named(previous[reference.nameColumn]);
  const touchesWriter = reference.callerColumn !== undefined && hasOwn(data, reference.callerColumn)
    && named(data[reference.callerColumn]) !== named(previous[reference.callerColumn]);
  if ((chosen === null && !touchesName && !touchesWriter) || !declaresColumn(engine, reference)) return;
  const after = { ...previous, ...data };
  const name = named(after[reference.nameColumn]);
  if (chosen !== null) {
    // A system writer naming the package — the reviewed bind, the backfill,
    // a rename that says which set it means — is judged, never re-stamped.
    if (name !== null) assertNamedPackageHolds(engine, name, chosen, writerOf(reference, after));
    return;
  }
  if (!touchesName && !touchesWriter) return;
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
    if (reference.object !== GRANT_OBJECT) continue;
    // [#32164] The one-grant check, after the grant table's refusals (module doc).
    const oneGrant = { ...options, priority: ONE_GRANT_HOOK_PRIORITY };
    engine.registerHook('beforeInsert', (ctx: any) => oneGrantOnInsert(engine, reference, ctx), oneGrant);
    engine.registerHook('beforeUpdate', (ctx: any) => oneGrantOnUpdate(engine, reference, ctx), oneGrant);
  }
  return true;
}

/** Unbind the seam (plugin teardown). */
export function unregisterPermissionSetPackageStamp(engine: StampEngine | null | undefined): void {
  if (engine && typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(PERMISSION_SET_PACKAGE_STAMP_HOOK_PACKAGE);
  }
}
