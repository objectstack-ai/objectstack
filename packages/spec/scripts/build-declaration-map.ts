// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * build-declaration-map.ts — the TS-declaration-name → spec-registry-name map
 * (`declaration-map/<category>.json`), generated.
 *
 * ## Why this artifact exists
 *
 * The authorable surface keys its rows as `<category>/<Def>:<prop>` using SPEC
 * REGISTRY names (`data/Object:userActions`). Tooling that walks a source diff —
 * the docs-audit anchor minting is the funding consumer — sees TS DECLARATION
 * names instead: the declaration enclosing a changed line is `ObjectSchemaBase`
 * or `DatasourceSchema`, never `data/Object`. No lookup between the two existed,
 * so a diff-side tool could not ask "is this declaration an authorable
 * container, and which one?". This artifact is that lookup:
 *
 *     require('packages/spec/declaration-map/data.json').entries['ObjectSchemaBase']
 *     // → 'data/Object'
 *
 * ## Where the mapping comes from — composition, not a second source of truth
 *
 * Two committed artifacts already carry every fact needed, plus one bounded
 * syntactic pass for module-private base declarations:
 *
 *   1. `json-schema.manifest/` — every def key the schema build publishes
 *      (`data/Object`). The def key is `<category>/<Name>` where `<Name>` is
 *      the export key with a trailing `Schema` suffix stripped
 *      (`lib/schema-name.ts`), so the export-key candidates for a def are
 *      exactly `<Name>` and `<Name>Schema` — the inverse is closed.
 *   2. `export-origins/` — which source declaration each entry-point export
 *      resolves to (`src/data/object.zod.ts#ObjectSchema (const)`). This gives
 *      the DECLARED name (the map's key) and the declaring FILE (where the
 *      base pass below runs).
 *   3. The base pass: a shape can live in a module-private const the exported
 *      def only wraps — `ObjectSchema`'s factory returns
 *      `Object.assign(ObjectSchemaBase, …)`, so the declaration enclosing
 *      `userActions` is `ObjectSchemaBase`, a name no runtime walk can see.
 *      Those are recovered by syntactically unwinding the exported
 *      declaration's initializer (single `ts.createSourceFile`, no type
 *      checker): unwrap `lazySchema` factories, follow `Object.assign` to its
 *      first argument, follow method-chain receivers (`.extend()`,
 *      `.superRefine()`, `.strict()`, …), follow returned identifiers, and
 *      record every same-file top-level const so reached against the wrapping
 *      def's key.
 *
 * No entry is hand-written and none can be: `--check` recomputes everything
 * from the same inputs and compares bytes, and it runs inside `check:generated`
 * (lint.yml's required TypeScript Type Check job), so a hand edit or a stale
 * artifact is CI-red. The INPUT artifacts are themselves gated in that same
 * job, so this artifact cannot silently ride a stale manifest either — the
 * manifest's own gate is red on the same commit.
 *
 * ## Precision over recall, and the two deliberate boundaries
 *
 * A LOOKUP MISS means "not known to be an authorable container" and the
 * consumer drops that anchor as internal noise — so a missing entry costs
 * recall, while a WRONG entry would misqualify an anchor. The map therefore
 * prefers dropping to guessing, twice:
 *
 *   - **Bare-name collisions.** One name mapping to two different def keys
 *     (e.g. `RetryPolicy`, declared in `src/shared/` and published as both
 *     `system/RetryPolicy` and `automation/RetryPolicy`) is resolved by the
 *     HOME rule — prefer the def key whose category matches the declaring
 *     file's `src/<category>/` segment — and dropped into the shard's
 *     `collisions` list when that still leaves more than one. Dropped is
 *     visible; guessed would not be.
 *   - **The unwinding grammar is closed.** It follows wrapper/derivation
 *     shapes only (see `collectBaseReferences`); a shape reached through an
 *     import from another module, or passed as a spread/argument the grammar
 *     does not name, yields no entry. Extending the grammar is a code change
 *     with a self-test case, never a data patch.
 *
 * ## Usage
 *
 *     pnpm --filter @objectstack/spec gen:declaration-map     # regenerate + write
 *     pnpm --filter @objectstack/spec check:declaration-map   # self-test, then fail on drift
 *     tsx scripts/build-declaration-map.ts --self-test        # fixture check only
 *
 * Reads `src/` and the two committed artifacts — no build needed (`readsDist`
 * does not apply). Sharded per category (#5837) so parallel spec PRs stay
 * textually disjoint; `.gitattributes` routes the directory to the os-regen
 * merge driver like its siblings.
 */

import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA_MANIFEST_DIR_NAME,
  readShards,
  serializeShard,
  writeShards,
  type SchemaManifestShard,
} from './lib/sharded-artifacts';
import {
  EXPORT_ORIGINS_DIR_NAME,
  type ExportOriginsShard,
} from './lib/export-origins-layout';

const PKG_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** `packages/spec/declaration-map/<category>.json` — this artifact. */
export const DECLARATION_MAP_DIR_NAME = 'declaration-map';

const MAP_DIR = path.resolve(PKG_DIR, DECLARATION_MAP_DIR_NAME);

const CHECK = process.argv.includes('--check');
const SELF_TEST = process.argv.includes('--self-test');

/** One category's slice of the declaration map. */
export interface DeclarationMapShard {
  description: string;
  category: string;
  /** TS declaration name → def key (`data/Object`), sorted by name. */
  entries: Record<string, string>;
  /**
   * Names this generator SAW pointing at more than one def key in this
   * category and therefore refused to record — a lookup of one of these
   * legitimately misses. Sorted; usually empty.
   */
  collisions: string[];
}

/** The description carried by every shard — repeated per file like its siblings'. */
export const DECLARATION_MAP_DESCRIPTION =
  'TS declaration name → spec registry name (def key) for the schemas @objectstack/spec publishes: ' +
  "entries['ObjectSchemaBase'] === 'data/Object'. Composed from json-schema.manifest/ (the def " +
  'keys), export-origins/ (which declaration each export resolves to), and a syntactic unwinding ' +
  'of wrapper initializers that recovers module-private base declarations (the ObjectSchemaBase ' +
  'case — see scripts/build-declaration-map.ts). A name that maps to two different def keys is ' +
  'DROPPED into `collisions` rather than guessed, so a lookup miss means "not known to be an ' +
  'authorable container". Consumers hold a changed line’s enclosing declaration name and ask ' +
  'which authorable container it declares (docs-audit anchor qualification is the funding one). ' +
  'Generated — never hand-edited; regenerate with ' +
  '`pnpm --filter @objectstack/spec gen:declaration-map` and read the diff.';

// ── The base-declaration unwinding ───────────────────────────────────────────

/**
 * A file's top-level `const` declarations: name → initializer (single-declarator
 * statements only — every schema const in this package is one).
 */
function topLevelConstInitializers(source: ts.SourceFile): Map<string, ts.Expression> {
  const out = new Map<string, ts.Expression>();
  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) {
        out.set(decl.name.text, decl.initializer);
      }
    }
  }
  return out;
}

