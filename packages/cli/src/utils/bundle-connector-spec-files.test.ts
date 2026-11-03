// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectConnectorSpecFiles, placeConnectorSpecFiles } from './bundle-connector-spec-files.js';

/**
 * `os build` reads the OpenAPI document a `provider: 'openapi'` connector names
 * by package-relative file, relative to the directory holding the config
 * (`collectConnectorSpecFiles`), and writes it into the entry's
 * `providerConfig.spec` as the inline document (`placeConnectorSpecFiles`), so
 * an artifact installed into another runtime carries it. A reference that is
 * absolute, climbs out of the root, names no file or names no JSON object is
 * refused; every other provider, key and form is left as written.
 */

const DOC = { openapi: '3.0.3', info: { title: 'Fixture', version: '1.0.0' }, paths: {} };

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A package root holding `files`; answers the path of its (unread) config. */
function packageRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'os-connector-spec-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return path.join(root, 'objectstack.config.ts');
}

/** Both halves, as `os build` runs them. */
function bundle(stack: Record<string, unknown>, config: string) {
  const collected = collectConnectorSpecFiles(config, stack);
  if (collected.issues.length === 0) placeConnectorSpecFiles(collected);
  return collected;
}

const openapi = (spec: unknown, name = 'billing') => ({
  name,
  provider: 'openapi',
  providerConfig: { spec, include: ['GetThings'] },
});

describe('os build — connector spec files', () => {
  it('carries a package-relative spec into the entry as the inline document, keeping its other keys', () => {
    const config = packageRoot({ 'openapi/billing.json': JSON.stringify(DOC) });
    const stack = { connectors: [openapi('./openapi/billing.json')] };
    const collected = bundle(stack, config);
    expect(collected.issues).toEqual([]);
    expect(collected.files).toBe(1);
    expect(stack.connectors[0].providerConfig).toEqual({ spec: DOC, include: ['GetThings'] });
  });

  it('reads the entries of every package body and the manifest, by where each sits', () => {
    const config = packageRoot({ 'a.json': JSON.stringify(DOC), 'b.json': JSON.stringify({ ...DOC, x: 1 }) });
    const stack = {
      manifest: { connectors: [openapi('a.json', 'a')] },
      packages: [{ manifest: { connectors: [openapi('b.json', 'b')] } }],
    };
    const collected = bundle(stack, config);
    expect(collected.issues).toEqual([]);
    expect(stack.manifest.connectors[0].providerConfig.spec).toEqual(DOC);
    expect(stack.packages[0].manifest.connectors[0].providerConfig.spec).toEqual({ ...DOC, x: 1 });
  });

  it('leaves an inline document, an http(s) URL and every other provider as written', () => {
    const config = packageRoot({ 'x.json': JSON.stringify(DOC) });
    const stack = {
      connectors: [
        openapi(DOC, 'inline'),
        openapi('https://example.com/openapi.json', 'remote'),
        { name: 'rest', provider: 'rest', providerConfig: { spec: 'x.json', baseUrl: 'https://example.com' } },
        { name: 'descriptor', type: 'api' },
      ],
    };
    const before = JSON.parse(JSON.stringify(stack));
    const collected = bundle(stack, config);
    expect(collected).toMatchObject({ issues: [], files: 0 });
    expect(stack).toEqual(before);
  });

  it.each([
    ['names no file', './openapi/absent.json'],
    ['climbs out of the root', '../outside.json'],
    ['is absolute', '/etc/openapi.json'],
    ['is not JSON', 'bad.json'],
    ['is not a JSON object', 'list.json'],
  ])('refuses a reference that %s, located and naming it, and changes nothing', (_label, ref) => {
    const config = packageRoot({ 'bad.json': 'openapi: 3.0.3', 'list.json': '[]' });
    const stack = { connectors: [openapi(ref)] };
    const collected = collectConnectorSpecFiles(config, stack);
    expect(collected.issues).toHaveLength(1);
    expect(collected.issues[0].location).toBe('connectors[0].providerConfig.spec');
    expect(collected.issues[0].message).toContain(`connector 'billing' providerConfig.spec '${ref}'`);
    expect(stack.connectors[0].providerConfig.spec).toBe(ref);
  });
});
