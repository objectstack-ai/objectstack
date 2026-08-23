// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { keysetWalk } from '@objectstack/types';
import { findFileHolder, type AttachmentLifecycleEngine } from './attachment-lifecycle.js';

/**
 * Stranded `sys_file` orphan inventory (#10950) — READ-ONLY.
 *
 * ## What is stranded, and why it can never un-strand itself
 *
 * `sys_file` declares (`objects/system-file.object.ts`):
 *
 *     lifecycle: {
 *       ttl:       { field: 'deleted_at', expireAfter: '30d' },
 *       retention: { maxAge: '7d', onlyWhen: { status: 'pending' } },
 *     }
 *
 * The LifecycleService turns those into the only two nomination filters that
 * ever reach this object — `{ deleted_at: { $lt: cutoff } }` and
 * `{ created_at: { $lt: cutoff }, status: 'pending' }` (`reap()` in objectql's
 * `lifecycle/lifecycle-service.ts`). A file whose `deleted_at` is NULL and
 * whose status is `committed` satisfies NEITHER. It is never a sweep
 * candidate, so the reap guard is never asked about it, so its storage bytes
 * are never reclaimed. The object's own comment says the same thing from the
 * other side: "Committed rows carry neither trigger … so they are immortal."
 *
 * That is fine for a live file and permanent for an orphaned one. Two verbs
 * used to produce orphans without writing the tombstone that would have put
 * them on the TTL path:
 *
 *   - the DELETE verb, before #10240 — a predicate delete of `sys_attachment`
 *     join rows dispatched per-row, the handler's stash died with the row, and
 *     no tombstone was written.
 *   - the UPDATE verb, before #10171 — an update re-pointing a join row's
 *     `file_id` detached the prior file and nothing said so.
 *
 * ## Why ONE predicate enumerates BOTH legacy classes
 *
 * Both fixes are forward-only: they changed what the next write does and
 * touched no already-written row. And both verbs leak into the SAME terminal
 * state — `scope='attachments'`, `status='committed'`, `deleted_at` NULL, zero
 * `sys_attachment` join rows — because in both cases the miss was simply that
 * `tombstoneOrphanedFiles` never ran. Nothing in the data records WHICH verb
 * stranded a given row: there is no provenance column, and the two classes are
 * indistinguishable by construction, not merely by omission here. So the
 * single predicate below is a COMPLETE enumeration of both classes, not a
 * count of one of them. Splitting the total by verb is not possible from the
 * data and this module does not pretend otherwise.
 *
 * ## The ownership question is the guard's, not a weaker one
 *
 * A file with zero join rows may still be owned through the `ref_*` columns
 * (field-file lineage, ADR-0104 / #3459 PR-5b). Counting it as an orphan would
 * put a LIVE file on a list whose whole purpose is to size a future byte
 * delete. This module therefore calls {@link findFileHolder} — the very
 * function the reap guard calls — rather than reimplementing the test. Per
 * candidate, one query, exactly the guard's query. That costs one read per
 * candidate instead of one per page; exactness wins here, because the number
 * this produces is what a destructive step 2 would be authorised against.
 *
 * ## Scope
 *
 * `scope === 'attachments'` ONLY. Those are the files whose ownership is
 * expressed as `sys_attachment` join rows, so they are the only ones a
 * join-row count can speak about at all. Files in the other scopes are
 * governed by the field-reference seam (`releaseOwnership` in
 * `file-reference-lifecycle.ts`) and are reconciled by `verifyFileReferences`,
 * which reports its own `unreferenced_file` advisory — and which deliberately
 * skips attachments-scope files, so the two passes partition the population
 * rather than overlapping. Every count here is labelled with its scope for
 * that reason: a total that reads as "all orphans" but means "attachments-
 * scope orphans" is the kind of number that gets acted on wrongly.
 *
 * ## ADR-0057 §3.3
 *
 * §3.3 forbids a bespoke SWEEPER: "detection and scheduling stay inside the
 * single platform sweep … the guard is a domain callback, not a scheduler."
 * This pass schedules nothing, registers nothing, and deletes nothing — it is
 * an operator-invoked reconciliation read, the same shape (and the same file
 * neighbourhood) as `verifyFileReferences`. It does not become a second
 * detection-and-scheduling path, because it never acts on what it finds.
 *
 * ⛔ It writes nothing. It tombstones nothing. It deletes nothing. Authorising
 * the destructive backfill is a separate, deferred decision (#10950 step 2)
 * that this inventory exists to inform.
 */