/**
 * The same-file top-level consts a declaration's initializer DERIVES ITS SCHEMA
 * FROM, collected by unwinding a closed grammar of wrapper shapes:
 *
 *   - `lazySchema(F)`            → into `F` (the deferred factory holds the real shape)
 *   - `Object.assign(E, …)`      → into `E` only (the schema identity is the first
 *                                  argument; the rest is method decoration)
 *   - `E.method(…)`              → into `E` (extend/superRefine/strict/describe/… —
 *                                  receiver chains keep the base's shape)
 *   - arrow/function body        → into the expression body, or into every
 *                                  `return` argument of a block body
 *   - `(E)`, `E as T`, `E satisfies T`, `E!`, `cond ? A : B` → through
 *   - `Identifier`               → RECORDED when it names a same-file top-level
 *                                  const, then unwound further (chained bases)
 *
 * Everything else — object literals, other call shapes, imported names — ends
 * the walk. The grammar deliberately under-collects: a missing base costs the
 * consumer one dropped anchor, while an over-collected name would qualify a
 * declaration that is not this container (the header says why that trade).
 */
export function collectBaseReferences(
  source: ts.SourceFile,
  declaredName: string,
): string[] {
  const topLevel = topLevelConstInitializers(source);
  const start = topLevel.get(declaredName);
  if (!start) return [];

  const found = new Set<string>();
  const visited = new Set<string>([declaredName]);

  const walk = (node: ts.Expression | undefined): void => {
    if (!node) return;
    if (ts.isIdentifier(node)) {
      const name = node.text;
      if (!topLevel.has(name) || visited.has(name)) return;
      visited.add(name);
      found.add(name);
      walk(topLevel.get(name));
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'Object' &&
        callee.name.text === 'assign'
      ) {
        walk(node.arguments[0]);
        return;
      }
      if (ts.isIdentifier(callee) && callee.text === 'lazySchema') {
        walk(node.arguments[0]);
        return;
      }
      if (ts.isPropertyAccessExpression(callee)) {
        walk(callee.expression);
        return;
      }
      return; // strictObject(…), z.object(…) via other shapes: the shape is inline.
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const body = node.body;
      if (ts.isBlock(body)) {
        const visitStatement = (stmt: ts.Node): void => {
          if (ts.isReturnStatement(stmt)) {
            walk(stmt.expression);
            return;
          }
          // Returns nested under if/try/switch still end the factory; plain
          // statement recursion finds them without evaluating anything.
          stmt.forEachChild(visitStatement);
        };
        body.forEachChild(visitStatement);
      } else {
        walk(body);
      }
      return;
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      walk(node.expression);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      walk(node.whenTrue);
      walk(node.whenFalse);
      return;
    }
    // Object literals, template strings, everything else: no schema identity here.
  };

  walk(start);
  return [...found].sort();
}

