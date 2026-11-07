// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25234 ruling A, refusals 3 to 6] The publish refusals a membership key's
 * DECLARATION earns (`ObjectSchema.membershipKeys`, ADR-0105 D11's declarative
 * second source). The predicate half — a key's `filter` (refusal 7) and a
 * policy reading a key (refusals 11 to 13) — is
 * `validate-rls-predicate-enforceability.ts`'s, judged by the same passes as
 * every row policy.
 *
 * ## What a declaration means at runtime
 *
 * The security plugin resolves `current_user.KEY` per request by reading the
 * declaring roster object X: the distinct values of `valueField` (F) on the
 * rows whose `userField` (U) is the caller and on which `filter` holds, inside
 * the caller's Layer 0 wall (`stageDeclaredMembershipKeys`,
 * `@objectstack/plugin-security`). Every miss fails closed: the key stays
 * unresolved, and every policy reading it matches no rows. So each refusal
 * below is a declaration that reads as a grant and resolves to nothing, or to
 * a set no policy can compare.
 *
 * ## The refusals
 *
 * - {@link MEMBERSHIP_KEY_USER_FIELD_INVALID} (refusal 5) — U is not a column of
 *   the merged object, is not a single-valued user reference (`user`, or a
 *   `lookup` / `master_detail` to `sys_user`), or is `multiple: true`. The read
 *   matches U against one user id, so any other column matches no row or the
 *   wrong ones. A registry-injected column (`owner_id`, `created_by`) is a
 *   column of the object and is judged by its injected definition.
 * - {@link MEMBERSHIP_KEY_VALUE_FIELD_INVALID} (refusal 6) — F is not a column
 *   of the merged object, or neither a reference (`lookup`, `master_detail` or
 *   `user`) nor `id`, the object's own primary key. The set holds F's values,
 *   and a policy compares it with a column that references F's target or with
 *   that target's `id` (refusal 11): a reference names its target, and `id`
 *   names X itself, so the key holds the caller's own rows of X (#31129 ruling
 *   A, "the records I am"). Any other column has no target to compare with.
 *   `multiple: true` is allowed: its values are flattened. F naming U's column
 *   is refused by `MembershipKeySchema` itself.
 * - {@link MEMBERSHIP_KEY_DECLARED_TWICE} (refusal 3) — one key on two objects.
 *   `defineStack` and `composeStacks` refuse it inside one stack; this is the
 *   door they do not see, the runtime publish gate, where the other declaration
 *   is a live registry object. At runtime neither declaration resolves.
 * - {@link MEMBERSHIP_KEY_RESOLVER_COLLISION} (refusal 4) — a key the
 *   registered code resolver (`IRlsMembershipResolver.keys`) also owns. Only
 *   the runtime publish gate knows the resolver, so the CLI cannot judge it. At
 *   runtime neither source resolves the key, and the boot logs an error.
 *
 * ## Which object U and F are judged on
 *
 * The MERGED one, as `stack.zod.ts` judges a `controlled_by_parent` master: an
 * `objectExtensions` entry that replaces U or F changes the column the read
 * uses. The merge is the registry's (`mergeObjectDefinitions`): fields by
 * name, a later writer replacing the whole field, extensions in ascending
 * `priority` (default 200) and, at one priority, in package order. A field two
 * packages write at the priority that decides it is not judged, because the
 * winner is registration order, which a stack does not state. At the runtime
 * gate the registry has already folded the extensions into the objects it
 * hands over.
 *
 * ## What the runtime gate states
 *
 * `AuthoringRuleContext.membershipKeyOwners`: the registered resolver's keys,
 * and every key the WHOLE live object collection declares. The second is the
 * collection before the package-closure narrowing (#9612), because a key's
 * namespace is the deployment's, not the package's. Absent (the CLI), refusal 4
 * is not judged and refusal 3 reads the stack alone.
 */

import {
  indexObjectGraph,
  isUnjudgeable,
  objectsAsServed,
  recordsOf,
  resolveFieldPath,
  suggestName,
  type GraphField,
  type ObjectGraph,
} from './object-graph.js';

/** `userField` is not a single-valued user reference on the merged object. */
export const MEMBERSHIP_KEY_USER_FIELD_INVALID = 'membership-key-user-field-invalid';
/** `valueField` is not a reference on the merged object. */
export const MEMBERSHIP_KEY_VALUE_FIELD_INVALID = 'membership-key-value-field-invalid';
/** One key declared on two objects. */
export const MEMBERSHIP_KEY_DECLARED_TWICE = 'membership-key-declared-twice';
/** A declared key the registered membership resolver also owns. */
export const MEMBERSHIP_KEY_RESOLVER_COLLISION = 'membership-key-resolver-collision';

export interface MembershipKeyFinding {
  severity: 'error';
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** The platform's user object, the target of every `user` field. */
const USER_OBJECT = 'sys_user';

/**
 * The field types a membership key's `valueField` may have. The one other
 * column it may name is `id`, X's own primary key ({@link isOwnPrimaryKey}),
 * which has no field type: the driver, not a definition, provisions it.
 */
const VALUE_FIELD_TYPES: ReadonlySet<string> = new Set(['lookup', 'master_detail', 'user']);

/** The column a membership key names for "the caller's own rows of X" (#31129 ruling A). */
export const MEMBERSHIP_KEY_OWN_ID_FIELD = 'id';

/** One `membershipKeys` entry, where the stack declares it. */
export interface DeclaredMembershipKey {
  /** The key name, `current_user.KEY`. */
  key: string;
  /** The declaring roster object, X. */
  object: string;
  /** X's position in `recordsOf(stack.objects)`, the finding path's index. */
  objectIndex: number;
  /** U. */
  userField: string;
  /** F. */
  valueField: string;
  /** The optional narrowing, as written. */
  filter?: string;
}

/**
 * Every membership key the stack's objects declare, in object order then key
 * order. A non-record object or declaration is skipped: its shape is the
 * schema's to refuse.
 */
export function declaredMembershipKeysOf(stack: unknown): DeclaredMembershipKey[] {
  const out: DeclaredMembershipKey[] = [];
  if (!isRec(stack)) return out;
  recordsOf(stack.objects).forEach((obj, objectIndex) => {
    const object = str(obj.name);
    if (!object || !isRec(obj.membershipKeys)) return;
    for (const [key, decl] of Object.entries(obj.membershipKeys)) {
      if (!isRec(decl)) continue;
      out.push({
        key,
        object,
        objectIndex,
        userField: str(decl.userField),
        valueField: str(decl.valueField),
        ...(typeof decl.filter === 'string' ? { filter: decl.filter } : {}),
      });
    }
  });
  return out;
}

/**
 * The deployment's membership-key owners, as the runtime publish gate states
 * them (`AuthoringRuleContext.membershipKeyOwners`).
 */
export interface MembershipKeyOwners {
  /** The keys the registered `rls-membership-resolver` declares; empty when none is registered. */
  readonly resolverKeys: ReadonlySet<string>;
  /** Key → the names of the live objects declaring it, read off the whole collection. */
  readonly declaredBy: ReadonlyMap<string, readonly string[]>;
}

/**
 * Build {@link MembershipKeyOwners} from the live object collection and the
 * resolver's keys. Pure; a non-record member is skipped.
 */
export function membershipKeyOwnersOf(
  objects: readonly unknown[] | undefined,
  resolverKeys: readonly string[],
): MembershipKeyOwners {
  const declaredBy = new Map<string, string[]>();
  for (const decl of declaredMembershipKeysOf({ objects: objects ?? [] })) {
    const names = declaredBy.get(decl.key) ?? [];
    if (!names.includes(decl.object)) names.push(decl.object);
    declaredBy.set(decl.key, names);
  }
  return { resolverKeys: new Set(resolverKeys), declaredBy };
}

/**
 * The objects declaring `key`: the stack's own declarations, plus every live
 * object the stack does not carry under its name. The stack is the authority
 * for an object it carries, so the written object's declaration replaces its
 * stored self's.
 */
export function objectsDeclaringKey(
  key: string,
  declared: readonly DeclaredMembershipKey[],
  stackObjectNames: ReadonlySet<string>,
  owners: MembershipKeyOwners | undefined,
): string[] {
  const names: string[] = [];
  for (const decl of declared) if (decl.key === key && !names.includes(decl.object)) names.push(decl.object);
  for (const name of owners?.declaredBy.get(key) ?? []) {
    if (!stackObjectNames.has(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The names of the objects a stack carries. */
export function stackObjectNamesOf(stack: unknown): Set<string> {
  const names = new Set<string>();
  if (!isRec(stack)) return names;
  for (const obj of recordsOf(stack.objects)) if (str(obj.name)) names.add(str(obj.name));
  return names;
}

/** U's verdict: `null` when it is a single-valued user reference, else the reason. */
function userFieldFault(meta: GraphField): string | null {
  const isUserRef =
    meta.type === 'user' ||
    ((meta.type === 'lookup' || meta.type === 'master_detail') && meta.reference === USER_OBJECT);
  if (!isUserRef) {
    const target = meta.reference ? ` to '${meta.reference}'` : '';
    return `is a \`${meta.type ?? 'untyped'}\` field${target}, not a user reference`;
  }
  if (meta.multiple) return 'holds several users (`multiple: true`), so no one user id can match it';
  return null;
}

/** F's verdict: `null` when it is a reference or X's own `id`, else the reason. */
function valueFieldFault(column: Extract<ColumnVerdict, { kind: 'ok' }>): string | null {
  if (column.primaryKey) return null;
  const { meta } = column;
  if (meta.type && VALUE_FIELD_TYPES.has(meta.type)) return null;
  return `is a \`${meta.type ?? 'untyped'}\` field, not a reference (\`lookup\`, \`master_detail\` or \`user\`) or \`id\``;
}

/**
 * Does the resolved column name X's own primary key? Only the `id` the
 * driver provisions: the graph serves it as an injected column with an empty
 * slice. An author-declared field that happens to be named `id` is judged by
 * its own definition, like any other column.
 */
function isOwnPrimaryKey(column: string, verdict: { injected?: true; meta?: GraphField }): boolean {
  return column === MEMBERSHIP_KEY_OWN_ID_FIELD && verdict.injected === true && !verdict.meta?.type;
}

/** One of U / F, resolved on the merged object — see {@link columnOf}. */
type ColumnVerdict =
  | { kind: 'ok'; meta: GraphField; primaryKey: boolean }
  | { kind: 'missing'; candidates: ReadonlySet<string> }
  | { kind: 'skip' };

/**
 * The column one of U / F names, judged on the merged object: `ok` with its
 * field slice, `missing` with the object's declared names, or `skip` when the
 * graph cannot answer (an object with no field map, a field two packages tie
 * on, an untyped or unread declaration).
 */
function columnOf(
  graph: ObjectGraph,
  object: string,
  column: string,
  tied: ReadonlySet<string> | undefined,
): ColumnVerdict {
  if (!column || tied?.has(column)) return { kind: 'skip' };
  const verdict = resolveFieldPath(graph, object, column);
  if (!verdict || isUnjudgeable(verdict)) return { kind: 'skip' };
  if (verdict.kind === 'field-unknown') return { kind: 'missing', candidates: verdict.candidates };
  if (verdict.kind !== 'ok') return { kind: 'skip' };
  // `id` maps to an empty slice: the driver's primary key, never a reference.
  // As U it is no user reference; as F it is the roster row's own id.
  return { kind: 'ok', meta: verdict.meta ?? {}, primaryKey: isOwnPrimaryKey(column, verdict) };
}

/**
 * Judge every membership key the stack declares (refusals 3 to 6).
 *
 * Pure `(stack, options) => Finding[]`; tolerates the normalized and the parsed
 * tier.
 *
 * @param options.membershipKeyOwners The runtime publish gate's statement of
 *   the deployment's owners — see this file's header. Absent on the CLI.
 */
export function validateMembershipKeyDeclarations(
  stack: unknown,
  options: { membershipKeyOwners?: MembershipKeyOwners } = {},
): MembershipKeyFinding[] {
  const findings: MembershipKeyFinding[] = [];
  if (!isRec(stack)) return findings;
  const declared = declaredMembershipKeysOf(stack);
  if (declared.length === 0) return findings;

  const { objects: merged, tied } = objectsAsServed(stack);
  const graph = indexObjectGraph({ objects: merged });
  const stackNames = stackObjectNamesOf(stack);
  const owners = options.membershipKeyOwners;

  for (const decl of declared) {
    const where = `membership key "${decl.key}" of object "${decl.object}"`;
    const at = `objects[${decl.objectIndex}].membershipKeys.${decl.key}`;
    const tiedHere = tied.get(decl.object);

    const user = columnOf(graph, decl.object, decl.userField, tiedHere);
    if (user.kind === 'missing') {
      findings.push({
        severity: 'error',
        rule: MEMBERSHIP_KEY_USER_FIELD_INVALID,
        where,
        path: `${at}.userField`,
        message:
          `\`userField\` names '${decl.userField}', which object '${decl.object}' does not declare, so the ` +
          'roster read fails and every policy reading the key matches no rows',
        hint:
          `Name the column that holds the roster row's user (\`user\`, or a lookup to \`sys_user\`).` +
          suggestName(decl.userField, user.candidates),
      });
    } else if (user.kind === 'ok') {
      const fault = userFieldFault(user.meta);
      if (fault) {
        findings.push({
          severity: 'error',
          rule: MEMBERSHIP_KEY_USER_FIELD_INVALID,
          where,
          path: `${at}.userField`,
          message:
            `\`userField\` '${decl.userField}' ${fault}, so the roster read cannot match the caller's user id ` +
            'and the key resolves to wrong rows or none',
          hint: 'Point `userField` at a single-valued `user` field, or a `lookup` / `master_detail` to `sys_user`',
        });
      }
    }

    const value = columnOf(graph, decl.object, decl.valueField, tiedHere);
    if (value.kind === 'missing') {
      findings.push({
        severity: 'error',
        rule: MEMBERSHIP_KEY_VALUE_FIELD_INVALID,
        where,
        path: `${at}.valueField`,
        message:
          `\`valueField\` names '${decl.valueField}', which object '${decl.object}' does not declare, so the ` +
          'roster read fails and every policy reading the key matches no rows',
        hint:
          'Name the reference column whose values the policies compare.' +
          suggestName(decl.valueField, value.candidates),
      });
    } else if (value.kind === 'ok' && decl.valueField !== decl.userField) {
      const fault = valueFieldFault(value);
      if (fault) {
        findings.push({
          severity: 'error',
          rule: MEMBERSHIP_KEY_VALUE_FIELD_INVALID,
          where,
          path: `${at}.valueField`,
          message:
            `\`valueField\` '${decl.valueField}' ${fault}, so the set holds values no policy can compare ` +
            'with a record',
          hint: 'Point `valueField` at a `lookup`, `master_detail` or `user` column, or at `id` for the caller\'s own rows',
        });
      }
    }

    const others = objectsDeclaringKey(decl.key, declared, stackNames, owners).filter((n) => n !== decl.object);
    if (others.length > 0) {
      findings.push({
        severity: 'error',
        rule: MEMBERSHIP_KEY_DECLARED_TWICE,
        where,
        path: at,
        message:
          `\`current_user.${decl.key}\` is also declared by object ${others.map((n) => `'${n}'`).join(', ')}, ` +
          'so neither declaration resolves and every policy reading the key matches no rows',
        hint: 'Declare each membership key on one roster object: rename this key or remove the other declaration',
      });
    }

    if (owners?.resolverKeys.has(decl.key)) {
      findings.push({
        severity: 'error',
        rule: MEMBERSHIP_KEY_RESOLVER_COLLISION,
        where,
        path: at,
        message:
          `\`current_user.${decl.key}\` is also owned by the registered membership resolver, so neither ` +
          'source resolves it and every policy reading the key matches no rows',
        hint: 'Rename the declared key, or drop it from the resolver\'s `keys`: one membership key has one owner',
      });
    }
  }
  return findings;
}
