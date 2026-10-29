// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Virtual ObjectQL request protocol — `data/data-engine.zod.ts`'s
 * `DataEngineRequestSchema`, its nine arms and `DataEngineContractSchema` —
 * RETIRED whole (#27028, ADR-0049 enforce-or-remove), by the maintainer's ruling
 * A on its decision card (2026-10-28): retire it rather than keep it as a planned
 * contract. No Virtual Data Engine existed and nothing parsed the protocol.
 *
 * Zero readers, measured before the removal (counts plus the tree each was
 * taken against): objectstack `1287b2fa` — no importer or parser outside
 * `packages/spec/src/data/` (generated ledgers, reference docs and changelogs
 * aside; control: 22 files name `DataEngineInsertOptions`, which stays);
 * hotcrm `353dace`, objectui `b2c0ade` and docs.objectos.ai `cab35fd` — 0
 * (controls: 311, 2095 and 74 files import `@objectstack/spec`).
 *
 * Bookkeeping shapes, pinned below:
 *   1. No carrier key, so no `retiredKey()` tombstone and no D2 conversion: no
 *      metadata source authors these shapes, so a conversion would have no seam
 *      that runs.
 *   2. `RETIRED_DEFS_BY_MAJOR[18]` carries the ten published defs, and the D3
 *      entry `data-engine-rpc-protocol-retired` carries the judgement an
 *      upgrader owes.
 *   3. The protocol's exports are gone from `@objectstack/spec/data` (and the
 *      root entry carries none of them), while the option bags `IDataEngine` is
 *      typed with and `RPC_QUERY_ALIAS_SLOTS` survive (the lit controls).
 *   4. Tree-scoped absence: nothing inside the declared radius still imports a
 *      retired export from a spec specifier or reaches one through `Data.`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as data from './index';
import * as root from '../index';
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR } from '../migrations/registry';

const ARMS = ['Find', 'FindOne', 'Insert', 'Update', 'Delete', 'Count', 'Aggregate', 'Execute', 'VectorFind'];
const RETIRED_DEFS = ['data/DataEngineRequest', ...ARMS.map((arm) => `data/DataEngine${arm}Request`)];
const RETIRED_VALUE_EXPORTS = [
  'DataEngineRequestSchema',
  ...ARMS.map((arm) => `DataEngine${arm}RequestSchema`),
  'DataEngineContractSchema',
];

describe('the Virtual ObjectQL request protocol is retired whole, and registered', () => {
  it('RETIRED_DEFS_BY_MAJOR[18] carries the ten published defs', () => {
    expect(RETIRED_DEFS).toHaveLength(10);
    for (const def of RETIRED_DEFS) expect(RETIRED_DEFS_BY_MAJOR[18], def).toContain(def);
  });

  it('the D3 entry `data-engine-rpc-protocol-retired` names the doors that exist', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === 'data-engine-rpc-protocol-retired');
    expect(entry).toBeDefined();
    expect(entry!.replacement).toMatch(/`IDataEngine`/);
    expect(entry!.replacement).toMatch(/POST \{basePath\}\/batch/);
    expect(entry!.reason).toMatch(/ADR-0049/);
    expect(entry!.acceptanceCriteria).toMatch(/TS2305/);
    // No conversion judged: there is no seam a conversion could run on.
    expect(entry!.conversionIds).toBeUndefined();
  });
});