// ── Composition ──────────────────────────────────────────────────────────────

/** `data/Object` → `data`; mirrors `categoryOfDefKey` but local to a def key we minted. */
function categoryOf(defKey: string): string {
  return defKey.slice(0, defKey.indexOf('/'));
}

/** `src/data/object.zod.ts` → `data`, or null for anything outside `src/<dir>/`. */
export function homeCategoryOfFile(file: string): string | null {
  const m = /^src\/([a-z-]+)\//.exec(file);
  return m ? m[1] : null;
}

interface Candidate {
  defKey: string;
  /** The `src/<cat>/…` segment of the declaring file, for the home rule. */
  homeCategory: string | null;
}

export interface ComposedMap {
  /** name → def key, after precedence, the home rule, and collision dropping. */
  entries: Map<string, string>;
  /** name → the distinct def keys it ambiguously pointed at (dropped). */
  collisions: Map<string, string[]>;
}

/**
 * Merge export-half and base-half candidates into one map.
 *
 * Precedence: a name's EXPORT-half candidates (the declaration is itself a
 * published def) beat its base-half ones (the declaration feeds someone else's
 * def) — a base reached by unwinding that is also a def in its own right owns
 * its own key. Within a half, one distinct def key wins outright; several are
 * narrowed by the home rule (the def key whose category matches the declaring
 * file's `src/<category>/`); anything still plural is dropped and recorded.
 */
export function composeEntries(
  exportHalf: Map<string, Candidate[]>,
  baseHalf: Map<string, Candidate[]>,
): ComposedMap {
  const entries = new Map<string, string>();
  const collisions = new Map<string, string[]>();

  const settle = (name: string, candidates: Candidate[]): void => {
    const distinct = [...new Set(candidates.map((c) => c.defKey))].sort();
    if (distinct.length === 1) {
      entries.set(name, distinct[0]);
      return;
    }
    const home = new Set(candidates.map((c) => c.homeCategory).filter((c) => c !== null));
    if (home.size === 1) {
      const homed = distinct.filter((d) => categoryOf(d) === [...home][0]);
      if (homed.length === 1) {
        entries.set(name, homed[0]);
        return;
      }
    }
    collisions.set(name, distinct);
  };

  for (const [name, candidates] of exportHalf) settle(name, candidates);
  for (const [name, candidates] of baseHalf) {
    if (entries.has(name) || collisions.has(name)) continue; // export half won.
    settle(name, candidates);
  }
  return { entries, collisions };
}

