// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// A scaffold's namespace has a paired customization namespace, so the first
// `os validate` on a fresh project prints no `namespace-no-customization-pair`
// warning about objects its author never wrote.
//
// The rule (ADR-0146 D3, `@objectstack/lint`'s `validateCustomizationNamespace`)
// warns when `customizationNamespace(manifest.namespace)` answers
// `base_namespace_too_long`. The verdict here is that same helper's, read from
// the spec, so the scaffold is judged by the function the ensure door creates
// the pair with, never by a number restated in this file.
//
// Drives the real CLI end to end via `tsx`: index.ts calls `program.parse()` on
// import (the pattern of scaffold-namespace-extends-template.test.ts).

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customizationNamespace, validateObjectNamespacePrefix } from '@objectstack/spec/kernel';
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

describe('a scaffold from a long project name', () => {
  it('`qa-console-first-paint` gets a namespace with a customization pair, and every object follows it', () => {
    const project = 'qa-console-first-paint';
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-ns-pair-'));
    const run = spawnSync(TSX, [INDEX_TS, project, '--skip-install', '--skip-skills'], {
      cwd: tmp,
      encoding: 'utf8',
    });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);

    const projectDir = path.join(tmp, project);
    const namespace = readTemplateNamespace(projectDir);
    expect(namespace).toBe('qa_console_fi');
    expect(customizationNamespace(namespace)).toEqual({ ok: true, value: 'qa_console_fi_custom' });

    // The config's `namespace:` literal is the same value the manifest carries.
    const config = fs.readFileSync(path.join(projectDir, 'objectstack.config.ts'), 'utf8');
    expect(/\bnamespace:\s*'([^']+)'/.exec(config)?.[1]).toBe(namespace);

    // Every object the scaffold ships sits under the shortened namespace.
    const objects = nameLiterals(path.join(projectDir, 'src')).filter((n) => /_/.test(n));
    expect(objects.length).toBeGreaterThan(0);
    for (const name of objects.filter((n) => n.startsWith('qa_'))) {
      expect(validateObjectNamespacePrefix(name, namespace as string), name).toBeNull();
    }
    expect(objects.some((n) => n.startsWith(`${namespace}_`))).toBe(true);
  }, 30_000);
});
