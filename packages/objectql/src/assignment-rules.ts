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
 * organization leaves the row ownerless with `queue` unset and warns; a read
 * that fails leaves the row as it was (with `queue` set when the entry had
 * already chosen one) and warns. Intake is never refused by assignment.
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
import { METADATA_ACTIVATION_TABLE } from '@objectstack/core';
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
   * Evaluate `object`'s rules over `candidates`, writing `owner_id` / `queue`
   * onto each row in place. Never throws.
   */
  async apply(object: string, candidates: readonly AssignmentCandidate[]): Promise<void> {
    const pending = candidates.filter((c) => present(c.row[OWNER_FIELD]) === null && present(c.row[QUEUE_FIELD]) === null);
    if (pending.length === 0) return;
    const declared = this.rulesFor(object);
    if (declared.length === 0) return;
    let rules: ActiveRule[];
    try {
      rules = await this.switchedOn(declared);
    } catch {
      rules = declared;
    }
    if (rules.length === 0) return;

    // Batch-local least-loaded adjustments, keyed per rule, entry and organization.
    const loads = new Map<string, Map<string, number>>();
    for (const candidate of pending) {
      try {
        await this.assignOne(object, rules, candidate, loads);
      } catch (err: any) {
        // ⛔ Intake is never refused by assignment.
        this.host.logger?.warn?.('[assignment] evaluation failed — the row is written as it stood', {
          object, error: err?.message,
        });
      }
    }
  }

  private async assignOne(
    object: string,
    rules: readonly ActiveRule[],
    { row, organizationId }: AssignmentCandidate,
    loads: Map<string, Map<string, number>>,
  ): Promise<void> {
    if (!organizationId) {
      this.warnOnce(`no-org::${object}`, `[assignment] a row of '${object}' has no organization, so no assignment rule is evaluated for it — it is written ownerless`, { object });
      return;
    }
    const ctx = { isSystem: true, tenantId: organizationId, positions: [], permissions: [] };
    for (const rule of rules) {
      for (const entry of rule.entries) {
        if (!this.matches(rule, entry, row)) continue;
        await this.route(object, rule, entry, row, organizationId, ctx, loads);
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
    loads: Map<string, Map<string, number>>,
  ): Promise<void> {
    if (entry.assignTo.type === 'user') {
      row[OWNER_FIELD] = entry.assignTo.value;
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
        ? await this.leastLoaded(object, rule, entry, members, organizationId, ctx, loads)
        : await this.roundRobin(rule, entry, members, organizationId, ctx);
      if (chosen) row[OWNER_FIELD] = chosen;
    } catch (err: any) {
      if (!(err instanceof AssignmentReadFailure)) throw err;
      this.host.logger?.warn?.('[assignment] a strategy read failed — the row parks in the queue', { rule: rule.name, entry: entry.name, error: err.message });
    }
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
      // The schema refuses `least_loaded` without `load`, and the authoring
      // gate refuses a `load` the compiler cannot lower — so this is a body
      // that skipped both. Never "count everything".
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
