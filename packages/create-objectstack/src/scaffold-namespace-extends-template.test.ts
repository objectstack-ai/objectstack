// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// A project whose namespace BEGINS with the template's own namespace plus `_`
// (`blank-probe` → `blank_probe` under the `blank` template) must scaffold.
// The scaffolder's stale-prefix self-check once tested each rewritten object
// name against the template prefix alone; `blank_probe_note` carries `blank_`,
// so a correct rewrite was refused with "This is a bug in the scaffolder".
//
// Drives the real CLI end to end via `tsx` — index.ts calls `program.parse()`
// on import, so `rewriteProjectIdentity` cannot be called directly (the same
// constraint and pattern as scaffold-description.test.ts). One case per
// bundled template, each probe named after THAT template's own namespace, so a
// second template is covered the day it is registered.

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateObjectNamespacePrefix } from '@objectstack/spec/kernel';
import { TEMPLATES } from './template-registry.js';
import { readTemplateNamespace } from './rewrite-identity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const INDEX_TS = path.join(PKG_ROOT, 'src', 'index.ts');

/** Every `name: '…'` literal in the `*.ts` files under `dir`. */
function nameLiterals(dir: string): string[] {
  const names: string[] = [];
  for (const rel of fs.readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!rel.endsWith('.ts')) continue;
    const text = fs.readFileSync(path.join(dir, rel), 'utf8');
    for (const m of text.matchAll(/\bname:\s*(['"`])([a-z0-9_]+)\1/g)) names.push(m[2]);
  }
  return names.sort();
}

let tmp: string | undefined;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('a project namespace that extends the template namespace', () => {
  it.each(
    Object.entries(TEMPLATES).map(([template, info]) => {
      const ns = readTemplateNamespace(path.join(HERE, 'templates', info.source.dir));
      if (!ns) throw new Error(`bundled template '${template}' declares no namespace`);
      return [template, ns, `${ns.replace(/_/g, '-')}-probe`, info.source.dir] as const;
    }),
  )('%s (namespace %s): `%s` scaffolds, every object moved under the new namespace', (template, ns, project, dir) => {
    const templateNames = nameLiterals(path.join(HERE, 'templates', dir, 'src')).filter(
      (n) => n.startsWith(`${ns}_`),
    );
    // Precondition: the template really ships prefixed names, or nothing is pinned.
    expect(templateNames.length).toBeGreaterThan(0);

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-ns-extends-'));
    const run = spawnSync(
      TSX,
      [INDEX_TS, project, '--template', template, '--skip-install', '--skip-skills'],
      { cwd: tmp, encoding: 'utf8' },
    );
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);

    const projectDir = path.join(tmp, project);
    const newNs = `${ns}_probe`;
    expect(readTemplateNamespace(projectDir)).toBe(newNs);

    const scaffolded = nameLiterals(path.join(projectDir, 'src')).filter((n) =>
      n.startsWith(`${ns}_`),
    );
    expect(scaffolded).toEqual(
      templateNames.map((n) => `${newNs}_${n.slice(ns.length + 1)}`).sort(),
    );
    for (const name of scaffolded) {
      expect(validateObjectNamespacePrefix(name, newNs), name).toBeNull();
    }
  }, 30_000);
});
