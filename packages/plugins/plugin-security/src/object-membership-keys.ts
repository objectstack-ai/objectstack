// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25234 ruling A] Declared membership keys (`ObjectSchema.membershipKeys`):
 * the declarative second source of `context.rlsMembership`, staged beside the
 * registered `rls-membership-resolver` (ADR-0105 D11) by
 * `stageRlsMembership`, the one producer of the bag.
 *
 * A key `KEY` declared on the roster object X as `{ userField: U, valueField:
 * F, filter }` makes `current_user.KEY` the distinct values of F on the rows of
 * X whose U is the caller and on which `filter` holds, inside the caller's
 * Layer 0 wall for X.
 *
 * ## Which keys, and when
 *
 * Lazily, per key: from the policies about to compile, take the
 * `current_user.*` names their `using` and `check` read (parsed once per
 * predicate by the platform's CEL front end, after the same SQL bridge the
 * compiler applies), and stage each one that an object in the ObjectQL
 * registry declares and this request has not staged yet. A key no applicable
 * policy reads is never resolved; a request that meets none costs nothing.
 * The memo is the execution context, the carrier the resolver's memo already
 * uses: one request that reads a key on five objects issues one read.
 *
 * ## The read (rider 1 of the ruling)
 *
 * The platform's own Layer 0 system read, independent of the caller's audience
 * and posture: X where U equals the caller's user id and `filter` holds, as
 * system context, with the caller's Layer 0 wall for X AND-ed in and no Layer
 * 1, projected to F (and `id`, which explain names), limited to
 * {@link MEMBERSHIP_KEY_MAX_VALUES} + 1 rows. The caller need not read X: a
 * portal contact who cannot see the roster still resolves the key, and X's own
 * row-level security, which may read the very key this read feeds, is not
 * consulted (reading X under the caller's RLS is exactly that cycle). The
 * wall is the caller's own, with no platform-admin crossing, so a roster row
 * in another organisation never counts. Keys are audience-neutral (rider 2):
 * an internal caller resolves a key exactly as an external one does.
 *
 * ## Fail closed
 *
 * A key whose read returns no row is staged as `[]`. Every other miss leaves
 * the key unstaged: more than the bound, a read that throws, a `filter` the
 * compiler refuses for X, no signed-in user, a tenant wall that denies, a key
 * two objects declare, and a key the registered resolver also owns (one
 * namespace: it resolves from neither source, and the boot and the request
 * each log an error naming both owners). A key that is staged as `[]` or left
 * unstaged takes the compiler's existing path: every policy reading it drops
 * with its existing WARN and, alone, fails closed to `RLS_DENY_FILTER`.
 *
 * A key already in the bag that the resolver did not put there was supplied
 * with the context, and is left as it is, as the resolver leaves it.
 *
 * ## Explain
 *
 * Each staging outcome is kept, per context and per object that read it, for
 * the explainer (`explain-engine.ts`): the `rls` layer's `detail` names the
 * key, X, F, U, the filter and the size or why the key did not resolve, and
 * who can grant it (whoever can write X, rider 3); a record-grained rule reads
 * `via: 'membership:KEY'` and names the roster row that linked the record.
 */

import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { MEMBERSHIP_KEY_MAX_VALUES } from '@objectstack/spec/security';
import { RESERVED_RLS_MEMBERSHIP_KEYS, type IRlsMembershipResolver } from '@objectstack/spec/contracts';
import { parseCelToAst, sqlPredicateToCel } from '@objectstack/formula';
import { RLS_DENY_FILTER, type RLSCompiler, type RlsFieldGuard } from './rls-compiler.js';
import {
  computeTenantLayer0Verdict,
  tenantLayer0FilterOf,
  tenantLayer0InputOf,
  type TenantLayer0Facts,
} from './tenant-layer.js';

/** One declaration of a key, as the registry's resolved object carries it. */
export interface DeclaredMembershipKey {
  key: string;
  /** The roster object X: the object that declares the key. */
  object: string;
  userField: string;
  valueField: string;
  filter?: string;
  label?: string;
  description?: string;
}

/** Why a declared key did not resolve. Each one fails closed. */
export type MembershipKeyMissReason =
  | 'no-user'
  | 'tenant-wall-denies'
  | 'filter-refused'
  | 'over-bound'
  | 'read-failed'
  | 'declared-twice'
  | 'resolver-collision';

/** What staging did with one declared key on one request. */
export type MembershipKeyOutcome =
  | (DeclaredMembershipKey & {
      status: 'resolved';
      /** The distinct values staged, in read order. */
      values: string[];
      /** For each value, the id of the first roster row that carried it. */
      rosterRowOf: ReadonlyMap<string, string | undefined>;
    })
  | (Omit<DeclaredMembershipKey, 'object' | 'userField' | 'valueField'> &
      Partial<Pick<DeclaredMembershipKey, 'object' | 'userField' | 'valueField'>> & {
        status: 'unresolved';
        reason: MembershipKeyMissReason;
        /** Every object that declares the key (for `declared-twice`). */
        declaredOn?: string[];
        detail: string;
      });

/** The members of the security plugin the declared-key read uses. */
export interface MembershipKeyStagingHost {
  readonly logger: { warn: (message: string, meta?: Record<string, unknown>) => void; error?: (message: string) => void } | undefined;
  readonly ql: any;
  readonly metadata: any;
  readonly rlsCompiler: Pick<RLSCompiler, 'compileFilter'>;
  readonly rlsMembershipResolver: IRlsMembershipResolver | null;
  readonly tenancyPosture: TenantLayer0Facts['tenancyPosture'];
  readonly tenancyDisabledCache: ReadonlyMap<string, boolean>;
  readonly datetimeFieldNamesCache: ReadonlyMap<string, NonNullable<RlsFieldGuard['datetime']>>;
  readonly numberComparandFieldsCache: ReadonlyMap<string, NonNullable<RlsFieldGuard['number']>>;
  getObjectFieldNames(metadata: any, objectName: string, ql?: any): Promise<Set<string> | null>;
  getObjectSecurityMeta(object: string): Promise<TenantLayer0Facts['meta']>;
}

interface StagingState {
  /** Keys the registered resolver put in the bag on this request. */
  resolverStaged: Set<string>;
  /** Per declared key: the staging, memoized for the request. */
  declared: Map<string, Promise<MembershipKeyOutcome | undefined>>;
  /** Per object: the declared keys its policies read on this request. */
  readBy: Map<string, Set<string>>;
}

/** Per execution context: the request scope the resolver's memo already uses. */
const STATE = new WeakMap<object, StagingState>();

function stateOf(context: object): StagingState {
  let state = STATE.get(context);
  if (!state) {
    state = { resolverStaged: new Set(), declared: new Map(), readBy: new Map() };
    STATE.set(context, state);
  }
  return state;
}

/** Record the keys the registered resolver staged on `context` (the collision screen reads it). */
export function noteResolverStagedKeys(context: object, keys: Iterable<string>): void {
  const state = stateOf(context);
  for (const key of keys) state.resolverStaged.add(key);
}

// ── Which keys a predicate reads ───────────────────────────────────────────

/** Parsed once per predicate text: the reads are a pure function of it. */
const KEYS_OF_PREDICATE = new Map<string, readonly string[]>();
const KEYS_OF_PREDICATE_MAX = 2000;

/**
 * The `current_user.KEY` names a predicate reads, through the platform's CEL
 * front end after the compiler's own SQL bridge (`sqlPredicateToCel`). A
 * predicate that does not parse reads nothing here; the compiler refuses it
 * on its own path. Reserved kernel names are left out: no declaration may own
 * one.
 */
export function membershipKeyReadsOf(predicate: string): readonly string[] {
  return currentUserReadsOf(predicate).filter((k) => !RESERVED_RLS_MEMBERSHIP_KEYS.includes(k));
}

/**
 * [ADR-0142 D3] Does any of these policies read `current_user.KEY`, in either
 * clause? Asked for a kernel key the security plugin stages lazily
 * (`queues`), so a request that reads none pays nothing.
 */
export function policiesReadCurrentUserKey(policies: readonly RowLevelSecurityPolicy[], key: string): boolean {
  for (const policy of policies) {
    for (const clause of [policy.using, (policy as { check?: unknown }).check]) {
      if (typeof clause === 'string' && clause !== '' && currentUserReadsOf(clause).includes(key)) return true;
    }
  }
  return false;
}

/** Every `current_user.KEY` name a predicate reads, reserved kernel names included. */
function currentUserReadsOf(predicate: string): readonly string[] {
  const cached = KEYS_OF_PREDICATE.get(predicate);
  if (cached) return cached;
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const { op, args } = node as { op?: unknown; args?: unknown };
    if (Array.isArray(args) && args.length === 2) {
      const [operand, member] = args as [unknown, unknown];
      const rootIsCurrentUser =
        operand !== null &&
        typeof operand === 'object' &&
        (operand as { op?: unknown }).op === 'id' &&
        (operand as { args?: unknown }).args === 'current_user';
      if (rootIsCurrentUser) {
        if ((op === '.' || op === '?.') && typeof member === 'string') out.add(member);
        if (
          (op === '[]' || op === '[?]') &&
          member !== null &&
          typeof member === 'object' &&
          (member as { op?: unknown }).op === 'value' &&
          typeof (member as { args?: unknown }).args === 'string'
        ) {
          out.add((member as { args: string }).args);
        }
      }
    }
    walk(args);
  };
  try {
    walk(parseCelToAst(sqlPredicateToCel(predicate)));
  } catch {
    // Not parseable: the compiler refuses it on its own path.
  }
  const keys = [...out];
  if (KEYS_OF_PREDICATE.size >= KEYS_OF_PREDICATE_MAX) KEYS_OF_PREDICATE.clear();
  KEYS_OF_PREDICATE.set(predicate, keys);
  return keys;
}

