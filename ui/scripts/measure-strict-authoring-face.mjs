/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * MEASUREMENT THROWAWAY — objectui#7581, the first deliverable of the #5250
 * ruling (maintainer, 2026-09-04, decision batch #25, option 2: "a strict
 * authoring face as a programme, measurement first").
 *
 * ⛔ THIS SCRIPT SHIPS NOTHING AND REPAIRS NOTHING. It changes no schema, wires
 * no gate, and does not touch `.passthrough()` on `BaseSchemaCore` — which the
 * ruling names as load-bearing for renderer props (see the `specFieldsExcept`
 * docblock in `packages/types/src/zod/base.zod.ts`). It derives strict TWINS in
 * memory, runs today's corpora through them, and prints how red strict goes.
 *
 * ── HOW TO RUN ─────────────────────────────────────────────────────────────
 *   pnpm --filter @object-ui/types build          # the twins are read from dist/
 *   pnpm exec tsx scripts/measure-strict-authoring-face.mjs            # markdown
 *   pnpm exec tsx scripts/measure-strict-authoring-face.mjs --json     # machine
 *
 * `tsx` (a root devDependency) is wanted only because corpus 3 holds authored
 * documents that live in `.ts` modules; everything else runs under plain
 * `node`. The zod face is read from `packages/types/dist/`, so a stale `dist/`
 * measures a stale face — build first. Output is deterministic (every list is
 * sorted, nothing is timestamped) so two runs diff clean, and the report
 * carries the `main` SHA it ran against so the numbers can be re-derived after
 * the declaration repairs of #6939 land and move them.
 *
 * ── WHAT A "STRICT TWIN" IS HERE ───────────────────────────────────────────
 * A recursive rebuild of a zod schema in which every `ZodObject` gets
 * `catchall: z.never()` (i.e. `.strict()`), reached through unions,
 * discriminated unions, arrays, tuples, records, sets, maps, intersections,
 * optionals, nullables, defaults, prefaults, promises, BOTH sides of a pipe
 * and `z.lazy` (memoised, so the self-referential schemas terminate). Objects
 * are cloned by patching `_zod.def` and calling their own constructor, NOT
 * rebuilt with `z.object(shape)`: the latter drops `.refine()` checks, which
 * several schemas here carry, and a twin that quietly lost a refinement would
 * under-report red.
 *
 * That arm table MIRRORS the shipped walker behind `deriveStrictAuthoringSchema`
 * (`packages/types/src/strict-authoring-face.ts`), and a mirror that falls
 * behind reads CLEANER than the face it measures — objectui#10076 was exactly
 * that: this twin closed only the `in` side of a pipe, and `z.preprocess(f, X)`
 * keeps `X` on the `out` side. A schema-bearing wrapper with no arm here is
 * reported under `walkerLimits`, ⛔ never handed back in silence. The script
 * keeps its own walker rather than calling the shipped one because the node
 * boundary below, the `baseline` twin and the `keyProbe` have no counterpart
 * there. The key probe and the node collector below walk both sides of a pipe
 * too, and neither RUNS a preprocessor: a preprocessor that renames a key makes
 * the probe name the old spelling as undeclared although both twins accept it.
 *
 * ── THE NODE BOUNDARY, AND WHY IT IS NOT OPTIONAL ──────────────────────────
 * Child slots (`children` / `body` / `content` / …) are typed
 * `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])`, and
 * `SchemaNodeSchema` is a `z.lazy` over ONE live union: a component arm in
 * slot 0, then the primitives a slot admits. Since objectui#8344 that arm is
 * the component union itself — `defineNodeComponentUnion` writes
 * `AnyComponentSchema` into slot 0 when the `./zod` barrel evaluates, and this
 * script reads the face through that barrel. So an un-boundaried walk does
 * judge every child node against its own component schema, but a child slot is
 * part of its parent's shape: a child's refusal fails every ancestor's parse
 * too, and a per-node table built that way charges one undeclared key to each
 * level above it. So the per-component measurement replaces `SchemaNodeSchema`
 * with `z.any()` (the "node boundary") and instead walks each document into
 * its constituent nodes, judging every node against ITS OWN component schema,
 * children excluded. objectui#10076 measured that difference once, on the
 * corpora of its day (a historical reading, ⛔ not re-derived here): strict
 * per-component twins refused 168 nodes with the boundary and 185 without it.
 * Both readings are reported: the per-component tables use the boundary, and
 * `totals.documentsStrictRefusedWholeTree` (and the same field per corpus)
 * reports the un-boundaried whole-document strict parse — what a naive
 * `.strict()` flip would really do.
 *
 * ── THE THREE TWINS PER SCHEMA ─────────────────────────────────────────────
 *  1. `baseline` — the face as shipped, boundary applied, nothing else
 *     changed. A node red here is red TODAY; strict is not what broke it.
 *  2. `strict` — baseline + `catchall: never` on every object.
 *  3. `keyProbe` — a shape skeleton: same keys, every leaf `z.any()`, every
 *     member optional, union arms merged key-wise, default (strip) catchall.
 *     It cannot fail, so `diff(input, keyProbe.parse(input))` enumerates the
 *     undeclared keys EXACTLY — including for nodes that are red for value
 *     reasons and would otherwise yield no parse output to diff. This is the
 *     authoritative key enumeration; zod's own `unrecognized_keys` issues are
 *     not used for it, because a union reports whichever arm it tried and can
 *     attribute a key to the wrong shape.
 *
 * ── THE PREDICATES, STATED UP FRONT (objectui#7581 asks for them) ──────────
 *  • COMPONENT TYPE / NODE SCHEMA — the arms of `AnyComponentSchema`, walked
 *    through nested unions and `z.lazy`. That union IS the face's own answer
 *    to "every node schema"; taking the type map from all 206 module exports
 *    instead is wrong, and measurably so: `FilterFieldSchema` declares
 *    `type: z.enum(['text','select','number','date',…])` for a FILTER FIELD,
 *    and an export-order registry hands it the `text` and `select` node types.
 *  • NODE DOCUMENT — a JSON value that (a) parses, (b) is a plain object, (c)
 *    carries a string `type`, and (d) whose `type` resolves in that registry.
 *  • FRAGMENT (docs corpus) — a ```json fence whose body does NOT parse as
 *    JSON. That is the deliberate-snippet shape (an `…` elision, a bare key
 *    list, a trailing comma). It is COUNTED, ⛔ never silently skipped: #5138
 *    is the open question of marking these explicitly, and this count is its
 *    price tag.
 *  • NON-DOCUMENT — parses as JSON but fails (b), (c) or (d). Split into
 *    `notAnObject`, `noTypeKey` and `unresolvedType`; the last is its own
 *    bucket because such a document is refused by `AnyComponentSchema` TODAY,
 *    which is a finding about the corpus, not about strict.
 *
 * ── WHERE NODES ARE LOOKED FOR ─────────────────────────────────────────────
 * Traversal is SCHEMA-GUIDED, never "any object with a `type` key". A field
 * definition `{ name: 'amount', type: 'currency' }` and a node `{ type:
 * 'text' }` are indistinguishable structurally, and half the field-type
 * vocabulary (`text`, `number`, `date`, `select`, `html`, `label`) collides
 * with a node type. So a value is a node only where the SCHEMA puts a
 * `SchemaNodeSchema` slot; from there descent continues through that node's
 * own schema. A `type` at a node slot that resolves in no schema is counted
 * (`unresolvedNodeTypes`), ⛔ not dropped.
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ZOD = path.join(REPO_ROOT, 'packages/types/dist/zod/index.zod.js');

// zod is not hoisted to the repo root under pnpm; resolve the SAME copy the
// built face was compiled against, or the twins would mix two zod realms.
const requireFromTypes = createRequire(path.join(REPO_ROOT, 'packages/types/package.json'));
const { z } = requireFromTypes('zod');
const ZOD_VERSION = requireFromTypes('zod/package.json').version;

const Zface = await import(pathToFileURL(DIST_ZOD).href);
const NODE_BOUNDARY = Zface.SchemaNodeSchema;

const git = (...args) => {
  try { return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); }
  catch { return null; }
};

/**
 * The pin objectui#7581 asks for. `HEAD` alone is not it: this script lives on
 * a branch, so HEAD is the branch tip while the numbers describe the CORPUS.
 * So report all three — the tip, the `origin/main` commit it forked from, and
 * a mechanical answer to "does this tree's corpus still equal main's?". If
 * `corpusMatchesMain` is false, the numbers below are NOT main's numbers.
 */
const CORPUS_PATHS = [
  'examples/schema-catalog/src/schemas',
  'content/docs',
  'apps',
  'packages/types/src',
];
function pin() {
  const head = git('rev-parse', 'HEAD');
  const base = git('merge-base', 'HEAD', 'origin/main');
  let corpusMatchesMain = null;
  if (base) {
    try {
      execFileSync('git', ['diff', '--quiet', base, '--', ...CORPUS_PATHS], { cwd: REPO_ROOT });
      corpusMatchesMain = true;
    } catch (err) { corpusMatchesMain = err.status === 1 ? false : null; }
  }
  return { head, mergeBaseWithOriginMain: base, corpusMatchesMain, corpusPaths: CORPUS_PATHS };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

// ───────────────────────────────────────────────────────────────────────────
// Registry — component `type` → the node schema that declares it
// ───────────────────────────────────────────────────────────────────────────

const exportNameOf = new Map();
for (const [name, value] of Object.entries(Zface)) {
  if (!value?._zod) continue;
  if (!exportNameOf.has(value)) exportNameOf.set(value, name);
  // `ActionSchema` and friends are exported as the `z.lazy` WRAPPER, while the
  // union arm is the object the getter returns. Index both, or the arm reads
  // as anonymous in the report.
  if (value._zod.def.type === 'lazy') {
    let inner;
    try { inner = value._zod.def.getter(); } catch { inner = null; }
    if (inner?._zod && !exportNameOf.has(inner)) exportNameOf.set(inner, name);
  }
}

/**
 * Identity is not enough. `ActionSchema` is `z.lazy(() => z.object({…}))`, and
 * its getter BUILDS A FRESH SCHEMA ON EVERY CALL — `getter() === getter()` is
 * false — so the arm reached through the union is never the object indexed
 * above. Naming by the `type` literals the arm declares recovers it, and the
 * unstable-getter fact is itself reported (`unstableLazyExports`).
 */
const nameByTypeLiterals = new Map();
const unstableLazyExports = [];
for (const [name, value] of Object.entries(Zface)) {
  if (!value?._zod) continue;
  let target = value;
  if (value._zod.def.type === 'lazy') {
    try {
      const a = value._zod.def.getter();
      const b = value._zod.def.getter();
      if (a !== b) unstableLazyExports.push(name);
      target = a;
    } catch { continue; }
  }
  if (target?._zod?.def?.type !== 'object') continue;
  const lits = typeLiterals(target._zod.def.shape?.type);
  if (!lits?.length) continue;
  const key = [...lits].sort().join('|');
  if (!nameByTypeLiterals.has(key)) nameByTypeLiterals.set(key, name);
}

/** The string literals a `type` member can take, or null if it is not literal. */
function typeLiterals(schema) {
  if (!schema?._zod) return null;
  const def = schema._zod.def;
  if (def.type === 'literal') return def.values.filter((v) => typeof v === 'string');
  if (def.type === 'enum') return Object.values(def.entries).filter((v) => typeof v === 'string');
  if (def.type === 'union') {
    const out = [];
    for (const option of def.options) {
      const lits = typeLiterals(option);
      if (!lits) return null;
      out.push(...lits);
    }
    return out;
  }
  return null;
}

const registry = new Map();
const registryCollisions = [];
const armsWithoutLiteralType = [];
/** Node types whose schema is reachable only through a union — not exported by
 *  name from `@object-ui/types/zod`, so no consumer can validate one alone. */
const unexportedNodeSchemas = new Set();

function registerArms(schema, depth = 0) {
  if (!schema?._zod || depth > 6) return;
  const def = schema._zod.def;
  if (def.type === 'union') { for (const option of def.options) registerArms(option, depth + 1); return; }
  if (def.type === 'lazy') { try { registerArms(def.getter(), depth + 1); } catch { /* reported below */ } return; }
  if (def.type !== 'object') { armsWithoutLiteralType.push(`${exportNameOf.get(schema) ?? '(anonymous)'} (${def.type})`); return; }
  const lits = typeLiterals(def.shape?.type);
  if (!lits) { armsWithoutLiteralType.push(exportNameOf.get(schema) ?? '(anonymous object arm)'); return; }
  const armName = exportNameOf.get(schema) ?? nameByTypeLiterals.get([...lits].sort().join('|')) ?? null;
  if (!armName) for (const t of lits) unexportedNodeSchemas.add(t);
  for (const t of lits) {
    const existing = registry.get(t);
    if (!existing) registry.set(t, { schema, name: armName ?? '(not exported by name)' });
    else if (existing.schema !== schema) {
      registryCollisions.push({ type: t, kept: existing.name, alsoDeclaredBy: armName ?? '(not exported by name)' });
    }
  }
}
registerArms(Zface.AnyComponentSchema);

// ───────────────────────────────────────────────────────────────────────────
// The twins
// ───────────────────────────────────────────────────────────────────────────

/** Clone a schema node with a patched `_zod.def`, preserving its checks. */
const cloneWithDef = (schema, patch) => new schema.constructor({ ...schema._zod.def, ...patch });

/** Shapes the walker could not strict-ify — a finding, ⛔ not a silent skip. */
const walkerLimits = new Map();
const noteLimit = (kind, where) => {
  if (!walkerLimits.has(kind)) walkerLimits.set(kind, new Set());
  walkerLimits.get(kind).add(where);
};

/** The def members through which a node can hold another schema — the same list the shipped walker reads. */
const SCHEMA_BEARING_MEMBERS = ['shape', 'options', 'items', 'element', 'rest', 'valueType', 'keyType', 'left', 'right', 'in', 'out', 'innerType'];
const carriesSchema = (def) => SCHEMA_BEARING_MEMBERS.some((member) => def[member] != null);

function makeTwin({ strict, boundary = true }) {
  const memo = new Map();
  const transform = (schema) => {
    if (!schema?._zod) return schema;
    if (boundary && schema === NODE_BOUNDARY) return z.any();
    if (memo.has(schema)) return memo.get(schema);
    const def = schema._zod.def;

    if (def.type === 'lazy') {
      const out = z.lazy(() => transform(def.getter()));
      memo.set(schema, out); // before the getter can re-enter
      return out;
    }

    let out;
    switch (def.type) {
      case 'object': {
        const shape = {};
        for (const [k, v] of Object.entries(def.shape)) shape[k] = transform(v);
        out = cloneWithDef(schema, strict ? { shape, catchall: z.never() } : { shape });
        break;
      }
      case 'union': out = cloneWithDef(schema, { options: def.options.map(transform) }); break;
      case 'array': out = cloneWithDef(schema, { element: transform(def.element) }); break;
      case 'tuple': out = cloneWithDef(schema, { items: def.items.map(transform), ...(def.rest ? { rest: transform(def.rest) } : {}) }); break;
      case 'record': case 'set': out = cloneWithDef(schema, { valueType: transform(def.valueType) }); break;
      case 'map': out = cloneWithDef(schema, { keyType: transform(def.keyType), valueType: transform(def.valueType) }); break;
      case 'intersection': out = cloneWithDef(schema, { left: transform(def.left), right: transform(def.right) }); break;
      // BOTH sides: `X.transform(f)` keeps X in `in`, `z.preprocess(f, X)` keeps it in `out`.
      case 'pipe': out = cloneWithDef(schema, { in: transform(def.in), ...(def.out ? { out: transform(def.out) } : {}) }); break;
      case 'optional': case 'nullable': case 'default': case 'prefault': case 'nonoptional': case 'readonly': case 'catch': case 'promise':
        out = cloneWithDef(schema, { innerType: transform(def.innerType) }); break;
      case 'custom': case 'transform': case 'function':
        // An opaque validator: there is no shape to close. Recorded so the
        // programme knows strict does not reach inside these.
        noteLimit(`opaque \`${def.type}\` node — strict cannot reach inside it`, exportNameOf.get(schema) ?? `(inline ${def.type})`);
        out = schema;
        break;
      default:
        // Leaves (string, number, literal, enum, any, unknown, …) have nothing
        // to close. A wrapper with no arm above is not a leaf: its inner schema
        // stays open, so it is reported rather than passed as clean.
        if (carriesSchema(def)) noteLimit(`\`${def.type}\` wrapper — the walker has no arm for it, its inner schema stays open`, exportNameOf.get(schema) ?? `(inline ${def.type})`);
        out = schema;
    }
    memo.set(schema, out);
    return out;
  };
  return transform;
}

