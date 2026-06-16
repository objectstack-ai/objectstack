// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time lint that closes the spec-liveness loop on the AUTHOR side.
 *
 * The liveness ledgers (`@objectstack/spec/liveness/<type>.json`) classify every
 * authorable metadata property as live / experimental / dead with evidence. The
 * CI gate enforces that classification is *complete*, but the ledger's knowledge
 * never reached the person (very often an AI) writing the metadata. This lint
 * surfaces it: when an authored object/field sets a property the ledger marks as
 * dead-and-misleading (or experimental), it emits an advisory WARNING — "you set
 * this expecting it to do something; at runtime it does nothing" — with a hint
 * toward the supported alternative. It NEVER fails the build.
 *
 * Signal over noise is the whole point, so the ledger opts in per entry via
 * `"authorWarn": true` (+ an optional `"authorHint"`). A property being merely
 * `dead` is NOT enough — plenty of dead props are benign display/doc metadata.
 * Only entries an author would be *misled* by are marked. Booleans warn only when
 * set truthy (so schema defaults like `enable.trash` never trip it); object/
 * string/array props warn when present at all.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export interface LivenessLintFinding {
  where: string;
  message: string;
  hint: string;
  rule: string;
}

export const LIVENESS_DEAD_PROPERTY = 'liveness-dead-property';
export const LIVENESS_EXPERIMENTAL_PROPERTY = 'liveness-experimental-property';

type AnyRec = Record<string, unknown>;

interface LedgerEntry {
  status?: string;
  authorWarn?: boolean;
  authorHint?: string;
  note?: string;
  children?: Record<string, LedgerEntry>;
}

/** Flattened, warn-only view of a type's ledger: propPath → entry (incl. `a.b` children). */
type WarnMap = Map<string, LedgerEntry>;

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  return [];
}

/** Locate `@objectstack/spec`'s shipped `liveness/` dir (workspace src or published files). */
function resolveLivenessDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve('@objectstack/spec/package.json');
    const dir = join(dirname(pkgJson), 'liveness');
    return existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

/** Build the warn-only lookup for one type, flattening one level of `children`. */
function loadWarnMap(dir: string, type: string): WarnMap {
  const map: WarnMap = new Map();
  const file = join(dir, `${type}.json`);
  if (!existsSync(file)) return map;
  let ledger: { props?: Record<string, LedgerEntry> };
  try {
    ledger = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return map;
  }
  const props = ledger.props || {};
  for (const [key, entry] of Object.entries(props)) {
    if (entry?.children) {
      for (const [ck, centry] of Object.entries(entry.children)) {
        if (shouldWarn(centry)) map.set(`${key}.${ck}`, centry);
      }
    }
    if (shouldWarn(entry)) map.set(key, entry);
  }
  return map;
}

/** An entry warns when explicitly opted in, OR when it's experimental (a declared-but-unenforced guarantee). */
function shouldWarn(entry: LedgerEntry | undefined): boolean {
  if (!entry) return false;
  return entry.authorWarn === true || entry.status === 'experimental';
}

/** A value that signals authoring intent: booleans only when truthy; everything else when present. */
function isAuthored(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value === true;
  return true;
}

function describe(entry: LedgerEntry): { kind: string; rule: string } {
  if (entry.status === 'experimental') {
    return { kind: 'is experimental — declared but NOT enforced at runtime', rule: LIVENESS_EXPERIMENTAL_PROPERTY };
  }
  return { kind: 'has no runtime effect (liveness: dead)', rule: LIVENESS_DEAD_PROPERTY };
}

/** Check one metadata item's set properties against its type's warn-map. */
function checkItem(
  type: string,
  item: AnyRec,
  whereBase: string,
  warnMap: WarnMap,
  findings: LivenessLintFinding[],
): void {
  for (const [path, entry] of warnMap) {
    const value = path.includes('.')
      ? getNested(item, path)
      : item[path];
    if (!isAuthored(value)) continue;
    const { kind, rule } = describe(entry);
    const hint = entry.authorHint
      ?? entry.note
      ?? 'Remove it — it is declared in the spec but not consumed at runtime.';
    findings.push({
      where: whereBase,
      message: `sets \`${path}\` but this ${type} property ${kind}.`,
      hint,
      rule,
    });
  }
}

/** Resolve a dotted path one or more levels, treating a missing parent as absent. */
function getNested(obj: AnyRec, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as AnyRec)[seg];
  }
  return cur;
}

/**
 * Lint the compiled stack for authored properties the liveness ledger flags as
 * misleading. Advisory only — returns findings, never throws. v1 covers the two
 * highest-signal surfaces (objects incl. their `enable.*` flags, and their
 * fields); the mechanism is ledger-driven, so coverage grows by marking more
 * entries `authorWarn` rather than touching this code.
 */
export function lintLivenessProperties(stack: AnyRec): LivenessLintFinding[] {
  const dir = resolveLivenessDir();
  if (!dir) return [];
  const objectWarn = loadWarnMap(dir, 'object');
  const fieldWarn = loadWarnMap(dir, 'field');
  if (objectWarn.size === 0 && fieldWarn.size === 0) return [];

  const findings: LivenessLintFinding[] = [];
  for (const obj of asArray(stack.objects)) {
    const objName = typeof obj.name === 'string' ? obj.name : '(unnamed object)';
    if (objectWarn.size > 0) checkItem('object', obj, `object '${objName}'`, objectWarn, findings);
    if (fieldWarn.size > 0) {
      for (const field of asArray(obj.fields)) {
        const fieldName = typeof field.name === 'string' ? field.name : '(unnamed field)';
        checkItem('field', field, `object '${objName}' · field '${fieldName}'`, fieldWarn, findings);
      }
    }
  }
  return findings;
}
