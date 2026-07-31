// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0104 D1 non-media value-shape scan — the evidence half of the
 * per-deployment gate `os migrate value-shapes` opens (#3438).
 *
 * ## Why a scan and not a backfill
 *
 * Its sibling migration (`os migrate files-to-references`) converts legacy file
 * values before reconciling them, because the platform narrowed that storage
 * form and therefore owes the conversion. Nothing comparable applies here: a
 * `location` stored as `{latitude, longitude}` or a `lookup` holding an
 * expanded record object is APPLICATION data whose correct value only its
 * author knows. So this run reports and prescribes; it never rewrites. A
 * mechanical normaliser is deliberately absent until real reports show a shape
 * common enough to justify one — a normaliser that guesses is how
 * silently-wrong values got here in the first place.
 *
 * The consequence is a pleasing simplification: with nothing to convert,
 * `--apply`'s only write is the flag row itself, so the #3617 invariant holds
 * trivially — a dry run changes nothing, and whether a run changed this
 * deployment's posture never depends on what the run happened to find.
 *
 * ## Why the predicate is imported
 *
 * `valueShapeViolation` and `isScannableValueShapeField` come from the write-
 * path validator. The scan must count exactly what strict mode would reject —
 * same type classes, same skip rules, same cached schemas. A second
 * implementation of "malformed" drifting by one clause would let a deployment
 * pass its scan and still have writes rejected, which is the flag attesting a
 * fact the validator does not recognise.
 */

import {
  valueShapeViolation,
  isScannableValueShapeField,
} from './record-validator.js';

/** One object/field pair holding at least one malformed value. */
export interface ValueShapeFinding {
  object: string;
  field: string;
  /** The declared field type, so the report can group by what went wrong. */
  type: string;
  /** How many records of this object hold a malformed value in this field. */
  count: number;
  /** A few offending record ids, so an operator can go and look. */
  sampleRecordIds: string[];
  /** The first parse issue seen — the prescription an author acts on. */
  detail: string;
}

export interface ValueShapeScanReport {
  /** Objects actually walked (those declaring at least one covered field). */
  scannedObjects: string[];
  scannedRecords: number;
  /** Object/field pairs with violations. Empty ⇒ the gate may open. */
  findings: ValueShapeFinding[];
  /** Total malformed values across every finding. */
  blocking: number;
  /**
   * True when a per-object cap or an unreadable object cut the walk short.
   * A truncated scan can never open the gate: it is evidence about part of the
   * data, and the claim being made is about all of it.
   */
  truncated: boolean;
  /** Objects that could not be read at all — reported, and they truncate. */
  unreadableObjects: string[];
}

export interface ValueShapeScanEngine {
  getObject(name: string): any | undefined;
  getConfigs?(): Record<string, any>;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
}

export interface ValueShapeScanOptions {
  /** Restrict to these objects (default: every object with a covered field). */
  objects?: string[];
  maxRecordsPerObject?: number;
}

export interface ValueShapeScanLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
}

const SCAN_PAGE_SIZE = 500;
const MAX_SAMPLE_IDS = 5;
const SYSTEM_CTX = { isSystem: true } as const;

/** The covered, client-writable fields of one object. */
function scannableFieldsOf(engine: ValueShapeScanEngine, objectName: string): Array<{ name: string; def: any }> {
  const schema: any = engine.getObject(objectName);
  if (!schema?.fields) return [];
  return Object.entries(schema.fields)
    .filter(([name, def]: [string, any]) => isScannableValueShapeField(name, def))
    .map(([name, def]: [string, any]) => ({ name, def }));
}

/**
 * Walk every stored value of the reference / structured-JSON classes and count
 * the ones the write path would reject.
 *
 * Read-only by construction — this function has no write surface at all, which
 * is why the engine type it accepts exposes none.
 */