/** Peel wrappers down to a ZodObject, or null. */
function unwrapToObject(schema, depth = 0) {
  if (!schema?._zod || depth > 20) return null;
  const def = schema._zod.def;
  if (def.type === 'object') return schema;
  if (def.innerType) return unwrapToObject(def.innerType, depth + 1);
  if (def.type === 'lazy') { try { return unwrapToObject(def.getter(), depth + 1); } catch { return null; } }
  if (def.type === 'pipe') return unwrapToObject(def.in, depth + 1) ?? (def.out ? unwrapToObject(def.out, depth + 1) : null);
  return null;
}

/**
 * The key skeleton — same declared keys, every value `z.any()`, every member
 * optional, strip catchall. It cannot fail, so `diff(in, out)` is exactly the
 * undeclared-key set. Union arms are merged key-wise: a key declared by ANY
 * arm counts as declared, which over-approximates "declared" and can therefore
 * only UNDER-report undeclared keys — the conservative direction for a
 * measurement whose headline is "how red". A pipe is probed on both sides, in
 * order, without running its preprocessor — the one shape that can OVER-report
 * (see `WHAT A "STRICT TWIN" IS HERE` at the top of this file).
 */
function makeKeyProbe() {
  const memo = new Map();
  // A shaped arm first (so an object really is stripped), anything second (so
  // a value of the wrong SHAPE — `items: 'x'` where the schema says an array —
  // still cannot make the probe fail). Without this the probe reports nothing
  // for exactly the nodes that are already red, which is where the undeclared
  // keys are most likely to be.
  const orAnything = (shaped) => z.union([shaped, z.any()]);
  const probe = (schema, depth = 0) => {
    if (!schema?._zod || depth > 40) return z.any();
    if (schema === NODE_BOUNDARY) return z.any();
    if (memo.has(schema)) return memo.get(schema);
    const def = schema._zod.def;

    if (def.type === 'lazy') {
      const out = z.lazy(() => probe(def.getter(), depth + 1));
      memo.set(schema, out);
      return out;
    }

    let out;
    switch (def.type) {
      case 'object': {
        const shape = {};
        for (const [k, v] of Object.entries(def.shape)) shape[k] = probe(v, depth + 1).optional();
        out = orAnything(z.object(shape));
        break;
      }
      case 'union': {
        const objectArms = def.options.map((o) => unwrapToObject(o));
        if (objectArms.some((o) => !o)) { out = z.any(); break; }
        const shape = {};
        for (const arm of objectArms) {
          for (const [k, v] of Object.entries(arm._zod.def.shape)) {
            shape[k] = shape[k] ? z.any().optional() : probe(v, depth + 1).optional();
          }
        }
        out = orAnything(z.object(shape));
        break;
      }
      case 'array': out = orAnything(z.array(probe(def.element, depth + 1))); break;
      case 'tuple': out = z.any(); break;
      case 'record': out = orAnything(z.record(z.string(), probe(def.valueType, depth + 1))); break;
      case 'intersection': {
        const l = unwrapToObject(def.left);
        const r = unwrapToObject(def.right);
        if (!l || !r) { out = z.any(); break; }
        const shape = {};
        for (const side of [l, r]) for (const [k, v] of Object.entries(side._zod.def.shape)) shape[k] = probe(v, depth + 1).optional();
        out = orAnything(z.object(shape));
        break;
      }
      case 'pipe': out = def.out ? probe(def.in, depth + 1).pipe(probe(def.out, depth + 1)) : probe(def.in, depth + 1); break;
      case 'optional': case 'nullable': case 'default': case 'prefault': case 'nonoptional': case 'readonly': case 'catch': case 'promise':
        out = probe(def.innerType, depth + 1); break;
      default: out = z.any();
    }
    memo.set(schema, out);
    return out;
  };
  return probe;
}

