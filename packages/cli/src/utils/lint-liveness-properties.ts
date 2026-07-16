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
    const values = path.includes('.')
      ? getNested(item, path)
      : [item[path]];
    for (const value of values instanceof Array ? values : [values]) {
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
      break; // one finding per (item, path) even when the container is an array
    }
  }
}

/**
 * Resolve a dotted path one or more levels, treating a missing parent as
 * absent. A container level that is an ARRAY fans out over its elements
 * (e.g. `nodes.outputSchema` on a flow checks every node), returning the
 * list of resolved values.
 */
function getNested(obj: AnyRec, path: string): unknown[] {
  let cur: unknown[] = [obj];
  for (const seg of path.split('.')) {
    const next: unknown[] = [];
    for (const c of cur) {
      if (c === null || typeof c !== 'object') continue;
      const v = Array.isArray(c) ? undefined : (c as AnyRec)[seg];
      if (Array.isArray(c)) {
        for (const el of c) {
          if (el && typeof el === 'object') next.push((el as AnyRec)[seg]);
        }
      } else {
        next.push(v);
      }
    }
    cur = next;
  }
  // Final level may itself contain arrays-of-values; flatten one step so a
  // trailing array container (e.g. `measures` → each measure) fans out too.
  return cur.flatMap((v) => (Array.isArray(v) ? v : [v]));
}

/**
 * The compiled-stack collection each governed metadata type lives in.
 * `object`/`field` keep their bespoke walk (fields nest under objects);
 * everything else is a flat top-level array on the stack definition.
 */
const TYPE_COLLECTIONS: Array<{ type: string; key: string }> = [
  { type: 'flow', key: 'flows' },
  { type: 'action', key: 'actions' },
  { type: 'agent', key: 'agents' },
  { type: 'tool', key: 'tools' },
  { type: 'skill', key: 'skills' },
  { type: 'dataset', key: 'datasets' },
  { type: 'permission', key: 'permissions' },
  { type: 'hook', key: 'hooks' },
  { type: 'page', key: 'pages' },
  { type: 'view', key: 'views' },
];

/**
 * Lint the compiled stack for authored properties the liveness ledger flags as
 * misleading. Advisory only — returns findings, never throws. Covers every
 * governed metadata type: objects (incl. `enable.*`) and their fields walk
 * bespoke nesting; the remaining types are flat stack collections. Container
 * properties fan out over arrays (each flow node, each dataset measure). The
 * mechanism stays ledger-driven — coverage grows by marking more entries
 * `authorWarn` rather than touching this code.
 */
export function lintLivenessProperties(stack: AnyRec): LivenessLintFinding[] {
  const dir = resolveLivenessDir();
  if (!dir) return [];

  const findings: LivenessLintFinding[] = [];

  const objectWarn = loadWarnMap(dir, 'object');
  const fieldWarn = loadWarnMap(dir, 'field');
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

  for (const { type, key } of TYPE_COLLECTIONS) {
    const warnMap = loadWarnMap(dir, type);
    if (warnMap.size === 0) continue;
    for (const item of asArray(stack[key])) {
      // view containers bind via `object`, not `name`
      const name = typeof item.name === 'string' ? item.name
        : typeof item.object === 'string' ? item.object
        : `(unnamed ${type})`;
      checkItem(type, item, `${type} '${name}'`, warnMap, findings);
    }
  }

  return findings;
}
