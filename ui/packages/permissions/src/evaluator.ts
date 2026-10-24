/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {
  RoleDefinition,
  ObjectPermissionConfig,
  PermissionAction,
  PermissionCheckResult,
  PermissionCondition,
} from '@object-ui/types';

interface EvaluatePermissionParams {
  roles: RoleDefinition[];
  permissions: ObjectPermissionConfig[];
  userRoles: string[];
  user: { id: string; roles: string[]; [key: string]: unknown };
  object: string;
  action: PermissionAction;
  record?: Record<string, unknown>;
  field?: string;
}

/**
 * Evaluates whether an action is permitted based on RBAC configuration.
 * Supports role inheritance, field-level, and row-level permissions.
 */
export function evaluatePermission({
  roles,
  permissions,
  userRoles,
  object,
  action,
  record,
}: EvaluatePermissionParams): PermissionCheckResult {
  const objectConfig = permissions.find((p) => p.object === object);

  // If no config exists for the object, allow by default
  if (!objectConfig) {
    return { allowed: true };
  }

  // Check public access
  if (objectConfig.publicAccess?.includes(action)) {
    return { allowed: true };
  }

  // Resolve all effective roles (including inherited)
  const effectiveRoles = resolveRoles(userRoles, roles);

  // Check role-based permissions
  for (const roleName of effectiveRoles) {
    // `roles` is declared required on `ObjectPermissionConfig`, but a config
    // reaching here from JS — or from metadata the type checker never saw —
    // can omit it, and `undefined[roleName]` is a TypeError, not a denial.
    // Reading it unguarded therefore let a malformed config crash the render
    // through every `check()` for a non-public action, which is precisely
    // what the note below forbids. Guarded, a missing `roles` grants nothing:
    // no role resolves, the loop falls through, and the function returns the
    // ordinary `allowed: false` denial. Fail-closed, and the `publicAccess`
    // early return above still answers first (objectui#4812).
    const roleConfig = objectConfig.roles?.[roleName];
    if (!roleConfig) continue;

    // `actions` is optional in practice: a role config may carry only
    // `fieldPermissions` (the field-level gate is the whole point of the
    // entry). Reading `.includes` off it unguarded threw a TypeError that
    // propagated out of `check()` and took the whole view down with it —
    // a permission *check* must never be able to crash a render
    // (objectstack#3821).
    if (roleConfig.actions?.includes(action)) {
      // Check row-level permissions if record is provided
      if (record && roleConfig.rowPermissions?.length) {
        const rowAllowed = roleConfig.rowPermissions.some(
          (rp) => rp.actions?.includes(action),
        );
        if (!rowAllowed) continue;
      }

      return {
        allowed: true,
        fieldRestrictions: roleConfig.fieldPermissions,
        rowFilter: roleConfig.rowPermissions?.[0]?.filter,
      };
    }
  }

  return {
    allowed: false,
    reason: `Action '${action}' on '${object}' is not permitted for roles: ${userRoles.join(', ')}`,
  };
}

/**
 * Resolves all effective roles including inherited roles.
 */
function resolveRoles(userRoles: string[], roleDefinitions: RoleDefinition[]): string[] {
  const resolved = new Set<string>(userRoles);
  const queue = [...userRoles];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const roleDef = roleDefinitions.find((r) => r.name === current);
    if (roleDef?.inherits) {
      for (const parent of roleDef.inherits) {
        if (!resolved.has(parent)) {
          resolved.add(parent);
          queue.push(parent);
        }
      }
    }
  }

  return Array.from(resolved);
}

/**
 * Field names refused outright, before the record is consulted at all.
 *
 * `__proto__` and `constructor` resolve on every ordinary object's chain, so
 * the own-member rule in `readField` would refuse them anyway. `prototype`
 * earns its place separately: it is NOT present on a plain object's chain
 * (`'prototype' in {}` is `false`), so without this list it would classify as
 * an ordinary absent field.
 */
