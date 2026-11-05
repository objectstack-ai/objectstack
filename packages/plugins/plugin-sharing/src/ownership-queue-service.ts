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
 * ## Absence is not a fault; a failed read is
 *
 * A name that resolves nowhere answers `null` / `[]` / `false`, and an empty
 * queue answers `[]`, under every option: those are facts.
 *
 * A failed read of a table behind the queue — its `sys_queue` row, its
 * `sys_queue_member` rows, or a member table a specification reads (team,
 * position, `sys_member`, business unit) — is a fault, and what the call
 * answers then is the caller's to say (ADR-0142 D2 as amended, the contract's
 * `OwnershipQueueFailedReadAnswer`):
 *
 * - `onFailedRead: 'nobody'`, the default — what sat behind the failed read
 *   contributes nobody, logged once. The admission consumers take it, because
 *   for them nobody denies: the sitting-record access path (D3), the claim
 *   (D4) and the assignment pool (D5). {@link OwnershipQueueService.queuesOf},
 *   which the access path reads, has no option and always answers this way.
 * - `onFailedRead: 'refuse'` (#29604) — the call rejects with a failure that
 *   names the queue, the organization and the read ({@link queueReadRefusal}),
 *   never `[]`, a partial set or `false`. The recompute consumers take it,
 *   because for them nobody revokes: the approver slate (D6) and the
 *   sharing-recipient grant recompute (D7). `isMember` under it still answers
 *   `true` when a read that succeeded reaches the user — a failed read beside
 *   it cannot take that membership away — and `false` only when every read
 *   behind the answer succeeded.
 *
 * A failed read of the activation ledger is neither: under either answer it
 * leaves the declared default — on — for that call and is logged, the posture
 * the sharing-rule service takes for the same ledger on its own position
 * recipients, so a queue's position and a rule's position never disagree on
 * an outage (#29604 keeps it; the contract leaves it to this service).
 *
 * ## Read to completion
 *
 * [#29604] The authored reads — an organization's `sys_queue` rows and its
 * `sys_queue_member` rows — are read to completion through the keyset walk the
 * team, position and business-unit member reads share
 * (`readMembershipToCompletion`), never cut at a row bound: a queue past the
 * bound lost its later members, a member past it lost every queue it sits in,
 * and nothing said so. A read that fails, or a walk that cannot vouch for
 * completion, is a failed read above, never an answer on the pages already
 * read.
 */

import type {
  IOwnershipQueueService,
  OwnershipQueueFailedReadAnswer,
  QueueExpansionPurpose,
  QueueMemberSpec,
  ResolvedQueue,
} from '@objectstack/spec/contracts';
import { QueueMemberType } from '@objectstack/spec/security';
import { METADATA_ACTIVATION_TABLE } from '@objectstack/core';
import type { OptionalSharingLogger } from './logger-shapes.js';
import type { SharingEngine } from './sharing-service.js';
import { TeamGraphService, readMembershipToCompletion, teamHasMember } from './team-graph.js';
import { PositionGraphService } from './position-graph.js';
import { BusinessUnitGraphService } from './business-unit-graph.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The authored queue table. */
export const QUEUE_OBJECT = 'sys_queue';
/** The authored member-specification table. */
export const QUEUE_MEMBER_OBJECT = 'sys_queue_member';
/** The `sys_metadata_activation.metadata_type` a declared queue is switched by. */
export const QUEUE_ACTIVATION_TYPE = 'queue';

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

/** A walk's or a holder check's closing consequence ("…, so the expansion refuses instead."). */
const WALK_CONSEQUENCE = / [^.]*\brefuses instead\.$/;

/**
 * The reason behind a failed authored read, for a warning that answers nobody.
 * A walk's refusal ends on its own consequence ("…, so the expansion refuses
 * instead."), which is not the answer a call under `onFailedRead: 'nobody'`
 * gives, so only the reason is logged: the driver's error the refusal carries
 * as `cause`, or, for a walk that could not vouch for completion (no cause),
 * the refusal's sentence with that closing clause cut.
 */
function readFailureReason(err: unknown): string {
  const cause = (err as { cause?: unknown } | null)?.cause;
  if (cause instanceof Error) return cause.message;
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(WALK_CONSEQUENCE, '');
}

/**
 * [#29604] The failure a call under `onFailedRead: 'refuse'` rejects with: the
 * queue, its organization, and the read that failed, in the read's own words —
 * a membership walk's or a holder check's refusal with its `[sharing]` tag and
 * its closing consequence cut (the consequence here is this sentence's), or
 * this service's own sentence for the `sys_queue` row read. The failed read's
 * error rides along as `cause`.
 */
function queueReadRefusal(name: string, organizationId: string | null, err: unknown): Error {
  const read = (err instanceof Error ? err.message : String(err))
    .replace(/^\[sharing\] /, '')
    .replace(WALK_CONSEQUENCE, '')
    .trim();
  const inOrg = organizationId ? ` in organization '${organizationId}'` : '';
  return Object.assign(
    new Error(
      `[queue] queue '${name}'${inOrg} does not answer its members, because a read behind it failed: `
        + `${read}${/[.!?]$/.test(read) ? '' : '.'} The caller asked for a refusal over a partial answer `
        + '(onFailedRead \'refuse\'): answering with the members that could be read would revoke or route past '
        + 'the ones that could not.',
    ),
    { cause: err },
  );
}

/**
 * One call's memo of the reads several specifications share: a position's
 * activation and holding, a team's membership, a unit's expansion. Scoped to a
 * single public call so an answer is never older than the call that asked.
 */
interface ExpansionPass {
  /** `'addressing'` keeps a switched-off position's holders (see the contract's `expandMembers`). */
  purpose: QueueExpansionPurpose;
  /**
   * [#29604] `onFailedRead: 'refuse'`: a failed member-table read rejects the
   * call instead of contributing nobody. An axis of its own, never read off
   * {@link purpose}.
   */
  refuse: boolean;
  positionActive: Map<string, boolean>;
  expansions: Map<string, Promise<string[]>>;
}

function newPass(
  purpose: QueueExpansionPurpose = 'access',
  onFailedRead: OwnershipQueueFailedReadAnswer = 'nobody',
): ExpansionPass {
  return { purpose, refuse: onFailedRead === 'refuse', positionActive: new Map(), expansions: new Map() };
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
    return this.resolve(name, organizationId, false);
  }

  /**
   * {@link resolveQueue}, with the caller's failed-read answer: under `refuse`
   * a failed `sys_queue` or `sys_queue_member` read rejects (a failure naming
   * the read, which the public caller wraps in {@link queueReadRefusal})
   * instead of resolving nowhere or to no authored members.
   */
  private async resolve(name: string, organizationId: string | null, refuse: boolean): Promise<ResolvedQueue | null> {
    const engine = this.engine();
    if (!engine || !name) return null;
    const declared = await this.declaredQueueItem(name);
    if (declared) {
      const authoredMembers = await this.authoredMemberSpecs(engine, [name], organizationId, refuse);
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
    const row = await this.authoredQueueRow(engine, name, organizationId, refuse);
    if (!row) return null;
    const authoredMembers = await this.authoredMemberSpecs(engine, [name], organizationId, refuse);
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
    options?: { purpose?: QueueExpansionPurpose; onFailedRead?: OwnershipQueueFailedReadAnswer },
  ): Promise<string[]> {
    const pass = newPass(options?.purpose, options?.onFailedRead);
    try {
      const queue = await this.resolve(name, organizationId, pass.refuse);
      if (!queue) return [];
      return await this.expandSpecs(queue.members, organizationId, pass);
    } catch (err) {
      // Only a call under 'refuse' gets here: under 'nobody' every read
      // behind the queue answers nobody in place (module header).
      if (!pass.refuse) throw err;
      throw queueReadRefusal(name, organizationId, err);
    }
  }

  async isMember(
    userId: string,
    name: string,
    organizationId: string | null,
    options?: { onFailedRead?: OwnershipQueueFailedReadAnswer },
  ): Promise<boolean> {
    if (!userId) return false;
    const pass = newPass('access', options?.onFailedRead);
    try {
      const queue = await this.resolve(name, organizationId, pass.refuse);
      if (!queue) return false;
      return await this.specsReachUser(queue.members, userId, organizationId, pass);
    } catch (err) {
      if (!pass.refuse) throw err;
      throw queueReadRefusal(name, organizationId, err);
    }
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

  /**
   * Does `organizationId` have at least one ownership queue? A declared queue
   * the activation ledger leaves on counts for every organization; otherwise
   * the organization's `sys_queue` rows count, except a row under a declared
   * queue's name, which resolves nowhere (see {@link resolveQueue}). So the
   * answer is `true` exactly when some name would resolve.
   *
   * The session payload's one boolean (`/auth/me/permissions` `hasAnyQueue`):
   * the console's list toolbar asks it once per session, for a member who may
   * not read `sys_queue` themselves. It discloses no name and no count. The
   * contract states it on {@link IOwnershipQueueService.hasAnyQueue}.
   */
  async hasAnyQueue(organizationId: string | null): Promise<boolean> {
    const engine = this.engine();
    if (!engine) return false;
    if ((await this.activeDeclaredQueues()).length > 0) return true;
    const declaredNames = new Set(this.declaredItems().map((q) => q.name));
    return (await this.authoredQueueNames(engine, organizationId, declaredNames)).length > 0;
  }

  // ── Helpers the plugin's other modules read ────────────────────────────────

  /**
   * The declared queue named `name`, switched on or off — the reader the
   * activation door looks a `queue` row's subject up through. It ignores the
   * ledger on purpose: a queue switched off must stay addressable, or the door
   * could never switch it back on. {@link resolveQueue} reads the ledger.
   */
  async declaredQueueNamed(name: string): Promise<{ name: string; packageId?: string } | null> {
    const item = this.declaredItems().find((q) => q.name === name);
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
      const rows = await readMembershipToCompletion(engine, {
        object: QUEUE_MEMBER_OBJECT,
        where: {
          recipient_type: kind,
          ...(organizationId ? { organization_id: organizationId } : {}),
        },
        fields: ['queue', 'recipient_id'],
        subject: `the '${kind}' member rows of the queues${organizationId ? ` in organization '${organizationId}'` : ''}`,
      });
      for (const r of rows ?? []) {
        const queue = str(r.queue);
        const value = str(r.recipient_id);
        if (queue && value && (BU_MEMBER_KINDS.has(kind) || values.has(value))) out.add(queue);
      }
    } catch (err: any) {
      this.warnOnce(`naming::${kind}`, '[queue] member read failed while looking through queues — the rules naming those queues are re-evaluated on their next write', { kind, error: readFailureReason(err) });
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
        // [#29604] Under 'refuse' the specification's failed read is the
        // call's answer — the pass, and so this rejected memo, ends with it.
        if (pass.refuse) throw err;
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
   *
   * [#29604] Under `onFailedRead: 'refuse'` a specification whose read fails
   * does not end the walk: a later one that reaches the user still answers
   * `true`, because a read that succeeded and found the user is a fact no
   * failure beside it can take away. Only when none reaches does the first
   * failure become the answer — `false` is given only when every read behind it
   * succeeded. Under `'nobody'` no specification rejects (each failed read
   * contributes nobody in place), so the walk is the one it always was.
   */
  private async specsReachUser(
    specs: readonly QueueMemberSpec[],
    userId: string,
    organizationId: string | null,
    pass: ExpansionPass,
  ): Promise<boolean> {
    const engine = this.engine();
    if (!engine) return false;
    let failed: { err: unknown } | undefined;
    for (const spec of specs) {
      if (!spec.value) continue;
      try {
        if (await this.specReachesUser(engine, spec, userId, organizationId, pass)) return true;
      } catch (err) {
        if (!pass.refuse) throw err;
        failed ??= { err };
      }
    }
    if (failed) throw failed.err;
    return false;
  }

  private async specReachesUser(
    engine: OwnershipQueueEngine,
    spec: QueueMemberSpec,
    userId: string,
    organizationId: string | null,
    pass: ExpansionPass,
  ): Promise<boolean> {
    switch (spec.type) {
      case 'user':
        return spec.value === userId;
      case 'team':
        return this.holderCheck(spec, pass, () => teamHasMember(engine, spec.value, userId));
      case 'position': {
        if (!(await this.positionActive(spec.value, pass))) return false;
        const positions = new PositionGraphService({ engine, organizationId });
        return this.holderCheck(spec, pass, () => positions.holdsPosition(userId, spec.value, organizationId ?? undefined));
      }
      default:
        return (await this.expandSpec(spec, organizationId, pass)).includes(userId);
    }
  }

  /**
   * [#29503] A team or position holder check, answered in the posture the
   * call asked for (module header). The checks themselves (`teamHasMember`,
   * `PositionGraphService.holdsPosition`) refuse a failed read instead of
   * answering `false`. Under `onFailedRead: 'nobody'` that specification
   * contributes nobody, logged once — the same answer {@link expandSpec} gives
   * the expansion, so the two twins cannot disagree. Under `'refuse'` (#29604)
   * the check's refusal is passed on, as the expansion's is.
   */
  private async holderCheck(spec: QueueMemberSpec, pass: ExpansionPass, check: () => Promise<boolean>): Promise<boolean> {
    try {
      return await check();
    } catch (err: any) {
      if (pass.refuse) throw err;
      this.warnOnce(`holds::${spec.type}::${spec.value}`, '[queue] a member specification could not be read for a holder check — it contributes nobody until it can', {
        type: spec.type, value: spec.value, error: err?.message,
      });
      return false;
    }
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

  /**
   * The organization's `sys_queue` row named `name`. A failed read resolves
   * the name nowhere, logged once — or, under `refuse` (#29604), rejects with
   * a sentence naming the read: whether the queue exists is itself unknown.
   */
  private async authoredQueueRow(
    engine: OwnershipQueueEngine,
    name: string,
    organizationId: string | null,
    refuse = false,
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
      if (refuse) {
        throw Object.assign(
          new Error(`the ${QUEUE_OBJECT} row of queue '${name}'${organizationId ? ` in organization '${organizationId}'` : ''} could not be read: ${err?.message ?? String(err)}`),
          { cause: err },
        );
      }
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
      const rows = await readMembershipToCompletion(engine, {
        object: QUEUE_OBJECT,
        where: organizationId ? { organization_id: organizationId } : {},
        fields: ['name'],
        subject: `the authored queues${organizationId ? ` of organization '${organizationId}'` : ''}`,
      });
      const out: string[] = [];
      for (const r of rows ?? []) {
        const name = str(r.name);
        // A row under a declared name is not a second queue (the guard refuses
        // the write; a row that predates the declaration is reported there).
        if (name && !declaredNames.has(name)) out.push(name);
      }
      return out;
    } catch (err: any) {
      this.warnOnce('read::sys_queue', '[queue] sys_queue read failed — authored queues resolve nowhere until it succeeds', { error: readFailureReason(err) });
      return [];
    }
  }

  /**
   * The organization's `sys_queue_member` rows for `names`, grouped by queue.
   * A failed read counts no authored member, logged once — or, under `refuse`
   * (#29604), passes the walk's refusal on, which names the read.
   */
  private async authoredMemberSpecs(
    engine: OwnershipQueueEngine,
    names: readonly string[],
    organizationId: string | null,
    refuse = false,
  ): Promise<Map<string, QueueMemberSpec[]>> {
    const out = new Map<string, QueueMemberSpec[]>();
    if (names.length === 0) return out;
    try {
      const rows = await readMembershipToCompletion(engine, {
        object: QUEUE_MEMBER_OBJECT,
        where: {
          queue: names.length === 1 ? names[0] : { $in: [...names] },
          ...(organizationId ? { organization_id: organizationId } : {}),
        },
        fields: ['queue', 'recipient_type', 'recipient_id'],
        subject: `the member rows of ${names.length === 1 ? `queue '${names[0]}'` : `${names.length} queues`}${organizationId ? ` in organization '${organizationId}'` : ''}`,
      });
      for (const r of rows ?? []) {
        const queue = str(r.queue);
        const type = str(r.recipient_type);
        const value = str(r.recipient_id);
        if (!queue || !type || !value || !MEMBER_KINDS.has(type)) continue;
        const list = out.get(queue) ?? [];
        list.push({ type: type as QueueMemberSpec['type'], value });
        out.set(queue, list);
      }
    } catch (err: any) {
      if (refuse) throw err;
      this.warnOnce('read::sys_queue_member', '[queue] sys_queue_member read failed — authored members count as nobody until it succeeds', { error: readFailureReason(err) });
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
