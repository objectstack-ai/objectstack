// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D1/D2] The ownership-queue service — the one place a queue name is
 * resolved and a queue's members are expanded.
 *
 * ## Two sources, one namespace
 *
 * A queue is DECLARED (a stack's `queues`, read from the engine registry on
 * every use, never copied into rows) or AUTHORED (an organization's
 * `sys_queue` row). Resolution reads the registry first, then the
 * organization's rows (ADR-0131 D4): a declared queue switched off in the
 * activation ledger (`sys_metadata_activation`, `metadata_type: 'queue'`)
 * resolves nowhere, and a `sys_queue` row may not take a declared queue's name
 * ({@link bindQueueGuards} refuses that write).
 *
 * A queue's members are the union of its member specifications: a declared
 * queue's own (positions only), plus the organization's `sys_queue_member` rows
 * naming the queue (any of the five set-valued kinds), whichever source the
 * queue has.
 *
 * ## One expander
 *
 * {@link OwnershipQueueService.expandMembers} is the function the access path,
 * the claim admission, the assignment pool, the approver slate and the sharing
 * recipient all read. It expands each specification through the expanders the
 * sharing engine already runs (`TeamGraphService`, `PositionGraphService`,
 * `BusinessUnitGraphService`), scoped to the queue's organization, and answers
 * the union de-duplicated and ordered by user id ascending — so round-robin and
 * the least-loaded tie-break see one stable order wherever they run.
 *
 * ## Absence is not a fault
 *
 * A name that resolves nowhere answers `null` / `[]` / `false`, and an empty
 * queue answers `[]`. A failed read of a member table contributes nobody for
 * that specification (fail closed for every admission that reads it); a failed
 * read of the activation ledger leaves the declared default — on — for that
 * call and is logged, the posture the sharing-rule service takes for the same
 * ledger.
 */

import type {
  IOwnershipQueueService,
  QueueExpansionPurpose,
  QueueMemberSpec,
  ResolvedQueue,
} from '@objectstack/spec/contracts';
import { QueueMemberType } from '@objectstack/spec/security';
import { METADATA_ACTIVATION_TABLE } from '@objectstack/core';
import type { OptionalSharingLogger } from './logger-shapes.js';
import type { SharingEngine } from './sharing-service.js';
import { TeamGraphService, teamHasMember } from './team-graph.js';
import { PositionGraphService } from './position-graph.js';
import { BusinessUnitGraphService } from './business-unit-graph.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The authored queue table. */
export const QUEUE_OBJECT = 'sys_queue';
/** The authored member-specification table. */
export const QUEUE_MEMBER_OBJECT = 'sys_queue_member';
/** The `sys_metadata_activation.metadata_type` a declared queue is switched by. */
export const QUEUE_ACTIVATION_TYPE = 'queue';

/** Upper bound on one organization's authored queues / member rows read in one call. */
const QUEUE_READ_LIMIT = 10000;

/** The member kinds a specification may carry, as a set for the row guard. */
const MEMBER_KINDS: ReadonlySet<string> = new Set(QueueMemberType.options);

/** The member kinds that read the business-unit graph. */
const BU_MEMBER_KINDS: ReadonlySet<string> = new Set(['business_unit', 'unit_and_subordinates']);

/** The engine slice the service reads through: the sharing engine plus its registry. */
export interface OwnershipQueueEngine extends SharingEngine {
  registry?: {
    listItems?: (type: string) => unknown[];
    getObject?: (name: string) => unknown;
  };
}

export interface OwnershipQueueServiceOptions {
  /**
   * The engine, resolved at use and never at construction: the service is
   * registered in the plugin's `init` so the engine's `kernel:ready` boot
   * refusal finds it, before the engine is necessarily reachable.
   */
  engine: () => OwnershipQueueEngine | null | undefined;
  logger?: OptionalSharingLogger;
}