/** The keys a set of policies reads, in either clause: a `using` and its `check` twin stage the same keys. */
function keysReadBy(policies: readonly RowLevelSecurityPolicy[]): Set<string> {
  const keys = new Set<string>();
  for (const policy of policies) {
    for (const clause of [policy.using, (policy as { check?: unknown }).check]) {
      if (typeof clause === 'string' && clause !== '') for (const k of membershipKeyReadsOf(clause)) keys.add(k);
    }
  }
  return keys;
}

// ── Who declares a key ─────────────────────────────────────────────────────

/**
 * Every declaration of `key` among the ObjectQL registry's resolved objects,
 * the schema the engine compiles every find against. Asked only for a key a
 * policy about to compile reads and this request has not staged.
 */
export function declarationsOf(ql: any, key: string): DeclaredMembershipKey[] {
  let objects: unknown;
  try {
    objects = ql?.registry?.getAllObjects?.();
  } catch {
    return [];
  }
  if (!Array.isArray(objects)) return [];
  const out: DeclaredMembershipKey[] = [];
  for (const object of objects) {
    const name = (object as { name?: unknown })?.name;
    const keys = (object as { membershipKeys?: unknown })?.membershipKeys;
    if (typeof name !== 'string' || keys === null || typeof keys !== 'object' || Array.isArray(keys)) continue;
    const entry = (keys as Record<string, unknown>)[key];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { userField, valueField, filter, label, description } = entry as Record<string, unknown>;
    if (typeof userField !== 'string' || typeof valueField !== 'string') continue;
    out.push({
      key,
      object: name,
      userField,
      valueField,
      ...(typeof filter === 'string' && filter.trim() !== '' ? { filter } : {}),
      ...(typeof label === 'string' ? { label } : {}),
      ...(typeof description === 'string' ? { description } : {}),
    });
  }
  return out;
}

