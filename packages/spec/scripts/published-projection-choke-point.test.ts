// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Holds the published-projection choke point (#18670 item 2) to the scope its
 * own docblock claims — mechanically, per file, over the whole of this
 * package's `scripts/` tree.
 *
 * ## The defect this exists for
 *
 * `projectPublishedJsonSchema` describes itself as the ONE call through which
 * `z.toJSONSchema` is reached anywhere this package writes a published JSON
 * Schema artifact. When that sentence was written it was measured over the
 * schema generator and the detector — `build-schemas.ts` went from four direct
 * calls to zero, `dropped-refinements.ts` to zero — and `build-openapi.ts` was
 * not in the corpus. It was a second, override-less `z.toJSONSchema` route,
 * writing `json-schema/openapi.json`: a file that ships in the tarball
 * (`files[]` carries `json-schema`) and is exported as `./openapi.json`. So a
 * refinement on the closed list would have been emitted into
 * `api/CreateRequest.json` and dropped from the SAME schema's copy inside
 * `openapi.json` — two published artifacts, one tarball, disagreeing about
 * which documents the contract accepts.
 *
 * ⛔ The reading that missed it was a grep over a hand-picked file list. This
 * file replaces the list with the tree: a NEW generator that reaches for
 * `z.toJSONSchema` fails here on the day it lands, rather than on the day
 * someone re-takes a census.
 *
 * ## Why an allowance table and not a flat zero
 *
 * One call in this tree is legitimately direct:
 * `union-branch-projection.ts`'s `projectsUnderStrictMode` asks zod whether a
 * node is representable at all and DISCARDS the result — a yes/no question,
 * not a projection, so routing it through the override would answer something
 * else. It is declared below with that reason and pinned at its exact count,
 * so a SECOND call in that file fails too.
 *
 * ## Why the controls are not decoration
 *
 * The scan strips comments before counting, and this tree talks about
 * `z.toJSONSchema` in prose constantly (`build-schemas.ts` alone twice). A
 * stripper that removed too much would make every assertion here pass over an
 * empty string. So the choke point itself is asserted to read EXACTLY one call
 * (lit control: the instrument can see a call), and a file whose only mentions
 * are prose is asserted to read zero (dark control: the instrument is not just
 * counting the word).
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Every non-test `.ts` under `scripts/`, as `<path relative to scripts/>`. */
function collectScriptSources(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|mts)$/.test(entry.name)) continue;
      if (/\.(test|spec)\.(ts|mts)$/.test(entry.name)) continue;
      if (/\.pin\.test\./.test(entry.name)) continue;
      out.set(path.relative(HERE, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf-8'));
    }
  };
  walk(HERE);
  return out;
}

/**
 * Line and block comments removed, everything else left alone. Deliberately
 * NOT a string-literal stripper: a `z.toJSONSchema(` inside a string would be a
 * false positive, and the corpus assertion below is what proves none exists
 * today — a future one fails loudly here rather than being tolerated by a
 * cleverer regex nobody can audit.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Direct `z.toJSONSchema(` calls in code, comments excluded. */
function directCallCount(source: string): number {
  return (stripComments(source).match(/\bz\.toJSONSchema\s*\(/g) ?? []).length;
}

/**
 * The calls that stay direct, each with the reason it is not a projection.
 * ⛔ Adding a row here widens the published-projection guarantee's hole: it is
 * a decision about `packages/spec`'s published surface, not a way to green a
 * failing scan.
 */
const DECLARED_DIRECT_CALLS: ReadonlyArray<{ file: string; count: number; why: string }> = [
  {
    file: 'lib/refinement-projection.ts',
    count: 1,
    why: 'the choke point itself — the one call every published projection is produced through',
  },
  {
    file: 'lib/union-branch-projection.ts',
    count: 1,
    why: "projectsUnderStrictMode asks zod whether a node is representable and DISCARDS the result; nothing it produces is published",
  },
];

/** The producers whose output is published and must reach it through the helper. */
const PUBLISHED_PRODUCERS = ['build-schemas.ts', 'build-openapi.ts'] as const;

describe('published projection choke point', () => {
  const sources = collectScriptSources();

  it('scans a corpus that is capable of failing', () => {
    // A walk that found nothing would make every assertion below vacuous.
    expect(sources.size).toBeGreaterThan(20);
    for (const producer of PUBLISHED_PRODUCERS) expect(sources.has(producer)).toBe(true);
    for (const declared of DECLARED_DIRECT_CALLS) expect(sources.has(declared.file)).toBe(true);
    for (const [file, source] of sources) expect(source.length, file).toBeGreaterThan(0);
  });

  it('LIT CONTROL: the scan sees the choke point own direct call', () => {
    // If this reads 0 the detector is blind and every zero below is worthless.
    expect(directCallCount(sources.get('lib/refinement-projection.ts')!)).toBe(1);
  });

  it('DARK CONTROL: prose about z.toJSONSchema is not counted as a call', () => {
    const schemas = sources.get('build-schemas.ts')!;
    // The word is present...
    expect(schemas.includes('toJSONSchema')).toBe(true);
    // ...and every occurrence is in a comment, so the count is 0.
    expect(directCallCount(schemas)).toBe(0);
  });

  it('no producer in scripts/ reaches z.toJSONSchema directly, outside the declared calls', () => {
    const allowed = new Map(DECLARED_DIRECT_CALLS.map((row) => [row.file, row.count]));
    const offenders: string[] = [];
    for (const [file, source] of sources) {
      const found = directCallCount(source);
      const expected = allowed.get(file) ?? 0;
      if (found !== expected) offenders.push(`${file}: ${found} direct call(s), declared ${expected}`);
    }
    expect(offenders, [
      'A direct `z.toJSONSchema(` in this tree bypasses the refinement projection override,',
      'so a rule on the closed list reaches one published artifact and not another.',
      'Route it through `projectPublishedJsonSchema` (lib/refinement-projection.ts), or —',
      'if it is a probe whose result is discarded — declare it in DECLARED_DIRECT_CALLS',
      'with the reason.',
    ].join(' ')).toEqual([]);
  });

  it('every published producer imports the helper it is required to project through', () => {
    for (const producer of PUBLISHED_PRODUCERS) {
      expect(stripComments(sources.get(producer)!), producer).toMatch(
        /import\s*\{[^}]*\bprojectPublishedJsonSchema\b[^}]*\}\s*from\s*'\.{1,2}\/(lib\/)?refinement-projection'/,
      );
    }
  });
});
