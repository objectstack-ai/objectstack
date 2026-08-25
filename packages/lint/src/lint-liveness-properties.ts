// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time lint that closes the spec-liveness loop on the AUTHOR side.
 *
 * The liveness ledgers (`@objectstack/spec/liveness/<type>.json`) classify every
 * authorable metadata property as live / experimental / planned / dead with
 * evidence. The CI gate enforces that classification is *complete*, but the
 * ledger's knowledge never reached the person (very often an AI) writing the
 * metadata. This lint surfaces it: when an authored object/field sets a property
 * the ledger marks `dead`-and-misleading, `experimental`, or `planned`, it emits
 * an advisory WARNING with a verdict-specific message and hint — `dead` says
 * remove it, `experimental`/`planned` say keep it (declared, just not enforced /
 * not read yet) — under a verdict-specific rule id (`describe()` below is the one
 * place that mapping lives; #11384). It NEVER fails the build.
 *
 * Signal over noise is the whole point, so the ledger opts in per entry via
 * `"authorWarn": true` (+ an optional `"authorHint"`). A property being merely
 * `dead` is NOT enough — plenty of dead props are benign display/doc metadata.
 * Only entries an author would be *misled* by are marked. Booleans warn only when
 * set truthy (so schema defaults like `enable.searchable` never trip it); object/
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
export const LIVENESS_PLANNED_PROPERTY = 'liveness-planned-property';

type AnyRec = Record<string, unknown>;

export interface LedgerEntry {
  status?: string;
  authorWarn?: boolean;
  authorHint?: string;
  note?: string;
  children?: Record<string, LedgerEntry>;
}

/** Flattened, warn-only view of a type's ledger: propPath → entry (incl. `a.b` children). */
type WarnMap = Map<string, LedgerEntry>;

function isRecord(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

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

/**
 * `#11384`. The ledger ships (at least) three verdicts an author-facing finding
 * can carry, and they imply OPPOSITE actions: `dead` means remove the property
 * (nothing will ever read it), `planned` means keep it (a consumer is being
 * built against it, contract-first — it just does not have runtime effect
 * YET), `experimental` means keep it too but with the guarantee's status
 * flagged. Collapsing `planned` into the `dead` branch — the bug this function
 * fixes — told an author to delete metadata the platform had asked them to
 * write, while the row's own `authorHint`/`note` (when present) said the
 * opposite one sentence later on the SAME finding.
 *
 * Each verdict below also carries its own DEFAULT hint (used only when the
 * ledger entry has neither `authorHint` nor `note`): the `dead` default says
 * "Remove it"; `planned`'s must not, because removing a planned property is
 * exactly the wrong author action.
 *
 * Unknown status: `LedgerEntry.status` is a plain `string` (see the interface
 * above) because the ledger's status vocabulary is DOCUMENTED, not
 * schema-enforced — `packages/spec/scripts/liveness/check-liveness.mts`'s own
 * header states "Statuses: live | experimental | planned | dead" in a comment,
 * and nothing in that gate (or anywhere else) rejects a ledger JSON file that
 * spells one wrong or ships a status this function has never heard of; the
 * gate only requires that a status be PRESENT, not that it be one of the four.
 * An entry only reaches `describe()` once `shouldWarn()` has already said yes
 * (`authorWarn: true`, or `status === 'experimental'`), so `live` can in
 * principle arrive here too (an entry marked `authorWarn: true` on a `live`
 * row would be a ledger authoring mistake, not a user error). Before this fix
 * every one of those unrecognised cases fell silently into the `dead` branch —
 * exactly the defect class #11384 reports, just with a different trigger — so
 * the boundary below is LOUD on purpose: a status this function does not
 * recognise is a bug in the shipped ledger, not something to guess about.
 * This is deliberately narrower than the file's general "never throws"
 * promise (see the `checkItem`/bundle-walk comments below): that promise
 * covers malformed STACK input from an untrusted author, while a ledger
 * status is OUR OWN shipped, framework-controlled data — failing loudly here
 * cannot be triggered by anything an app author writes.
 */
function describe(entry: LedgerEntry): { kind: string; rule: string; defaultHint: string } {
  if (entry.status === 'experimental') {
    return {
      kind: 'is experimental — declared but NOT enforced at runtime',
      rule: LIVENESS_EXPERIMENTAL_PROPERTY,
      defaultHint: 'It is declared in the spec as an experimental guarantee — not yet enforced at runtime.',
    };
  }
  if (entry.status === 'planned') {
    return {
      kind: 'is planned — declared, and a consumer is being built against it (not read YET)',
      rule: LIVENESS_PLANNED_PROPERTY,
      defaultHint: 'Keep it — a consumer is being built against this property; it has no runtime effect yet.',
    };
  }
  if (entry.status === 'dead') {
    return {
      kind: 'has no runtime effect (liveness: dead)',
      rule: LIVENESS_DEAD_PROPERTY,
      defaultHint: 'Remove it — it is declared in the spec but not consumed at runtime.',
    };
  }
  throw new Error(
    `lintLivenessProperties: ledger entry has unrecognised status ${JSON.stringify(entry.status)} — ` +
    "describe() only knows 'experimental' | 'planned' | 'dead'. This is a shipped-ledger integrity " +
    'bug, not an authoring error: either the ledger JSON has a typo, or a new status was added to ' +
    'the vocabulary without teaching describe() in lint-liveness-properties.ts about it (#11384).',
  );
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
      const { kind, rule, defaultHint } = describe(entry);
      const hint = entry.authorHint ?? entry.note ?? defaultHint;
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
 *
 * Exported as a test seam — see the block below `getNested` for why this one
 * property cannot stay ledger-driven.
 */
export function getNested(obj: AnyRec, path: string): unknown[] {
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
 * ── Test seam (#10262). Package-internal: NOT part of the published surface ──
 *
 * `getNested` above and this wrapper are exported for
 * `lint-liveness-properties.test.ts` to drive the array fan-out against a
 * SYNTHETIC warn map. They are exported from the MODULE only — neither is
 * re-exported by `src/index.ts`, and this package's `exports` map publishes
 * exactly two subpaths (`.` → `dist/index.js`, `./runtime` → `dist/runtime.js`,
 * both bundled by tsup from those two entries). So no consumer can reach either
 * symbol and the built `.d.ts` surface is unchanged; the test reaches them the
 * way every other test in this package reaches its subject, by importing
 * `./lint-liveness-properties.js` directly.
 *
 * WHY the fan-out needs a seam when everything else in this file is (rightly)
 * ledger-driven: its subject is a ledger VERDICT, and verdicts are supposed to
 * move. A dotted warn-map path is the only thing that reaches `getNested` at
 * all — `checkItem` takes the `path.includes('.') ? getNested(item, path) :
 * [item[path]]` branch — and twice now a row correctly flipping to `live`
 * deleted the only test of the walk:
 *
 *   - #6774 flipped `dashboard.widgets.colorVariant` live → subject lost, filed
 *     as #7079;
 *   - #7079 was closed by re-subjecting to `app.…navigation.children.runAction`;
 *   - #10068 flipped THAT live → subject lost again, and measured across all 30
 *     shipped ledgers every remaining warned entry is top-level, so there is
 *     nothing left to re-subject to. Filed as #10262 (this seam).
 *
 * A broken walk is invisible without it: a `getNested` that stopped at index 0
 * "still warns on every single-entry fixture, on every top-level warned key,
 * and on the first item of every real app", so nothing else in this file would
 * go red. The seam moves ONLY that one property to the walker's own level;
 * every other assertion in the test file stays a real contract test against the
 * shipped ledgers, including the #10068 silence pin and its anti-vacuity guard.
 */
export function checkItemAgainstWarnMap(
  type: string,
  item: AnyRec,
  whereBase: string,
  warnMap: Iterable<readonly [string, LedgerEntry]>,
): LivenessLintFinding[] {
  const findings: LivenessLintFinding[] = [];
  checkItem(type, item, whereBase, new Map(warnMap), findings);
  return findings;
}

/**
 * The compiled-stack collection each governed metadata type lives in.
 * `object`/`field` and `translation` keep their bespoke walks (fields nest
 * under objects; translation bundles nest under locale codes); everything else
 * is a flat top-level array of items whose TOP-LEVEL keys are the ledger's
 * props, which is what this loop's `checkItem(type, item, …)` assumes.
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
  { type: 'webhook', key: 'webhooks' },
  // #4487. Note what adding a TYPE costs versus adding a warned property: the
  // doc below is right that coverage grows by marking entries `authorWarn` —
  // but only WITHIN a type already listed here. A newly governed type needs its
  // collection registered or its ledger warns nobody, which would leave the
  // ledger correct and silent: the exact shape this lint exists to prevent.
  { type: 'datasource', key: 'datasources' },
  // #4488 — the six newly governed types that carry `authorWarn` entries.
  // (doc / seed / validation are governed too but warn on nothing today, so
  // they are not listed; add them here the day one of their entries warns.)
  { type: 'app', key: 'apps' },
  { type: 'book', key: 'books' },
  { type: 'job', key: 'jobs' },
  { type: 'email_template', key: 'emailTemplates' },
  { type: 'mapping', key: 'mappings' },
  // `translation` is NOT here — see the bespoke bundle walk in
  // `lintLivenessProperties`. It was listed here until #11288, and being listed
  // is precisely what made it silent: an item of `stack.translations` is a
  // locale-keyed `TranslationBundle`, not a `TranslationItem`, so this loop's
  // flat `checkItem` read `bundle['flows']` and every warned lookup missed. Do
  // not re-add the row — registering the collection is only half the contract;
  // the walk has to match the collection's SHAPE.
  // #4956 — dashboard joins the list the moment its ledger first warns on
  // anything, which is exactly the rule the comment above states. Drilling
  // `widgets` produced five warned keys (`colorVariant`, `actionUrl`,
  // `actionType`, `actionIcon`, `aria`), all under `widgets[]`; `getNested`
  // fans a dotted path out over an array level, so `widgets.colorVariant`
  // checks every widget on the dashboard. Registering it here is not optional
  // bookkeeping: without it the ledger would be newly correct and newly
  // silent, which is the shape this lint exists to prevent.
  //
  // As of #6774 the dashboard ledger warns on NOTHING — four of those five were
  // retired in 17.0.0 (#5010) and `colorVariant` went `live` when objectui#3799
  // gave it a renderer. The type STAYS listed, the resolved state `webhook` and
  // `email_template` already sit in: a zero-warn entry costs one empty map
  // lookup, and it means a future regression that re-deadens a widget key warns
  // on its own instead of waiting for someone to notice this list again.
  { type: 'dashboard', key: 'dashboards' },
];

/**
 * Lint the compiled stack for authored properties the liveness ledger flags as
 * misleading. Advisory only — returns findings, never throws. Covers every
 * governed metadata type: objects (incl. `enable.*`) and their fields walk
 * bespoke nesting, and translation bundles walk their locale entries (#11288);
 * the remaining types are flat stack collections. Container properties fan out
 * over arrays (each flow node, each dataset measure). The
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
    // Malformed collection item — same "never throws" contract as the flat
    // TYPE_COLLECTIONS loop and the translation bundle walk below (#11385).
    if (!isRecord(obj)) continue;
    const objName = typeof obj.name === 'string' ? obj.name : '(unnamed object)';
    if (objectWarn.size > 0) checkItem('object', obj, `object '${objName}'`, objectWarn, findings);
    if (fieldWarn.size > 0) {
      for (const field of asArray(obj.fields)) {
        if (!isRecord(field)) continue;
        const fieldName = typeof field.name === 'string' ? field.name : '(unnamed field)';
        checkItem('field', field, `object '${objName}' · field '${fieldName}'`, fieldWarn, findings);
      }
    }
  }

  // `translation` walks one level deeper than every other collection. An item of
  // `stack.translations` is a `TranslationBundle` — `z.record(LocaleSchema,
  // TranslationDataSchema)` (`packages/spec/src/stack.zod.ts:275`) — so the
  // ledger's groups (`flows`, `objects`, `messages`, …) live under each locale
  // code, not on the item. Walked flat (as it was until #11288) every warned
  // lookup read `bundle['flows']`, which a bundle has at no depth reachable that
  // way, and the whole translation ledger warned nobody for file-authored
  // bundles — the only way apps author translations today. Measured on a real
  // app as a zero-delta ablation: an injected `flows:` section produced no new
  // findings at all.
  //
  // The ledger's own subject is `TranslationItemSchema`, the RUNTIME metadata
  // door, which does carry the groups at its top level. That door is reached by
  // no walk here and cannot be: no stack collection carries those items, and
  // this rule is `surfaces: CLI_ONLY` (`authoring-rules.ts`), so it never runs
  // at the runtime publish gate either. The two doors share the group
  // vocabulary, not the container; only the file-authored one is lintable.
  const translationWarn = loadWarnMap(dir, 'translation');
  if (translationWarn.size > 0) {
    const bundles = asArray(stack.translations);
    for (let i = 0; i < bundles.length; i++) {
      const bundle = bundles[i];
      if (!isRecord(bundle)) continue;
      for (const [locale, data] of Object.entries(bundle)) {
        // Only a locale entry holds `TranslationData`. Anything else is either a
        // malformed bundle or the `name` key `asArray` injects for a map-shaped
        // collection — skipping both keeps the "never throws" contract.
        if (!isRecord(data)) continue;
        checkItem('translation', data, `translation bundle #${i} · locale '${locale}'`, translationWarn, findings);
      }
    }
  }

  for (const { type, key } of TYPE_COLLECTIONS) {
    const warnMap = loadWarnMap(dir, type);
    if (warnMap.size === 0) continue;
    for (const item of asArray(stack[key])) {
      // Malformed collection item — "never throws" contract (#11385).
      if (!isRecord(item)) continue;
      // view containers bind via `object`, not `name`
      const name = typeof item.name === 'string' ? item.name
        : typeof item.object === 'string' ? item.object
        : `(unnamed ${type})`;
      checkItem(type, item, `${type} '${name}'`, warnMap, findings);
    }
  }

  return findings;
}
