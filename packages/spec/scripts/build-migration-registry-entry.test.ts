// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `build-migration-registry.ts` has TWO kinds of caller now, and its entry guard
// is the only thing telling them apart:
//
//   - pnpm RUNS it (`gen:migration-registry`, `check:migration-registry`), and
//     write mode rewrites `src/migrations/registry.ts`;
//   - `build-schemas.ts` IMPORTS it, for `shardNameFor` — so the entry file each
//     registration remedy names is the one name the generator accepts, read from
//     the rule `entries/README.md` documents instead of restated beside it.
//
// Both directions are pinned, because each one fails silently on its own. A
// guard that answered "imported" for a real run turns the CI gate into exit 0
// with no output; one that answered "run" for an import executes the generator
// inside every build of the schemas. Each probe is a real `tsx` process, the
// runner both callers use, so neither half is a model of the other.

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const TSX = path.join(PKG, 'node_modules', '.bin', 'tsx');
const GENERATOR = path.join(HERE, 'build-migration-registry.ts');
const SPAWN_TIMEOUT_MS = 60_000;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'build-migration-registry-entry-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function tsx(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(TSX, args, {
    cwd: PKG,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('build-migration-registry.ts — run, it speaks; import, it runs nothing', () => {
  it('a direct run still reaches the generator (its self-test answers)', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const r = tsx([GENERATOR, '--self-test']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('build-migration-registry --self-test: ok');
  });

  it('a run through a symlink still reaches it — node keeps argv[1] as typed', { timeout: SPAWN_TIMEOUT_MS }, () => {
    const link = path.join(scratch, 'linked-generator.ts');
    fs.symlinkSync(GENERATOR, link);
    const r = tsx([link, '--self-test']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('build-migration-registry --self-test: ok');
  });

  it('an import runs nothing: the importer prints exactly what it asked for', { timeout: SPAWN_TIMEOUT_MS }, () => {
    // The README's own example, so a reader can check the expectation by eye.
    const probe = path.join(scratch, 'import-probe.ts');
    fs.writeFileSync(
      probe,
      `import { shardNameFor } from ${JSON.stringify(GENERATOR)};\n` +
        `console.log(shardNameFor(17, 'data/AggregationNode:distinct'));\n`,
    );
    const r = tsx([probe]);
    expect(r.status, r.stderr).toBe(0);
    // Write mode would have printed `✓ wrote src/migrations/registry.ts (…)`, and
    // check mode `✓ … is current` — any line beyond the probe's own is the defect.
    expect(r.stdout).toBe('17.data__AggregationNode__distinct.ts\n');
    expect(r.stderr).toBe('');
  });
});
