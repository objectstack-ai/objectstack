// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins that `build-schemas.ts --check` — the script behind
// `check:authorable-surface`, one of the eight generated-artifact gates
// `check:generated` runs — reports and NEVER writes (#4711).
//
// The defect these tests exist for: the manifest ratchet had no `CHECK`
// discriminator at all. `--check` recomputed the emitted schema set and, on any
// addition, rewrote the tracked `json-schema.manifest.json` in place and exited
// 0. Two things follow, and both were observed:
//
//   1. A "check" edited the working tree. The developer's own manifest content
//      was overwritten by a command whose entire job is to look — which is how
//      `git stash pop` / worktree / merge-conflict work fails for a reason
//      nobody traces back to a gate.
//   2. The additions branch could never go red in CI. Seven of the eight
//      generated artifacts mean "stale ⇒ fail, run the generator"; this one
//      meant "stale ⇒ I'll write it for you", inside the same `check:generated`
//      summary. A gate that repairs what it is meant to detect reports success
//      forever.
//
// So the assertions here are deliberately about the SIDE EFFECT and the EXIT
// CODE, not about the diff arithmetic (which was always correct): every check
// case compares the manifest bytes before and after the run.
//
// ── Why a sandbox rather than the real package ────────────────────────────
// The script resolves every path from its own `__dirname`, so running it in
// place would mutate the repo's tracked `json-schema.manifest.json` — and under
// `turbo run test` a `pnpm --filter @objectstack/spec build` (whose first step
// is `gen:schema`) can be writing that very file concurrently, which would make
// these tests both destructive and flaky. Instead each run happens in a temp
// tree that COPIES `scripts/` (so `__dirname` lands there) and symlinks the
// read-only inputs — `src/`, `node_modules/`, `package.json`. That keeps the
// production code path byte-for-byte: no test-only seam is added to the gate,
// because a seam is itself a place where the gate can differ from what CI runs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RENAMED_DEFS } from './lib/renamed-defs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const TSX = path.join(PKG, 'node_modules', '.bin', 'tsx');
const REAL_MANIFEST = path.join(PKG, 'json-schema.manifest.json');

/**
 * Every run loads the entire spec surface and emits ~1700 JSON Schemas (~7s
 * alone, more under turbo's parallel test load). A timeout here should mean
 * "the script hung", not "the runner was busy" — cf. the same note in
 * check-react-blocks-declaration-parity.test.ts.
 */
const SPAWN_TIMEOUT_MS = 180_000;

/** A schema key the committed manifest carries; dropping it fakes "one addition pending". */
const KNOWN_KEY = 'ui/View';
/** A key no build can emit — the `missing` (disappearance) ratchet's input. */
const PHANTOM_KEY = 'ui/ZzzNeverEmittedByAnyBuild';

let sandbox: string;
let script: string;
let manifestPath: string;
let pristine: string;

beforeAll(() => {
  pristine = fs.readFileSync(REAL_MANIFEST, 'utf8');
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'build-schemas-check-'));
  fs.cpSync(path.join(PKG, 'scripts'), path.join(sandbox, 'scripts'), { recursive: true });
  for (const entry of ['src', 'node_modules', 'package.json']) {
    fs.symlinkSync(path.join(PKG, entry), path.join(sandbox, entry));
  }
  // The authorable-surface ratchet runs after the manifest one; give it the
  // committed snapshot so a check that gets that far judges the same contract.
  fs.copyFileSync(
    path.join(PKG, 'authorable-surface.json'),
    path.join(sandbox, 'authorable-surface.json'),
  );
  script = path.join(sandbox, 'scripts', 'build-schemas.ts');
  manifestPath = path.join(sandbox, 'json-schema.manifest.json');
});

