// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Each knowledge source's sync state, one durable record per source
 * (ADR-0161; `sys_knowledge_sync_state`, declared in
 * `@objectstack/platform-objects` and registered by `KnowledgeServicePlugin`).
 *
 * A row holds the source's last build and the record syncs that failed and are
 * not yet repaired. Every node of a deployment reads and writes the same row,
 * so `index_status` answers the same on every node, and a restart forgets
 * nothing. The service writes it; nothing else does.
 *
 * ## Who writes what
 *
 * - The build (`KnowledgeService.rebuildSource`, every trigger) writes the
 *   row when it starts, once it holds the source's build lease; at most every
 *   `BUILD_PROGRESS_LOG_INTERVAL_MS` while it walks; and when it ends. A build
 *   that never held the lease (another node holds it, or the lock did not
 *   answer) or found nothing to build writes nothing: the row keeps the build
 *   that ran. A build writes its progress and its end only while the row's
 *   `build_id` still names it, so a build that lost its lease never overwrites
 *   the build that took the source over.
 * - A build a node that died left `running` is closed `interrupted` by the
 *   next boot (`KnowledgeService.closeInterruptedBuilds`, for each source
 *   whose lease is free) or by the next node that takes the source's lease.
 * - The record-sync worker adds one failure per dead letter, never one per
 *   attempt (`KnowledgeService.recordSyncFailure`), as a compare-and-set on
 *   the count, so two nodes failing at once both count.
 * - A reconcile of the source that completes clears the failures that failed
 *   before its walk began, and removes their dead letters from the queue; a
 *   failure recorded during the walk stays.
 * - The source's removal (`KnowledgeService.dropMetadataSource`) removes its
 *   row.
 *
 * ## No record content
 *
 * ⛔ `build_message` and `last_error` are the platform's own sentences
 * ({@link storedBuildMessage}, {@link syncFailureText}). An embedding
 * provider's or a store's own text may quote the record it was handed, and a
 * row is readable by a platform administrator of any organization; that text
 * stays in the server log of the node that met it.
 *
 * Every read and write runs under the system identity.
 */

import type { KnowledgeBuildRecord, KnowledgeBuildTrigger } from './knowledge-build.js';

/** The system object a source's sync state is kept in. */
export const KNOWLEDGE_SYNC_STATE_OBJECT = 'sys_knowledge_sync_state';

/** The longest `last_error` is kept: the field's `maxLength`. */
export const SYNC_FAILURE_TEXT_MAX = 500;

/** The longest `build_message` is kept: the field's `maxLength`. */
export const BUILD_MESSAGE_MAX = 1000;

const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] } as const;

/** How many times a compare-and-set write is tried before it gives up. */
const CAS_ATTEMPTS = 8;

/**
 * How the last build of a source ended, as the record keeps it: the build
 * record's statuses a build that ran can end in, and `interrupted`, a build
 * whose node stopped while it ran. `not-run` is never kept: a build that did
 * not run leaves the record with the build that did.
 */
export type KnowledgeStoredBuildStatus = Exclude<KnowledgeBuildRecord['status'], 'not-run'> | 'interrupted';

/** The last build of a source, as the record answers it. */
export interface KnowledgeStoredBuild {
  trigger: KnowledgeBuildTrigger;
  status: KnowledgeStoredBuildStatus;
  /** ISO-8601 time the build was asked for. */
  startedAt: string;
  /** ISO-8601 time it ended; absent while it runs. */
  finishedAt?: string;
  /** Its counts: so far while it runs, the totals once it ended. `purged` is `null` when it purged nothing. */
  counts: { discovered: number; indexed: number; skipped: number; purged: number | null; failed: number };
  /** The platform's sentence for it ({@link storedBuildMessage}). */
  message?: string;
}

/** A source's record syncs that failed and are not yet repaired. */
export interface KnowledgeSyncFailures {
  /** Dead letters on the record-sync queue not yet repaired: one per message, never one per attempt. */
  count: number;
  /** ISO-8601 time the oldest one counted failed. */
  firstFailedAt?: string;
  /** ISO-8601 time the newest one counted failed. */
  lastFailedAt?: string;
  /** The platform's sentence for the newest one ({@link syncFailureText}). */
  lastError?: string;
}