const toBaseline = makeTwin({ strict: false });
const toStrict = makeTwin({ strict: true });
const toKeyProbe = makeKeyProbe();
const anyBaseline = toBaseline(Zface.AnyComponentSchema);
const anyStrict = toStrict(Zface.AnyComponentSchema);
const anyStrictWholeTree = makeTwin({ strict: true, boundary: false })(Zface.AnyComponentSchema);

const twinCache = new Map();
function twinsFor(type) {
  if (twinCache.has(type)) return twinCache.get(type);
  const entry = registry.get(type);
  let out = null;
  try {
    out = { baseline: toBaseline(entry.schema), strict: toStrict(entry.schema), keyProbe: toKeyProbe(entry.schema) };
  } catch (err) {
    noteLimit('walker threw while deriving a twin', `${type}: ${String(err?.message ?? err).split('\n')[0]}`);
  }
  twinCache.set(type, out);
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Corpora
// ───────────────────────────────────────────────────────────────────────────

function walkFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}
const rel = (p) => path.relative(REPO_ROOT, p);

/** Corpus 1 — the schema-catalog fixtures. */
const loadCatalog = () =>
  walkFiles(path.join(REPO_ROOT, 'examples/schema-catalog/src/schemas'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ origin: rel(f), text: readFileSync(f, 'utf8') }));