afterAll(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

function run(args: string[] = []): { status: number; output: string } {
  const r = spawnSync(TSX, [script, ...args], {
    cwd: sandbox,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Seed the sandbox manifest from the committed one; returns the exact bytes written. */
function seedManifest(mutate: (schemas: string[]) => string[]): string {
  const doc = JSON.parse(pristine) as { description?: string; schemas: string[] };
  doc.schemas = mutate(doc.schemas);
  const text = JSON.stringify(doc, null, 2) + '\n';
  fs.writeFileSync(manifestPath, text);
  return text;
}

const readManifest = () => fs.readFileSync(manifestPath, 'utf8');

describe('build-schemas.ts --check — a check reports, it does not write (#4711)', () => {
  it(
    'fails on a manifest behind on additions, and leaves the file byte-identical',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      expect(JSON.parse(pristine).schemas).toContain(KNOWN_KEY);
      const stale = seedManifest((s) => s.filter((k) => k !== KNOWN_KEY));

      const { status, output } = run(['--check']);

      // The exit code is half the fix: before #4711 this branch exited 0.
      expect(status).toBe(1);
      expect(output).toMatch(/json-schema\.manifest\.json is out of date \(1 schema\(s\) not recorded\)/);
      expect(output).toContain(`+ json-schema/${KNOWN_KEY}.json`);
      // The remedy must be the generator, exactly as the other seven artifacts say.
      expect(output).toMatch(/gen:schema/);
      // …and the file is the other half: not rewritten, not touched.
      expect(readManifest()).toBe(stale);
      expect(output).not.toContain('📒');
    },
  );

  it(
    'fails on a manifest still listing a def RENAMED_DEFS moved away, without writing it',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The other half of the same condition, and the half that has no other
      // reporter: a renamed-away source key is deliberately NOT "missing" (the
      // disappearance ratchet excludes it, since the def is published under the
      // new name), so before #4711 the only thing that ever noticed it was the
      // silent rewrite. #4684 / #4703 both depend on that key actually leaving
      // the manifest.
      const [renamedSource] = Object.keys(RENAMED_DEFS);
      // Loud on purpose: an empty table makes this branch dead code, which is a
      // decision (delete the branch, or the test) — not something to skip past.
      expect(renamedSource, 'RENAMED_DEFS is empty — this test exercises nothing').toBeTruthy();
      const withStaleRename = seedManifest((s) => [...s, renamedSource].sort());

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(
        /json-schema\.manifest\.json is out of date .*1 renamed-away key\(s\) still listed/,
      );
      expect(output).toContain(`- json-schema/${renamedSource}.json  (renamed away)`);
      expect(readManifest()).toBe(withStaleRename);
    },
  );

  it(
    'keeps the disappearance ratchet intact: a schema in the manifest that no build emits still exits 1',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const withPhantom = seedManifest((s) => [...s, PHANTOM_KEY].sort());

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(/1 previously published schema\(s\) disappeared from this build/);
      expect(output).toContain(`- json-schema/${PHANTOM_KEY}.json`);
      expect(readManifest()).toBe(withPhantom);
    },
  );

  it(
    'still writes the manifest outside --check, so gen:schema keeps recording additions',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const stale = seedManifest((s) => s.filter((k) => k !== KNOWN_KEY));

      const { status, output } = run([]);

      expect(status).toBe(0);
      expect(output).toContain('📒 json-schema.manifest.json updated (+1 schema(s))');
      expect(readManifest()).not.toBe(stale);
      expect(JSON.parse(readManifest()).schemas).toContain(KNOWN_KEY);
    },
  );

  it(
    'is silent about the manifest when it is up to date — the new failure is staleness, not --check itself',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Negative control. Without it, "always exit 1 in check mode" would pass
      // every assertion above while breaking the gate for everyone.
      // NOTE: this asserts status 0, so it also re-proves that the COMMITTED
      // manifest and authorable-surface snapshots are current — the same thing
      // `check:authorable-surface` asserts in CI. If it fails here, run
      // `pnpm --filter @objectstack/spec gen:schema` and commit the result.
      const current = seedManifest((s) => s);

      const { status, output } = run(['--check']);

      expect(output).not.toMatch(/json-schema\.manifest\.json is out of date/);
      expect(output).not.toContain('📒');
      expect(readManifest()).toBe(current);
      expect(status).toBe(0);
    },
  );
});
