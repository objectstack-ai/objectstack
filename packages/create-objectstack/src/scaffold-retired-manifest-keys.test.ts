// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The scaffolder strips every `objectstack.manifest.json` key that
// @objectstack/spec 18 retired (`category` #30980, five more #31035), so a
// template authored before that release never hands a new project a manifest
// the schema refuses (or, for `category` and `visibility`, one
// `os package publish` refuses). The restated list is pinned equal to the
// spec's own registry rows, and the call site in index.ts is pinned to use it
// (index.ts runs `program.parse()` on import, so `rewriteProjectIdentity`
// cannot be called from a test; the bundled template no longer carries any
// retired key, so an end-to-end scaffold cannot reach the strip either).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TemplateManifestSchema } from '@objectstack/spec/marketplace';
import { RETIRED_KEYS_BY_MAJOR } from '@objectstack/spec/migrations';
import { RETIRED_TEMPLATE_MANIFEST_KEYS, stripRetiredManifestKeys } from './rewrite-identity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX_TS = path.join(HERE, 'index.ts');

/** A manifest as the blank template wrote it before #31035, plus `category` and `visibility`. */
const PRE_18_MANIFEST = () => ({
  category: 'crm',
  name: 'blank',
  namespace: 'blank',
  displayName: 'Blank Starter',
  specVersion: '^18.0.0',
  isStarter: true,
  readmePath: 'README.md',
  skills: ['objectstack-platform'],
  scaffold: { variables: { appName: { type: 'string' } } },
  visibility: 'marketplace',
});

describe('RETIRED_TEMPLATE_MANIFEST_KEYS', () => {
  it('is exactly the spec registry rows for TemplateManifest', () => {
    const PREFIX = 'marketplace/TemplateManifest:';
    const fromSpec = Object.values(RETIRED_KEYS_BY_MAJOR)
      .flat()
      .filter((entry) => entry.startsWith(PREFIX))
      .map((entry) => entry.slice(PREFIX.length));
    expect([...RETIRED_TEMPLATE_MANIFEST_KEYS].sort()).toEqual([...new Set(fromSpec)].sort());
  });

  it('names only keys the schema refuses', () => {
    for (const key of RETIRED_TEMPLATE_MANIFEST_KEYS) {
      expect(TemplateManifestSchema.safeParse({ [key]: 'x' }).success, key).toBe(false);
    }
  });
});

describe('stripRetiredManifestKeys', () => {
  it('turns a pre-18 manifest into one the schema accepts, touching nothing else', () => {
    const m: Record<string, unknown> = PRE_18_MANIFEST();
    expect(TemplateManifestSchema.safeParse(m).success).toBe(false);
    expect(stripRetiredManifestKeys(m)).toEqual([...RETIRED_TEMPLATE_MANIFEST_KEYS]);
    expect(m).toEqual({
      namespace: 'blank',
      displayName: 'Blank Starter',
      isStarter: true,
      readmePath: 'README.md',
    });
    expect(TemplateManifestSchema.safeParse(m).success).toBe(true);
  });

  it('is a no-op on a manifest that carries none of them', () => {
    const m: Record<string, unknown> = { displayName: 'Blank Starter', namespace: 'blank' };
    expect(stripRetiredManifestKeys(m)).toEqual([]);
    expect(m).toEqual({ displayName: 'Blank Starter', namespace: 'blank' });
  });
});

describe('rewriteProjectIdentity wiring', () => {
  it('strips the retired keys from the scaffolded manifest, not only `name`', () => {
    const src = fs.readFileSync(INDEX_TS, 'utf8');
    const start = src.indexOf("path.join(targetDir, 'objectstack.manifest.json')");
    expect(start, 'the manifest rewrite block').toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('writeFileSync(manifestPath', start));
    expect(block).toContain('stripRetiredManifestKeys(m);');
    expect(block).not.toMatch(/delete m\.name\b/);
  });
});