/**
 * The keys both sources claim: declared on an object in the registry AND
 * owned by the registered resolver. Each resolves from neither; the boot
 * logs them (`SecurityPlugin.start`), and the request that meets one logs it
 * again.
 */
export function resolverCollisionsOf(ql: any, resolver: IRlsMembershipResolver | null): Array<{ key: string; objects: string[] }> {
  if (!resolver || !Array.isArray(resolver.keys)) return [];
  const out: Array<{ key: string; objects: string[] }> = [];
  for (const key of new Set(resolver.keys)) {
    const objects = declarationsOf(ql, key).map((d) => d.object);
    if (objects.length > 0) out.push({ key, objects });
  }
  return out;
}

/** The sentence both the boot and the request log for a key both sources claim. */
export function resolverCollisionMessage(key: string, objects: readonly string[]): string {
  return (
    `[security] membership key '${key}' is declared by ${objects.map((o) => `'${o}'`).join(', ')} ` +
    '(`membershipKeys`) AND owned by the registered rls-membership-resolver: one key has one source, so it ' +
    'resolves from NEITHER and every policy reading `current_user.' + key + '` matches no rows. Rename one of them.'
  );
}

// ── Staging ────────────────────────────────────────────────────────────────

/**
 * Stage, on `context`, every declared key the given policies read that this
 * request has not staged yet. `object` names the object whose policies these
 * are, for the explainer; the keys staged are the same with or without it.
 */