describe('the protocol\'s exports are gone from every entry that carried them', () => {
  it.each(RETIRED_VALUE_EXPORTS)('`%s` is exported neither from `@objectstack/spec/data` nor from the root entry', (name) => {
    expect(Object.keys(data)).not.toContain(name);
    expect(Object.keys(root)).not.toContain(name);
  });

  it('the option bags and the alias table survive — the lit controls', () => {
    for (const name of ['EngineQueryOptionsSchema', 'DataEngineInsertOptionsSchema', 'RPC_QUERY_ALIAS_SLOTS', 'QueryWithTransportSchema']) {
      expect(Object.keys(data), name).toContain(name);
    }
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — the protocol's exports are gone, so every
// typed import fails to compile (TS2305). The residue is what `tsc` never
// judges: MD/MDX code fences, JSON, YAML and untyped `.js`. This walk covers
// that residue across the five repo roots `scripts/cross-package-test-inputs.mjs`
// declares for `@objectstack/spec#test` (mirrored in `turbo.json`), plus the
// example apps' own `src/` trees, declared there as `examples/*/src/**/*.ts`.
//
// Two matchers, each judging a USE, never a mention:
//   - an `import` / `export … from` naming a retired export from an
//     `@objectstack/spec` specifier, the type aliases included;
//   - a `Data.<retired value export>` access through the documented
//     `import * as Data from '@objectstack/spec/data'` namespace.
// Inline code is prose and is stripped before judging. The bound, stated:
// `docs/**`, `.claude/**`, `.github/**` and the repo-root files are outside what
// this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still imports the Virtual ObjectQL protocol', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /** Every retired name: the ten request schemas and their types, and the contract schema. */
  const RETIRED_NAMES =
    '(DataEngine(Find|FindOne|Insert|Update|Delete|Count|Aggregate|Execute|VectorFind)?Request(Schema|Parsed)?'
    + '|DataEngineContractSchema)';
  const USES = [
    // An import or re-export naming a retired export from a spec specifier.
    new RegExp(`\\b(import|export)\\s+(type\\s+)?\\{[^}]*\\b${RETIRED_NAMES}\\b[^}]*\\}\\s*from\\s*['"]@objectstack/spec`, 'm'),
    // An access through the documented `import * as Data` namespace.
    new RegExp(`\\bData\\.${RETIRED_NAMES}\\b`, 'm'),
  ];

  /**
   * Inline code spans are prose — the house style `check:doc-authoring` enforces
   * — so stripping single-backtick spans separates "the retirement kit naming
   * what it removed" from "a source still using it". Newline-bounded: a fenced
   * block's content is NOT stripped.
   */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string): RegExpExecArray | null => {
    const stripped = stripInlineCode(text);
    for (const re of USES) {
      const m = re.exec(stripped);
      if (m) return m;
    }
    return null;
  };

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4).
   */
  const EXCLUDED = new Set([
    // This pin spells the retired names to assert their absence.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output (`packages/spec/json-schema/`), reached only
    // because this is a FILESYSTEM walk. Its source is the Zod tree.
    'packages/spec/json-schema/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /** Tolerates ONLY a path that vanished mid-walk; every other read fault is re-raised. */
  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises a use and ignores a prose mention and the neighbours (anti-vacuity)', () => {
    // Uses — in each syntax the walk reads.
    expect(judge("import { DataEngineRequestSchema } from '@objectstack/spec/data';")).not.toBeNull();
    expect(judge("import type {\n  EngineQueryOptions,\n  DataEngineRequest,\n} from '@objectstack/spec/data';")).not.toBeNull();
    expect(judge("Prose.\n\n```ts\nimport { DataEngineVectorFindRequestSchema } from '@objectstack/spec';\n```\n")).not.toBeNull();
    expect(judge("export { DataEngineContractSchema } from '@objectstack/spec/data';")).not.toBeNull();
    expect(judge('const r = Data.DataEngineFindOneRequestSchema.parse(x);')).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge('the `DataEngineRequestSchema` export was retired')).toBeNull();
    expect(judge("import { DataEngineInsertOptionsSchema, DataEngineQueryOptions } from '@objectstack/spec/data';")).toBeNull();
    expect(judge("import { CrossObjectBatchRequestSchema } from '@objectstack/spec/api';")).toBeNull();
    expect(judge("import { DataEngineRequestSchema } from './local-protocol';")).toBeNull();
  });

  it('no use of a retired export survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        const scanned = rel.startsWith('examples/')
          ? EXAMPLES_EXT.has(ext) || EXAMPLE_APP_SRC_TS.test(rel)
          : SCANNED_EXT.has(ext);
        if (!scanned) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        if (EXAMPLE_APP_SRC_TS.test(rel)) exampleSources += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        const m = judge(text);
        if (m) offenders.push(`${rel} uses \`${m[0].trim().replace(/\s+/g, ' ')}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree, and the example apps'
    // sources were really read.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(offenders, 'a use of a retired Virtual ObjectQL export means the retirement is being undone').toEqual([]);
  });
});