/** Split the composed map into `<category shard> → canonical shard bytes`. */
export function declarationMapShardTexts(composed: ComposedMap): Map<string, string> {
  const byCategory = new Map<string, { entries: Map<string, string>; collisions: Set<string> }>();
  const slot = (category: string) => {
    let s = byCategory.get(category);
    if (!s) {
      s = { entries: new Map(), collisions: new Set() };
      byCategory.set(category, s);
    }
    return s;
  };
  for (const [name, defKey] of composed.entries) slot(categoryOf(defKey)).entries.set(name, defKey);
  // A dropped name is listed in EVERY category it pointed at — the reader who
  // misses a lookup opens the shard for the category they expected.
  for (const [name, defKeys] of composed.collisions) {
    for (const defKey of defKeys) slot(categoryOf(defKey)).collisions.add(name);
  }

  const out = new Map<string, string>();
  for (const category of [...byCategory.keys()].sort()) {
    const { entries, collisions } = byCategory.get(category)!;
    out.set(
      category,
      serializeShard({
        description: DECLARATION_MAP_DESCRIPTION,
        category,
        entries: Object.fromEntries([...entries.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
        collisions: [...collisions].sort(),
      } satisfies DeclarationMapShard),
    );
  }
  return out;
}

/**
 * The whole computation, from the two committed artifacts plus `src/`, pure of
 * argv so the self-test and both modes share one code path.
 */
export function buildDeclarationMap(pkgDir: string): ComposedMap {
  const manifestShards = readShards<SchemaManifestShard>(path.resolve(pkgDir, SCHEMA_MANIFEST_DIR_NAME));
  const originShards = readShards<ExportOriginsShard>(path.resolve(pkgDir, EXPORT_ORIGINS_DIR_NAME));
  const originsByCategory = new Map<string, Record<string, string>>(
    originShards.map((s) => [s.name, s.doc.exports]),
  );

  const defKeys = manifestShards.flatMap((s) => s.doc.schemas);
  // Anti-vacuity floor, same instinct as build-export-origins' entry-point
  // floor: an empty or truncated manifest would compose a tiny, plausible map
  // and every downstream lookup would quietly miss.
  if (defKeys.length < 1000) {
    console.error(
      `❌  ${SCHEMA_MANIFEST_DIR_NAME}/ lists only ${defKeys.length} def key(s); @objectstack/spec ` +
        `publishes well over a thousand. Refusing to compose a map from what is probably a ` +
        `truncated read.`,
    );
    process.exit(1);
  }

  const exportHalf = new Map<string, Candidate[]>();
  const baseHalf = new Map<string, Candidate[]>();
  const push = (half: Map<string, Candidate[]>, name: string, candidate: Candidate) => {
    const list = half.get(name);
    if (list) list.push(candidate);
    else half.set(name, [candidate]);
  };

  const sourceCache = new Map<string, ts.SourceFile>();
  const parsed = (file: string): ts.SourceFile => {
    let sf = sourceCache.get(file);
    if (!sf) {
      sf = ts.createSourceFile(
        file,
        fs.readFileSync(path.resolve(pkgDir, file), 'utf8'),
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false,
      );
      sourceCache.set(file, sf);
    }
    return sf;
  };

  const unresolved: string[] = [];
  for (const defKey of defKeys) {
    const category = categoryOf(defKey);
    const name = defKey.slice(category.length + 1);
    const exports = originsByCategory.get(category);
    if (!exports) {
      unresolved.push(`${defKey} — no ${EXPORT_ORIGINS_DIR_NAME}/${category}.json shard`);
      continue;
    }
    // The closed inverse of schemaNameFromExportKey: the export key is the def
    // name verbatim or with the `Schema` suffix it strips.
    const candidates = [name, `${name}Schema`].filter((k) => k in exports);
    if (candidates.length === 0) {
      unresolved.push(`${defKey} — neither "${name}" nor "${name}Schema" in ${category}'s export origins`);
      continue;
    }
    for (const exportKey of candidates) {
      // `src/data/object.zod.ts#ObjectSchema (const)` → file + declared name.
      const origin = exports[exportKey];
      const hash = origin.indexOf('#');
      const space = origin.indexOf(' ', hash);
      const file = origin.slice(0, hash);
      const declared = origin.slice(hash + 1, space === -1 ? undefined : space);
      const homeCategory = homeCategoryOfFile(file);

      push(exportHalf, exportKey, { defKey, homeCategory });
      if (declared !== exportKey) push(exportHalf, declared, { defKey, homeCategory });

      // The base pass runs only over this package's own sources — an origin in
      // node_modules/ (a re-exported dependency type) has no authorable shape
      // to unwind and is not ours to parse.
      if (!file.startsWith('src/')) continue;
      for (const base of collectBaseReferences(parsed(file), declared)) {
        push(baseHalf, base, { defKey, homeCategory });
      }
    }
  }

  if (unresolved.length > 0) {
    console.error(
      `❌  ${unresolved.length} def key(s) did not resolve to an export origin — the manifest and ` +
        `${EXPORT_ORIGINS_DIR_NAME}/ disagree (regenerate whichever is stale first):\n`,
    );
    for (const line of unresolved) console.error(`    • ${line}`);
    process.exit(1);
  }

  const composed = composeEntries(exportHalf, baseHalf);

  // Named canary: the module-private base that funded the base pass. If the
  // unwinding grammar rots (a refactor of ObjectSchema's factory it cannot
  // follow), this build fails HERE, naming the pass — rather than the artifact
  // silently thinning and a docs-audit anchor going quietly dark downstream.
  if (composed.entries.get('ObjectSchemaBase') !== 'data/Object') {
    console.error(
      `❌  base-pass canary: expected ObjectSchemaBase → data/Object, got ` +
        `${JSON.stringify(composed.entries.get('ObjectSchemaBase') ?? null)}. Either ` +
        `src/data/object.zod.ts reshaped its wrapper into a form collectBaseReferences() cannot ` +
        `follow (extend the grammar + its self-test), or the base declaration was renamed (update ` +
        `this canary in the same PR).`,
    );
    process.exit(1);
  }

  return composed;
}

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * Pin every rule of the unwinding grammar on a fixture, plus the composition's
 * precedence and collision behaviour — the edges the real surface cannot show
 * (both answers look plausible there).
 */
function selfTest(): never {
  const fail = (message: string): never => {
    console.error(`✗ self-test: ${message}`);
    process.exit(1);
  };

  const fixture = ts.createSourceFile(
    'fixture.zod.ts',
    [
      `import { z } from 'zod';`,
      `import { lazySchema } from './lazy';`,
      `import { ImportedBase } from './elsewhere';`,
      `const GrandBase = z.object({ a: z.string() });`,
      `const MidBase = GrandBase.extend({ b: z.string() });`,
      `export const ChainSchema = lazySchema(() => MidBase.superRefine(() => {}));`,
      `const AssignedBase = z.object({ c: z.string() });`,
      `export const AssignedSchema = lazySchema(() => {`,
      `  const helper = 1;`,
      `  if (helper) { return Object.assign(AssignedBase, { extra: true }); }`,
      `  return Object.assign(AssignedBase, {});`,
      `});`,
      `export const InlineSchema = z.object({ d: z.string() });`,
      `export const FromImportSchema = ImportedBase.extend({ e: z.string() });`,
      `const CondA = z.object({ f: z.string() });`,
      `const CondB = z.object({ g: z.string() });`,
      `export const CondSchema = (process.env.X ? CondA : CondB) as unknown as typeof CondA;`,
    ].join('\n'),
    ts.ScriptTarget.Latest,
  );

  const expectBases = (declared: string, expected: string[]) => {
    const got = collectBaseReferences(fixture, declared);
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      fail(`${declared}: expected bases [${expected.join(', ')}], got [${got.join(', ')}]`);
    }
  };

  // Receiver chain through lazySchema, then transitively to the base's own base.
  expectBases('ChainSchema', ['GrandBase', 'MidBase']);
  // Block-bodied factory, returns nested under `if`, Object.assign first-arg rule.
  expectBases('AssignedSchema', ['AssignedBase']);
  // Inline shape: nothing to record.
  expectBases('InlineSchema', []);
  // An imported base is not a same-file top-level const — deliberately not recorded.
  expectBases('FromImportSchema', []);
  // Conditional + `as` chains unwrap; both arms are candidates.
  expectBases('CondSchema', ['CondA', 'CondB']);
  // A name that declares nothing here yields nothing (and does not throw).
  expectBases('NoSuchDeclaration', []);

  // Composition: export half beats base half for the same name…
  const composed = composeEntries(
    new Map([
      ['MidBase', [{ defKey: 'data/MidBase', homeCategory: 'data' }]],
      ['Solo', [{ defKey: 'data/Solo', homeCategory: 'data' }]],
      // …the home rule narrows a cross-category duplicate…
      [
        'Dup',
        [
          { defKey: 'kernel/Dup', homeCategory: 'kernel' },
          { defKey: 'api/Dup', homeCategory: 'kernel' },
        ],
      ],
      // …and a duplicate the home rule cannot narrow is dropped, not guessed.
      [
        'Torn',
        [
          { defKey: 'system/Torn', homeCategory: 'shared' },
          { defKey: 'automation/Torn', homeCategory: 'shared' },
        ],
      ],
    ]),
    new Map([
      ['MidBase', [{ defKey: 'data/Chain', homeCategory: 'data' }]],
      ['GrandBase', [{ defKey: 'data/Chain', homeCategory: 'data' }]],
      // A base wrapped by two different defs is ambiguous — dropped.
      [
        'SharedBase',
        [
          { defKey: 'data/One', homeCategory: 'data' },
          { defKey: 'data/Two', homeCategory: 'data' },
        ],
      ],
    ]),
  );
  const expectEntry = (name: string, want: string | undefined) => {
    const got = composed.entries.get(name);
    if (got !== want) fail(`composeEntries: ${name} → ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  };
  expectEntry('MidBase', 'data/MidBase');
  expectEntry('Solo', 'data/Solo');
  expectEntry('Dup', 'kernel/Dup');
  expectEntry('GrandBase', 'data/Chain');
  expectEntry('Torn', undefined);
  expectEntry('SharedBase', undefined);
  if (![...composed.collisions.keys()].sort().join(',').includes('SharedBase')) {
    fail('composeEntries: SharedBase must be RECORDED as a collision, not silently absent');
  }
  if (!composed.collisions.has('Torn')) {
    fail('composeEntries: Torn must be recorded as a collision');
  }

  // Shard routing: entries land in their def key's category; a collision is
  // listed in EVERY category it pointed at.
  const shards = declarationMapShardTexts(composed);
  const dataShard = JSON.parse(shards.get('data') ?? '{}') as DeclarationMapShard;
  if (dataShard.entries['GrandBase'] !== 'data/Chain') fail('data shard must carry GrandBase');
  if (!dataShard.collisions.includes('SharedBase')) fail('data shard must list SharedBase as a collision');
  const systemShard = JSON.parse(shards.get('system') ?? '{}') as DeclarationMapShard;
  const automationShard = JSON.parse(shards.get('automation') ?? '{}') as DeclarationMapShard;
  if (!systemShard.collisions.includes('Torn') || !automationShard.collisions.includes('Torn')) {
    fail('a cross-category collision must be listed in every category it pointed at');
  }

  console.log(
    '✅  self-test: the unwinding grammar follows wrappers/receivers/returns and stops at imports ' +
      'and inline shapes; composition prefers the export half, applies the home rule, and drops ' +
      'ambiguity loudly.',
  );
  process.exit(0);
}

if (SELF_TEST) selfTest();

// ── Generate / check ─────────────────────────────────────────────────────────

const composed = buildDeclarationMap(PKG_DIR);
const shardTexts = declarationMapShardTexts(composed);
const totals = `${composed.entries.size} declaration name(s) across ${shardTexts.size} categor(ies), ` +
  `${composed.collisions.size} dropped as ambiguous`;

if (!CHECK) {
  const { written, removed } = writeShards(MAP_DIR, shardTexts);
  console.log(
    `✅  ${DECLARATION_MAP_DIR_NAME}/: ${totals} — ${written.length} shard(s) rewritten` +
      `${removed.length ? `, ${removed.length} removed` : ''}.`,
  );
  process.exit(0);
}

const problems: string[] = [];
const onDiskNames = fs.existsSync(MAP_DIR)
  ? fs.readdirSync(MAP_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length))
  : [];
for (const [name, text] of [...shardTexts].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const file = path.join(MAP_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    problems.push(`missing shard ${DECLARATION_MAP_DIR_NAME}/${name}.json`);
  } else if (fs.readFileSync(file, 'utf8') !== text) {
    problems.push(`${DECLARATION_MAP_DIR_NAME}/${name}.json is stale — the sources compose differently`);
  }
}
for (const name of onDiskNames) {
  if (!shardTexts.has(name)) {
    problems.push(`${DECLARATION_MAP_DIR_NAME}/${name}.json is for a category with no entries any more`);
  }
}

if (problems.length === 0) {
  console.log(`✅  ${DECLARATION_MAP_DIR_NAME}/ is current: ${totals}.`);
  process.exit(0);
}

console.error(`❌  ${problems.length} problem(s) with ${DECLARATION_MAP_DIR_NAME}/:\n`);
for (const problem of problems) console.error(`    • ${problem}`);
console.error(
  `\nThis artifact maps TS DECLARATION names to the spec registry names the authorable surface\n` +
    `keys by (ObjectSchemaBase → data/Object). Diff-side tooling reads it to decide whether a\n` +
    `changed declaration is an authorable container at all, so a stale map silently misroutes\n` +
    `that decision. Regenerate and commit the diff:\n\n` +
    `    pnpm --filter @objectstack/spec gen:declaration-map\n`,
);
process.exit(1);