/** A source as its record names it. */
export interface KnowledgeSyncStateIdentity {
  /** The source's index key: the row's id. */
  key: string;
  /** The source as callers name it. */
  source: string;
  packageId?: string;
  adapter?: string;
  object?: string;
}

/** One source's record, read. */
export interface KnowledgeSyncState extends KnowledgeSyncStateIdentity {
  /** Names the last build; absent until a build ran. */
  buildId?: string;
  build?: KnowledgeStoredBuild;
  failures: KnowledgeSyncFailures;
  /** The stored `failure_count` exactly as read: the compare-and-set's expected value. */
  readonly failureCountStored: unknown;
}

/** A build's counts, as the build writes them. */
export type KnowledgeStoredBuildCounts = KnowledgeStoredBuild['counts'];

/** How a build that ran ended, as its last write states it. */
export interface KnowledgeStoredBuildEnd {
  status: Exclude<KnowledgeStoredBuildStatus, 'running'>;
  finishedAt: string;
  counts: KnowledgeStoredBuildCounts;
  message: string;
}

/** What a failure write answered. */
export interface KnowledgeSyncFailureWrite {
  /** The count after this failure. */
  count: number;
  /** Whether this was the source's first failure: the count went from none to one. */
  first: boolean;
}

/** A failures write's new values. */
export interface KnowledgeSyncFailuresUpdate {
  count: number;
  firstFailedAt?: string;
  lastFailedAt?: string;
  lastError?: string;
}

/**
 * The record's store. {@link ObjectStoreKnowledgeSyncState} is the one
 * implementation; `KnowledgeService` takes it as an option, and
 * `KnowledgeServicePlugin` wires it wherever the object is registered and a
 * data engine is bound.
 */
export interface KnowledgeSyncStateStore {
  read(key: string): Promise<KnowledgeSyncState | undefined>;
  /** The sources whose last build reads `running`. */
  runningBuilds(): Promise<KnowledgeSyncState[]>;
  /** Write the source's row with no build and no failure, when it has none. */
  ensure(identity: KnowledgeSyncStateIdentity): Promise<void>;
  /** Write a build's start: the row then names `buildId`, `running`, with zero counts. */
  startBuild(identity: KnowledgeSyncStateIdentity, buildId: string, trigger: KnowledgeBuildTrigger, startedAt: string): Promise<void>;
  /** Write a running build's counts, while the row still names `buildId`. Answers whether it did. */
  progressBuild(key: string, buildId: string, counts: KnowledgeStoredBuildCounts): Promise<boolean>;
  /** Write a build's end, while the row still names `buildId`. Answers whether it did. */
  finishBuild(key: string, buildId: string, end: KnowledgeStoredBuildEnd): Promise<boolean>;
  /** Close `buildId` as `interrupted`, while the row names it and reads `running`. Answers whether it did. */
  closeInterrupted(key: string, buildId: string, finishedAt: string): Promise<boolean>;
  /** Count one failure (a compare-and-set on the count, retried). */
  addFailure(identity: KnowledgeSyncStateIdentity, failedAt: string, text: string): Promise<KnowledgeSyncFailureWrite>;
  /** Replace the failure fields, while the stored count is still `expected`. Answers whether it did. */
  setFailures(key: string, expected: unknown, update: KnowledgeSyncFailuresUpdate): Promise<boolean>;
  /** Remove the source's row. */
  remove(key: string): Promise<void>;
}

/** The engine surface the store needs: ObjectQL's `find` / `insert` / `update` / `delete`. */
export interface KnowledgeSyncStateEngine {
  find(object: string, query?: any): Promise<any>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, data: any, options?: any): Promise<any>;
  delete(object: string, options?: any): Promise<any>;
}

type Row = Record<string, unknown>;

function rowsOf(found: unknown): Row[] {
  if (Array.isArray(found)) return found as Row[];
  const records = (found as { records?: unknown } | null)?.records;
  return Array.isArray(records) ? (records as Row[]) : [];
}