export async function stageDeclaredMembershipKeys(
  host: MembershipKeyStagingHost,
  context: any,
  policies: readonly RowLevelSecurityPolicy[],
  object?: string,
): Promise<void> {
  if (!context || typeof context !== 'object' || policies.length === 0) return;
  const reads = keysReadBy(policies);
  if (reads.size === 0) return;
  const state = stateOf(context);
  const pending: Array<Promise<unknown>> = [];
  for (const key of reads) {
    let staging = state.declared.get(key);
    if (!staging) {
      staging = stageOneKey(host, context, state, key);
      state.declared.set(key, staging);
    }
    pending.push(staging);
    if (object) {
      const seen = state.readBy.get(object) ?? new Set<string>();
      seen.add(key);
      state.readBy.set(object, seen);
    }
  }
  await Promise.all(pending);
}

/** The bag on `context`, created on first write. */
function bagOf(context: any): Record<string, string[]> {
  if (!context.rlsMembership || typeof context.rlsMembership !== 'object') context.rlsMembership = {};
  return context.rlsMembership as Record<string, string[]>;
}

/** Errors already logged, per logger: a collision is a deployment fault, not a per-request one. */
const LOGGED_ERRORS = new WeakMap<object, Set<string>>();

function errorOnce(host: MembershipKeyStagingHost, id: string, message: string, meta: Record<string, unknown>): void {
  const logger = host.logger;
  if (!logger) return;
  const seen = LOGGED_ERRORS.get(logger) ?? new Set<string>();
  LOGGED_ERRORS.set(logger, seen);
  if (seen.has(id)) return;
  seen.add(id);
  if (logger.error) logger.error(message);
  else logger.warn?.(message, meta);
}

