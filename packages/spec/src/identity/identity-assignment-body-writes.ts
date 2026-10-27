// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * App-authored automation does not use elevation to write the four
 * identity-assignment objects (#25251, ruling 6354966423; #25653, the same
 * principle for the whole family, ruling record 6384657105 letter A).
 *
 * The run-time half lives in `@objectstack/plugin-security`
 * (`flow-system-identity-write-refusal.ts`): the data middleware refuses,
 * ahead of its `isSystem` bypass, a governed write to these four objects from
 * a system flow run, a hook that runs as system, or an action body, with
 * `PERMISSION_DENIED`. This module is the save-time half: the authoring
 * schemas (`HookSchema`, `ActionSchema`) refuse a sandboxed body that runs
 * elevated AND names such a write in its source, so the author meets the
 * refusal at `os validate`, `defineStack` and the metadata save door instead
 * of in a failed run.
 *
 * It imports nothing, on purpose: `data/hook.zod.ts` and `ui/action.zod.ts`
 * both read it, and a leaf keeps either schema's import graph unchanged (the
 * `kernel/stored-metadata-body-objects.ts` precedent).
 */

/**
 * The identity-assignment objects app-authored automation's system elevation
 * may not write: position holdings, permission-set grants, invitations and
 * memberships. Exactly the run-time refusal's set
 * (`FLOW_SYSTEM_IDENTITY_WRITE_OBJECTS`, plugin-security).
 */
export const IDENTITY_ASSIGNMENT_WRITE_OBJECTS: ReadonlySet<string> = new Set([
  'sys_user_position',
  'sys_user_permission_set',
  'sys_invitation',
  'sys_member',
]);

/**
 * The two whose door is the ADR-0090 D12 delegated-administration gate. The
 * other two are better-auth's tables, whose door is the organization endpoints.
 */
const ASSIGNMENT_OBJECTS: ReadonlySet<string> = new Set(['sys_user_position', 'sys_user_permission_set']);

/**
 * The write methods a sandboxed body's `ctx.api.object(name)` handle carries
 * (`packages/runtime/src/sandbox/quickjs-runner.ts`, the `api.write` set).
 * Reads (`find`, `findOne`, `count`, `aggregate`) are not judged: the run-time
 * refusal leaves reads of the four objects to every context.
 */
const BODY_WRITE_METHODS = ['insert', 'update', 'delete', 'updateMany', 'deleteMany', 'upsert'] as const;

const OBJECT_NAMES = [...IDENTITY_ASSIGNMENT_WRITE_OBJECTS].join('|');
const WRITE_METHODS = BODY_WRITE_METHODS.join('|');

/** `.object('<one of the four>')` — the literal handle, in any of the three quote forms. */
const HANDLE = String.raw`\.\s*object\s*\(\s*(?<quote>['"\x60])(?<object>${OBJECT_NAMES})\k<quote>\s*\)`;
/** A write call on whatever precedes it: `.insert(`, `?.update(` and so on. */
const WRITE_CALL = String.raw`\s*\??\.\s*(${WRITE_METHODS})\s*\(`;

/** A write called straight on the literal handle: `ctx.api.object('sys_member').insert(…)`. */
const CHAINED_WRITE = new RegExp(HANDLE + WRITE_CALL, 'g');
/** The literal handle bound to a name: `const members = ctx.api.object('sys_member')`. */
const BOUND_HANDLE = new RegExp(String.raw`\b(?:const|let|var)\s+(?<binding>[A-Za-z_$][\w$]*)\s*=\s*[\w$.]*` + HANDLE, 'g');

function escapeIdentifier(name: string): string {
  return name.replace(/\$/g, '\\$');
}

/**
 * The identity-assignment objects a sandboxed body's source names a write to,
 * in first-seen order: a write method called on the literal
 * `ctx.api.object('<name>')` handle, or on a `const` / `let` / `var` the body
 * bound that handle to.
 */
export function identityAssignmentWritesNamedIn(source: string): string[] {
  const named = new Set<string>();
  for (const match of source.matchAll(CHAINED_WRITE)) named.add(match.groups!.object);
  for (const match of source.matchAll(BOUND_HANDLE)) {
    const { binding, object } = match.groups!;
    const write = new RegExp(String.raw`(?<![\w$.])${escapeIdentifier(binding)}` + WRITE_CALL);
    if (write.test(source.slice((match.index ?? 0) + match[0].length))) named.add(object);
  }
  return [...named];
}

/** Which app-authored elevation the body runs under. */
export type IdentityAssignmentBodySource = 'hook' | 'action';

const SUBJECT: Readonly<Record<IdentityAssignmentBodySource, string>> = {
  hook: "this hook runs as system (runAs: 'system')",
  action: 'an action body runs as system',
};

const ASSIGNMENT_PRESCRIPTION: Readonly<Record<IdentityAssignmentBodySource, string>> = {
  hook:
    "Set the hook's runAs to 'user': the delegated-administration gate then judges the user the hook acts for, "
    + "and records that user as the grant's granted_by.",
  action:
    "Make the grant from a flow whose runAs is 'user', which an action of type 'flow' runs as the invoking user: "
    + "the delegated-administration gate then judges that user, and records them as the grant's granted_by.",
};

const MEMBERSHIP_PRESCRIPTION =
  'Invitations and memberships change through the organization endpoints (POST /api/v1/auth/organization/'
  + 'invite-member, cancel-invitation, update-member-role, remove-member), which apply the invitation\'s '
  + 'placement and role-cap checks.';

/**
 * The refusal for one named write: what the body does, why elevation does not
 * lift it, and where the change goes instead.
 */
export function identityAssignmentBodyWriteRefusal(object: string, source: IdentityAssignmentBodySource): string {
  return (
    `\`body.source\` writes '${object}' and ${SUBJECT[source]}: position holdings, permission-set grants, `
    + 'invitations and memberships are governed identity writes, and system elevation does not lift that, so '
    + 'the write is refused when the body runs. '
    + (ASSIGNMENT_OBJECTS.has(object) ? ASSIGNMENT_PRESCRIPTION[source] : MEMBERSHIP_PRESCRIPTION)
  );
}
