// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The listing this package publishes as, and the document it packages:
 * `objectstack.manifest.json` parses against the spec's own schema for that
 * file and names the same package id as the stack; the README's credentials
 * section names every credential the app's connectors reference (the
 * marketplace handbook's "every credential it needs" rule, checked against
 * the metadata rather than trusted); and the packaged OpenAPI document is the
 * one the README's provenance names — its sha256 is the hash recorded there,
 * and it carries exactly the read operations the connector includes.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TemplateManifestSchema } from '@objectstack/spec/marketplace';
import stack from '../objectstack.config.js';
import { STRIPE_READ_OPERATIONS, StripeConnector } from '../src/connectors/stripe.connector.js';

const manifestPath = fileURLToPath(new URL('../objectstack.manifest.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
const documentBytes = readFileSync(fileURLToPath(new URL('../openapi/stripe.openapi.json', import.meta.url)));
const document = JSON.parse(documentBytes.toString('utf8')) as {
  openapi?: string;
  servers?: Array<{ url?: string }>;
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

describe('connector-stripe listing', () => {
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
    expect(existsSync(fileURLToPath(new URL(`../${String(manifest.readmePath)}`, import.meta.url)))).toBe(true);
    const credentials = section('Credentials');
    const refs = (stack.connectors ?? [])
      .map((c) => (c as { auth?: { credentialRef?: string } }).auth?.credentialRef)
      .filter((r): r is string => typeof r === 'string');
    expect(refs).toEqual(['STRIPE_RESTRICTED_KEY']);
    for (const ref of refs) expect(credentials).toContain(`\`${ref}\``);
    expect(credentials).toContain('https://dashboard.stripe.com/apikeys');
  });

  it('carries no secret in metadata', () => {
    for (const c of stack.connectors ?? []) {
      expect(c).not.toHaveProperty('authentication.token');
      expect(JSON.stringify(c)).not.toMatch(/\b[sr]k_(live|test)_/);
    }
  });
});

describe('connector-stripe packaged OpenAPI document', () => {
  it("is the document the README's provenance names: its sha256 is the one recorded there", () => {
    const provenance = section('Provenance');
    const recorded = provenance.match(/sha256\s+`([0-9a-f]{64})`/)?.[1];
    expect(recorded, 'README provenance records no sha256').toBeDefined();
    expect(createHash('sha256').update(documentBytes).digest('hex')).toBe(recorded);
  });

  it('is OpenAPI 3.x against https://api.stripe.com/', () => {
    expect(document.openapi).toMatch(/^3\.\d+(\.\d+)?$/);
    expect(document.servers?.[0]?.url).toBe('https://api.stripe.com/');
  });

  it('carries exactly the operations the connector includes, every one a GET', () => {
    const operations: Array<{ method: string; operationId?: string }> = [];
    for (const item of Object.values(document.paths ?? {})) {
      for (const [method, op] of Object.entries(item)) {
        if (['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)) {
          operations.push({ method, operationId: op.operationId });
        }
      }
    }
    expect(operations.map((o) => o.operationId).sort()).toEqual([...STRIPE_READ_OPERATIONS].sort());
    expect(operations.every((o) => o.method === 'get')).toBe(true);
    expect(StripeConnector.providerConfig).toMatchObject({ include: [...STRIPE_READ_OPERATIONS] });
  });

  it("ships the upstream document's MIT licence notice beside it", () => {
    const notice = readFileSync(fileURLToPath(new URL('../openapi/LICENSE', import.meta.url)), 'utf8');
    expect(notice).toContain('The MIT License');
    expect(notice).toContain('Stripe, Inc.');
  });
});
