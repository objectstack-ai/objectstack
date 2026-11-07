// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The listing this package publishes as, and the document it packages:
 * `objectstack.manifest.json` parses against the spec's own schema for that
 * file, names the same package id as the stack and points at the icon the
 * package owns (a public http(s) `iconUrl`); the connector takes its OAuth
 * client from the installer and names none of its own (ADR-0143 D2.1,
 * `clientSource: 'installer'`), and the README's credentials section tells
 * the administrator where that client comes from and which redirect URI to
 * register; the packaged OpenAPI document is the one the README's provenance
 * names — its sha256 is the hash recorded there — and it carries exactly the
 * operations the connector includes.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainSolutionTypeContradiction, TemplateManifestSchema } from '@objectstack/spec/marketplace';
import { resolveInstallModes } from '@objectstack/spec/kernel';
import { DeclarativeConnectorEntrySchema } from '@objectstack/spec/integration';
import stack from '../objectstack.config.js';
import {
  DOCUSIGN_ENVELOPE_OPERATIONS,
  DOCUSIGN_SANDBOX,
  DocuSignConnector,
} from '../src/connectors/docusign.connector.js';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = fileURLToPath(new URL('../objectstack.manifest.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;

/** Where the listing icon is served from once this package's tree is on `main`. */
const ICON_URL = 'https://raw.githubusercontent.com/objectstack-ai/objectstack/main/packages/apps/connector-docusign/assets/icon.svg';

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

const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
const documentBytes = readFileSync(fileURLToPath(new URL('../openapi/docusign-esignature.openapi.json', import.meta.url)));
const document = JSON.parse(documentBytes.toString('utf8')) as {
  openapi?: string;
  servers?: Array<{ url?: string }>;
  security?: unknown;
  components?: { securitySchemes?: Record<string, unknown> };
  paths?: Record<string, Record<string, { operationId?: string }>>;
};

/** A README `## <title>` section, up to the next second-level heading. */
function section(title: string): string {
  const start = readme.indexOf(`\n## ${title}\n`);
  expect(start, `README has no "## ${title}" section`).toBeGreaterThan(-1);
  const rest = readme.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Every text file this package ships, by path relative to its root. */
function packageTextFiles(dir = PACKAGE_ROOT, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.objectstack' || entry.name === 'dist') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...packageTextFiles(join(dir, entry.name), rel));
    else if (/\.(ts|json|md|svg)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe('connector-docusign listing', () => {
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
});

describe('connector-docusign OAuth client: the installer supplies it, the package names none', () => {
  const auth = DocuSignConnector.auth as Record<string, unknown>;

  it('is an oauth2 authorization_code instance that takes its client from the installer', () => {
    expect(auth).toEqual({
      type: 'oauth2',
      grant: 'authorization_code',
      authorizationUrl: DOCUSIGN_SANDBOX.authorizationUrl,
      tokenUrl: DOCUSIGN_SANDBOX.tokenUrl,
      scopes: ['signature'],
      clientSource: 'installer',
    });
    expect(auth).not.toHaveProperty('clientId');
    expect(auth).not.toHaveProperty('credentialRef');
  });

  it("parses against the spec's declarative connector entry schema", () => {
    const parsed = DeclarativeConnectorEntrySchema.safeParse(DocuSignConnector);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('targets the DocuSign developer sandbox: its account server and its API host', () => {
    expect(new URL(DOCUSIGN_SANDBOX.authorizationUrl).host).toBe('account-d.docusign.com');
    expect(new URL(DOCUSIGN_SANDBOX.tokenUrl).host).toBe('account-d.docusign.com');
    expect(DocuSignConnector.providerConfig).toMatchObject({ baseUrl: 'https://demo.docusign.net/restapi' });
  });

  it('ships no client id, secret or token: no GUID-shaped value in any file it owns but the upstream document', () => {
    // A DocuSign integration key, secret key and account id are GUIDs. The
    // packaged document is DocuSign's and carries example GUIDs of its own.
    const guid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    const files = packageTextFiles().filter((f) => !f.startsWith('openapi/'));
    expect(files).toContain('src/connectors/docusign.connector.ts');
    for (const file of files) {
      const text = readFileSync(join(PACKAGE_ROOT, file), 'utf8');
      expect(text, `${file} carries a GUID-shaped value`).not.toMatch(guid);
    }
    for (const c of stack.connectors ?? []) {
      expect(JSON.stringify(c)).not.toMatch(/clientSecret|accessToken|refreshToken/);
    }
  });

  it("the README's credentials section says where the client comes from and which redirect URI to register", () => {
    expect(existsSync(fileURLToPath(new URL(`../${String(manifest.readmePath)}`, import.meta.url)))).toBe(true);
    const credentials = section('Credentials');
    expect(credentials).toContain('Integration key');
    expect(credentials).toContain('Secret key');
    expect(credentials).toContain('/api/v1/automation/connectors/oauth/callback');
    expect(credentials).toContain('GET /api/v1/automation/connectors/docusign/connection');
    expect(credentials).toContain('POST /api/v1/automation/connectors/docusign/connection');
    expect(credentials).toContain('`redirectUri`');
    expect(credentials).toContain('manage_connector_connections');
  });

  it("the README's callbacks section names the unverified Connect signature and the poll that replaces it", () => {
    const callbacks = section('Callbacks');
    expect(callbacks).toContain('DocuSign Connect');
    expect(callbacks).toContain('docusign_poll_status_changes');
    const flowNames = (stack.flows ?? []).map((f) => (f as { name: string }).name);
    expect(flowNames).toContain('docusign_poll_status_changes');
  });
});

describe('connector-docusign packaged OpenAPI document', () => {
  it("is the document the README's provenance names: its sha256 is the one recorded there", () => {
    const provenance = section('Provenance');
    const recorded = provenance.match(/sha256\s+`([0-9a-f]{64})`/)?.[1];
    expect(recorded, 'README provenance records no sha256').toBeDefined();
    expect(createHash('sha256').update(documentBytes).digest('hex')).toBe(recorded);
  });

  it("is OpenAPI 3.x naming DocuSign's production host, with no security scheme (the token rides on every operation)", () => {
    expect(document.openapi).toMatch(/^3\.\d+(\.\d+)?$/);
    expect(document.servers?.[0]?.url).toBe('https://www.docusign.net/restapi');
    expect(document.security).toBeUndefined();
    expect(document.components?.securitySchemes ?? {}).toEqual({});
  });

  it('carries exactly the operations the connector includes', () => {
    const operations: Array<{ method: string; path: string; operationId?: string }> = [];
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const [method, op] of Object.entries(item)) {
        if (['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)) {
          operations.push({ method, path, operationId: op.operationId });
        }
      }
    }
    expect(operations.map((o) => o.operationId).sort()).toEqual([...DOCUSIGN_ENVELOPE_OPERATIONS].sort());
    expect(operations.find((o) => o.operationId === 'Envelopes_PostEnvelopes')).toMatchObject({
      method: 'post',
      path: '/v2.1/accounts/{accountId}/envelopes',
    });
    expect(DocuSignConnector.providerConfig).toMatchObject({ include: [...DOCUSIGN_ENVELOPE_OPERATIONS] });
  });

  it('gives Envelopes_PostEnvelopes a JSON request body (the --empty-consumes repair landed)', () => {
    const post = (document.paths?.['/v2.1/accounts/{accountId}/envelopes'] as Record<string, unknown>)?.post as {
      requestBody?: { content?: Record<string, { schema?: { type?: string; description?: string } }> };
    };
    expect(Object.keys(post?.requestBody?.content ?? {})).toEqual(['application/json']);
    // `--max-depth 0`: the envelope definition is a typed, explained stub.
    const schema = post?.requestBody?.content?.['application/json']?.schema;
    expect(schema?.type).toBe('object');
    expect(schema?.description).toContain('envelopeDefinition');
  });

  it("ships the upstream document's MIT licence notice beside it", () => {
    const notice = readFileSync(fileURLToPath(new URL('../openapi/LICENSE', import.meta.url)), 'utf8');
    expect(notice).toContain('The MIT License');
    expect(notice).toContain('DocuSign, Inc.');
  });
});
