/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32770 — which package's permission set a `permission-ref` pick
 * addresses when more than one package holds the set's name (objectstack
 * ADR-0150 D3/D4/D8).
 *
 * A permission set is identified by `(package, name)`, and `GET
 * /api/v1/meta/permission` serves one item per `(package, name)` plus the
 * environment's own set, each with the package that holds it (`_packageId`,
 * carried to this package as `RegistryItemHeader.packageId`). A name one
 * holder serves is addressed by the name alone. A name more than one holder
 * serves is addressed by the name and the holder's package, except the
 * environment's own set, which a reference naming no package reaches.
 *
 * These are the holder readings the widget needs, read by the rule the server
 * reads a stored grant with (core's `storedPermissionSetScope`). They are a
 * local copy of the same readings the Setup and Studio permission-set pages
 * make (`@object-ui/app-shell`, objectstack#32537), kept here because this
 * package sits below the shell and cannot import it.
 */

/**
 * The `_packageId` a definition rehydrated from `sys_metadata` carries: the
 * environment's own item, not a package (core's `catalogEntryAddress` reads it
 * the same way).
 */
export const OVERLAY_PROVENANCE_SENTINEL = 'sys_metadata';

/** A holder of a name: a package id, or `null` for the environment's own set. */
export type PermissionSetHolder = string | null;

/** A served or stored package id as the server reads it: empty and the overlay sentinel are no package. */
export function holderPackageOf(packageId: unknown): PermissionSetHolder {
  return typeof packageId === 'string' && packageId.trim() !== '' && packageId !== OVERLAY_PROVENANCE_SENTINEL
    ? packageId
    : null;
}

/** The environment's own set first, then packages by id: a stable order among one name's holders. */
export function holderOrder(a: PermissionSetHolder, b: PermissionSetHolder): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.localeCompare(b);
}

/**
 * The holders a reference to a name reaches, read as the resolver reads a
 * stored grant (ADR-0150 D8 R1): a package that holds the name is that
 * holder; no package, or one that no longer serves the name, is read as a
 * caller with no package — the environment's own set when it holds the name,
 * else the one holder, else nothing (a name two packages hold, named by no
 * package, grants nothing).
 */
export function storedGrantHolders(
  rowPackage: PermissionSetHolder,
  holders: readonly PermissionSetHolder[],
): PermissionSetHolder[] {
  if (rowPackage !== null && holders.includes(rowPackage)) return [rowPackage];
  if (holders.includes(null)) return [null];
  return holders.length === 1 ? [...holders] : [];
}

/**
 * The package a write must name to address `holder`'s set of a name held by
 * `holders`: `undefined` when the name alone addresses it (one holder, or the
 * environment's own set), else `holder`.
 */
export function addressingPackageOf(
  holders: readonly PermissionSetHolder[],
  holder: PermissionSetHolder,
): string | undefined {
  if (holder === null || holders.length <= 1) return undefined;
  return holder;
}

/**
 * [ADR-0150 D8 row R1] The grant table's two columns for one reference: the
 * permission set's name, and beside it the package that holds it (ADR-0126 §4:
 * two facts, two columns). The server's own declaration of the pair is
 * plugin-security's `STORED_PERMISSION_SET_REFERENCES` row R1.
 *
 * The package column is declared `readonly`: a non-system UPDATE's value is
 * stripped and the column re-stamped by the rule, so only an INSERT can name
 * the holder (the stamp hook keeps a named package that holds the name and
 * refuses one that does not with `409 RESOURCE_CONFLICT`). So a form writes
 * it on a create only — the record form's renderer hands this widget its
 * sibling writer on a create form alone, and the record form's write payload
 * keeps the column only on a create, only for this object
 * (`@object-ui/plugin-form`'s `createHolderPackagePayload`).
 */
export const PERMISSION_SET_GRANT_COLUMNS = Object.freeze({
  object: 'sys_user_permission_set',
  nameField: 'permission_set',
  packageField: 'permission_set_package',
});

/**
 * The sibling column that stores the holder of the set a `permission-ref`
 * field names, or `null` where the target has none. Only the grant's name
 * column has one; an action param (`create_user`'s `permissionSet`, the group
 * mappings') names a set by its name alone.
 */
export function holderPackageFieldOf(fieldName: unknown): string | null {
  return fieldName === PERMISSION_SET_GRANT_COLUMNS.nameField ? PERMISSION_SET_GRANT_COLUMNS.packageField : null;
}
