// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the #19086 ruling: **`check:generated --fix` rebuilds what it writes
// from.** Three clauses, pinned one case apiece plus the two reproducers the
// card's own thread measured:
//
//   1. the write path takes a forced `packages/spec` build inside the same
//      invocation and generates from THAT dist, never from whatever dist
//      happens to be on disk;
//   2. the 「All N generated artifacts are up to date」 line names the dist it
//      measured against;
//   3. `--fix` re-runs the check after writing, so a write is never its own
//      only witness.
//
// ## Why these fixtures, and why they are not invented
//
// The card holds two measured dist states, both of which the old guard
// acquitted (`distIsStale()` false, declaration stamp `match`) and from which
// `--fix` wrote a baseline missing live exports and exited 0:
//
//   • B1 — an ENTRY declaration whose final `export { … }` lost two names,
//     while the `declare function` bodies stayed. Measured: 3 live exports
//     deleted from `api-surface/`, 2 more downgraded, exit 0.
//   • E1 — two of the 46 emitted CHUNK declarations absent, which is what an
//     interrupted declaration pass leaves behind (every DECLARED entry file is
//     still present, so the build's own `check-dts-emitted` reports 34/34 and
//     exits 0). Measured: 322 baseline lines removed across four tracked
//     shards plus `api-surface-signatures.json`, exit 0.
//
// Neither is reproducible inside a unit test at full scale — a real
// `packages/spec` build is ~3 minutes under the shared verify lock, and the
// pin would then be the slowest test in the package by two orders of
// magnitude. So the ORDER of effects is what is pinned, against a fixture
// world small enough to run in milliseconds: the fixture's `build` re-emits a
// dist that describes its `src`, its `check:api-surface` compares the surface
// READ OFF THE DIST against the committed baseline, and its `gen:api-surface`
// WRITES that surface into the baseline. Put a damaged dist in front of that
// world and the baseline loses names unless something rebuilt first — which is
// exactly the failure the ruling removes, and exactly what these cases assert
// did not happen.
//
// ⛔ Each case carries its own lit control: it asserts the fixture really is in
// the damaged state (the names ARE missing from the dist before the run), so a
// pin that passed because the fixture was healthy is not available.

import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkGenerated, distEvidence, type CheckGeneratedIO } from './check-generated';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');
/** The real ledger: the pins drive the real reconciliation, not a stub of it. */
const SCRIPTS: Record<string, string> = JSON.parse(
  readFileSync(path.join(SPEC, 'package.json'), 'utf8'),
).scripts;

/* ─────────────────────────────────────────────── the fixture world ────── */

interface SrcModel {
  /** entry name → the names it declares itself, and the chunks it re-exports. */
  entries: Record<string, { own: string[]; chunks: number[] }>;
  /** chunk id → the names that chunk declares. */
  chunks: Record<number, string[]>;
}

function emitDist(root: string, src: SrcModel): void {
  const dist = path.join(root, 'dist');
  rmSync(dist, { recursive: true, force: true });
  for (const [entry, { own, chunks }] of Object.entries(src.entries)) {
    mkdirSync(path.join(dist, entry), { recursive: true });
    writeFileSync(
      path.join(dist, entry, 'index.d.ts'),
      `export { ${own.join(', ')} };\n// re-exports: ${chunks.map((c) => `chunk-${c}.d.ts`).join(', ')}\n`,
    );
  }
  for (const [id, names] of Object.entries(src.chunks)) {
    writeFileSync(path.join(dist, `chunk-${id}.d.ts`), `export { ${names.join(', ')} };\n`);
  }
}

/**
 * The surface a consumer resolves THROUGH THE DIST — the same question
 * `build-api-surface.ts` asks of the real one. A chunk file that is not on disk
 * contributes nothing and says nothing: that silence is the whole of E1.
 */