/** How many rows a predicate update reports it changed; anything but a count reads as none. */
function affectedRows(result: unknown): number {
  const count = typeof result === 'number' ? result : Number((result as { count?: unknown } | null)?.count);
  return Number.isFinite(count) ? count : 0;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** A stored instant as ISO-8601: the dialects materialize a datetime as a string, a number or a `Date`. */
function instant(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const date = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(date.getTime()) ? (typeof v === 'string' ? v : undefined) : date.toISOString();
}

function count(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nullableCount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The record's status spelling: the select's option values are snake_case. */
const STATUS_TO_STORED: Record<KnowledgeStoredBuildStatus, string> = {
  running: 'running',
  done: 'done',
  failed: 'failed',
  'lease-lost': 'lease_lost',
  'timed-out': 'timed_out',
  interrupted: 'interrupted',
};
const STATUS_FROM_STORED: Record<string, KnowledgeStoredBuildStatus> = Object.fromEntries(
  Object.entries(STATUS_TO_STORED).map(([answer, stored]) => [stored, answer as KnowledgeStoredBuildStatus]),
);
const TRIGGERS: ReadonlySet<string> = new Set(['boot', 'reload', 'operator', 'reconcile']);

function identityFields(identity: KnowledgeSyncStateIdentity): Row {
  return {
    source: identity.source,
    package_id: identity.packageId ?? null,
    adapter: identity.adapter ?? null,
    object: identity.object ?? null,
  };
}

function countFields(counts: KnowledgeStoredBuildCounts): Row {
  return {
    build_discovered: counts.discovered,
    build_indexed: counts.indexed,
    build_skipped: counts.skipped,
    build_purged: counts.purged,
    build_failed: counts.failed,
  };
}

function bounded(sentence: string, max: number): string {
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1)}…`;
}

/** One stored row, read. */
export function readSyncStateRow(row: Row): KnowledgeSyncState {
  const status = STATUS_FROM_STORED[String(row.build_status ?? '')];
  const trigger = String(row.build_trigger ?? '');
  const startedAt = instant(row.build_started_at);
  const finishedAt = instant(row.build_finished_at);
  const message = text(row.build_message);
  const build: KnowledgeStoredBuild | undefined =
    status !== undefined && TRIGGERS.has(trigger) && startedAt !== undefined
      ? {
        trigger: trigger as KnowledgeBuildTrigger,
        status,
        startedAt,
        ...(finishedAt === undefined ? {} : { finishedAt }),
        counts: {
          discovered: count(row.build_discovered),
          indexed: count(row.build_indexed),
          skipped: count(row.build_skipped),
          purged: nullableCount(row.build_purged),
          failed: count(row.build_failed),
        },
        ...(message === undefined ? {} : { message }),
      }
      : undefined;
  const firstFailedAt = instant(row.first_failed_at);
  const lastFailedAt = instant(row.last_failed_at);
  const lastError = text(row.last_error);
  const packageId = text(row.package_id);
  const adapter = text(row.adapter);
  const object = text(row.object);
  const buildId = text(row.build_id);
  return {
    key: String(row.id),
    source: text(row.source) ?? String(row.id),
    ...(packageId === undefined ? {} : { packageId }),
    ...(adapter === undefined ? {} : { adapter }),
    ...(object === undefined ? {} : { object }),
    ...(buildId === undefined ? {} : { buildId }),
    ...(build === undefined ? {} : { build }),
    failures: {
      count: count(row.failure_count),
      ...(firstFailedAt === undefined ? {} : { firstFailedAt }),
      ...(lastFailedAt === undefined ? {} : { lastFailedAt }),
      ...(lastError === undefined ? {} : { lastError }),
    },
    failureCountStored: row.failure_count ?? null,
  };
}

/**
 * The sync state over the data engine. Holds no state of its own: the engine
 * is the record, so every node reads the same.
 */
export class ObjectStoreKnowledgeSyncState implements KnowledgeSyncStateStore {
  constructor(private readonly engine: KnowledgeSyncStateEngine) {}

  private async readRow(key: string): Promise<Row | undefined> {
    return rowsOf(
      await this.engine.find(KNOWLEDGE_SYNC_STATE_OBJECT, { where: { id: key }, limit: 1, context: SYSTEM_CONTEXT }),
    )[0];
  }

  /** Update the rows `where` matches; answers how many changed. */
  private async updateWhere(where: Row, data: Row): Promise<number> {
    return affectedRows(
      await this.engine.update(KNOWLEDGE_SYNC_STATE_OBJECT, data, { where, multi: true, context: SYSTEM_CONTEXT }),
    );
  }

  /**
   * Write `data` onto the row `key`, inserting it (with `inserted`) when it
   * has none. An insert that loses a race with another node's is retried as
   * an update.
   */
  private async upsert(key: string, data: Row, inserted: Row): Promise<void> {
    if ((await this.updateWhere({ id: key }, data)) > 0) return;
    try {
      await this.engine.insert(KNOWLEDGE_SYNC_STATE_OBJECT, { id: key, ...inserted, ...data }, { context: SYSTEM_CONTEXT });
    } catch (err) {
      if ((await this.updateWhere({ id: key }, data)) > 0) return;
      throw err;
    }
  }

  async read(key: string): Promise<KnowledgeSyncState | undefined> {
    const row = await this.readRow(key);
    return row === undefined ? undefined : readSyncStateRow(row);
  }

  async runningBuilds(): Promise<KnowledgeSyncState[]> {
    const rows = rowsOf(
      await this.engine.find(KNOWLEDGE_SYNC_STATE_OBJECT, { where: { build_status: 'running' }, limit: 10_000, context: SYSTEM_CONTEXT }),
    );
    return rows.map(readSyncStateRow);
  }

  async ensure(identity: KnowledgeSyncStateIdentity): Promise<void> {
    if (await this.readRow(identity.key)) return;
    try {
      await this.engine.insert(
        KNOWLEDGE_SYNC_STATE_OBJECT,
        { id: identity.key, ...identityFields(identity), failure_count: 0 },
        { context: SYSTEM_CONTEXT },
      );
    } catch (err) {
      // Another node wrote it first: the row is there, which is all this asks.
      if (await this.readRow(identity.key)) return;
      throw err;
    }
  }

  async startBuild(identity: KnowledgeSyncStateIdentity, buildId: string, trigger: KnowledgeBuildTrigger, startedAt: string): Promise<void> {
    await this.upsert(
      identity.key,
      {
        ...identityFields(identity),
        build_id: buildId,
        build_trigger: trigger,
        build_status: STATUS_TO_STORED.running,
        build_started_at: startedAt,
        build_finished_at: null,
        build_message: null,
        ...countFields({ discovered: 0, indexed: 0, skipped: 0, purged: null, failed: 0 }),
      },
      { failure_count: 0 },
    );
  }

  async progressBuild(key: string, buildId: string, counts: KnowledgeStoredBuildCounts): Promise<boolean> {
    return (await this.updateWhere({ id: key, build_id: buildId }, countFields(counts))) > 0;
  }

  async finishBuild(key: string, buildId: string, end: KnowledgeStoredBuildEnd): Promise<boolean> {
    return (
      (await this.updateWhere(
        { id: key, build_id: buildId },
        {
          build_status: STATUS_TO_STORED[end.status],
          build_finished_at: end.finishedAt,
          build_message: bounded(end.message, BUILD_MESSAGE_MAX),
          ...countFields(end.counts),
        },
      )) > 0
    );
  }

  async closeInterrupted(key: string, buildId: string, finishedAt: string): Promise<boolean> {
    return (
      (await this.updateWhere(
        { id: key, build_id: buildId, build_status: STATUS_TO_STORED.running },
        {
          build_status: STATUS_TO_STORED.interrupted,
          build_finished_at: finishedAt,
          build_message: storedBuildMessage({ status: 'interrupted' }),
        },
      )) > 0
    );
  }

  async addFailure(identity: KnowledgeSyncStateIdentity, failedAt: string, errorText: string): Promise<KnowledgeSyncFailureWrite> {
    const lastError = bounded(errorText, SYNC_FAILURE_TEXT_MAX);
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const row = await this.readRow(identity.key);
      if (row === undefined) {
        try {
          await this.engine.insert(
            KNOWLEDGE_SYNC_STATE_OBJECT,
            {
              id: identity.key,
              ...identityFields(identity),
              failure_count: 1,
              first_failed_at: failedAt,
              last_failed_at: failedAt,
              last_error: lastError,
            },
            { context: SYSTEM_CONTEXT },
          );
          return { count: 1, first: true };
        } catch {
          // Another node wrote the row first: count onto it.
          continue;
        }
      }
      const stored = row.failure_count ?? null;
      const before = count(stored);
      const first = instant(row.first_failed_at);
      const changed = await this.updateWhere(
        { id: identity.key, failure_count: stored },
        {
          failure_count: before + 1,
          first_failed_at: before === 0 || first === undefined ? failedAt : first,
          last_failed_at: failedAt,
          last_error: lastError,
        },
      );
      if (changed > 0) return { count: before + 1, first: before === 0 };
    }
    throw new Error(
      `${KNOWLEDGE_SYNC_STATE_OBJECT}: the failure of source '${identity.source}' was not counted: the count kept ` +
        `changing under ${CAS_ATTEMPTS} attempts.`,
    );
  }

  async setFailures(key: string, expected: unknown, update: KnowledgeSyncFailuresUpdate): Promise<boolean> {
    return (
      (await this.updateWhere(
        { id: key, failure_count: expected ?? null },
        {
          failure_count: update.count,
          first_failed_at: update.firstFailedAt ?? null,
          last_failed_at: update.lastFailedAt ?? null,
          last_error: update.lastError === undefined ? null : bounded(update.lastError, SYNC_FAILURE_TEXT_MAX),
        },
      )) > 0
    );
  }

  async remove(key: string): Promise<void> {
    await this.engine.delete(KNOWLEDGE_SYNC_STATE_OBJECT, { where: { id: key }, context: SYSTEM_CONTEXT });
  }
}

/**
 * The record's sentence for a build: the platform's own words, by status and
 * counts. ⛔ Never the build record's `message`, which may quote an embedding
 * provider or a store (and through them a record): that one is logged.
 */
export function storedBuildMessage(build: {
  status: Exclude<KnowledgeStoredBuildStatus, 'running'>;
  counts?: KnowledgeStoredBuildCounts;
}): string {
  const unindexable = build.counts && build.counts.failed > 0
    ? ` ${build.counts.failed} document(s) cannot be indexed under the source's split and were removed from the index.`
    : '';
  const again = 'The index keeps what it held, and the next reconcile, boot or operator rebuild builds again.';
  switch (build.status) {
    case 'done':
      return `The build finished: every row was read, and the index recorded the build.${unindexable}`;
    case 'failed':
      return (
        `The build did not finish. ${again} Its reason, which may quote the embedding provider or the store, is ` +
        "in the server log of the node that ran it, on the line '[knowledge] build of source … did not finish'."
      );
    case 'lease-lost':
      return `The build's cluster lease was lost, so it stopped before its next page; another node may build the source now. ${again}`;
    case 'timed-out':
      return (
        'No page finished within the bound (a call to the embedding provider or to the store did not answer), so the ' +
        `build was cancelled and its lease released. ${again}`
      );
    case 'interrupted':
      return `The node running the build stopped before it ended. ${again}`;
  }
}

