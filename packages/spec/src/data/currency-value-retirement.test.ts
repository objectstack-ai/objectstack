// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `CurrencyValueSchema` / `CurrencyValue` (`data/field.zod.ts`, the
 * `{value, currency}` shape) — RETIRED (#27182, ADR-0049 enforce-or-remove),
 * as ADR-0104 D1 decided ("`currency` is a scalar number —
 * `CurrencyValueSchema` is deleted") and as the multi-currency epic #8345
 * needs before it starts (ruling 6465431966 on #27119). A currency field's
 * value is a BARE NUMBER; its code is field configuration
 * (`CurrencyConfigSchema`).
 *
 * Zero readers, measured before the removal on objectstack `fd73f2b3`: every
 * hit outside `packages/spec/src/data/field.zod.ts` was its own
 * `field.test.ts` block, its `Iso_` row in `type-alias-convention.pin.test.ts`,
 * the generated baselines and reference docs, changelogs, or prose (control:
 * `CurrencyConfigSchema`, read by the record validator and the object form).
 * Nothing under `ui/` or `skills/`.
 *
 * Bookkeeping shapes, pinned below:
 *   1. No carrier key, so no `retiredKey()` tombstone and no D2 conversion: the
 *      schema was mounted by no stack key and is no metadata type.
 *   2. `RETIRED_DEFS_BY_MAJOR[18]` carries `data/CurrencyValue`, and the D3
 *      entry `currency-value-schema-retired` carries the FROM → TO note.
 *   3. The export is gone from `@objectstack/spec/data` and the root entry,
 *      while `CurrencyConfigSchema` survives (the lit control).
 *   4. Tree-scoped absence: nothing inside the declared radius still imports
 *      the retired names from a spec specifier or reaches them through `Data.`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as data from './index';
import * as root from '../index';
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR } from '../migrations/registry';

describe('the currency value shape is retired, and registered', () => {
  it('RETIRED_DEFS_BY_MAJOR[18] carries `data/CurrencyValue`', () => {
    expect(RETIRED_DEFS_BY_MAJOR[18]).toContain('data/CurrencyValue');
  });

  it('the D3 entry `currency-value-schema-retired` says a currency value is a bare number', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === 'currency-value-schema-retired');
    expect(entry).toBeDefined();
    expect(entry!.replacement).toMatch(/BARE NUMBER/);
    expect(entry!.replacement).toMatch(/defaultCurrency/);
    expect(entry!.reason).toMatch(/ADR-0049/);
    expect(entry!.reason).toMatch(/ADR-0104 D1/);
    expect(entry!.acceptanceCriteria).toMatch(/TS2305/);
    // No conversion judged: there is no seam a conversion could run on.
    expect(entry!.conversionIds).toBeUndefined();
  });
});

describe('the export is gone from every entry that carried it', () => {
  it('`CurrencyValueSchema` is exported neither from `@objectstack/spec/data` nor from the root entry', () => {
    expect(Object.keys(data)).not.toContain('CurrencyValueSchema');
    expect(Object.keys(root)).not.toContain('CurrencyValueSchema');
  });

  it('the field-config `CurrencyConfigSchema` survives — the lit control', () => {
    expect(Object.keys(data)).toContain('CurrencyConfigSchema');
  });

  it('the value contract still answers a bare number for a currency field', () => {
    const schema = data.valueSchemaFor({ type: 'currency' });
    expect(schema.safeParse(1000.5).success).toBe(true);
    expect(schema.safeParse({ value: 1000.5, currency: 'USD' }).success).toBe(false);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — the export is gone, so every typed import
// fails to compile (TS2305). The residue is what `tsc` never judges: MD/MDX
// code fences, JSON, YAML and untyped `.js`. This walk covers that residue
// across the five repo roots `scripts/cross-package-test-inputs.mjs` declares
// for `@objectstack/spec#test` (mirrored in `turbo.json`), plus the example
// apps' own `src/` trees, declared there as `examples/*/src/**/*.ts`.
//
// Two matchers, each judging a USE, never a mention: an `import` / `export …
// from` naming a retired name from an `@objectstack/spec` specifier, and a
// `Data.CurrencyValueSchema` access through the documented namespace import.
// Inline code is prose and is stripped before judging. The bound, stated:
// `docs/**`, `.claude/**`, `.github/**` and the repo-root files are outside
// what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still imports the currency value shape', () => {
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

  const RETIRED_NAMES = '(CurrencyValueSchema|CurrencyValue)';
  const USES = [
    // An import or re-export naming a retired name from a spec specifier.
    new RegExp(`\\b(import|export)\\s+(type\\s+)?\\{[^}]*\\b${RETIRED_NAMES}\\b[^}]*\\}\\s*from\\s*['"]@objectstack/spec`, 'm'),
    // An access through the documented `import * as Data` namespace.
    new RegExp('\\bData\\.CurrencyValueSchema\\b', 'm'),
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
    expect(judge("import { CurrencyValueSchema } from '@objectstack/spec/data';")).not.toBeNull();
    expect(judge("import type { Field, CurrencyValue } from '@objectstack/spec/data';")).not.toBeNull();
    expect(judge("Prose.\n\n```ts\nimport { CurrencyValueSchema } from '@objectstack/spec';\n```\n")).not.toBeNull();
    expect(judge("export { CurrencyValueSchema } from '@objectstack/spec/data';")).not.toBeNull();
    expect(judge('const v = Data.CurrencyValueSchema.parse(x);')).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge('the `CurrencyValueSchema` export was retired')).toBeNull();
    expect(judge("import { CurrencyConfigSchema, type CurrencyConfig } from '@objectstack/spec/data';")).toBeNull();
    expect(judge("import { CurrencyValueSchema } from './local-money';")).toBeNull();
    expect(judge('const v = Data.CurrencyConfigSchema.parse(x);')).toBeNull();
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
    expect(offenders, 'a use of the retired currency value export means the retirement is being undone').toEqual([]);
  });
});