function surfaceFromDist(root: string): Record<string, string[]> {
  const dist = path.join(root, 'dist');
  const out: Record<string, string[]> = {};
  for (const entry of readdirSync(dist, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const text = readFileSync(path.join(dist, entry.name, 'index.d.ts'), 'utf8');
    const own = (/export \{([^}]*)\}/.exec(text)?.[1] ?? '')
      .split(',').map((n) => n.trim()).filter(Boolean);
    const refs = (/^\/\/ re-exports: (.*)$/m.exec(text)?.[1] ?? '')
      .split(',').map((n) => n.trim()).filter(Boolean);
    const names = [...own];
    for (const ref of refs) {
      const p = path.join(dist, ref);
      if (!existsSync(p)) continue;
      const chunk = readFileSync(p, 'utf8');
      names.push(...(/export \{([^}]*)\}/.exec(chunk)?.[1] ?? '')
        .split(',').map((n) => n.trim()).filter(Boolean));
    }
    out[entry.name] = names.sort();
  }
  return out;
}

function readBaseline(root: string): Record<string, string[]> {
  return JSON.parse(readFileSync(path.join(root, 'api-surface.json'), 'utf8'));
}
function writeBaseline(root: string, surface: Record<string, string[]>): void {
  writeFileSync(path.join(root, 'api-surface.json'), JSON.stringify(surface, null, 2));
}

interface WorldOptions {
  src: SrcModel;
  /** What `distIsStale()` answers. Both reproducers measured `false`. */
  distStale?: boolean;
  /** Scripts whose gate fails; `check:api-surface` is decided from the dist. */
  failing?: Set<string>;
  /** Gates that keep failing even after their generator ran (the ratchet half). */
  unfixable?: Set<string>;
  /** Make the forced build fail. */
  buildFails?: boolean;
}

interface World {
  root: string;
  calls: string[];
  io: CheckGeneratedIO;
  out: string[];
}

function makeWorld(o: WorldOptions): World {
  const root = mkdtempSync(path.join(tmpdir(), 'check-generated-pin-'));
  emitDist(root, o.src);
  // The committed baseline is correct for the SOURCE, which is what makes a
  // write from a damaged dist a deletion rather than an update.
  const truth: Record<string, string[]> = {};
  for (const [entry, { own, chunks }] of Object.entries(o.src.entries)) {
    truth[entry] = [...own, ...chunks.flatMap((c) => o.src.chunks[c] ?? [])].sort();
  }
  writeBaseline(root, truth);

  const calls: string[] = [];
  const out: string[] = [];
  const failing = o.failing ?? new Set<string>();
  const unfixable = o.unfixable ?? new Set<string>();

  const io: CheckGeneratedIO = {
    run(script) {
      calls.push(script);
      if (script === 'build') {
        if (o.buildFails) return { ok: false, output: 'fixture build failed\nsecond line' };
        emitDist(root, o.src); // a build emits a dist that describes src
        return { ok: true, output: 'built' };
      }
      if (script === 'check:api-surface') {
        const ok = JSON.stringify(surfaceFromDist(root)) === JSON.stringify(readBaseline(root));
        return { ok, output: ok ? 'unchanged' : 'public API changed: breaking (removed/narrowed)' };
      }
      if (script === 'gen:api-surface') {
        writeBaseline(root, surfaceFromDist(root));
        return { ok: true, output: 'wrote api-surface' };
      }
      if (script.startsWith('gen:')) return { ok: true, output: 'regenerated' };
      if (failing.has(script)) {
        const repaired = calls.includes(script.replace('check:', 'gen:')) && !unfixable.has(script);
        return repaired
          ? { ok: true, output: 'now current' }
          : { ok: false, output: `${script} verdict: a hand-written row names a file that is gone` };
      }
      return { ok: true, output: 'ok' };
    },
    distIsStale: () => o.distStale ?? false,
    distEvidence: (builtByThisRun, buildMs) => distEvidence(root, builtByThisRun, buildMs),
    log: (line) => out.push(line),
    error: (line) => out.push(line),
  };
  return { root, calls, io, out };
}