async function stageOneKey(
  host: MembershipKeyStagingHost,
  context: any,
  state: StagingState,
  key: string,
): Promise<MembershipKeyOutcome | undefined> {
  const declarations = declarationsOf(host.ql, key);
  // Not a declared key: the resolver's, the caller's, or nobody's. Nothing to stage here.
  if (declarations.length === 0) return undefined;

  const bag = context.rlsMembership as Record<string, unknown> | undefined;
  // The resolver owns what it declares, and what it staged on this request.
  const resolverOwns = !!host.rlsMembershipResolver?.keys?.includes(key) || state.resolverStaged.has(key);
  if (resolverOwns) {
    // One namespace: the key resolves from neither source. A value the resolver
    // already staged is withdrawn before any policy compiles against it.
    if (bag && state.resolverStaged.has(key)) delete bag[key];
    const objects = declarations.map((d) => d.object);
    errorOnce(host, `collision:${key}`, resolverCollisionMessage(key, objects), { key, objects });
    return {
      ...declarations[0],
      status: 'unresolved',
      reason: 'resolver-collision',
      declaredOn: objects,
      detail: `the registered rls-membership-resolver owns '${key}' too, so it resolves from neither source`,
    };
  }
  // Supplied with the context (not by the resolver, which does not own it): left as it is.
  if (bag && bag[key] !== undefined) return undefined;

  if (declarations.length > 1) {
    const objects = declarations.map((d) => d.object);
    errorOnce(
      host,
      `twice:${key}`,
      `[security] membership key '${key}' is declared on ${objects.map((o) => `'${o}'`).join(', ')}: one key ` +
        'name is one request-wide set, so it resolves from none of them and every policy reading it matches no rows.',
      { key, objects },
    );
    return {
      key,
      status: 'unresolved',
      reason: 'declared-twice',
      declaredOn: objects,
      detail: `'${key}' is declared on ${objects.length} objects (${objects.join(', ')}), so it resolves from none`,
    };
  }

  const declaration = declarations[0];
  const outcome = await readDeclaredKey(host, context, declaration);
  if (outcome.status === 'resolved') {
    bagOf(context)[key] = outcome.values;
  } else {
    host.logger?.warn?.(
      `[security] membership key '${key}' (declared on '${declaration.object}') did not resolve for this ` +
        `request: ${outcome.detail}. Every policy reading it fails closed.`,
      { key, object: declaration.object, reason: outcome.reason, userId: context.userId },
    );
  }
  return outcome;
}