export async function scanValueShapes(
  engine: ValueShapeScanEngine,
  logger: ValueShapeScanLogger,
  options: ValueShapeScanOptions = {},
): Promise<ValueShapeScanReport> {
  const maxPerObject = options.maxRecordsPerObject ?? 100_000;
  let scannedRecords = 0;
  let truncated = false;
  const unreadableObjects: string[] = [];

  const candidates =
    options.objects ??
    (typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : []);
  const scannedObjects = candidates.filter((name) => scannableFieldsOf(engine, name).length > 0);

  // Keyed `object.field`, so one finding aggregates every offending row.
  const findings = new Map<string, ValueShapeFinding>();

  for (const object of scannedObjects) {
    const fields = scannableFieldsOf(engine, object);
    let offset = 0;

    for (;;) {
      let page: Array<Record<string, unknown>>;
      try {
        page = await engine.find(object, {
          fields: ['id', ...fields.map((f) => f.name)],
          limit: SCAN_PAGE_SIZE,
          offset,
          context: { ...SYSTEM_CTX },
        });
      } catch (err) {
        // An object we cannot read is not an object we may vouch for. Record it
        // AND truncate: the gate's claim is about all the data, so a hole in
        // the evidence has to close it.
        logger.warn(
          `[value-shape] scan: cannot read ${object} (${(err as Error)?.message ?? err}) — ` +
            'reported as unreadable; the gate stays closed',
        );
        unreadableObjects.push(object);
        truncated = true;
        break;
      }
      if (!page || page.length === 0) break;

      for (const record of page) {
        scannedRecords++;
        for (const { name, def } of fields) {
          const detail = valueShapeViolation(def, record[name]);
          if (!detail) continue;
          const key = `${object}.${name}`;
          const existing = findings.get(key);
          const recordId = String(record.id ?? '(unknown id)');
          if (existing) {
            existing.count++;
            if (existing.sampleRecordIds.length < MAX_SAMPLE_IDS) existing.sampleRecordIds.push(recordId);
          } else {
            findings.set(key, {
              object,
              field: name,
              type: String(def?.type ?? 'unknown'),
              count: 1,
              sampleRecordIds: [recordId],
              detail,
            });
          }
        }
      }

      offset += page.length;
      if (page.length < SCAN_PAGE_SIZE) break;
      if (offset >= maxPerObject) {
        truncated = true;
        break;
      }
    }
  }

  const list = [...findings.values()].sort((a, b) => b.count - a.count);
  return {
    scannedObjects,
    scannedRecords,
    findings: list,
    blocking: list.reduce((n, f) => n + f.count, 0),
    truncated,
    unreadableObjects,
  };
}

/**
 * Does this scan authorise the gate? Zero violations AND a complete walk —
 * `blocking === 0` on a truncated scan means "none in the part we read", which
 * is not the claim the flag makes.
 */
export function valueShapeScanPassed(report: ValueShapeScanReport): boolean {
  return report.blocking === 0 && !report.truncated;
}

/** Human-readable report body, shared by the CLI's dry-run and apply output. */
export function formatValueShapeScanReport(report: ValueShapeScanReport): string[] {
  const lines: string[] = [];
  lines.push(
    `Scanned ${report.scannedRecords} record(s) across ${report.scannedObjects.length} object(s) ` +
      'for reference / structured-JSON value shapes.',
  );
  if (report.findings.length === 0) {
    lines.push('✓ No malformed values found.');
  } else {
    lines.push(`✗ ${report.blocking} malformed value(s) in ${report.findings.length} field(s):`);
    for (const f of report.findings) {
      lines.push(
        `  • ${f.object}.${f.field} (${f.type}) — ${f.count} record(s): ${f.detail}` +
          `\n      e.g. ${f.sampleRecordIds.join(', ')}`,
      );
    }
    lines.push(
      'These are application data, not platform data: fix the values (or the code that writes',
      'them) and re-run. Nothing here is converted for you — the correct value is one only the',
      "app's author knows.",
    );
  }
  if (report.unreadableObjects.length > 0) {
    lines.push(`⚠ Unreadable object(s): ${report.unreadableObjects.join(', ')}`);
  }
  if (report.truncated) {
    lines.push('⚠ Scan incomplete — the gate cannot open on partial evidence.');
  }
  return lines;
}