/* ───────────────────────────────────────────────────────── the pins ────── */

describe('check:generated --fix rebuilds what it writes from (#19086)', () => {
  it('B1 — an entry declaration missing two exports: the baseline keeps every live export', () => {
    const src: SrcModel = {
      entries: {
        'meta-spelling': {
          own: ['META_URL_TO_SINGULAR', 'PLURAL_TO_SINGULAR', 'SINGULAR_TO_PLURAL',
            'canonicalMetaUrlType', 'metaUrlSpellingRefusal', 'pluralToSingular',
            'singularToPlural', 'unrecognisedMetaTypeRefusal'],
          chunks: [],
        },
      },
      chunks: {},
    };
    const w = makeWorld({ src, distStale: false });

    // B1: the two names leave the entry's export statement, as measured.
    writeFileSync(
      path.join(w.root, 'dist', 'meta-spelling', 'index.d.ts'),
      'export { META_URL_TO_SINGULAR, PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL, ' +
        'canonicalMetaUrlType, metaUrlSpellingRefusal, pluralToSingular };\n// re-exports: \n',
    );
    // LIT CONTROL — the fixture really is damaged, so a green below is a verdict.
    expect(surfaceFromDist(w.root)['meta-spelling']).not.toContain('singularToPlural');
    expect(readBaseline(w.root)['meta-spelling']).toContain('singularToPlural');

    const code = checkGenerated(['--fix'], SCRIPTS, w.io);

    // THE HARM, asserted first so a regression names the deleted exports rather
    // than the missing call: without the forced build this baseline loses them.
    expect(readBaseline(w.root)['meta-spelling']).toContain('singularToPlural');
    expect(readBaseline(w.root)['meta-spelling']).toContain('unrecognisedMetaTypeRefusal');
    expect(readBaseline(w.root)['meta-spelling']).toHaveLength(8);
    // THE MECHANISM: the build ran first, and every gate saw the dist it emitted.
    expect(w.calls[0]).toBe('build');
    expect(w.calls.indexOf('build')).toBeLessThan(w.calls.indexOf('check:api-surface'));
    expect(code).toBe(0);
    rmSync(w.root, { recursive: true, force: true });
  });

  it('E1 — two of the emitted chunk declarations absent: the baseline keeps all 64 chunk exports', () => {
    const chunks: Record<number, string[]> = {};
    for (let i = 0; i < 46; i++) chunks[i] = [`chunkExport${i}a`, `chunkExport${i}b`];
    const src: SrcModel = {
      entries: { root: { own: ['defineStack', 'defineView'], chunks: Object.keys(chunks).map(Number) } },
      chunks,
    };
    const w = makeWorld({ src, distStale: false });

    // E1: two chunk declarations vanish — an unfinished declaration pass. Every
    // DECLARED entry file is still present, which is why the build's own
    // 34/34 emission check would still pass over this tree.
    const gone = [3, 17];
    // 64 names is the measured scale of the real case; this fixture removes
    // exactly as many names as the two chunks carry, and asserts that number.
    for (const id of gone) rmSync(path.join(w.root, 'dist', `chunk-${id}.d.ts`));

    // LIT CONTROL — the surface really lost the chunks' names.
    const damaged = surfaceFromDist(w.root).root;
    const full = readBaseline(w.root).root;
    expect(full.length - damaged.length).toBe(gone.length * 2);
    expect(damaged).not.toContain('chunkExport3a');

    const code = checkGenerated(['--fix'], SCRIPTS, w.io);

    // THE HARM first, for the same reason as B1 above.
    expect(readBaseline(w.root).root).toContain('chunkExport3a');
    expect(readBaseline(w.root).root).toContain('chunkExport17b');
    expect(readBaseline(w.root).root).toHaveLength(full.length);
    // THE MECHANISM.
    expect(w.calls[0]).toBe('build');
    expect(w.calls.indexOf('build')).toBeLessThan(w.calls.indexOf('check:api-surface'));
    expect(code).toBe(0);
    rmSync(w.root, { recursive: true, force: true });
  });

  it('the up-to-date line names the dist it measured against, and whether this run built it', () => {
    const src: SrcModel = { entries: { root: { own: ['defineStack'], chunks: [0] } }, chunks: { 0: ['Field'] } };

    const readOnly = makeWorld({ src });
    expect(checkGenerated([], SCRIPTS, readOnly.io)).toBe(0);
    const readOnlyText = readOnly.out.join('\n');
    expect(readOnlyText).toContain('generated artifacts are up to date');
    expect(readOnlyText).toContain(path.join(readOnly.root, 'dist'));
    expect(readOnlyText).toContain('AS FOUND ON DISK — this run did not build it');
    expect(readOnlyText).toContain('declaration stamp');
    expect(readOnlyText).toContain('check:api-surface');   // names WHO reads that dist
    expect(readOnly.calls).not.toContain('build');          // §4: the read-only path never builds
    rmSync(readOnly.root, { recursive: true, force: true });

    const fixed = makeWorld({ src });
    expect(checkGenerated(['--fix'], SCRIPTS, fixed.io)).toBe(0);
    const fixedText = fixed.out.join('\n');
    expect(fixedText).toContain('generated artifacts are up to date');
    expect(fixedText).toContain('BUILT BY THIS RUN');
    expect(fixedText).not.toContain('AS FOUND ON DISK');
    rmSync(fixed.root, { recursive: true, force: true });
  });

  it('--fix re-runs each gate it wrote for, and reds when the write did not satisfy it', () => {
    const src: SrcModel = { entries: { root: { own: ['defineStack'], chunks: [] } }, chunks: {} };
    // `check:liveness` is the live shape: its generator repairs the arithmetic
    // half only, and the other half is a ledger edit no `gen:` can make.
    const w = makeWorld({
      src,
      failing: new Set(['check:liveness']),
      unfixable: new Set(['check:liveness']),
    });

    const code = checkGenerated(['--fix'], SCRIPTS, w.io);

    const genAt = w.calls.indexOf('gen:liveness-counts');
    expect(genAt).toBeGreaterThan(-1);
    // The gate is asked AGAIN, after the write — the write is not its own witness.
    expect(w.calls.slice(genAt + 1)).toContain('check:liveness');
    expect(w.out.join('\n')).toContain('a write is not its own witness');
    expect(code).toBe(1);
    rmSync(w.root, { recursive: true, force: true });
  });

  it('a gate the generator DOES satisfy passes its re-check and the run exits 0', () => {
    const src: SrcModel = { entries: { root: { own: ['defineStack'], chunks: [] } }, chunks: {} };
    const w = makeWorld({ src, failing: new Set(['check:spec-changes']) });

    const code = checkGenerated(['--fix'], SCRIPTS, w.io);

    const genAt = w.calls.indexOf('gen:spec-changes');
    expect(w.calls.slice(genAt + 1)).toContain('check:spec-changes');
    expect(code).toBe(0);
    rmSync(w.root, { recursive: true, force: true });
  });

  it('a forced build that FAILS writes nothing at all', () => {
    const src: SrcModel = { entries: { root: { own: ['defineStack'], chunks: [] } }, chunks: {} };
    const w = makeWorld({ src, buildFails: true, failing: new Set(['check:api-surface']) });

    const code = checkGenerated(['--fix'], SCRIPTS, w.io);

    expect(code).toBe(1);
    expect(w.calls).toEqual(['build']);                      // no gate, no generator
    expect(w.calls.filter((c) => c.startsWith('gen:'))).toHaveLength(0);
    expect(w.out.join('\n')).toContain('NOTHING was written');
    rmSync(w.root, { recursive: true, force: true });
  });
});
