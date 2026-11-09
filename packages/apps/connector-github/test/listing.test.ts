// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The listing this package publishes as: `objectstack.manifest.json` parses
 * against the spec's own schema for that file, names the same package id as
 * the stack, points at a README that exists and at the icon the package owns
 * (a public http(s) `iconUrl`), and that README's credentials
 * section names every credential the app's connectors reference — the
 * marketplace handbook's "every credential it needs" rule, checked against
 * the metadata rather than trusted.
 *
 * The second block holds the connector's tool pins (ruling 6556740185, letter
 * B): every tool `include` lists carries a `toolsSnapshot` pin of 64 lowercase
 * hex characters, each pin is the digest `computeMcpToolsSnapshot` takes of
 * the tool definitions measured from GitHub's server (the fixture beside this
 * file, so no call leaves the process), and the README's Provenance section
 * records the server URL, the pins and the pin-set digest the listing carries.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { explainSolutionTypeContradiction, TemplateManifestSchema } from '@objectstack/spec/marketplace';
import { resolveInstallModes } from '@objectstack/spec/kernel';
import { computeMcpToolsSnapshot, type McpToolDescriptor } from '@objectstack/connector-mcp';
import stack from '../objectstack.config.js';
import { GitHubMcpConnector } from '../src/connectors/github.connector.js';

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

  it('is listed as a connector, and the stack declares the connector that makes it one', () => {
    // `os package publish` runs the same check against the built artifact and
    // refuses a `connector` that declares none.
    expect(manifest.solutionType).toBe('connector');
    expect(explainSolutionTypeContradiction('connector', {
      installModes: resolveInstallModes(stack.manifest),
      connectorCount: (stack.connectors ?? []).length,
    })).toBeUndefined();
  });

  it('declares no key the publisher ignores', () => {
    // Retired from the file: the platform decides `publisher` and `isStarter`, and the schema refuses both.
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

/** The `providerConfig` keys this block reads. */
interface PinnedConfig {
  transport?: { url?: string };
  include?: readonly string[];
  toolsSnapshot?: Record<string, unknown>;
}

/** A pin as `mcpToolDigest` writes it, and as the `mcp` provider accepts it. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * What is wrong with an MCP connector's pins, one line per fault, or `[]`:
 * an included tool with no pin, a pin that is not 64 lowercase hex, or a pin
 * on a tool `include` leaves out (the provider refuses that one at boot,
 * since the instance never exposes the tool and its pin is never checked).
 */
function pinProblems(config: PinnedConfig): string[] {
  const include = config.include ?? [];
  const pins = config.toolsSnapshot ?? {};
  const problems: string[] = [];
  for (const tool of include) {
    if (!Object.hasOwn(pins, tool)) problems.push(`${tool}: no pin`);
    else if (typeof pins[tool] !== 'string' || !SHA256_HEX.test(pins[tool] as string)) {
      problems.push(`${tool}: pin is not 64 lowercase hex`);
    }
  }
  for (const tool of Object.keys(pins)) {
    if (!include.includes(tool)) problems.push(`${tool}: pinned but not included`);
  }
  return problems;
}

/**
 * The listing's `sha256` for an MCP app: the pin set serialized with its keys
 * sorted (UTF-16 code-unit order) and no whitespace, which for a record of
 * strings is its RFC 8785 (JCS) form, then sha256 of the UTF-8 bytes,
 * lowercase hex. The README names this recipe for whoever recomputes it.
 */
function pinSetDigest(pins: Record<string, unknown>): string {
  const sorted = Object.keys(pins)
    .sort()
    .map((key) => [key, pins[key]] as const);
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(sorted)), 'utf8').digest('hex');
}

/** The README section under `## <title>`, up to the next second-level heading. */
function readmeSection(title: string): string {
  const readmePath = fileURLToPath(new URL(`../${String(manifest.readmePath)}`, import.meta.url));
  const readme = readFileSync(readmePath, 'utf8');
  const start = readme.indexOf(`\n## ${title}\n`);
  expect(start, `README has no "## ${title}" section`).toBeGreaterThan(-1);
  const rest = readme.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The tool definitions measured from GitHub's server, as the measurement printed them. */
const measured = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/github-mcp-tools.json', import.meta.url)), 'utf8'),
) as { url: string; toolsSnapshot: Record<string, string>; tools: McpToolDescriptor[] };

describe('connector-github tool pins', () => {
  const config = GitHubMcpConnector.providerConfig as PinnedConfig;

  it('pins every included tool with 64 lowercase hex characters', () => {
    expect(config.include).toEqual(['search_issues', 'issue_read']);
    expect(pinProblems(config)).toEqual([]);
  });

  it('refuses a dropped pin, a malformed pin and a pin on a tool not included', () => {
    const pins = config.toolsSnapshot!;
    const dropped = { ...pins };
    delete dropped.issue_read;
    expect(pinProblems({ ...config, toolsSnapshot: dropped })).toEqual(['issue_read: no pin']);
    expect(pinProblems({ ...config, toolsSnapshot: undefined })).toEqual([
      'search_issues: no pin',
      'issue_read: no pin',
    ]);
    const upper = { ...pins, search_issues: String(pins.search_issues).toUpperCase() };
    expect(pinProblems({ ...config, toolsSnapshot: upper })).toEqual(['search_issues: pin is not 64 lowercase hex']);
    const short = { ...pins, issue_read: String(pins.issue_read).slice(1) };
    expect(pinProblems({ ...config, toolsSnapshot: short })).toEqual(['issue_read: pin is not 64 lowercase hex']);
    expect(pinProblems({ ...config, toolsSnapshot: { ...pins, issue_write: pins.issue_read } })).toEqual([
      'issue_write: pinned but not included',
    ]);
  });

  it('each pin is the digest of the tool definition measured from the server it dials', () => {
    expect(measured.url).toBe(config.transport?.url);
    expect(measured.tools.map((t) => t.name).sort()).toEqual([...config.include!].sort());
    expect(computeMcpToolsSnapshot(measured.tools)).toEqual(config.toolsSnapshot);
    expect(measured.toolsSnapshot).toEqual(config.toolsSnapshot);
  });

  it("the README's provenance records the server URL, every pin and the pin-set digest", () => {
    const provenance = readmeSection('Provenance');
    expect(provenance).toContain(`\`${config.transport!.url}\``);
    for (const [tool, pin] of Object.entries(config.toolsSnapshot!)) {
      expect(provenance).toMatch(new RegExp(`\`${tool}\`[^\\n]*\`${String(pin)}\``));
    }
    const recorded = provenance.match(/pin-set sha256\s+`([0-9a-f]{64})`/)?.[1];
    expect(recorded, 'README provenance records no pin-set sha256').toBeDefined();
    expect(pinSetDigest(config.toolsSnapshot!)).toBe(recorded);
  });
});
