// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `build-migration-registry.ts` has TWO kinds of caller now, and its entry guard
// is the only thing telling them apart:
//
//   - pnpm RUNS it (`gen:migration-registry`, on install, in `build`, before
//     `typecheck` and `test`), and every run rewrites `src/migrations/registry.ts`
//     from the template and the entries;
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
import { KINDS, TEMPLATE_PATH } from './build-migration-registry';
import { PROTOCOL_MAJOR } from '../src/kernel/protocol-version';

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
    // A run would have printed its self-test line and then `✓ wrote
    // src/migrations/registry.ts (…)` or `✓ … is current` — any line beyond the
    // probe's own is the defect.
    expect(r.stdout).toBe('17.data__AggregationNode__distinct.ts\n');
    expect(r.stderr).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Every major an entry can register under has a region in the template.
//
// `build-schemas.ts` prescribes every new retired-key / retired-def entry under
// the SPEC PACKAGE's major (`CURRENT_MAJOR`, parsed from its version), and an
// author opening a protocol move registers semantic entries under
// `PROTOCOL_VERSION`'s major. The generator refuses an entry whose major has no
// marked region — correctly, since the alternative is a silent drop — so a
// template that trails either major only reds once something registers there.
// On `main` that is never: the package version moves only on the Version PR,
// so the gap surfaced as a required check failing on the release tree. This
// pins the regions on every tree instead, for both majors, each kind.
// ---------------------------------------------------------------------------

describe('registry.ts.template — a region for each major an entry can register under', () => {
  const template = fs.readFileSync(path.join(PKG, TEMPLATE_PATH), 'utf8');
  const specVersion: string = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
  const specMajor = Number.parseInt(specVersion, 10);
  const majors = [...new Set([specMajor, PROTOCOL_MAJOR])].sort((a, b) => a - b);

  it('reads two real majors', () => {
    expect(Number.isInteger(specMajor) && specMajor > 0, `spec version ${specVersion}`).toBe(true);
    expect(Number.isInteger(PROTOCOL_MAJOR) && PROTOCOL_MAJOR > 0).toBe(true);
  });

  it.each(majors.flatMap((major) => KINDS.map(({ kind }) => [kind, major] as const)))(
    'opens and closes `%s:%i`',
    (kind, major) => {
      const lines = template.split('\n');
      const open = lines.indexOf(`    // <os-generated ${kind}:${major}>`);
      const close = lines.indexOf(`    // </os-generated ${kind}:${major}>`);
      expect(
        open,
        `${TEMPLATE_PATH} has no \`<os-generated ${kind}:${major}>\` region, but major ${major} is current ` +
          `(spec package ${specVersion}, PROTOCOL_VERSION major ${PROTOCOL_MAJOR}); an entry registered there ` +
          'is refused by gen:migration-registry. Open the region beside the previous major\'s.',
      ).toBeGreaterThanOrEqual(0);
      expect(close, `region \`${kind}:${major}\` is never closed`).toBeGreaterThan(open);
    },
  );
});