/** An identifier-shaped token of a thrown value: its class, `code` and HTTP status. Never its message. */
function errorKind(err: unknown): string {
  const parts: string[] = [];
  const name = err instanceof Error ? err.name : undefined;
  parts.push(typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : err instanceof Error ? 'Error' : 'a thrown value that is not an Error');
  if (err !== null && typeof err === 'object') {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(code)) parts.push(`code ${code}`);
    const status = (err as { status?: unknown; httpStatus?: unknown; statusCode?: unknown }).status
      ?? (err as { httpStatus?: unknown }).httpStatus
      ?? (err as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) parts.push(`status ${status}`);
  }
  return parts.join(', ');
}

/**
 * The record's sentence for a record sync that spent its last attempt: the
 * record's id, the attempts and the kind of error. ⛔ Never the error's
 * message: a provider's text may quote the document it was handed.
 */
export function syncFailureText(recordId: string, attempts: number, maxAttempts: number, err: unknown): string {
  const id = recordId.length <= 128 ? recordId : `${recordId.slice(0, 127)}…`;
  return bounded(
    `The sync of record '${id}' failed its last attempt (${attempts} of ${maxAttempts}): ${errorKind(err)}. ` +
      "The error's own text is in the server log of the node that ran it; it is not kept here, since it may quote the record.",
    SYNC_FAILURE_TEXT_MAX,
  );
}

/** A fresh build id. */
export function nextBuildId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const rand = g.crypto?.randomUUID
    ? g.crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `kbuild_${rand}`;
}
