// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The listing this package publishes as: `objectstack.manifest.json` parses
 * against the spec's own schema for that file, names the same package id as
 * the stack, points at a README that exists and at the icon the package owns
 * (a public http(s) `iconUrl`), and that README's credentials
 * section names every credential the app's connectors reference — the
 * marketplace handbook's "every credential it needs" rule, checked against
 * the metadata rather than trusted.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TemplateManifestSchema } from '@objectstack/spec/marketplace';
import stack from '../objectstack.config.js';

const manifestPath = fileURLToPath(new URL('../objectstack.manifest.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;

/** Where the listing icon is served from once this package's tree is on `main`. */
const ICON_URL = 'https://raw.githubusercontent.com/objectstack-ai/objectstack/main/packages/apps/connector-github/assets/icon.svg';

/**
 * Why a manifest's `iconUrl` cannot be the listing icon, or `null` when it can:
 * `os package publish` sends the key as the package's `icon_url`, and the
 * marketplace handbook asks for a public http(s) URL. `TemplateManifestSchema`
 * accepts any URL scheme, so the scheme is checked here.
 */
function iconUrlProblem(m: Record<string, unknown>): string | null {
  const value = m.iconUrl;
  if (typeof value !== 'string') return 'iconUrl is absent';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `iconUrl is not a URL: ${value}`;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? null : `iconUrl is not http(s): ${value}`;
}

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

  it('carries a public http(s) iconUrl', () => {
    expect(iconUrlProblem(manifest)).toBeNull();
  });

  it('refuses an iconUrl that is absent or not http(s)', () => {
    const withoutIcon = { ...manifest };
    delete withoutIcon.iconUrl;
    expect(iconUrlProblem(withoutIcon)).toBe('iconUrl is absent');
    expect(iconUrlProblem({ ...manifest, iconUrl: 'ftp://example.com/icon.svg' })).toMatch(/not http\(s\)/);
    expect(iconUrlProblem({ ...manifest, iconUrl: 'assets/icon.svg' })).toMatch(/not a URL/);
  });

  it('points iconUrl at the icon this package owns', () => {
    expect(manifest.iconUrl).toBe(ICON_URL);
    const iconPath = fileURLToPath(new URL('../assets/icon.svg', import.meta.url));
    expect(existsSync(iconPath)).toBe(true);
    // `--icon-file` takes up to 256 KB; hold the owned asset to the same bound.
    expect(statSync(iconPath).size).toBeLessThan(256 * 1024);
    expect(readFileSync(iconPath, 'utf8')).toMatch(/^<svg [^>]*viewBox="0 0 256 256"/);
  });

  it('carries no secret in metadata', () => {
    for (const c of stack.connectors ?? []) {
      expect(c).not.toHaveProperty('authentication.token');
      expect(JSON.stringify(c)).not.toMatch(/ghp_|github_pat_/);
    }
  });
});