/** Rows read per page while walking `sys_file`. */
const SCAN_PAGE_SIZE = 500;

/** Reads are system-context: an orphan by definition has no one to read it. */
const SYSTEM_CTX = { isSystem: true } as const;

/** Default number of example rows carried back with the counts. */
const DEFAULT_SAMPLE_LIMIT = 20;

/** An example stranded row, so an operator can spot-check the verdict. */
export interface StrandedOrphanSample {
  fileId: string;
  /** Storage key — where the bytes are. */
  key?: string;
  name?: string;
  /** Recorded size in bytes; absent when the row never carried one. */
  size?: number;
  createdAt?: string;
}

export interface StrandedOrphanInventory {
  /**
   * The population this inventory speaks about. Always `'attachments'` — see
   * the module comment. Present in the payload so a consumer cannot read the
   * totals as covering every scope.
   */
  scope: 'attachments';
  /** `sys_file` rows examined (attachments-scope, `status='committed'`). */
  filesScanned: number;
  /**
   * Examined rows carrying a `deleted_at`, so the TTL can already nominate
   * them. Not stranded — they are on the reap path and the guard will be
   * asked about them.
   */
  alreadyOnTtlPath: number;
  /** Excluded: at least one `sys_attachment` join row still points at it. */
  heldByAttachment: number;
  /**
   * Excluded: ZERO join rows, but the `ref_*` columns name an owner. These are
   * the rows a weaker question would have miscounted as orphans — live,
   * field-owned files.
   */
  heldByFieldOwner: number;
  /** Stranded orphans: nothing holds them and no policy can nominate them. */
  stranded: number;
  /** Summed `sys_file.size` over the stranded rows. */
  strandedBytes: number;
  /**
   * Stranded rows whose `size` was absent or unusable. Their bytes are real
   * but uncounted.
   */
  strandedRowsWithoutSize: number;
  /**
   * True when at least one stranded row had no usable `size`, i.e.
   * {@link strandedBytes} is a LOWER BOUND on the reclaimable bytes rather
   * than the figure.
   */
  bytesAreLowerBound: boolean;
  /** True when `maxCandidates` stopped the walk — the counts are partial. */
  truncated: boolean;
  samples: StrandedOrphanSample[];
}

export interface StrandedOrphanInventoryOptions {
  /**
   * Safety bound on `sys_file` rows read. Exceeding it sets `truncated`, which
   * makes every count a lower bound. Omit for a complete walk — and prefer
   * omitting it, since a truncated inventory cannot size the population.
   */
  maxCandidates?: number;
  /** Example rows to carry back (default 20). */
  sampleLimit?: number;
}

/** Engine surface this pass needs — duck-typed like the other storage seams. */
export type StrandedOrphanInventoryEngine = Pick<AttachmentLifecycleEngine, 'find'>;