/**
 * Corpus 2 — every ```json fence under content/docs. Real fence-state
 * scanning, not a grep: an info string may carry a title and a fence may be
 * indented inside a list item, so the opening count here is derived.
 */
function loadDocsFences() {
  const fences = [];
  for (const file of walkFiles(path.join(REPO_ROOT, 'content/docs'))) {
    if (!/\.mdx?$/.test(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    let open = null;
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
      if (!m) { if (open) open.body.push(lines[i]); continue; }
      const [, ticks, info] = m;
      if (open) {
        if (ticks[0] === open.marker[0] && ticks.length >= open.marker.length && info.trim() === '') {
          fences.push({ origin: `${rel(file)}#L${open.line}`, text: open.body.join('\n'), lang: open.lang });
          open = null;
        } else open.body.push(lines[i]);
        continue;
      }
      open = { marker: ticks, lang: info.trim().split(/\s+/)[0] ?? '', body: [], line: i + 1 };
    }
    if (open) fences.push({ origin: `${rel(file)}#L${open.line}`, text: open.body.join('\n'), lang: open.lang });
  }
  return fences.filter((f) => f.lang === 'json' || f.lang === 'jsonc');
}

/**
 * Corpus 3 — authored documents under `apps/**` and `packages/*​/examples/**`.
 * `.json` files are read directly; `.ts` modules that actually carry authored
 * data (a `type: '…'` literal in the source) are imported and every exported
 * plain object / array of objects / one-level record of objects is harvested
 * as a candidate. A module that cannot be imported is RECORDED, ⛔ not skipped.
 */
async function loadAuthored() {
  const docs = [];
  const unloadable = [];
  const sideEffectful = [];
  const scanned = [];
  const files = [
    ...walkFiles(path.join(REPO_ROOT, 'apps')),
    ...readdirSync(path.join(REPO_ROOT, 'packages'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => walkFiles(path.join(REPO_ROOT, 'packages', d.name, 'examples'))),
  ];
  for (const file of files) {
    if (file.endsWith('.json')) { docs.push({ origin: rel(file), text: readFileSync(file, 'utf8') }); scanned.push(rel(file)); continue; }
    if (!file.endsWith('.ts') || /\.(test|spec)\.ts$/.test(file) || file.includes('__tests__')) continue;
    if (!/\btype:\s*['"]/.test(readFileSync(file, 'utf8'))) continue;
    scanned.push(rel(file));
    let mod;
    // Importing an example module RUNS it, and several of them are worked
    // examples that print. Muting console for the duration keeps this script's
    // stdout exactly the report (it is diffed run-to-run), and the fact that a
    // module printed is recorded rather than swallowed.
    const realConsole = { ...console };
    const noop = () => {};
    let printed = false;
    for (const m of ['log', 'info', 'warn', 'error', 'debug']) console[m] = (...a) => { printed = a.length >= 0; };
    try { mod = await import(pathToFileURL(file).href); }
    catch (err) { unloadable.push({ origin: rel(file), error: String(err?.message ?? err).split('\n')[0] }); continue; }
    finally { Object.assign(console, realConsole); }
    if (printed) sideEffectful.push(rel(file));
    for (const [name, value] of Object.entries(mod)) harvest(docs, `${rel(file)}#${name}`, value);
  }
  return { docs, unloadable, sideEffectful: sideEffectful.sort(), scanned: scanned.sort() };
}

function harvest(docs, origin, value, depth = 0) {
  if (Array.isArray(value)) { value.forEach((v, i) => harvest(docs, `${origin}[${i}]`, v, depth)); return; }
  if (!isPlainObject(value)) return;
  if (typeof value.type === 'string') { docs.push({ origin, value }); return; }
  if (depth < 1) for (const [k, v] of Object.entries(value)) harvest(docs, `${origin}.${k}`, v, depth + 1);
}

// ───────────────────────────────────────────────────────────────────────────
// Schema-guided node collection
// ───────────────────────────────────────────────────────────────────────────

const unresolvedNodeTypes = new Map();

/** Every node in `value`, found only where the SCHEMA declares a node slot. */
function collectNodes(value, schema, state, depth = 0) {
  if (!schema?._zod || value === undefined || value === null || depth > 60) return;
  const def = schema._zod.def;

  if (schema === NODE_BOUNDARY) {
    if (Array.isArray(value)) { for (const v of value) collectNodes(v, schema, state, depth + 1); return; }
    if (!isPlainObject(value)) return;
    if (state.seenNodes.has(value)) return;
    state.seenNodes.add(value);
    if (typeof value.type !== 'string') { state.nodeSlotsWithoutType++; return; }
    const entry = registry.get(value.type);
    if (!entry) { bump(unresolvedNodeTypes, value.type); return; }
    state.nodes.push({ type: value.type, node: value });
    collectNodes(value, entry.schema, state, depth + 1);
    return;
  }

  switch (def.type) {
    case 'lazy': { let inner; try { inner = def.getter(); } catch { return; } collectNodes(value, inner, state, depth + 1); return; }
    case 'object':
      if (!isPlainObject(value)) return;
      for (const [k, v] of Object.entries(value)) if (def.shape[k]) collectNodes(v, def.shape[k], state, depth + 1);
      return;
    case 'array': if (Array.isArray(value)) for (const v of value) collectNodes(v, def.element, state, depth + 1); return;
    case 'tuple': if (Array.isArray(value)) value.forEach((v, i) => collectNodes(v, def.items[i] ?? def.rest, state, depth + 1)); return;
    case 'record': if (isPlainObject(value)) for (const v of Object.values(value)) collectNodes(v, def.valueType, state, depth + 1); return;
    case 'union': for (const o of def.options) collectNodes(value, o, state, depth + 1); return;
    case 'intersection': collectNodes(value, def.left, state, depth + 1); collectNodes(value, def.right, state, depth + 1); return;
    case 'pipe': collectNodes(value, def.in, state, depth + 1); if (def.out) collectNodes(value, def.out, state, depth + 1); return;
    case 'optional': case 'nullable': case 'default': case 'prefault': case 'nonoptional': case 'readonly': case 'catch': case 'promise':
      collectNodes(value, def.innerType, state, depth + 1); return;
    default:
  }
}

/** The nodes of one document, root included. */
function documentNodes(root, rootType) {
  const state = { nodes: [], seenNodes: new Set(), nodeSlotsWithoutType: 0 };
  state.seenNodes.add(root);
  state.nodes.push({ type: rootType, node: root });
  collectNodes(root, registry.get(rootType).schema, state);
  return state;
}

// ───────────────────────────────────────────────────────────────────────────
// Measurement
// ───────────────────────────────────────────────────────────────────────────

/** Undeclared keys of `input` relative to the key-probe's stripped output. */
function undeclaredKeys(input, stripped, at = [], acc = []) {
  if (Array.isArray(input)) {
    if (!Array.isArray(stripped)) return acc;
    input.forEach((v, i) => undeclaredKeys(v, stripped[i], [...at, '[]'], acc));
    return acc;
  }
  if (!isPlainObject(input) || !isPlainObject(stripped)) return acc;
  for (const k of Object.keys(input)) {
    if (!(k in stripped)) acc.push({ key: k, path: at });
    else if (input[k] && typeof input[k] === 'object') undeclaredKeys(input[k], stripped[k], [...at, k], acc);
  }
  return acc;
}

/**
 * The distinct leaf issues of a zod error, unions flattened. A union reports
 * `invalid_union` with one nested error list per arm; the arm-level issues are
 * what says WHY the corpus document is already refused today.
 */
function leafIssues(error, out = [], seen = new Set()) {
  for (const issue of error?.issues ?? []) {
    if (issue.code === 'invalid_union' && Array.isArray(issue.errors)) {
      for (const arm of issue.errors) leafIssues({ issues: arm }, out, seen);
      continue;
    }
    const k = `${issue.path.join('.')}|${issue.code}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(issue);
  }
  return out;
}

const redTodayReasons = new Map();
const perComponent = new Map();
function bucketFor(type) {
  if (!perComponent.has(type)) {
    perComponent.set(type, {
      type, schema: registry.get(type)?.name ?? null,
      nodes: 0, baselineRed: 0, strictRed: 0, strictOnlyRed: 0,
      nodesWithTopLevelUnknown: 0, nodesWithNestedUnknown: 0,
      topLevelKeys: new Map(), nestedKeys: new Map(), byCorpus: {},
    });
  }
  return perComponent.get(type);
}

function measureNode(type, node, corpus) {
  const b = bucketFor(type);
  b.nodes++;
  b.byCorpus[corpus] = (b.byCorpus[corpus] ?? 0) + 1;
  const twins = twinsFor(type);
  if (!twins) return { baselineOk: null, strictOk: null };

  const baselineResult = twins.baseline.safeParse(node);
  const baselineOk = baselineResult.success;
  const strictOk = twins.strict.safeParse(node).success;
  if (!baselineOk) {
    b.baselineRed++;
    for (const issue of leafIssues(baselineResult.error)) {
      bump(redTodayReasons, `${type}: ${issue.path.length ? issue.path.join('.') : '(root)'} — ${issue.code}`);
    }
  }
  if (!strictOk) b.strictRed++;
  if (baselineOk && !strictOk) b.strictOnlyRed++;

  const probed = twins.keyProbe.safeParse(node);
  if (!probed.success) { noteLimit('key probe refused a node (it should be unfailable)', type); return { baselineOk, strictOk }; }
  let sawTop = false;
  let sawNested = false;
  for (const u of undeclaredKeys(node, probed.data)) {
    if (u.path.length === 0) { bump(b.topLevelKeys, u.key); sawTop = true; }
    else { bump(b.nestedKeys, `${u.path.join('.')}.${u.key}`); sawNested = true; }
  }
  if (sawTop) b.nodesWithTopLevelUnknown++;
  if (sawNested) b.nodesWithNestedUnknown++;
  return { baselineOk, strictOk };
}

function classify(item) {
  let value = item.value;
  if (!('value' in item)) {
    try { value = JSON.parse(item.text); } catch { return { kind: 'fragment' }; }
  }
  if (!isPlainObject(value)) return { kind: 'notAnObject' };
  if (typeof value.type !== 'string') return { kind: 'noTypeKey' };
  if (!registry.has(value.type)) return { kind: 'unresolvedType', type: value.type };
  return { kind: 'document', value };
}

const corpora = {};
const unresolvedRootTypes = new Map();

function runCorpus(name, items) {
  const t = {
    items: items.length, documents: 0, fragments: 0, notAnObject: 0, noTypeKey: 0, unresolvedType: 0,
    nodes: 0, nodesStrictRefused: 0, nodesRedToday: 0, nodesStrictOnlyRefused: 0,
    documentsStrictRefusedWholeTree: 0, documentsRedTodayWholeDocument: 0, nodeSlotsWithoutType: 0,
  };
  for (const item of items) {
    const c = classify(item);
    if (c.kind !== 'document') {
      t[c.kind === 'fragment' ? 'fragments' : c.kind]++;
      if (c.kind === 'unresolvedType') bump(unresolvedRootTypes, c.type);
      continue;
    }
    t.documents++;
    const state = documentNodes(c.value, c.value.type);
    t.nodeSlotsWithoutType += state.nodeSlotsWithoutType;
    for (const { type, node } of state.nodes) {
      t.nodes++;
      const r = measureNode(type, node, name);
      if (r.strictOk === false) t.nodesStrictRefused++;
      if (r.baselineOk === false) t.nodesRedToday++;
      if (r.baselineOk === true && r.strictOk === false) t.nodesStrictOnlyRefused++;
    }
    if (!anyBaseline.safeParse(c.value).success) t.documentsRedTodayWholeDocument++;
    if (!anyStrictWholeTree.safeParse(c.value).success) t.documentsStrictRefusedWholeTree++;
  }
  corpora[name] = t;
}

// ───────────────────────────────────────────────────────────────────────────
// The TypeScript face — the twin of `.passthrough()` (objectui#7581 asks for
// both faces; the runtime one is everything above)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Where `[key: string]: any` is DECLARED in `@object-ui/types`, and how much of
 * the authoring surface inherits it. Syntactic, deliberately: the point is a
 * census of declaration sites, and #5250's probes (comments 5521873763 /
 * 5523535054) already established the behaviour those sites produce — an
 * unknown key on a type extending `BaseSchema` raises nothing, the same key on
 * a sibling without the signature raises TS2561.
 *
 * The card cites "`base.ts` lines 409 / 441". Line addresses rot; this finds
 * them by CONTENT and prints today's numbers.
 */
function measureTypeScriptFace() {
  const sites = [];
  const extendsBase = [];
  const files = walkFiles(path.join(REPO_ROOT, 'packages/types/src'))
    .filter((f) => f.endsWith('.ts') && !f.includes('__tests__') && !f.includes('/zod/'));
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let owner = '(file scope)';
    lines.forEach((line, i) => {
      // `interface X extends Y {` and `type X = A & { … }` both open an owner.
      const iface = /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_]+)([^{]*)\{/.exec(line);
      const alias = /^\s*(?:export\s+)?type\s+([A-Za-z0-9_]+)[^=]*=\s*(.*)$/.exec(line);
      if (iface) {
        owner = iface[1];
        if (/\bextends\b[^{]*\bBaseSchema\b/.test(iface[2])) extendsBase.push(iface[1]);
      } else if (alias) {
        owner = alias[1];
        if (/\bBaseSchema\b/.test(alias[2])) extendsBase.push(alias[1]);
      }
      // A DECLARATION site, not a mention inside a comment or a string.
      if (/^\s*\[key: string\]: any;\s*$/.test(line)) {
        sites.push({ file: rel(file), line: i + 1, declaredOn: owner });
      }
    });
  }
  return {
    indexSignatureSites: sites,
    indexSignatureSiteCount: sites.length,
    interfacesExtendingBaseSchema: extendsBase.sort(),
    interfacesExtendingBaseSchemaCount: extendsBase.length,
    cardCitedLines: 'base.ts 409 / 441 (objectui#7581) — located by content instead; see indexSignatureSites',
  };
}

const catalog = loadCatalog();
const fences = loadDocsFences();
const authored = await loadAuthored();

runCorpus('catalog', catalog);
runCorpus('docs', fences);
runCorpus('authored', authored.docs);

// ───────────────────────────────────────────────────────────────────────────
// Report
// ───────────────────────────────────────────────────────────────────────────

const sortedKeys = (map, limit = Infinity) =>
  [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([key, count]) => ({ key, count }));

const components = [...perComponent.values()]
  .sort((a, b) => b.nodes - a.nodes || (a.type < b.type ? -1 : 1))
  .map((c) => ({
    type: c.type, schema: c.schema, documents: c.nodes,
    strictRefused: c.strictRed, strictOnlyRefused: c.strictOnlyRed, redToday: c.baselineRed,
    nodesWithTopLevelUnknown: c.nodesWithTopLevelUnknown, nodesWithNestedUnknown: c.nodesWithNestedUnknown,
    topLevelUndeclaredKeys: sortedKeys(c.topLevelKeys), nestedUndeclaredKeys: sortedKeys(c.nestedKeys),
    byCorpus: c.byCorpus,
  }));

const globalTop = new Map();
const globalNested = new Map();
for (const c of perComponent.values()) {
  for (const [k, n] of c.topLevelKeys) globalTop.set(k, (globalTop.get(k) ?? 0) + n);
  for (const [k, n] of c.nestedKeys) globalNested.set(k, (globalNested.get(k) ?? 0) + n);
}
const sum = (f) => components.reduce((s, c) => s + f(c), 0);

/** bare key name → total occurrences, both faces, across every component. */
const keyTotals = new Map();
for (const [k, n] of globalTop) keyTotals.set(k, (keyTotals.get(k) ?? 0) + n);
for (const [p, n] of globalNested) {
  const leaf = p.slice(p.lastIndexOf('.') + 1);
  keyTotals.set(leaf, (keyTotals.get(leaf) ?? 0) + n);
}

const report = {
  card: 'objectui#7581',
  pin: pin(),
  zod: ZOD_VERSION,
  zodFace: path.relative(REPO_ROOT, DIST_ZOD),
  registry: {
    source: 'arms of AnyComponentSchema',
    componentTypes: registry.size,
    types: [...registry.keys()].sort(),
    collisions: registryCollisions,
    armsWithoutLiteralType: armsWithoutLiteralType.sort(),
  },
  corpora,
  totals: {
    nodes: sum((c) => c.documents),
    nodesStrictRefused: sum((c) => c.strictRefused),
    nodesStrictOnlyRefused: sum((c) => c.strictOnlyRefused),
    nodesRedToday: sum((c) => c.redToday),
    componentTypesSeen: components.length,
    componentTypesStrictClean: components.filter((c) => c.strictRefused === 0).length,
    componentTypesNeverSeenCount: registry.size - components.length,
    documents: Object.values(corpora).reduce((s, c) => s + c.documents, 0),
    documentsStrictRefusedWholeTree: Object.values(corpora).reduce((s, c) => s + c.documentsStrictRefusedWholeTree, 0),
    documentsRedTodayWholeDocument: Object.values(corpora).reduce((s, c) => s + c.documentsRedTodayWholeDocument, 0),
  },
  topUndeclaredKeysTopLevel: sortedKeys(globalTop, 40),
  topUndeclaredKeysNested: sortedKeys(globalNested, 40),
  undeclaredKeyOccurrences: Object.fromEntries([...keyTotals.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  rendererMentionsOfUndeclaredKeys: rendererMentions([...keyTotals.keys()].sort()),
  redTodayReasons: sortedKeys(redTodayReasons, 40),
  unexportedNodeSchemas: [...unexportedNodeSchemas].sort(),
  unstableLazyExports: unstableLazyExports.sort(),
  unresolvedRootTypes: sortedKeys(unresolvedRootTypes),
  unresolvedNodeTypes: sortedKeys(unresolvedNodeTypes),
  componentTypesNeverSeen: [...registry.keys()].filter((t) => !perComponent.has(t)).sort(),
  walkerLimits: [...walkerLimits.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([kind, where]) => ({ kind, where: [...where].sort() })),
  typeScriptFace: measureTypeScriptFace(),
  authoredModulesScanned: authored.scanned,
  unloadableModules: authored.unloadable,
  sideEffectfulModules: authored.sideEffectful,
  components,
};

/**
 * A COARSE signal for the split the card asks for: a key the renderer READS but
 * the schema does not declare is #6939-shaped (repair the declaration); a key
 * NOTHING reads is #7077-shaped (retire it). This probe answers only "does the
 * identifier occur in renderer source at all" — one `git grep -w` per key over
 * `packages/*​/src`, `@object-ui/types` excluded so the schema's own mention of
 * a sibling key cannot answer for it. It is a TRIAGE HINT, ⛔ not a verdict:
 * a common word (`value`, `icon`, `title`) hits on unrelated code, and a key
 * read through a computed accessor hits zero. Every row it produces still needs
 * a human read of the call site before it becomes a worklist item.
 */
function mentionCount(key) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  // Spelled INSIDE the function on purpose: this is called from the `report`
  // object literal, which is evaluated above where a module-level `const`
  // would sit, and the resulting TDZ throw lands in the `catch` below as a
  // silent 0 for every key. The controls caught exactly that while this was
  // being written.
  const pathspec = [
    ':(glob)packages/*/src/**', // ⛔ `packages/*/src` without `:(glob)` matches NOTHING
    ':!packages/types/**',
    ':!**/__tests__/**',
    ':!**/*.test.*',
    ':!**/*.spec.*',
  ];
  let n = 0;
  try {
    const raw = execFileSync('git', ['grep', '-c', '-w', '-e', key, '--', ...pathspec], { cwd: REPO_ROOT, encoding: 'utf8' });
    for (const line of raw.trim().split('\n')) {
      const m = /:(\d+)$/.exec(line);
      if (m) n += Number(m[1]);
    }
  } catch { n = 0; } // git grep exits 1 on no match
  return n;
}

function rendererMentions(keys) {
  // Two controls, because a pathspec that matches NOTHING returns 0 for every
  // key and reads exactly like "nothing reads any of these" — which is the
  // wrong answer in the most consequential direction. `packages/*/src` (no
  // `:(glob)`) is precisely that trap and was the first spelling tried here.
  const positive = mentionCount('className');
  const negative = mentionCount('zzzFabricatedControlKey');
  const controlsOk = positive > 0 && negative === 0;
  const out = { __controls: { positiveKey: 'className', positive, negativeKey: 'zzzFabricatedControlKey', negative, ok: controlsOk } };
  for (const key of keys) out[key] = controlsOk ? mentionCount(key) : null;
  return out;
}

const md = (rows) => rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
const keyList = (keys, limit = 6) =>
  keys.length === 0 ? '—' : keys.slice(0, limit).map((k) => `\`${k.key}\`×${k.count}`).join(', ') + (keys.length > limit ? `, +${keys.length - limit} more` : '');

function renderMarkdown(r) {
  const L = [];
  L.push('# Strict authoring face — measurement (objectui#7581)');
  L.push('');
  L.push(`- HEAD \`${r.pin.head}\` · forked from \`origin/main\` at \`${r.pin.mergeBaseWithOriginMain ?? '(unknown)'}\``);
  L.push(`- corpus identical to that \`main\` commit: **${r.pin.corpusMatchesMain === null ? 'unknown' : r.pin.corpusMatchesMain ? 'yes' : 'NO — the numbers below are not main\'s'}** (compared over ${r.pin.corpusPaths.map((p) => `\`${p}\``).join(', ')})`);
  L.push(`- zod \`${r.zod}\` · face read from \`${r.zodFace}\``);
  L.push(`- node schemas in the registry (arms of \`AnyComponentSchema\`): **${r.registry.componentTypes}** component types`);
  L.push('');
  L.push('## Per corpus');
  L.push('');
  L.push(md([
    ['corpus', 'items', 'node documents', 'fragments', 'not an object', 'no `type`', 'unresolved `type`', 'nodes', 'nodes strict-refused', 'nodes red today', 'strict-ONLY'],
    ['---', '--:', '--:', '--:', '--:', '--:', '--:', '--:', '--:', '--:', '--:'],
    ...Object.entries(r.corpora).map(([n, t]) => [n, t.items, t.documents, t.fragments, t.notAnObject, t.noTypeKey, t.unresolvedType, t.nodes, t.nodesStrictRefused, t.nodesRedToday, t.nodesStrictOnlyRefused].map(String)),
  ]));
  L.push('');
  L.push('## Headline');
  L.push('');
  L.push(md([
    ['metric', 'value'], ['---', '--:'],
    ['node documents measured', String(r.totals.documents)],
    ['nodes measured (documents flattened at declared node slots)', String(r.totals.nodes)],
    ['nodes refused by the strict twin', String(r.totals.nodesStrictRefused)],
    ['…of which strict is the ONLY reason (green today, red strictly)', String(r.totals.nodesStrictOnlyRefused)],
    ['nodes already red under the face as shipped', String(r.totals.nodesRedToday)],
    ['component types seen in the corpora', String(r.totals.componentTypesSeen)],
    ['component types strict-CLEAN (zero refusals)', String(r.totals.componentTypesStrictClean)],
    ['registered component types with no document anywhere', String(r.totals.componentTypesNeverSeenCount)],
    ['whole-document strict parse (no node boundary), refused', `${r.totals.documentsStrictRefusedWholeTree} / ${r.totals.documents}`],
    ['whole-document parse under the face as shipped, refused', `${r.totals.documentsRedTodayWholeDocument} / ${r.totals.documents}`],
  ]));
  L.push('');
  L.push('## Top undeclared keys — top level (what `BaseSchemaCore.passthrough()` admits today)');
  L.push('');
  L.push(md([['key', 'occurrences'], ['---', '--:'], ...r.topUndeclaredKeysTopLevel.map((k) => [`\`${k.key}\``, String(k.count)])]));
  L.push('');
  L.push('## Top undeclared keys — nested inside declared members');
  L.push('');
  L.push(r.topUndeclaredKeysNested.length
    ? md([['path', 'occurrences'], ['---', '--:'], ...r.topUndeclaredKeysNested.map((k) => [`\`${k.key}\``, String(k.count)])])
    : '_none_');
  L.push('');
  L.push('## Undeclared keys × does any renderer source mention the identifier?');
  L.push('');
  L.push('Coarse triage hint only — see the `rendererMentions` docblock. A key with **0**');
  L.push('mentions is #7077-shaped (nothing reads it); a key with mentions is #6939-shaped');
  L.push('(the renderer reads it, the schema does not declare it). Both still need the call');
  L.push('site read before they become worklist items.');
  L.push('');
  const ctl = r.rendererMentionsOfUndeclaredKeys.__controls;
  L.push(`Probe controls — \`${ctl.positiveKey}\` (must be > 0): **${ctl.positive}**; \`${ctl.negativeKey}\` (must be 0): **${ctl.negative}** ⇒ ${ctl.ok ? 'probe is live' : '⛔ PROBE DEAD, every count below is `n/a`'}.`);
  L.push('');
  L.push(md([
    ['key', 'total occurrences in corpora', '`git grep -w` hits in `packages/*/src` (types excluded)'],
    ['---', '--:', '--:'],
    ...Object.entries(r.rendererMentionsOfUndeclaredKeys)
      .filter(([k]) => k !== '__controls')
      .sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0) || (a[0] < b[0] ? -1 : 1))
      .map(([k, n]) => [`\`${k}\``, String(r.undeclaredKeyOccurrences[k] ?? 0), n === null ? 'n/a' : String(n)]),
  ]));
  L.push('');
  L.push('## Why the nodes that are ALREADY red today are red (top issues)');
  L.push('');
  L.push('These are refused by the face **as shipped**; strict is not what broke them.');
  L.push('');
  L.push(r.redTodayReasons.length
    ? md([['component: path — issue', 'nodes'], ['---', '--:'], ...r.redTodayReasons.map((k) => [`\`${k.key}\``, String(k.count)])])
    : '_none_');
  L.push('');
  L.push('## Per component type');
  L.push('');
  L.push(md([
    ['type', 'schema', 'nodes', 'strict-refused', 'strict-only', 'red today', 'top-level undeclared keys', 'nested undeclared keys'],
    ['---', '---', '--:', '--:', '--:', '--:', '---', '---'],
    ...r.components.map((c) => [`\`${c.type}\``, c.schema ?? '—', String(c.documents), String(c.strictRefused), String(c.strictOnlyRefused), String(c.redToday), keyList(c.topLevelUndeclaredKeys), keyList(c.nestedUndeclaredKeys)]),
  ]));
  L.push('');
  L.push('## `type` values that resolve in no node schema (refused by `AnyComponentSchema` today)');
  L.push('');
  L.push('At a document root:');
  L.push('');
  L.push(r.unresolvedRootTypes.length ? md([['type', 'occurrences'], ['---', '--:'], ...r.unresolvedRootTypes.map((k) => [`\`${k.key}\``, String(k.count)])]) : '_none_');
  L.push('');
  L.push('At a declared child-node slot:');
  L.push('');
  L.push(r.unresolvedNodeTypes.length ? md([['type', 'occurrences'], ['---', '--:'], ...r.unresolvedNodeTypes.map((k) => [`\`${k.key}\``, String(k.count)])]) : '_none_');
  L.push('');
  L.push('## Registered component types with zero documents in any corpus');
  L.push('');
  L.push(r.componentTypesNeverSeen.length ? r.componentTypesNeverSeen.map((t) => `\`${t}\``).join(', ') : '_none_');
  L.push('');
  L.push('## Node schemas not exported by name from `@object-ui/types/zod`');
  L.push('');
  L.push(r.unexportedNodeSchemas.length
    ? `${r.unexportedNodeSchemas.map((t) => `\`${t}\``).join(', ')} — reachable only through the union, so no consumer can validate one of these alone.`
    : '_none_');
  L.push('');
  L.push('## `z.lazy` exports whose getter rebuilds the schema on every call');
  L.push('');
  L.push(r.unstableLazyExports.length
    ? `${r.unstableLazyExports.map((n) => `\`${n}\``).join(', ')} — \`getter() === getter()\` is **false**, so the schema is reconstructed on every parse and no consumer can compare it by identity.`
    : '_none_');
  L.push('');
  L.push('## The TypeScript face — where `[key: string]: any` is declared');
  L.push('');
  L.push(`\`packages/types/src\` declares the index signature at **${r.typeScriptFace.indexSignatureSiteCount}** sites, and **${r.typeScriptFace.interfacesExtendingBaseSchemaCount}** interfaces \`extends BaseSchema\` directly (so they inherit it).`);
  L.push('');
  L.push(md([
    ['file', 'line', 'declared on'],
    ['---', '--:', '---'],
    ...r.typeScriptFace.indexSignatureSites.map((x) => [`\`${x.file}\``, String(x.line), `\`${x.declaredOn}\``]),
  ]));
  L.push('');
  L.push('## Walker limits — shapes strict could not close');
  L.push('');
  L.push(r.walkerLimits.length ? r.walkerLimits.map((w) => `- **${w.kind}**: ${w.where.join(', ')}`).join('\n') : '_none — every reachable shape was strict-ified_');
  L.push('');
  L.push('## Authored-module loading (corpus 3)');
  L.push('');
  L.push(r.unloadableModules.length ? r.unloadableModules.map((u) => `- ⚠ \`${u.origin}\`: ${u.error}`).join('\n') : '_every candidate authored module imported cleanly_');
  L.push('');
  L.push(r.sideEffectfulModules.length ? `Modules that PRINT when imported (console muted for the run): ${r.sideEffectfulModules.map((m) => `\`${m}\``).join(', ')}` : '_no candidate module printed on import_');
  L.push('');
  if (r.registry.collisions.length) {
    L.push('## Registry collisions');
    L.push('');
    L.push(r.registry.collisions.map((c) => `- \`${c.type}\`: kept ${c.kept}, also declared by ${c.alsoDeclaredBy}`).join('\n'));
    L.push('');
  }
  return `${L.join('\n')}\n`;
}

process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
