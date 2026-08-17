// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Regression cover for #9263: `rewriteProjectIdentity` rewrote manifest.id /
// manifest.namespace / manifest.name (both in objectstack.config.ts and
// objectstack.manifest.json) but left `description` untouched, so every
// scaffolded project inherited the blank template's own line verbatim
// ("Minimal ObjectStack environment — a clean slate for building.") —
// confidently wrong on the first command the getting-started flow runs
// (`os validate`), not merely empty.
//
// `rewriteProjectIdentity` is not exported (and cannot be imported directly:
// index.ts calls `program.parse()` at module scope — see
// template-consistency.test.ts's comment on the same constraint), so this
// exercises the real CLI end to end via `tsx`, the same no-build pattern
// `packages/spec/scripts/dist-freshness.test.ts` uses to run a TS entrypoint
// as a subprocess without depending on a prior `pnpm build`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const INDEX_TS = path.join(PKG_ROOT, 'src', 'index.ts');

const TEMPLATE_DESCRIPTION_CONFIG =
  'Minimal ObjectStack environment — a clean slate for building.';
const TEMPLATE_DESCRIPTION_MANIFEST =
  'Minimal ObjectStack environment with a single object — a clean slate for building.';

let tmp: string;
let projectDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-desc-'));
  execFileSync(
    TSX,
    [INDEX_TS, 'support-desk', '--template', 'blank', '--skip-install', '--skip-skills'],
    { cwd: tmp, stdio: 'pipe' },
  );
  projectDir = path.join(tmp, 'support-desk');
}, 30_000);

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('scaffolded project description (#9263)', () => {
  it('does not carry the blank template\'s own description into objectstack.manifest.json', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectDir, 'objectstack.manifest.json'), 'utf8'),
    );
    expect(manifest.description).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(manifest, 'description')).toBe(false);
    // Sanity: prove this is a real assertion, not a check the template never
    // shipped the key in the first place.
    const templateManifest = JSON.parse(
      fs.readFileSync(
        path.join(PKG_ROOT, 'src', 'templates', 'blank', 'objectstack.manifest.json'),
        'utf8',
      ),
    );
    expect(templateManifest.description).toBe(TEMPLATE_DESCRIPTION_MANIFEST);
  });

  it('does not carry the blank template\'s own description into objectstack.config.ts', () => {
    const cfg = fs.readFileSync(path.join(projectDir, 'objectstack.config.ts'), 'utf8');
    expect(cfg).not.toContain('description:');
    expect(cfg).not.toContain(TEMPLATE_DESCRIPTION_CONFIG);
    // Sanity: the template source really does ship the line this asserts is gone.
    const templateConfig = fs.readFileSync(
      path.join(PKG_ROOT, 'src', 'templates', 'blank', 'objectstack.config.ts'),
      'utf8',
    );
    expect(templateConfig).toContain(`description: '${TEMPLATE_DESCRIPTION_CONFIG}'`);
  });

  it('still rewrites id/namespace/name — the description drop does not regress the existing rewrite', () => {
    const cfg = fs.readFileSync(path.join(projectDir, 'objectstack.config.ts'), 'utf8');
    expect(cfg).toContain("id: 'support-desk'");
    expect(cfg).toContain("namespace: 'support_desk'");
    expect(cfg).toContain("name: 'Support Desk'");
    // The line immediately after the (now-removed) description must still be
    // the `engines` comment/key — i.e. no stray blank line or dangling comma
    // was left behind by the line-removal regex.
    expect(cfg).toMatch(/name: 'Support Desk',\n\s*\/\/ Protocol compatibility range/);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectDir, 'objectstack.manifest.json'), 'utf8'),
    );
    expect(manifest.name).toBe('support-desk');
    expect(manifest.namespace).toBe('support_desk');
    expect(manifest.displayName).toBe('Support Desk');
  });

  it('produces objectstack.config.ts that still parses as valid TypeScript', () => {
    // A regex-based line removal is exactly the kind of edit that can silently
    // corrupt surrounding syntax (stray comma, unbalanced brace). Parse the
    // scaffolded file with the TypeScript compiler's single-file transpile
    // (syntactic-only — it never attempts to resolve `@objectstack/*`, so a
    // real syntax defect can't hide behind an unrelated "cannot find module").
    const source = fs.readFileSync(path.join(projectDir, 'objectstack.config.ts'), 'utf8');
    const { diagnostics } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    const messages = (diagnostics ?? []).map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    );
    expect(messages).toEqual([]);
  });
});
