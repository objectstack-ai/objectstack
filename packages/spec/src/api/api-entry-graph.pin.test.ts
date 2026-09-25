// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: `@objectstack/spec/api` does not reach the assembled package body.
 *
 * The maintainer ruling on #18576 (letter B) split `./api`: the declarations
 * whose payload embeds the assembled package body moved to
 * `@objectstack/spec/api-assembled` (`./package-api-assembled.zod.ts`), so the
 * browser-facing entry stops linking `../stack.zod` — the whole metadata
 * vocabulary — and, behind it, the datasource declaration and the
 * driver-config validators. Measured when the split landed: a browser bundle
 * whose only use of `./api` is two string constants from `./sortability.zod`
 * roughly halved.
 *
 * Nothing else holds that boundary. `browser-reachable-entries.json` leaves
 * `./api` unjudged (it links zod, and its weight has no rule), so without this
 * pin one `export *` of a stack-dependent module from `./index.ts` would put
 * the whole tree back into every `./api` bundle and every gate would stay
 * green. This walks the entry's STATIC value-import graph from source — the
 * edges a bundler follows — and refuses it reaching any of the three modules
 * the split exists to keep out.
 *
 * `import type` / `export type` edges are not followed: they are erased at
 * build time and cost a bundle nothing.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');

/** The modules `./api` must not reach — the tree the split moved out. */
const FORBIDDEN = ['stack.zod.ts', 'data/datasource.zod.ts', 'data/driver/config-registry.zod.ts'];

// A relative specifier in a value-bearing `import … from` / `export … from`
// statement, or a bare side-effect `import '…'`. Statements that open with
// `import type` / `export type` are dropped before this runs.
const EDGE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;
const TYPE_ONLY = /(?:^|\n)\s*(?:import|export)\s+type\s[^;]*?from\s*['"][^'"]+['"]\s*;?/g;

function resolveSpecifier(fromFile: string, spec: string): string {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  // An edge that does not resolve would make the walk incomplete, and an
  // incomplete walk reporting "not reached" is exactly the false green this
  // pin exists to prevent — so it fails instead.
  throw new Error(`unresolved relative import ${spec} in ${relative(SRC, fromFile)}`);
}

function valueGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    // Comment lines are dropped line by line (a docblock line opens with `*`),
    // never with a `/* … */` regex: glob strings such as `src/**/*.ts` in this
    // tree would open a false comment and swallow real import statements.
    const source = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n')
      .replace(TYPE_ONLY, '\n');
    for (const m of source.matchAll(EDGE)) {
      queue.push(resolveSpecifier(file, (m[1] ?? m[2])!));
    }
  }
  return new Set([...seen].map((f) => relative(SRC, f).split('\\').join('/')));
}

describe('`@objectstack/spec/api` stays off the assembled package body (#18576 ruling, letter B)', () => {
  const api = valueGraph('api/index.ts');
  const assembled = valueGraph('api-assembled/index.ts');

  it('`./api` reaches none of stack.zod, the datasource declaration or the driver-config registry', () => {
    expect(FORBIDDEN.filter((f) => api.has(f))).toEqual([]);
  });

  it('`./api` does not re-export the assembled-stage module', () => {
    expect(api.has('api/package-api-assembled.zod.ts')).toBe(false);
  });

  it('positive control: the same walk DOES find all three from `./api-assembled`', () => {
    // Without this, a walker that silently stopped following edges would pass
    // the two assertions above over nothing.
    expect(FORBIDDEN.filter((f) => assembled.has(f))).toEqual(FORBIDDEN);
  });

  it('anti-vacuity: the `./api` walk covers the entry\'s real graph', () => {
    // 120 value-graph modules when the split landed; far below that means the
    // edge pattern stopped matching, not that the entry shrank.
    expect(api.size).toBeGreaterThan(60);
    expect(api.has('api/sortability.zod.ts')).toBe(true);
    expect(api.has('api/package-api.zod.ts')).toBe(true);
  });
});
