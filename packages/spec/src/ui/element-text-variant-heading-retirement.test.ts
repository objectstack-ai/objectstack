// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `element:text` `variant`'s `heading` / `subheading` RETIRED (#21015) —
 * release 2 of objectui#7450's ruling B: the vocabulary is the nine values
 * `ui:text` publishes, and the two pre-convergence spellings are refused by
 * name (`enumWithRetiredValues`), with the ADR-0087 D2 conversion
 * `element-text-variant-heading-levels` rewriting them to `h2` / `h3`.
 *
 * This file is the TREE-SCOPED half of the retirement — it reads outside the
 * package, so it runs in the `repo` project (`vitest.repo-tests.json`). The
 * refusal, its prescription and the `tsc` channel are pinned in
 * `component.test.ts` (`ElementTextPropsSchema`); the conversion's fixture is
 * replayed by the conversion suite.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps only TYPED authoring sites, and a page component's `properties`
// is an open bag, so `tsc` does not reach an `element:text` authored through
// `definePage`/`defineStack` at all — the five writers this retirement moved
// were found by grep, not by the compiler. This walk covers every text file
// under the five repo roots `scripts/cross-package-test-inputs.mjs` declares
// for `@objectstack/spec#test` (mirrored in `turbo.json`), plus the example
// apps' own `src/` trees.
//
// The matcher judges the AUTHORING SHAPE, never a mention: `variant` in key
// position with the string value `heading` or `subheading` (TS / JS / JSON,
// and YAML, quoted or bare). It is deliberately not narrowed to
// `element:text`: no other component in this contract declares either value,
// so any `variant: 'heading'` is this retirement being undone — if a schema
// ever declares one, narrow the matcher to `element:text` then, never exclude
// the new file. Prose mentions are spelled in inline code in this repo, and
// inline code is stripped before judging. The bound, stated: a value that is
// not a string literal, a computed key, and `docs/**`, `.claude/**`,
// `.github/**` and the repo-root files are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors an element:text heading / subheading variant', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const AUTHORING = /(^|[^\w.$])["']?variant["']?[ \t]*:[ \t]*(["'])(heading|subheading)\2|(^|\n)[ \t]*variant:[ \t]*(heading|subheading)[ \t]*(#.*)?$/m;

  /** Inline code spans are prose; newline-bounded, so a fenced example is still judged. */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string): RegExpExecArray | null => AUTHORING.exec(stripInlineCode(text));

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired value.
   */
  const EXCLUDED = new Set([
    // This pin authors the values in its anti-vacuity cases.
    THIS_FILE,
    // The row's pin authors the values to assert their refusal.
    'packages/spec/src/ui/component.test.ts',
    // The helper's own contract suite, over a SYNTHETIC `heading` / `subheading`
    // vocabulary that is not this enum's (shared/retired-key.ts, #17109).
    'packages/spec/src/shared/retired-key.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement spellings on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output (`packages/spec/json-schema/`), reached only
    // because this is a FILESYSTEM walk. Its source is `component.zod.ts`.
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

  it('the matcher recognises an authoring and ignores a prose mention and the kit (anti-vacuity)', () => {
    // Offenders — the retired shape, in each syntax the walk reads.
    expect(judge("{ type: 'element:text', properties: { content: 'Overview', variant: 'heading' } }")).not.toBeNull();
    expect(judge("  properties: {\n    variant: 'subheading',\n  },")).not.toBeNull();
    expect(judge('{ "type": "element:text", "properties": { "variant": "subheading" } }')).not.toBeNull();
    expect(judge('      properties:\n        variant: heading\n')).not.toBeNull();
    expect(judge("      properties:\n        variant: 'subheading'\n")).not.toBeNull();
    expect(judge("Prose.\n\n```ts\ndefinePage({ regions: [{ components: [{ properties: { variant: 'heading' } }] }] });\n```\n")).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge('a block that said `variant: \'subheading\'` now says `h3`')).toBeNull();
    expect(judge("{ type: 'element:text', properties: { variant: 'h2' } }")).toBeNull();
    expect(judge("aliases: { heading: 'title', subheading: 'subtitle' },")).toBeNull();
    expect(judge("variant: 'headings',")).toBeNull();
    expect(judge('properties.variant authored as heading or subheading')).toBeNull();
  });

  it('no heading / subheading variant authoring survives inside the declared radius outside the retirement kit', () => {
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
        if (m) offenders.push(`${rel} authors \`${m[0].trim().replace(/\s+/g, ' ')}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree and the example apps' sources.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(offenders, 'a heading / subheading variant authoring means the retirement is being undone').toEqual([]);
  });
});
