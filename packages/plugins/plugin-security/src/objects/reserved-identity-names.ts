// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Reserved identity names — the ONE predicate both position write doors read.
 *
 * ADR-0068 D2 reserves four names for the framework's built-in identities.
 * They are a normalized PROJECTION into `current_user.positions`, and their
 * sources of truth are elsewhere: the unscoped `admin_full_access` grant for
 * `platform_admin`, `sys_member.role` for the `org_*` trio. Nothing in the
 * platform ever writes one of these names into a tenant-authored row —
 * `bootstrapBuiltinRoles` seeds the `sys_position` CATALOG rows (stamped
 * `managed_by = 'platform'`) and no writer anywhere creates a
 * `sys_user_position` assignment spelling one.
 *
 * ## Why this file exists at all
 *
 * `sys-position.object.ts` already SAID it, in prose:
 *
 *     Framework-reserved built-in identities (platform_admin / org_*) ...
 *     MUST NOT be repurposed by a tenant
 *
 * and `resolve-authz-context.ts` said the consequence from the other side
 * («Read the RUNG — never `positions.includes(...)`; an ADR-0057 D4
 * `sys_user_position` row may spell that very name»). Both were comments. A
 * comment is not a gate: the names stayed writable, every defence was a READER
 * choosing to consult the capability rung, and an out-of-repo reader that
 * forgets reopens the hole with nothing mechanical to catch it.
 *
 * ## The closed enumeration is IMPORTED, never retyped
 *
 * {@link RESERVED_IDENTITY_NAMES} IS `BUILTIN_IDENTITY_NAMES` — the spec
 * constant that DECLARES the set. ⛔ Never re-spell the strings here, and ⛔
 * never widen the set by PATTERN (`org_*` would swallow every tenant position
 * whose name happens to start with `org_`). A name joins this set by joining
 * the spec constant, in `packages/spec`, where the identity is declared.
 *
 * ## Two consumers, one predicate
 *
 * 1. The OBJECT LAYER — `sys_position.name` and `sys_user_position.position`
 *    each declare a `validations[]` rule whose CEL list literal is generated
 *    by {@link reservedIdentityNamesCelList} from this same array. Object-level
 *    validations are the platform's one server-enforced "this column's values
 *    must look like X" channel (ADR-0049 declared = enforced): `objectql`'s
 *    rule validator runs them on insert, by-id update AND multi-row update, so
 *    every door that writes through the engine — data API, seed, import — is
 *    covered by one refusal carrying one code (`VALIDATION_FAILED`).
 * 2. TypeScript callers — {@link isReservedIdentityName} — for any door that
 *    needs the answer in code rather than in CEL.
 *
 * ⛔ A second copy of the refusal in a service gate would carry that gate's own
 * error code, and which of the two a caller sees would depend on hook order:
 * one condition, one code, one wording. The doors share the PREDICATE; they do
 * not each grow a refusal.
 */

import { BUILTIN_IDENTITY_NAMES } from '@objectstack/spec';

/**
 * The reserved set: EXACTLY the ADR-0068 built-in identity names, read from the
 * spec constant that declares them.
 *
 * ⛔ Not the ADR-0090 D5/D9 audience anchors (`everyone` / `guest`). Those are
 * a different invariant with a different remedy — a stored assignment to an
 * implicit audience is a modelling error, refused by the delegated-admin gate —
 * and folding them in here would widen a closed enumeration the ruling closed.
 */
export const RESERVED_IDENTITY_NAMES: readonly string[] = BUILTIN_IDENTITY_NAMES;

/**
 * Does `value` spell a framework-reserved built-in identity name?
 *
 * Exact match, deliberately: the reserved set is a closed enumeration, not a
 * shape. Case folding and trimming are NOT applied — the platform stores and
 * resolves position names verbatim, so `Platform_Admin` is a different name to
 * every reader in the system and refusing it here would refuse a name nothing
 * treats as authority.
 */
export function isReservedIdentityName(value: unknown): boolean {
  return typeof value === 'string' && RESERVED_IDENTITY_NAMES.includes(value);
}

/**
 * The reserved set as a CEL list literal — `['a', 'b', …]` — for a
 * `validations[]` predicate.
 *
 * GENERATED from the array on purpose: an object declaration that spelled the
 * names inside its condition string would be the second copy this module
 * exists to prevent, and a copy inside a string is one no compiler checks.
 *
 * The names are `[a-z_]` machine names (ADR-0068 D2), so single quotes need no
 * escaping — asserted by this module's own test rather than assumed, because
 * an unescaped quote would produce a predicate that cannot parse, and an
 * unparseable predicate is REJECTED fail-closed on every write (#4649), which
 * would brick the object rather than guard it.
 */
export function reservedIdentityNamesCelList(): string {
  return `[${RESERVED_IDENTITY_NAMES.map((n) => `'${n}'`).join(', ')}]`;
}

/**
 * The one wording both declarations use, parameterised by the column the write
 * spelled the name in. One condition, one code, one sentence (#5240) — an
 * operator who meets this refusal on either door reads the same explanation.
 *
 * It names the remedy, because the refusal is not "you lack permission" — no
 * caller has permission, tenant admins included. The name is reserved by the
 * framework; a different name is the only way through.
 */
export function reservedIdentityNameMessage(column: string): string {
  return (
    `'${column}' cannot spell a framework-reserved built-in identity name ` +
    `(${RESERVED_IDENTITY_NAMES.join(', ')}). These names are ADR-0068 built-in identities: ` +
    `the platform projects them into current_user.positions from their own sources of truth, ` +
    `and a row spelling one is not an assignment of that identity. Choose a different name.`
  );
}
