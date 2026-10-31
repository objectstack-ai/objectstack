// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The listing this package publishes as: `objectstack.manifest.json` parses
 * against the spec's own schema for that file, names the same package id as
 * the stack, points at a README that exists, and that README's credentials
 * section names every credential the app's connectors reference — the
 * marketplace handbook's "every credential it needs" rule, checked against
 * the metadata rather than trusted.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TemplateManifestSchema } from '@objectstack/spec/marketplace';
import stack from '../objectstack.config.js';

const manifestPath = fileURLToPath(new URL('../objectstack.manifest.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;

/** The README's `## Credentials` section, up to the next second-level heading. */
function credentialsSection(readme: string): string {
  const start = readme.indexOf('\n## Credentials\n');
  expect(start, 'README has no "## Credentials" section').toBeGreaterThan(-1);
  const rest = readme.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('connector-github listing', () => {
  it('parses against TemplateManifestSchema', () => {
    const parsed = TemplateManifestSchema.safeParse(manifest);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('names the stack manifest id as its package id', () => {
    expect(manifest.manifestId).toBe(stack.manifest!.id);
  });

  it('declares no key the publisher ignores', () => {
    // The handbook: the platform decides `publisher` and `isStarter`; the CLI never sends them.
    expect(manifest).not.toHaveProperty('publisher');
    expect(manifest).not.toHaveProperty('isStarter');
  });

  it("the README's credentials section names every credentialRef and where to obtain it", () => {
    const readmePath = fileURLToPath(new URL(`../${String(manifest.readmePath)}`, import.meta.url));
    expect(existsSync(readmePath)).toBe(true);
    const section = credentialsSection(readFileSync(readmePath, 'utf8'));
    const refs = (stack.connectors ?? [])
      .map((c) => (c as { auth?: { credentialRef?: string } }).auth?.credentialRef)
      .filter((r): r is string => typeof r === 'string');
    expect(refs).toEqual(['GITHUB_MCP_TOKEN']);
    for (const ref of refs) expect(section).toContain(`\`${ref}\``);
    expect(section).toContain('https://github.com/settings/personal-access-tokens/new');
  });

  it('carries no secret in metadata', () => {
    for (const c of stack.connectors ?? []) {
      expect(c).not.toHaveProperty('authentication.token');
      expect(JSON.stringify(c)).not.toMatch(/ghp_|github_pat_/);
    }
  });
});