const PROTOTYPE_FIELD_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * The outcome of reading a condition's field off a record.
 *
 * `readable: false` is not "the value was falsy" — it is "this evaluator
 * refuses to answer this condition from this record", which
 * `evaluateCondition` turns into a denial.
 */
type FieldRead = { readable: true; value: unknown } | { readable: false };

/**
 * Read a condition's field as an OWN member of the record.
 *
 * Measured on the pre-fix source (objectui#8044): the guard refused three
 * field names by list and read every other name with `hasOwnProperty`. That
 * read collapses *inherited* into *absent*, and on a negative operator absent
 * ADMITS — so every prototype member outside the list admitted every record.
 * Against `{ id: 1, tenant: 'acme' }`, `{ field: 'toString', operator: 'neq' }`
 * returned `true`, as did `valueOf`, `hasOwnProperty` and `isPrototypeOf`; a
 * fail-open on a row-level permission boundary. A longer list does not close
 * it: a list enumerates spellings, and `Object.prototype` has more of them
 * than any list will hold.
 *
 * Three cases, and the third is why this is not simply `hasOwnProperty`:
 *
 *   1. A name in `PROTOTYPE_FIELD_NAMES` — refused outright.
 *   2. An own member — its value, which is the only value ever read. A record
 *      whose OWN key happens to be spelled `toString` is answered from its own
 *      data, unchanged.
 *   3. Not an own member. Here the record is asked whether the name resolves
 *      on its prototype chain at all:
 *        - it does (`toString`, `valueOf`, an `Object.create` parent's field)
 *          → REFUSED. The value exists but is not this record's data.
 *        - it does not → the field is genuinely absent, and `undefined` is
 *          returned exactly as before, so the ordinary "this record has no
 *          `status`" rules keep the verdicts they have always had.
 *
 * The second half of case 3 is load-bearing. Refusing every non-own read would
 * deny records this evaluator should admit, which on a permission boundary is
 * a worse defect than the one being fixed, and it is what the differential
 * matrix in `__tests__/evaluator.prototype-guard-8044.test.ts` measures: the
 * genuinely-absent family changed zero verdicts.
 *
 * This is a port of the shape objectui#7751 landed on a sibling row-level
 * evaluator in `@object-ui/core`, which was written against this evaluator as
 * its reference — and then went further than it, because this evaluator had
 * the defect it was being used as the standard for. objectui#7750 retired that
 * sibling; the guard stands here on its own.
 */
function readField(record: Record<string, unknown>, field: string): FieldRead {
  if (PROTOTYPE_FIELD_NAMES.has(field)) return { readable: false };
  if (Object.prototype.hasOwnProperty.call(record, field)) return { readable: true, value: record[field] };
  if (field in Object(record)) return { readable: false };
  return { readable: true, value: undefined };
}

/**
 * Evaluates a permission condition against a record.
 */
export function evaluateCondition(
  condition: PermissionCondition,
  record: Record<string, unknown>,
): boolean {
  // Fail closed: a condition this evaluator cannot answer FROM THE RECORD must
  // not admit the record it exists to hide. Prototype-named and inherited
  // reads both land here (objectui#8044); the `default` arm below gives the
  // same answer for an operator this switch does not implement.
  const read = readField(record, condition.field);
  if (!read.readable) {
    return false;
  }

  const value = read.value;

  switch (condition.operator) {
    case 'eq':
      return value === condition.value;
    case 'neq':
      return value !== condition.value;
    case 'gt':
      return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;
    case 'gte':
      return typeof value === 'number' && typeof condition.value === 'number' && value >= condition.value;
    case 'lt':
      return typeof value === 'number' && typeof condition.value === 'number' && value < condition.value;
    case 'lte':
      return typeof value === 'number' && typeof condition.value === 'number' && value <= condition.value;
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(value);
    case 'not_in':
      return Array.isArray(condition.value) && !condition.value.includes(value);
    case 'contains':
      return typeof value === 'string' && typeof condition.value === 'string' && value.includes(condition.value);
    case 'is_null':
      return value === null || value === undefined;
    case 'is_not_null':
      return value !== null && value !== undefined;
    default:
      return false;
  }
}