function usableSize(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/**
 * Count the `sys_file` rows that the forward-only fixes (#10171, #10240) would
 * have tombstoned had they existed when the rows were orphaned, and that the
 * reap guard would then confirm.
 *
 * ⛔ Read-only: no write of any kind is issued, on any object.
 */
export async function inventoryStrandedFileOrphans(
  engine: StrandedOrphanInventoryEngine,
  options: StrandedOrphanInventoryOptions = {},
): Promise<StrandedOrphanInventory> {
  const sampleLimit = options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
  const report: StrandedOrphanInventory = {
    scope: 'attachments',
    filesScanned: 0,
    alreadyOnTtlPath: 0,
    heldByAttachment: 0,
    heldByFieldOwner: 0,
    stranded: 0,
    strandedBytes: 0,
    strandedRowsWithoutSize: 0,
    bytesAreLowerBound: false,
    truncated: false,
    samples: [],
  };

  // Seek by `id` rather than counting from the start (#4363): a row an offset
  // walk skips is a row silently missing from a population count, and the
  // result still looks like a clean run.
  const walk = keysetWalk<Record<string, unknown>>(
    (q) =>
      engine.find('sys_file', {
        ...q,
        fields: [
          'id',
          'key',
          'name',
          'size',
          'scope',
          'status',
          'deleted_at',
          'ref_object',
          'ref_id',
          'created_at',
        ],
        context: { ...SYSTEM_CTX },
      }),
    {
      where: { scope: 'attachments', status: 'committed' },
      pageSize: SCAN_PAGE_SIZE,
      max: options.maxCandidates,
    },
  );

  for await (const page of walk.pages()) {
    for (const row of page) {
      if (row?.id == null) continue;
      // Re-apply the filter in process rather than trusting it round-tripped.
      // A driver that dropped part of the `where` would otherwise WIDEN this
      // population, and widening is the direction that puts live files on the
      // list. (Same posture as `verifyFileReferences`, for the same reason.)
      if (row.scope !== 'attachments' || row.status !== 'committed') continue;
      report.filesScanned++;

      // A `deleted_at` makes the row TTL-nominable, whatever else is true of
      // it — so it is on the reap path and is not this card's subject.
      if (row.deleted_at != null && row.deleted_at !== '') {
        report.alreadyOnTtlPath++;
        continue;
      }

      const id = String(row.id);
      const holder = await findFileHolder(engine, id, row);
      if (holder === 'attachment') {
        report.heldByAttachment++;
        continue;
      }
      if (holder === 'field-owner') {
        report.heldByFieldOwner++;
        continue;
      }

      report.stranded++;
      const size = usableSize(row.size);
      if (size === undefined) {
        report.strandedRowsWithoutSize++;
        report.bytesAreLowerBound = true;
      } else {
        report.strandedBytes += size;
      }
      if (report.samples.length < sampleLimit) {
        report.samples.push({
          fileId: id,
          key: typeof row.key === 'string' ? row.key : undefined,
          name: typeof row.name === 'string' ? row.name : undefined,
          size,
          createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
        });
      }
    }
  }

  report.truncated = walk.truncated;
  return report;
}

/** Human-readable bytes, for the report line an operator reads. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** Render an inventory as human-readable lines (CLI output). */
export function formatStrandedOrphanInventory(report: StrandedOrphanInventory): string {
  const lines: string[] = [];
  lines.push(
    `Scanned ${report.filesScanned} committed ${report.scope}-scope sys_file row(s).`,
  );
  if (report.truncated) {
    lines.push(
      '⚠ Walk was truncated by --max-candidates — every count below is a LOWER BOUND. ' +
        'Re-run without the bound to size the population.',
    );
  }
  lines.push(
    `   held by a sys_attachment join row : ${report.heldByAttachment}`,
    `   held via ref_* field ownership    : ${report.heldByFieldOwner}` +
      (report.heldByFieldOwner > 0
        ? '   ← live files a join-row-only question would have miscounted as orphans'
        : ''),
    `   already tombstoned (on the TTL)   : ${report.alreadyOnTtlPath}`,
  );
  lines.push('');
  if (report.stranded === 0) {
    lines.push(
      `✅ No stranded ${report.scope}-scope orphans on this deployment. ` +
        'Nothing here is unreachable by the platform sweep.',
    );
  } else {
    lines.push(
      `❗ ${report.stranded} stranded ${report.scope}-scope orphan(s), ` +
        `${formatBytes(report.strandedBytes)} (${report.strandedBytes} bytes)` +
        (report.bytesAreLowerBound
          ? ` — LOWER BOUND: ${report.strandedRowsWithoutSize} row(s) carry no recorded size`
          : ''),
    );
    lines.push(
      '   These match neither lifecycle policy on sys_file, so the platform sweep can never',
      '   nominate them and their bytes are never reclaimed.',
    );
    if (report.samples.length > 0) {
      lines.push('', `   Examples (${report.samples.length} of ${report.stranded}):`);
      for (const s of report.samples) {
        const size = s.size === undefined ? 'size unrecorded' : formatBytes(s.size);
        lines.push(`     ${s.fileId}  ${size}  ${s.key ?? '(no key)'}`);
      }
    }
  }
  lines.push(
    '',
    `Scope note: this pass covers ${report.scope}-scope files only — the files whose referrers are`,
    '  sys_attachment join rows. Files in the other scopes are governed by the field-reference',
    '  seam; run "os migrate files-to-references --include-unreferenced" to reconcile those.',
    'This pass is READ-ONLY: nothing was written, tombstoned or deleted.',
  );
  return lines.join('\n');
}