/** The system read of one declaration for the caller `context` names. */
async function readDeclaredKey(
  host: MembershipKeyStagingHost,
  context: any,
  d: DeclaredMembershipKey,
): Promise<MembershipKeyOutcome> {
  const miss = (reason: MembershipKeyMissReason, detail: string): MembershipKeyOutcome => ({
    ...d,
    status: 'unresolved',
    reason,
    detail,
  });
  const userId = context.userId;
  if (typeof userId !== 'string' || userId === '') {
    return miss('no-user', 'the request carries no signed-in user to read the roster for');
  }

  let objectFields: Set<string> | null;
  let meta: TenantLayer0Facts['meta'];
  try {
    objectFields = await host.getObjectFieldNames(host.metadata, d.object, host.ql);
    meta = await host.getObjectSecurityMeta(d.object);
  } catch (e) {
    return miss('read-failed', `the roster object's schema could not be read (${(e as Error)?.message ?? String(e)})`);
  }

  // Layer 0: the caller's own wall for X, and no crossing. `isPlatformAdmin`
  // is false whatever the caller holds: the read is the platform's, not the
  // caller's, so neither the caller's posture nor its audience changes which
  // roster rows count (rider 1).
  const layer0 = tenantLayer0FilterOf(
    computeTenantLayer0Verdict(
      tenantLayer0InputOf({
        tenancyPosture: host.tenancyPosture,
        context,
        meta,
        objectFields,
        tenancyDisabled: host.tenancyDisabledCache.get(d.object) === true || meta.tenancyDisabled,
        isPlatformAdmin: false,
      }),
    ),
  );
  if (layer0 === RLS_DENY_FILTER) {
    return miss('tenant-wall-denies', 'the tenant wall for the roster object denies this caller (no organization scope)');
  }

  // The filter, judged by the compiler that judges every policy, against X's
  // columns, with no caller variables: a filter reading `current_user.*`, a
  // shape that does not lower, or a column X lacks is refused.
  let filter: Record<string, unknown> | null = null;
  if (d.filter) {
    const compiled = host.rlsCompiler.compileFilter(
      [{ name: `membershipKeys.${d.key}.filter`, object: d.object, operation: 'select', using: d.filter } as RowLevelSecurityPolicy],
      {} as never,
      'using',
      objectFields
        ? {
            declared: objectFields,
            datetime: host.datetimeFieldNamesCache.get(d.object),
            number: host.numberComparandFieldsCache.get(d.object),
          }
        : undefined,
    );
    if (compiled === null || compiled === RLS_DENY_FILTER) {
      return miss('filter-refused', `the key's filter '${d.filter}' does not compile for '${d.object}'`);
    }
    filter = compiled;
  }

  const where = [{ [d.userField]: userId }, filter, layer0].filter(Boolean) as Record<string, unknown>[];
  let rows: unknown;
  try {
    rows = await host.ql.find(d.object, {
      where: where.length === 1 ? where[0] : { $and: where },
      fields: ['id', d.valueField],
      limit: MEMBERSHIP_KEY_MAX_VALUES + 1,
      // The wall is the `where` above, the caller's Layer 0 as the read door
      // composes it; the system context carries no organization of its own,
      // so under `group` every organization the wall admits counts.
      context: { isSystem: true },
    });
  } catch (e) {
    return miss('read-failed', `the roster read failed (${(e as Error)?.message ?? String(e)})`);
  }
  const list: unknown[] = Array.isArray(rows) ? rows : Array.isArray((rows as { value?: unknown })?.value) ? (rows as { value: unknown[] }).value : [];
  if (list.length > MEMBERSHIP_KEY_MAX_VALUES) {
    return miss('over-bound', `more than ${MEMBERSHIP_KEY_MAX_VALUES} roster rows match, over the per-key bound`);
  }
  const values: string[] = [];
  const rosterRowOf = new Map<string, string | undefined>();
  for (const row of list) {
    const raw = (row as Record<string, unknown> | null)?.[d.valueField];
    const id = (row as Record<string, unknown> | null)?.id;
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (typeof value !== 'string' || value === '' || rosterRowOf.has(value)) continue;
      rosterRowOf.set(value, typeof id === 'string' ? id : undefined);
      values.push(value);
    }
  }
  if (values.length > MEMBERSHIP_KEY_MAX_VALUES) {
    return miss('over-bound', `the roster rows carry more than ${MEMBERSHIP_KEY_MAX_VALUES} values, over the per-key bound`);
  }
  return { ...d, status: 'resolved', values, rosterRowOf };
}

// ── Explain ────────────────────────────────────────────────────────────────

/**
 * The staging outcomes of the declared keys `object`'s policies read on
 * `context`, in the order first read. Empty when none was read (and on a
 * context staging never saw), so a report about an object whose policies read
 * no declared key is unchanged.
 */
export async function membershipKeyOutcomesFor(context: unknown, object: string): Promise<MembershipKeyOutcome[]> {
  if (!context || typeof context !== 'object') return [];
  const state = STATE.get(context);
  const keys = state?.readBy.get(object);
  if (!state || !keys) return [];
  const out: MembershipKeyOutcome[] = [];
  for (const key of keys) {
    const outcome = await state.declared.get(key);
    if (outcome) out.push(outcome);
  }
  return out;
}

/** How a key is declared, in words: its label and description, X, F, U and the filter. */
export function describeMembershipKeyDeclaration(o: MembershipKeyOutcome): string {
  const about = [o.label, o.description].filter((text): text is string => typeof text === 'string' && text.trim() !== '');
  const named = `'${o.key}'${about.length > 0 ? ` (${about.join(' — ')})` : ''}`;
  if (!o.object) return named;
  return (
    `${named}, declared on '${o.object}' as the '${o.valueField}' values of its rows whose '${o.userField}' is the user` +
    (o.filter ? ` and on which '${o.filter}' holds` : '')
  );
}
