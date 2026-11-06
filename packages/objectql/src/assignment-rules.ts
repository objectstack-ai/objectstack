// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D5] The assignment seam: declared routing of an inserted row to a
 * queue or a user, evaluated by the engine once per inserted row.
 *
 * ## When, and on which rows
 *
 * `ObjectQL.insert` calls {@link AssignmentRuleEvaluator.apply} after every
 * `beforeInsert` hook has run and after the system-insert organization is
 * resolved, before the write — and only rows whose `owner_id` and `queue` are
 * both still empty are evaluated. A writer-supplied owner was adjudicated by
 * the ownership gate, a middleware-stamped owner is the acting user's own
 * record, and a hook that set or cleared one spoke for the scenario first
 * (ADR-0138 D1 item 3's order: hooks, then assignment rules). An update never
 * evaluates a rule.
 *
 * ## Two sources, and their order
 *
 * A rule is DECLARED (a stack's `assignmentRules`, read from the registry) or
 * AUTHORED by an organization (a `sys_assignment_rule` row, owned by
 * `@objectstack/plugin-sharing`; one row is one rule with one entry, named
 * after the rule). The engine is first-match, and an object's authored rules
 * go FIRST — ascending by `sort_order`, then by `name` — with the declared
 * rules, in registry order, as the fallback. The other order would let an
 * organization's rule never win: the activation ledger that switches a
 * declared rule off is one deployment-wide row per rule with no organization
 * column, so an organization cannot switch a package rule off for itself
 * alone (ruling A on organization-authored routing, its execution parameter
 * 1). An authored row under a declared rule's name is not evaluated — one
 * name means one rule (ADR-0131 D4): the declared rule answers for it, as the
 * declared queue answers for a `sys_queue` row under its name. The rows are
 * validated on save by plugin-sharing's guard, which compiles `criteria` and
 * `load` through {@link assignmentExpressionRefusals}, the paths this module
 * evaluates them by.
 *
 * ## As which identity
 *
 * A platform step, not app automation: every read — the queue's members, a
 * member's load, the cursor — runs under an explicit system context pinned to
 * the row's organization. The owner it picks is ownership, not attribution:
 * the row's audit columns still record the writer. A row with no organization
 * evaluates no rule (logged once).
 *
 * ## What it writes, and what it never does
 *
 * `owner_id` (when a member or a user was chosen) and `queue` (for a queue
 * target). Nothing else. It never refuses an insert: an empty pool parks the
 * row and warns once per rule; a queue that resolves nowhere in the row's
 * organization leaves the row ownerless with `queue` unset and warns; a user
 * target who is not an active member of the row's organization
 * ({@link organizationMemberStanding}) leaves the row ownerless the same way
 * and warns once; a read that fails leaves the row as it was (with `queue`
 * set when the entry had already chosen one) and warns — the organization's
 * own rules unreadable included, which routes the row by no rule rather than
 * by the fallback its own rules would have overtaken. Intake is never refused
 * by assignment.
 *
 * ## The strategies
 *
 * Over the queue's member expansion, ordered by user id (the queue service's
 * one expander):
 *
 * - `least_loaded` — per member, the count of the object's rows in the
 *   organization the member owns and that match the entry's `load` predicate
 *   (lowered by the one canonical CEL compiler). The smallest wins; a tie goes
 *   to the earlier member. Counts are adjusted locally within one insert call.
 * - `round_robin` — the member after the one the entry's cursor last chose
 *   (`sys_assignment_cursor`, one row per rule, entry and organization),
 *   advanced through the by-id write precondition `{ version }` and retried on
 *   a lost race.
 */

import { compileCelToFilter, ExpressionEngine } from '@objectstack/formula';
import { METADATA_ACTIVATION_TABLE, isUserBanInForce } from '@objectstack/core';
import { resolveInjectedColumnProvenance } from '@objectstack/spec/data';
import type { IOwnershipQueueService } from '@objectstack/spec/contracts';

/**
 * The engine slot where `ObjectQLPlugin` puts the SOURCE of the registered
 * ownership-queue service — resolved at use, never at init, for the reason
 * {@link SECURITY_SERVICE_SOURCE_SLOT} gives. A wiring seam between this
 * package's plugin and its engine: ⛔ not re-exported by `index.ts`.
 */
export const OWNERSHIP_QUEUE_SOURCE_SLOT: unique symbol = Symbol.for('objectstack.objectql.ownershipQueueSource');

/** The round-robin cursor table (owned by `@objectstack/plugin-sharing`). */
export const ASSIGNMENT_CURSOR_OBJECT = 'sys_assignment_cursor';
/** The registry type and the activation-ledger `metadata_type` of an assignment rule. */
export const ASSIGNMENT_RULE_TYPE = 'assignment_rule';
/** An organization's own assignment rules (owned by `@objectstack/plugin-sharing`). */
export const ASSIGNMENT_RULE_OBJECT = 'sys_assignment_rule';
/** The organization membership table a user target is resolved against. */
const MEMBER_OBJECT = 'sys_member';
/** The user table whose ban columns a user target's standing reads. */
const USER_OBJECT = 'sys_user';

const OWNER_FIELD = 'owner_id';
const QUEUE_FIELD = 'queue';
/** How many times a lost cursor race is re-read and retried before the row parks. */
const CURSOR_RETRIES = 5;

/** The slice of the queue service the seam reads. */
export type AssignmentQueueService = Pick<IOwnershipQueueService, 'resolveQueue' | 'expandMembers'>;

/** What the engine lends the seam. Every read and write runs under `context`, a system context the seam builds. */
export interface AssignmentHost {
  /** The declared assignment rules, as the registry serves them. */
  listRules(): unknown[];
  getSchema(object: string): unknown;
  hasObject(object: string): boolean;
  queues(): AssignmentQueueService | null;
  find(object: string, where: Record<string, unknown>, context: Record<string, unknown>, limit?: number): Promise<Record<string, unknown>[]>;
  count(object: string, where: Record<string, unknown>, context: Record<string, unknown>): Promise<number>;
  insert(object: string, data: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown>;
  /** A by-id update under the engine-internal precondition; throws `CONCURRENT_UPDATE` when it matched nothing. */
  updateExpecting(
    object: string,
    id: unknown,
    data: Record<string, unknown>,
    expect: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<unknown>;
  logger?: { warn?: (msg: string, meta?: Record<string, unknown>) => void };
}

/** One row the insert is about to write, with the organization it lands in. */
export interface AssignmentCandidate {
  row: Record<string, unknown>;
  organizationId: string | null;
}

interface RuleEntry {
  name: string;
  criteria?: { dialect: string; source: string };
  assignTo: { type: 'queue' | 'user'; value: string };
  strategy?: 'round_robin' | 'least_loaded';
  load?: string;
}

interface ActiveRule {
  name: string;
  object: string;
  entries: RuleEntry[];
}

/** One evaluation's memo: least-loaded counts and user-target standings, never older than the insert that asked. */
interface EvaluationPass {
  loads: Map<string, Map<string, number>>;
  standings: Map<string, Promise<OrganizationMemberStanding>>;
}

function present(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s === '' ? null : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** A CEL slot as authored (`'…'`) or as parsed (`{ dialect, source }`). */
function expressionOf(v: unknown): { dialect: string; source: string } | undefined {
  if (typeof v === 'string' && v.trim() !== '') return { dialect: 'cel', source: v };
  if (isRecord(v) && typeof v.source === 'string' && v.source.trim() !== '') {
    return { dialect: typeof v.dialect === 'string' ? v.dialect : 'cel', source: v.source };
  }
  return undefined;
}

function ruleOf(item: unknown): ActiveRule | null {
  if (!isRecord(item) || typeof item.name !== 'string' || typeof item.object !== 'string') return null;
  if (item.active === false) return null;
  const entries: RuleEntry[] = [];
  for (const e of Array.isArray(item.entries) ? item.entries : []) {
    if (!isRecord(e) || typeof e.name !== 'string' || !isRecord(e.assignTo)) continue;
    const type = e.assignTo.type;
    const value = present(e.assignTo.value);
    if ((type !== 'queue' && type !== 'user') || !value) continue;
    entries.push({
      name: e.name,
      criteria: expressionOf(e.criteria),
      assignTo: { type, value },
      ...(e.strategy === 'round_robin' || e.strategy === 'least_loaded' ? { strategy: e.strategy } : {}),
      ...(expressionOf(e.load) ? { load: expressionOf(e.load)!.source } : {}),
    });
  }
  return entries.length > 0 ? { name: item.name, object: item.object, entries } : null;
}

/**
 * A stored `sys_assignment_rule` row as the rule it is: one entry, named after
 * the rule, so the round-robin cursor keys it (rule, entry, organization) like
 * any declared entry. `null` for a row that does not read as a rule.
 */
function authoredRuleOf(row: Record<string, unknown>): ActiveRule | null {
  const name = present(row.name);
  if (!name) return null;
  return ruleOf({
    name,
    object: row.object_name,
    entries: [{
      name,
      criteria: row.criteria,
      assignTo: { type: row.recipient_type, value: row.recipient_id },
      strategy: row.strategy,
      load: row.load,
    }],
  });
}

function sortOrderOf(row: Record<string, unknown>): number {
  const n = Number(row.sort_order ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The refusals of an entry's `criteria` and `load`, compiled by the paths
 * this module evaluates them by — `criteria` by the expression engine that
 * {@link AssignmentRuleEvaluator} interprets it with, `load` by the pushdown
 * compiler its least-loaded count lowers it with. Empty when both compile (or
 * are absent). The save guard of an organization's `sys_assignment_rule` row
 * asks this, so a rule the engine could not evaluate is refused when it is
 * written, never discovered as a warning at an insert.
 */
export function assignmentExpressionRefusals(entry: { criteria?: unknown; load?: unknown }): Array<{ field: 'criteria' | 'load'; message: string }> {
  const out: Array<{ field: 'criteria' | 'load'; message: string }> = [];
  const criteria = expressionOf(entry.criteria);
  if (criteria) {
    const compiled = ExpressionEngine.compile(criteria as any);
    if (!compiled.ok) {
      out.push({ field: 'criteria', message: (compiled as any).error?.message ?? 'the condition does not compile' });
    }
  }
  const load = expressionOf(entry.load);
  if (load) {
    const compiled = compileCelToFilter(load.source, { variables: {} });
    if (!compiled.ok) {
      out.push({ field: 'load', message: compiled.detail ?? compiled.reason });
    }
  }
  return out;
}

/**
 * Where a user stands in an organization, for a user target: `member` — a
 * `sys_member` row in that organization, and no ban in force on the user
 * (`isUserBanInForce`, the one ban predicate); `not_member`; `banned`; or
 * `unconfirmable` — no membership table is registered, so no user can be
 * confirmed as anyone's member. A failed read throws: the caller says what
 * the row does then.
 *
 * The one predicate for an active member of an organization on this surface:
 * the engine asks it of every user target at insert, and plugin-sharing's
 * save guard asks it of an organization rule's user target.
 */
export type OrganizationMemberStanding = 'member' | 'not_member' | 'banned' | 'unconfirmable';

export async function organizationMemberStanding(
  read: Pick<AssignmentHost, 'hasObject' | 'find'>,
  userId: string,
  organizationId: string,
): Promise<OrganizationMemberStanding> {
  if (!read.hasObject(MEMBER_OBJECT)) return 'unconfirmable';
  const pinned = { isSystem: true, tenantId: organizationId, positions: [], permissions: [] };
  const memberships = await read.find(MEMBER_OBJECT, { user_id: userId, organization_id: organizationId }, pinned, 1);
  if (!Array.isArray(memberships) || memberships.length === 0) return 'not_member';
  if (!read.hasObject(USER_OBJECT)) return 'member';
  const users = await read.find(USER_OBJECT, { id: userId }, { isSystem: true, positions: [], permissions: [] }, 1);
  const user = Array.isArray(users) ? users[0] : undefined;
  if (!user) return 'not_member';
  return isUserBanInForce(user) ? 'banned' : 'member';
}

/** Does `object` carry the platform's `queue` column, with storage behind it? */
export function carriesQueueColumn(schema: unknown): boolean {
  return resolveInjectedColumnProvenance(schema, QUEUE_FIELD) === 'injected-provisioned';
}

/** A read failed inside the evaluation: the row keeps what it had, the failure is logged. */
class AssignmentReadFailure extends Error {}

export class AssignmentRuleEvaluator {
  private readonly warned = new Set<string>();

  constructor(private readonly host: AssignmentHost) {}

  /**
   * The object's active declared rules, in registry order — `[]` (the cheap
   * path every insert takes) when none names it or it carries no `queue`.
   */
  rulesFor(object: string): ActiveRule[] {
    let items: unknown[];
    try {
      items = this.host.listRules();
    } catch {
      return [];
    }
    const rules: ActiveRule[] = [];
    for (const item of Array.isArray(items) ? items : []) {
      const rule = ruleOf(item);
      if (rule && rule.object === object) rules.push(rule);
    }
    if (rules.length === 0) return rules;
    if (!carriesQueueColumn(this.host.getSchema(object))) {
      this.warnOnce(`no-column::${object}`, `[assignment] '${object}' has assignment rules but no ownership-queue column (its records have no user owner, or it is federated) — the rules route nothing`, { object, rules: rules.map((r) => r.name) });
      return [];
    }
    return rules;
  }

  /**
   * Can an insert into `object` be routed at all? The engine's cheap gate:
   * `true` when a declared rule names the object, or when organizations can
   * author rules (`sys_assignment_rule` is registered) and the object carries
   * the queue column those rules need. Registry reads only.
   */
  mayRoute(object: string): boolean {
    return this.rulesFor(object).length > 0 || this.authoredRulesPossible(object);
  }

  private authoredRulesPossible(object: string): boolean {
    return object !== ASSIGNMENT_RULE_OBJECT
      && this.host.hasObject(ASSIGNMENT_RULE_OBJECT)
      && carriesQueueColumn(this.host.getSchema(object));
  }

  /**
   * Evaluate `object`'s rules over `candidates`, writing `owner_id` / `queue`
   * onto each row in place. Never throws.
   */
  async apply(object: string, candidates: readonly AssignmentCandidate[]): Promise<void> {
    const pending = candidates.filter((c) => present(c.row[OWNER_FIELD]) === null && present(c.row[QUEUE_FIELD]) === null);
    if (pending.length === 0) return;
    const declared = this.rulesFor(object);
    const authoredPossible = this.authoredRulesPossible(object);
    if (declared.length === 0 && !authoredPossible) return;
    let fallback: ActiveRule[] = [];
    if (declared.length > 0) {
      try {
        fallback = await this.switchedOn(declared);
      } catch {
        fallback = declared;
      }
    }

    // An organization's own rules, read once per organization in the batch;
    // `null` marks an organization whose rules could not be read.
    const authored = new Map<string, ActiveRule[] | null>();
    if (authoredPossible) {
      const declaredNames = new Set(declared.map((r) => r.name));
      for (const name of this.declaredRuleNames()) declaredNames.add(name);
      for (const { organizationId } of pending) {
        if (organizationId && !authored.has(organizationId)) {
          authored.set(organizationId, await this.authoredRules(object, organizationId, declaredNames));
        }
      }
    }

    // Batch-local least-loaded adjustments, keyed per rule, entry and
    // organization, and user-target standings, keyed per user and organization.
    const pass: EvaluationPass = { loads: new Map(), standings: new Map() };
    for (const candidate of pending) {
      const own = candidate.organizationId ? authored.get(candidate.organizationId) : undefined;
      // The organization's rules go first; when they could not be read the row
      // is written as it stood — never routed by the fallback they overtake.
      if (own === null) continue;
      const rules = own ? [...own, ...fallback] : fallback;
      // A row with no organization is reported (inside `assignOne`) only when
      // a declared rule names its object; no rule at all is the cheap case.
      if (rules.length === 0) continue;
      try {
        await this.assignOne(object, rules, candidate, pass);
      } catch (err: any) {
        // ⛔ Intake is never refused by assignment.
        this.host.logger?.warn?.('[assignment] evaluation failed — the row is written as it stood', {
          object, error: err?.message,
        });
      }
    }
  }

  /** Every declared assignment rule's name, switched on or off, any object — the one namespace an authored row may not take. */
  private declaredRuleNames(): string[] {
    let items: unknown[];
    try {
      items = this.host.listRules();
    } catch {
      return [];
    }
    return (Array.isArray(items) ? items : [])
      .map((item) => (isRecord(item) && typeof item.name === 'string' ? item.name : null))
      .filter((name): name is string => name !== null);
  }

  /**
   * `organizationId`'s own active rules for `object`, in evaluation order
   * (`sort_order`, then `name`) — or `null` when the read failed, which the
   * caller answers by routing the organization's rows by no rule.
   */
  private async authoredRules(object: string, organizationId: string, declaredNames: ReadonlySet<string>): Promise<ActiveRule[] | null> {
    const ctx = { isSystem: true, tenantId: organizationId, positions: [], permissions: [] };
    let rows: Record<string, unknown>[];
    try {
      rows = await this.host.find(ASSIGNMENT_RULE_OBJECT, { object_name: object, organization_id: organizationId }, ctx);
    } catch (err: any) {
      this.host.logger?.warn?.(`[assignment] the assignment rules of organization '${organizationId}' could not be read — its new '${object}' rows are written as they stood, routed by no rule`, {
        object, organization: organizationId, error: err?.message,
      });
      return null;
    }
    const ordered = (Array.isArray(rows) ? rows : [])
      .filter(isRecord)
      .sort((a, b) => sortOrderOf(a) - sortOrderOf(b) || String(a.name ?? '').localeCompare(String(b.name ?? '')));
    const rules: ActiveRule[] = [];
    for (const row of ordered) {
      const name = present(row.name);
      if (name && declaredNames.has(name)) {
        this.warnOnce(`shadowed::${organizationId}::${name}`, `[assignment] organization '${organizationId}' has an assignment rule named '${name}', which is the name of a rule an installed app declares — one name means one rule, so the app's rule answers for it and the organization's is not evaluated. Rename the organization's rule to keep it.`, {
          rule: name, organization: organizationId,
        });
        continue;
      }
      if (row.active === false || row.active === 0 || row.active === '0' || row.active === 'false') continue;
      const rule = authoredRuleOf(row);
      if (!rule) {
        this.warnOnce(`unreadable::${organizationId}::${name ?? String(row.id ?? '')}`, `[assignment] organization '${organizationId}' has an assignment rule${name ? ` '${name}'` : ''} that does not read as a rule (no recipient, or an unknown recipient type) — it routes nothing until it is corrected`, {
          rule: name, organization: organizationId,
        });
        continue;
      }
      if (rule.object === object) rules.push(rule);
    }
    return rules;
  }

  private async assignOne(
    object: string,
    rules: readonly ActiveRule[],
    { row, organizationId }: AssignmentCandidate,
    pass: EvaluationPass,
  ): Promise<void> {
    if (!organizationId) {
      this.warnOnce(`no-org::${object}`, `[assignment] a row of '${object}' has no organization, so no assignment rule is evaluated for it — it is written ownerless`, { object });
      return;
    }
    const ctx = { isSystem: true, tenantId: organizationId, positions: [], permissions: [] };
    for (const rule of rules) {
      for (const entry of rule.entries) {
        if (!this.matches(rule, entry, row)) continue;
        await this.route(object, rule, entry, row, organizationId, ctx, pass);
        return; // the first matching entry of the first matching rule decides
      }
    }
  }

  /** The entry's `criteria`, interpreted against the row in flight (it is not stored yet). Absent = every row. */
  private matches(rule: ActiveRule, entry: RuleEntry, row: Record<string, unknown>): boolean {
    if (!entry.criteria) return true;
    const r = ExpressionEngine.evaluate<boolean>(entry.criteria as any, { record: row } as any);
    if (r.ok) return r.value === true;
    this.warnOnce(`criteria::${rule.name}::${entry.name}`, `[assignment] the criteria of rule '${rule.name}' entry '${entry.name}' could not be evaluated — the entry does not match until it can`, {
      rule: rule.name, entry: entry.name, error: (r as any).error?.message,
    });
    return false;
  }

  private async route(
    object: string,
    rule: ActiveRule,
    entry: RuleEntry,
    row: Record<string, unknown>,
    organizationId: string,
    ctx: Record<string, unknown>,
    pass: EvaluationPass,
  ): Promise<void> {
    if (entry.assignTo.type === 'user') {
      await this.routeToUser(rule, entry.assignTo.value, row, organizationId, pass);
      return;
    }
    const queueName = entry.assignTo.value;
    const queues = this.host.queues();
    if (!queues) {
      this.warnOnce(`no-service::${rule.name}`, `[assignment] rule '${rule.name}' routes into a queue, but no ownership-queue service is registered — the row is written ownerless`, { rule: rule.name });
      return;
    }
    let resolved: unknown;
    try {
      resolved = await queues.resolveQueue(queueName, organizationId);
    } catch (err: any) {
      this.host.logger?.warn?.('[assignment] the queue could not be resolved — the row is written as it stood', { rule: rule.name, queue: queueName, organization: organizationId, error: err?.message });
      return;
    }
    if (!resolved) {
      this.warnOnce(`unresolved::${rule.name}::${queueName}::${organizationId}`, `[assignment] rule '${rule.name}' routes into queue '${queueName}', which does not resolve in organization '${organizationId}' — the row is written ownerless, in no queue. Declare the queue, or author it in that organization.`, {
        rule: rule.name, queue: queueName, organization: organizationId,
      });
      return;
    }
    // From here the row sits in the queue whatever happens next.
    row[QUEUE_FIELD] = queueName;
    if (!entry.strategy) return; // park

    let members: string[];
    try {
      members = await queues.expandMembers(queueName, organizationId);
    } catch (err: any) {
      this.host.logger?.warn?.('[assignment] the queue\'s members could not be read — the row parks in the queue', { rule: rule.name, queue: queueName, error: err?.message });
      return;
    }
    if (members.length === 0) {
      this.warnOnce(`empty::${rule.name}`, `[assignment] rule '${rule.name}' routes into queue '${queueName}', which has no members in organization '${organizationId}' — the row parks in the queue. Staff the queue to have rows assigned.`, {
        rule: rule.name, queue: queueName, organization: organizationId,
      });
      return;
    }
    try {
      const chosen = entry.strategy === 'least_loaded'
        ? await this.leastLoaded(object, rule, entry, members, organizationId, ctx, pass.loads)
        : await this.roundRobin(rule, entry, members, organizationId, ctx);
      if (chosen) row[OWNER_FIELD] = chosen;
    } catch (err: any) {
      if (!(err instanceof AssignmentReadFailure)) throw err;
      this.host.logger?.warn?.('[assignment] a strategy read failed — the row parks in the queue', { rule: rule.name, entry: entry.name, error: err.message });
    }
  }

  /**
   * A user target owns the row only while the user is an active member of the
   * row's organization (ruling A's execution parameter 2). One that no longer
   * resolves is a lapsed target, handled as a lapsed queue is: the row is
   * written ownerless and the lapse is logged once, never refused.
   */
  private async routeToUser(
    rule: ActiveRule,
    userId: string,
    row: Record<string, unknown>,
    organizationId: string,
    pass: EvaluationPass,
  ): Promise<void> {
    const key = `${userId}::${organizationId}`;
    let standing = pass.standings.get(key);
    if (!standing) {
      standing = organizationMemberStanding(this.host, userId, organizationId);
      pass.standings.set(key, standing);
    }
    let answer: OrganizationMemberStanding;
    try {
      answer = await standing;
    } catch (err: any) {
      this.host.logger?.warn?.('[assignment] the user target\'s membership could not be read — the row is written as it stood', {
        rule: rule.name, user: userId, organization: organizationId, error: err?.message,
      });
      return;
    }
    if (answer === 'member') {
      row[OWNER_FIELD] = userId;
      return;
    }
    if (answer === 'unconfirmable') {
      this.warnOnce(`unconfirmable::${rule.name}`, `[assignment] rule '${rule.name}' assigns to user '${userId}', but no organization membership table ('${MEMBER_OBJECT}') is registered, so no user can be confirmed as a member — the row is written ownerless.`, {
        rule: rule.name, user: userId, organization: organizationId,
      });
      return;
    }
    const why = answer === 'banned' ? 'whose account is banned' : `who is not a member of organization '${organizationId}'`;
    this.warnOnce(`lapsed-user::${rule.name}::${userId}::${organizationId}`, `[assignment] rule '${rule.name}' assigns to user '${userId}', ${why} — the row is written ownerless. Point the rule at a current member, or at a queue.`, {
      rule: rule.name, user: userId, organization: organizationId, standing: answer,
    });
  }

  private async leastLoaded(
    object: string,
    rule: ActiveRule,
    entry: RuleEntry,
    members: readonly string[],
    organizationId: string,
    ctx: Record<string, unknown>,
    loads: Map<string, Map<string, number>>,
  ): Promise<string | null> {
    // The count reads the object's own `owner_id` and `organization_id`: only
    // on an object whose platform columns have storage behind them (a
    // federated object's are the injection's alone, and `rulesFor` admitted
    // none — asked again here, at the read).
    if (!carriesQueueColumn(this.host.getSchema(object))) return null;
    const compiled = entry.load ? compileCelToFilter(entry.load, { variables: {} }) : null;
    if (!compiled || !compiled.ok) {
      // The schema refuses `least_loaded` without `load`, but nothing before
      // this point asks whether the compiler can lower it: a body that skipped
      // the schema, or a `load` the compiler cannot lower, lands here. Never
      // "count everything".
      this.warnOnce(`load::${rule.name}::${entry.name}`, `[assignment] rule '${rule.name}' entry '${entry.name}' has no \`load\` the platform can count by — the row parks in the queue`, {
        rule: rule.name, entry: entry.name, ...(compiled && !compiled.ok ? { reason: compiled.reason, detail: compiled.detail } : {}),
      });
      return null;
    }
    const key = `${rule.name}::${entry.name}::${organizationId}`;
    let counts = loads.get(key);
    if (!counts) {
      counts = new Map();
      for (const member of members) {
        try {
          counts.set(member, await this.host.count(object, { $and: [{ [OWNER_FIELD]: member, organization_id: organizationId }, compiled.filter] }, ctx));
        } catch (err: any) {
          throw new AssignmentReadFailure(err?.message ?? 'count failed');
        }
      }
      loads.set(key, counts);
    }
    let best: string | null = null;
    let bestCount = Infinity;
    for (const member of members) {
      const n = counts.get(member) ?? 0;
      if (n < bestCount) {
        best = member;
        bestCount = n;
      }
    }
    if (best) counts.set(best, bestCount + 1);
    return best;
  }

  private async roundRobin(
    rule: ActiveRule,
    entry: RuleEntry,
    members: readonly string[],
    organizationId: string,
    ctx: Record<string, unknown>,
  ): Promise<string | null> {
    const where = { rule: rule.name, entry: entry.name, organization_id: organizationId };
    for (let attempt = 0; attempt < CURSOR_RETRIES; attempt++) {
      let cursor: Record<string, unknown> | undefined;
      try {
        cursor = (await this.host.find(ASSIGNMENT_CURSOR_OBJECT, where, ctx, 1))[0];
      } catch (err: any) {
        throw new AssignmentReadFailure(err?.message ?? 'cursor read failed');
      }
      const next = nextMember(members, present(cursor?.last_user_id));
      try {
        if (!cursor) {
          await this.host.insert(ASSIGNMENT_CURSOR_OBJECT, { ...where, last_user_id: next, version: 1 }, ctx);
        } else {
          const version = Number(cursor.version ?? 0);
          await this.host.updateExpecting(
            ASSIGNMENT_CURSOR_OBJECT, cursor.id, { last_user_id: next, version: version + 1 }, { version }, ctx,
          );
        }
        return next;
      } catch (err: any) {
        // A lost race — another insert advanced or created the cursor first.
        if (err?.code === 'CONCURRENT_UPDATE' || err?.code === 'DUPLICATE_RECORD') continue;
        throw new AssignmentReadFailure(err?.message ?? 'cursor write failed');
      }
    }
    this.host.logger?.warn?.('[assignment] the round-robin cursor kept moving under concurrent inserts — the row parks in the queue', { rule: rule.name, entry: entry.name });
    return null;
  }

  /** The active subset of `rules`: an `assignment_rule` row with `active: false` in the activation ledger switches a rule off. */
  private async switchedOn(rules: readonly ActiveRule[]): Promise<ActiveRule[]> {
    if (!this.host.hasObject(METADATA_ACTIVATION_TABLE)) return [...rules];
    const names = rules.map((r) => r.name);
    let rows: Record<string, unknown>[] = [];
    try {
      rows = await this.host.find(
        METADATA_ACTIVATION_TABLE,
        { metadata_type: ASSIGNMENT_RULE_TYPE, name: names.length === 1 ? names[0] : { $in: names } },
        { isSystem: true, positions: [], permissions: [] },
        names.length,
      );
    } catch (err: any) {
      this.warnOnce('ledger', `[assignment] ${METADATA_ACTIVATION_TABLE} read failed — assignment rules treated as switched ON for this insert`, { error: err?.message });
      return [...rules];
    }
    const off = new Set(rows.filter((r) => r.active === false || r.active === 0).map((r) => String(r.name)));
    return rules.filter((r) => !off.has(r.name));
  }

  private warnOnce(key: string, message: string, meta: Record<string, unknown>): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.host.logger?.warn?.(message, meta);
  }
}

/**
 * The member after `last` in `members` (ordered by user id). A member set that
 * changed since the last assignment is handled by position: the first member
 * whose id sorts after `last`, wrapping to the first.
 */
export function nextMember(members: readonly string[], last: string | null): string {
  if (last === null) return members[0]!;
  return members.find((m) => m > last) ?? members[0]!;
}

/**
 * [ADR-0142 D1] The `kernel:ready` boot refusal: a stack that declares
 * `queues` or `assignmentRules` with no ownership-queue service registered
 * would have nothing behind its declarations. The probe tests the
 * `ownership-queue` service name — never the job queue's `queue`.
 */
export function describeMissingOwnershipQueueService(
  declared: { queues: readonly unknown[]; assignmentRules: readonly unknown[] },
  serviceRegistered: boolean,
): Error | null {
  if (serviceRegistered) return null;
  const keys: string[] = [];
  if (declared.queues.length > 0) keys.push(`queues (${declared.queues.length})`);
  if (declared.assignmentRules.length > 0) keys.push(`assignmentRules (${declared.assignmentRules.length})`);
  if (keys.length === 0) return null;
  return new Error(
    `[ObjectQLPlugin] the stack declares ${keys.join(' and ')}, but no 'ownership-queue' service is registered, ` +
      'so no queue would resolve and no assignment rule would route a row. Add @objectstack/plugin-sharing to ' +
      "the composition (it registers 'ownership-queue'); the job-queue service named 'queue' is a different service " +
      'and does not serve ownership queues.',
  );
}
