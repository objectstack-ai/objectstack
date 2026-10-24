/**
 * `scripts/check-ui-root-lookups.mjs` -- no marker-based repo-root lookup
 * outside `scripts/ui-root.mjs` (objectstack ruling D1: under `ui/` such a
 * lookup finds the objectstack root). The detector's own cases live in its
 * `--self-test`; this file pins that they hold, that the live tree is clean,
 * that the allowlist is a ledger (stale entries red), and that the gate is
 * reachable as a root script.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALLOWLIST, HELPER, SELF, lookupsIn, scan, selfTest } from '../check-ui-root-lookups.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('check-ui-root-lookups (objectstack ruling D1)', () => {
  it('passes its own self-test, and the self-test is not empty in either direction', () => {
    const cases = selfTest();
    expect(cases.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`)).toEqual([]);
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it('reads the call target, not the spelling', () => {
    const fires = lookupsIn('x.ts', "import { existsSync } from 'node:fs';\nlet d = __dirname;\nwhile (!existsSync(`${d}/pnpm-workspace.yaml`)) d = d.slice(0, -1);");
    expect(fires.map((h) => h.shape)).toEqual(['marker-probe']);
    const silent = lookupsIn('x.ts', "import { readFileSync } from 'node:fs';\nconst globs = readFileSync(`${root}/pnpm-workspace.yaml`, 'utf8');");
    expect(silent).toEqual([]);
  });

  it('finds no lookup outside the helper in this tree, and every allowlist entry is live', () => {
    const result = scan(repoRoot);
    expect(result.scanned).toBeGreaterThan(100);
    expect(result.hits.filter((h) => h.allowed === null).map((h) => `${h.file}:${h.line} ${h.text}`)).toEqual([]);
    expect(result.stale).toEqual([]);
    // The two files the scan skips exist and are the only ones it skips.
    expect([HELPER, SELF]).toEqual(['scripts/ui-root.mjs', 'scripts/check-ui-root-lookups.mjs']);
  });

  it('reds on a planted lookup and on a stale allowlist entry, from a fixture tree', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ui-root-lookups-'));
    try {
      mkdirSync(path.join(root, 'scripts'), { recursive: true });
      writeFileSync(path.join(root, 'scripts/ok.mjs'), "import { uiRoot } from './ui-root.mjs';\nexport const x = uiRoot();\n");
      const clean = scan(root);
      expect(clean.scanned).toBe(1);
      expect(clean.hits).toEqual([]);
      // Every allowlist path is absent from this tree, so every entry reads stale here.
      expect(clean.stale.sort()).toEqual([...ALLOWLIST.keys()].sort());

      writeFileSync(
        path.join(root, 'scripts/walk.mjs'),
        "import { existsSync } from 'node:fs';\nimport { dirname, join } from 'node:path';\nlet dir = process.cwd();\nwhile (!existsSync(join(dir, '.git'))) dir = dirname(dir);\n",
      );
      const planted = scan(root);
      expect(planted.hits.map((h) => [h.file, h.shape, h.allowed])).toEqual([['scripts/walk.mjs', 'marker-probe', null]]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits 0 on this tree through the CLI and is wired as `check:ui-root-lookups`', () => {
    const scripts = (JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['check:ui-root-lookups']).toBe('node scripts/check-ui-root-lookups.mjs');
    const run = spawnSync(process.execPath, [path.join(repoRoot, SELF)], { cwd: repoRoot, encoding: 'utf8' });
    expect(run.stdout).toContain('check-ui-root-lookups: OK');
    expect(run.status).toBe(0);
  });
});