/** A declared queue as the registry serves it — only the keys this service reads. */
interface DeclaredQueueItem {
  name: string;
  label?: string;
  members?: Array<{ type?: unknown; value?: unknown }>;
  _packageId?: string;
  packageId?: string;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s === '' ? null : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * One call's memo of the reads several specifications share: a position's
 * activation and holding, a team's membership, a unit's expansion. Scoped to a
 * single public call so an answer is never older than the call that asked.
 */
interface ExpansionPass {
  /** `'addressing'` keeps a switched-off position's holders (see the contract's `expandMembers`). */
  purpose: QueueExpansionPurpose;
  positionActive: Map<string, boolean>;
  expansions: Map<string, Promise<string[]>>;
}

function newPass(purpose: QueueExpansionPurpose = 'access'): ExpansionPass {
  return { purpose, positionActive: new Map(), expansions: new Map() };
}

export class OwnershipQueueService implements IOwnershipQueueService {
  private readonly engine: () => OwnershipQueueEngine | null | undefined;
  private readonly logger?: OptionalSharingLogger;
  private readonly warned = new Set<string>();

  constructor(options: OwnershipQueueServiceOptions) {
    this.engine = options.engine;
    this.logger = options.logger;
  }

  // ── The contract ───────────────────────────────────────────────────────────

  async resolveQueue(name: string, organizationId: string | null): Promise<ResolvedQueue | null> {
    const engine = this.engine();
    if (!engine || !name) return null;
    const declared = await this.declaredQueueItem(name);
    if (declared) {
      const authoredMembers = await this.authoredMemberSpecs(engine, [name], organizationId);
      return {
        name,
        label: declared.label ?? name,
        source: 'declared',
        organizationId: null,
        members: [...declaredMemberSpecs(declared), ...(authoredMembers.get(name) ?? [])],
        ...(declared._packageId ?? declared.packageId
          ? { packageId: String(declared._packageId ?? declared.packageId) }
          : {}),
      };
    }
    // A declared name switched off in the ledger resolves nowhere — not even to
    // an authored row, which may not take a declared queue's name.
    if (this.declaredItems().some((q) => q.name === name)) return null;
    const row = await this.authoredQueueRow(engine, name, organizationId);
    if (!row) return null;
    const authoredMembers = await this.authoredMemberSpecs(engine, [name], organizationId);
    return {
      name,
      label: str(row.label) ?? name,
      source: 'authored',
      organizationId: str(row.organization_id),
      members: authoredMembers.get(name) ?? [],
    };
  }

  async expandMembers(
    name: string,
    organizationId: string | null,
    options?: { purpose?: QueueExpansionPurpose },
  ): Promise<string[]> {
    const queue = await this.resolveQueue(name, organizationId);
    if (!queue) return [];
    return this.expandSpecs(queue.members, organizationId, newPass(options?.purpose));
  }

  async isMember(userId: string, name: string, organizationId: string | null): Promise<boolean> {
    if (!userId) return false;
    const queue = await this.resolveQueue(name, organizationId);
    if (!queue) return false;
    return this.specsReachUser(queue.members, userId, organizationId, newPass());
  }

  async queuesOf(userId: string, organizationId: string | null): Promise<string[]> {
    const engine = this.engine();
    if (!engine || !userId) return [];
    const declared = await this.activeDeclaredQueues();
    const authored = await this.authoredQueueNames(engine, organizationId, new Set(this.declaredItems().map((q) => q.name)));
    const names = [...new Set([...declared.map((q) => q.name), ...authored])].sort();
    if (names.length === 0) return [];
    const memberRows = await this.authoredMemberSpecs(engine, names, organizationId);
    const declaredByName = new Map(declared.map((q) => [q.name, q] as const));
    const pass = newPass();
    const out: string[] = [];
    for (const name of names) {
      const specs = [
        ...(declaredByName.has(name) ? declaredMemberSpecs(declaredByName.get(name)!) : []),
        ...(memberRows.get(name) ?? []),
      ];
      if (await this.specsReachUser(specs, userId, organizationId, pass)) out.push(name);
    }
    return out;
  }

