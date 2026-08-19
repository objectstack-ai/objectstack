// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0076 D2 boundary ratchet. The lean engine entry `@objectstack/objectql/core`
// (src/core.ts) and its entire local import closure must NOT depend on the kernel
// plugin, the kernel factory, or the metadata-management protocol — so a thin
// embedder importing `@objectstack/objectql/core` never pulls
// `@objectstack/metadata-protocol` into its graph.
//
// ---------------------------------------------------------------------------
// Why no byte figure is quoted for what is excluded (#9803)
//
// The entry comment used to sell this boundary with a hard number. That number
// was real once, but it never measured the thing the sentence claimed. Full
// provenance, each line re-derivable with `git cat-file -s <rev>:<path>`
// (measured 2026-08-19; the extraction predates the default shallow clone, so
// `git fetch --deepen=1200` first):
//
//     268,886 B  packages/objectql/src/protocol.ts           @ d9fe95fcf
//                the pre-extraction SOURCE FILE — what ADR-0076's premise
//                paragraph counted. 268,886 B = 268.9 decimal KB, hence "268KB".
//     268,921 B  packages/metadata-protocol/src/protocol.ts  @ 13dbcf2d0
//                the same file as it landed in the new package, 2026-06-28,
//                "extract metadata-protocol + add lean ./core entry (ADR-0076
//                Step 1)" (#2415).
//   1,054,749 B  packages/metadata-protocol/src/protocol.ts  @ HEAD
//                3.9x the quoted figure — and that is ONE file of a package
//                whose src tree totals ~3.6 MB (`find … -type f | xargs wc -c`).
//
// So the figure was raw source bytes of a single file, and was then re-pointed
// at a whole package ("the 268KB metadata-management layer") — a unit it never
// had. Re-measuring cannot repair that, because there is no one number to
// re-measure. "The size of @objectstack/metadata-protocol" on 2026-08-19, after
// `pnpm --filter @objectstack/metadata-protocol build`, via `wc -c` and
// `gzip -9 -c | wc -c`:
//
//     169,718 B  dist/index.js, gzipped        (LESS than the quoted figure)
//     591,087 B  dist/index.js, raw
//   1,054,749 B  src/protocol.ts               (the quoted figure's own unit)
//   1,513,973 B  src/**/*.ts, excluding tests
//   3,637,237 B  src/**/*.ts
//
// A 21x spread that straddles "268KB" in BOTH directions, before an embedder's
// own bundler and tree-shaking are even considered. The defect is therefore not
// staleness — it is that the figure never had a stated unit, and no refresh can
// supply one. The claim worth making is EXCLUSION, and the test below is what
// pins it. The second test keeps a figure from growing back into core.ts.
// ---------------------------------------------------------------------------
//
// If this test fails, you added a forbidden import somewhere reachable from
// core.ts. Keep metadata/plugin/kernel concerns out of the core closure.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_PACKAGES = ['@objectstack/metadata-protocol'];
const FORBIDDEN_LOCAL = ['plugin', 'kernel-factory'];

function localImports(source: string): string[] {
  const out: string[] = [];
  const re = /(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

function toTsPath(fromFile: string, spec: string): string {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ''));
  return base.endsWith('.ts') ? base : `${base}.ts`;
}

describe('ADR-0076 D2 — @objectstack/objectql/core boundary', () => {
  it('core.ts closure pulls neither metadata-protocol nor plugin/kernel-factory', () => {
    const entry = resolve(SRC, 'core.ts');
    const visited = new Set<string>();
    const violations: string[] = [];
    const stack = [entry];

    while (stack.length) {
      const file = stack.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);

      let src: string;
      try {
        src = readFileSync(file, 'utf8');
      } catch {
        continue; // generated / non-existent; ignore
      }

      for (const pkg of FORBIDDEN_PACKAGES) {
        if (new RegExp(`['"]${pkg.replace('/', '\\/')}['"]`).test(src)) {
          violations.push(`${file} imports forbidden package ${pkg}`);
        }
      }

      for (const spec of localImports(src)) {
        const base = spec.replace(/\.js$/, '').split('/').pop();
        if (FORBIDDEN_LOCAL.includes(base ?? '')) {
          violations.push(`${file} imports forbidden local module ./${base}`);
        }
        stack.push(toTsPath(file, spec));
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
    // sanity: the engine itself IS in the closure
    expect([...visited].some((f) => f.endsWith('/engine.ts'))).toBe(true);
  });

  // #9803. The exclusion claim is pinned by the test above. A byte figure for
  // the excluded weight is pinned by nothing, so core.ts must not state one —
  // that is how "268KB" sat there unverified from 2026-06-28 until #9803.
  // Scope is deliberately this package's entry only: the historical figures in
  // this file's own header are provenance (dated, commit-pinned), not a claim,
  // and are meant to stay.
  it('core.ts quotes no unverifiable byte figure for the excluded weight', () => {
    const src = readFileSync(resolve(SRC, 'core.ts'), 'utf8');
    const offenders = src
      .split('\n')
      .filter((line) => /^\s*(?:\/\/|\/\*|\*)/.test(line))
      .filter((line) => /metadata[- ](?:protocol|management)/i.test(line))
      .filter((line) => /\b\d[\d.,]*\s*(?:[KMG]i?B|kB)\b/.test(line))
      .map((line) => line.trim());

    expect(
      offenders,
      `core.ts states a byte figure for the excluded metadata protocol:\n${offenders.join(
        '\n',
      )}\nNothing re-measures such a number. State the exclusion, not a size — see this file's header.`,
    ).toEqual([]);
  });
});