  // ── Helpers the plugin's other modules read ────────────────────────────────

  /**
   * The declared queue named `name`, unless the activation ledger switches it
   * off — the reader the activation door looks a `queue` row's subject up
   * through, and the first half of {@link resolveQueue}.
   */
  async declaredQueueNamed(name: string): Promise<{ name: string; packageId?: string } | null> {
    const item = await this.declaredQueueItem(name);
    if (!item) return null;
    const packageId = str(item._packageId ?? item.packageId);
    return { name: item.name, ...(packageId ? { packageId } : {}) };
  }

  private async declaredQueueItem(name: string): Promise<DeclaredQueueItem | null> {
    const item = this.declaredItems().find((q) => q.name === name);
    if (!item) return null;
    const off = await this.switchedOff(QUEUE_ACTIVATION_TYPE, [name]);
    return off.has(name) ? null : item;
  }

  /** Is `name` a declared queue's name, switched on or off? The authored-row guard's question. */
  isDeclaredQueueName(name: string): boolean {
    return this.declaredItems().some((q) => q.name === name);
  }

  /**
   * The queues in `organizationId` whose member specifications name one of
   * `values` under `kind` — the recompute's look-through from a position, team
   * or business-unit write to the queue-recipient sharing rules it moves.
   */
  async queuesNaming(kind: string, values: ReadonlySet<string>, organizationId: string | null): Promise<string[]> {
    const engine = this.engine();
    if (!engine || values.size === 0) return [];
    const out = new Set<string>();
    if (kind === 'position') {
      for (const q of await this.activeDeclaredQueues()) {
        if (declaredMemberSpecs(q).some((s) => values.has(s.value))) out.add(q.name);
      }
    }
    try {
      const rows = await engine.find(QUEUE_MEMBER_OBJECT, {
        where: {
          recipient_type: kind,
          ...(organizationId ? { organization_id: organizationId } : {}),
        },
        fields: ['queue', 'recipient_id'],
        limit: QUEUE_READ_LIMIT,
        context: SYSTEM_CTX,
      });
      for (const r of (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>) {
        const queue = str(r.queue);
        const value = str(r.recipient_id);
        if (queue && value && (BU_MEMBER_KINDS.has(kind) || values.has(value))) out.add(queue);
      }
    } catch (err: any) {
      this.warnOnce(`naming::${kind}`, '[queue] member read failed while looking through queues — the rules naming those queues are re-evaluated on their next write', { kind, error: err?.message });
    }
    return [...out].sort();
  }

  // ── Expansion ──────────────────────────────────────────────────────────────

  private async expandSpecs(
    specs: readonly QueueMemberSpec[],
    organizationId: string | null,
    pass: ExpansionPass,
  ): Promise<string[]> {
    const users = new Set<string>();
    for (const spec of specs) {
      for (const u of await this.expandSpec(spec, organizationId, pass)) users.add(u);
    }
    return [...users].sort();
  }

  private expandSpec(spec: QueueMemberSpec, organizationId: string | null, pass: ExpansionPass): Promise<string[]> {
    const key = `${spec.type}::${spec.value}`;
    let pending = pass.expansions.get(key);
    if (!pending) {
      pending = this.expandSpecUncached(spec, organizationId, pass).catch((err: any) => {
        this.warnOnce(`expand::${key}`, '[queue] a member specification could not be expanded — it contributes nobody until it can', {
          type: spec.type, value: spec.value, error: err?.message,
        });
        return [];
      });
      pass.expansions.set(key, pending);
    }
    return pending;
  }

  private async expandSpecUncached(
    spec: QueueMemberSpec,
    organizationId: string | null,
    pass: ExpansionPass,
  ): Promise<string[]> {
    const engine = this.engine();
    if (!engine || !spec.value) return [];
    const team = new TeamGraphService({ engine, organizationId });
    switch (spec.type) {
      case 'user':
        return [spec.value];
      case 'team':
        return team.expandUsers(spec.value);
      case 'position': {
        if (!(await this.positionActive(spec.value, pass))) return [];
        const positions = new PositionGraphService({ engine, organizationId, teamGraph: team });
        return positions.expandPositionUsers(spec.value, organizationId ?? undefined);
      }
      case 'business_unit':
        return new BusinessUnitGraphService({ engine, organizationId, teamGraph: team }).expandUnitMembers(spec.value);
      case 'unit_and_subordinates':
        return new BusinessUnitGraphService({ engine, organizationId, teamGraph: team }).expandUsers(spec.value);
      default:
        return [];
    }
  }

  /**
   * Does any specification reach `userId`? The user-scoped twin of
   * {@link expandSpecs}: a position or a team is answered by an indexed
   * holder check rather than a full expansion, the reason
   * `PositionGraphService.holdsPosition` exists.
   */
  private async specsReachUser(
    specs: readonly QueueMemberSpec[],
    userId: string,
    organizationId: string | null,
    pass: ExpansionPass,
  ): Promise<boolean> {
    const engine = this.engine();
    if (!engine) return false;
    for (const spec of specs) {
      if (!spec.value) continue;
      switch (spec.type) {
        case 'user':
          if (spec.value === userId) return true;
          break;
        case 'team':
          if (await teamHasMember(engine, spec.value, userId)) return true;
          break;
        case 'position': {
          if (!(await this.positionActive(spec.value, pass))) break;
          const positions = new PositionGraphService({ engine, organizationId });
          if (await positions.holdsPosition(userId, spec.value, organizationId ?? undefined)) return true;
          break;
        }
        default:
          if ((await this.expandSpec(spec, organizationId, pass)).includes(userId)) return true;
      }
    }
    return false;
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  private declaredItems(): DeclaredQueueItem[] {
    const items = this.engine()?.registry?.listItems?.('queue');
    if (!Array.isArray(items)) return [];
    return items.filter((q): q is DeclaredQueueItem => isRecord(q) && typeof q.name === 'string' && q.name !== '');
  }

  private async activeDeclaredQueues(): Promise<DeclaredQueueItem[]> {
    const items = this.declaredItems();
    if (items.length === 0) return [];
    const off = await this.switchedOff(QUEUE_ACTIVATION_TYPE, items.map((q) => q.name));
    return items.filter((q) => !off.has(q.name));
  }

  private async authoredQueueRow(
    engine: OwnershipQueueEngine,
    name: string,
    organizationId: string | null,
  ): Promise<Record<string, unknown> | null> {
    try {
      const rows = await engine.find(QUEUE_OBJECT, {
        where: { name, ...(organizationId ? { organization_id: organizationId } : {}) },
        fields: ['id', 'name', 'label', 'organization_id'],
        limit: 1,
        context: SYSTEM_CTX,
      });
      return Array.isArray(rows) && isRecord(rows[0]) ? rows[0] : null;
    } catch (err: any) {
      this.warnOnce('read::sys_queue', '[queue] sys_queue read failed — authored queues resolve nowhere until it succeeds', { error: err?.message });
      return null;
    }
  }

  private async authoredQueueNames(
    engine: OwnershipQueueEngine,
    organizationId: string | null,
    declaredNames: ReadonlySet<string>,
  ): Promise<string[]> {
    try {
      const rows = await engine.find(QUEUE_OBJECT, {
        where: organizationId ? { organization_id: organizationId } : {},
        fields: ['name'],
        limit: QUEUE_READ_LIMIT,
        context: SYSTEM_CTX,
      });
      const out: string[] = [];
      for (const r of (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>) {
        const name = str(r.name);
        // A row under a declared name is not a second queue (the guard refuses
        // the write; a row that predates the declaration is reported there).
        if (name && !declaredNames.has(name)) out.push(name);
      }
      return out;
    } catch (err: any) {
      this.warnOnce('read::sys_queue', '[queue] sys_queue read failed — authored queues resolve nowhere until it succeeds', { error: err?.message });
      return [];
    }
  }

  /** The organization's `sys_queue_member` rows for `names`, grouped by queue. */
  private async authoredMemberSpecs(
    engine: OwnershipQueueEngine,
    names: readonly string[],
    organizationId: string | null,
  ): Promise<Map<string, QueueMemberSpec[]>> {
    const out = new Map<string, QueueMemberSpec[]>();
    if (names.length === 0) return out;
    try {
      const rows = await engine.find(QUEUE_MEMBER_OBJECT, {
        where: {
          queue: names.length === 1 ? names[0] : { $in: [...names] },
          ...(organizationId ? { organization_id: organizationId } : {}),
        },
        fields: ['queue', 'recipient_type', 'recipient_id'],
        limit: QUEUE_READ_LIMIT,
        context: SYSTEM_CTX,
      });
      for (const r of (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>) {
        const queue = str(r.queue);
        const type = str(r.recipient_type);
        const value = str(r.recipient_id);
        if (!queue || !type || !value || !MEMBER_KINDS.has(type)) continue;
        const list = out.get(queue) ?? [];
        list.push({ type: type as QueueMemberSpec['type'], value });
        out.set(queue, list);
      }
    } catch (err: any) {
      this.warnOnce('read::sys_queue_member', '[queue] sys_queue_member read failed — authored members count as nobody until it succeeds', { error: err?.message });
    }
    return out;
  }

  /**
   * A deactivated position confers nothing, here as for a sharing rule's
   * position recipient: read from the activation ledger, no row = active.
   */
  private async positionActive(name: string, pass: ExpansionPass): Promise<boolean> {
    if (pass.purpose === 'addressing') return true;
    const memo = pass.positionActive.get(name);
    if (memo !== undefined) return memo;
    const verdict = !(await this.switchedOff('position', [name])).has(name);
    pass.positionActive.set(name, verdict);
    return verdict;
  }

  /**
   * The names of `type` the activation ledger switches off. A composition with
   * no ledger object issues no read; a failed read switches nothing off for
   * this call and says so.
   */
  private async switchedOff(type: string, names: readonly string[]): Promise<Set<string>> {
    const off = new Set<string>();
    const engine = this.engine();
    if (!engine || names.length === 0) return off;
    const getObject = engine.registry?.getObject;
    if (typeof getObject === 'function' && !getObject.call(engine.registry, METADATA_ACTIVATION_TABLE)) return off;
    try {
      const rows = await engine.find(METADATA_ACTIVATION_TABLE, {
        filter: { metadata_type: type, name: names.length === 1 ? names[0] : { $in: [...names] } },
        fields: ['metadata_type', 'name', 'active'],
        limit: names.length,
        context: SYSTEM_CTX,
      });
      for (const row of (Array.isArray(rows) ? rows : []) as Array<{ name?: unknown; active?: unknown }>) {
        if (row.active === false || row.active === 0) off.add(String(row.name));
      }
    } catch (err: any) {
      this.warnOnce(`ledger::${type}`, `[queue] ${METADATA_ACTIVATION_TABLE} read failed — '${type}' items treated as switched ON for this call`, { error: err?.message });
    }
    return off;
  }

  private warnOnce(key: string, message: string, meta: Record<string, unknown>): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger?.warn?.(message, meta);
  }
}

/** A declared queue's member specifications — positions, by the schema's own rule. */
function declaredMemberSpecs(q: DeclaredQueueItem): QueueMemberSpec[] {
  const out: QueueMemberSpec[] = [];
  for (const m of Array.isArray(q.members) ? q.members : []) {
    const value = str(m?.value);
    if (m?.type === 'position' && value) out.push({ type: 'position', value });
  }
  return out;
}

/** Does any of a queue's specifications read the business-unit graph? */
export function specsReadBusinessUnits(specs: readonly QueueMemberSpec[]): boolean {
  return specs.some((s) => BU_MEMBER_KINDS.has(s.type));
}
