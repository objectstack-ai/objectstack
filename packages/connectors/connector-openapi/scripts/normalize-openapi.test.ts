// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The offline normalizer (`normalize-openapi.mts`) against two trimmed
// fixtures shaped like the documents it exists for -- a Swagger 2.0 JSON
// document like DocuSign's eSignature API and a multi-file OpenAPI 3.0 YAML
// document like Stripe's -- and, for every output, the REAL `openapi`
// provider: "loads with no $ref left" is a claim about what
// `createOpenApiProviderFactory` materializes, not about a grep. No network:
// a URL input is served by an injected fetch.

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';
import type { ConnectorAction } from '@objectstack/spec/integration';

import { createOpenApiProviderFactory } from '../src/openapi-provider.js';
import { DEFAULT_MAX_DEPTH, main, normalizeOpenApi, NormalizeError, type NormalizeResult } from './normalize-openapi.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SWAGGER2 = join(FIXTURES, 'swagger2-esignature-shape.json');
const OPENAPI3_YAML = join(FIXTURES, 'openapi3-billing-shape.yaml');

/** Every `$ref` key anywhere in a value. */
function refPaths(node: unknown, path: string[] = [], out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((item, i) => refPaths(item, [...path, String(i)], out));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref') out.push(path.join('/'));
      refPaths(value, [...path, key], out);
    }
  }
  return out;
}

/** Materialize the normalized text through the real provider, as a file-path spec. */
async function load(result: NormalizeResult, include?: string[]) {
  const factory = createOpenApiProviderFactory();
  return factory({
    name: 'normalized',
    label: 'Normalized',
    type: 'api',
    providerConfig: { spec: './normalized.json', ...(include ? { include } : {}) },
    loadPackageFile: async () => result.text,
  });
}

const action = (actions: ConnectorAction[] | undefined, key: string): ConnectorAction => {
  const found = actions?.find((a) => a.key === key);
  if (!found) throw new Error(`no action '${key}'`);
  return found;
};

async function refusal(promise: Promise<unknown>): Promise<NormalizeError> {
  const err = await promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(NormalizeError);
  return err as NormalizeError;
}

describe('normalize-openapi: Swagger 2.0 (DocuSign-shaped)', () => {
  it('refuses an operation whose empty consumes list would drop its request body, naming it', async () => {
    const err = await refusal(normalizeOpenApi({ input: SWAGGER2 }));
    expect(err.message).toContain("'POST /v2.1/accounts/{accountId}/envelopes'");
    expect(err.message).toContain('--empty-consumes');
  });

  it('converts to OpenAPI 3.0 with the body schema kept, no $ref left, and an absolute server', async () => {
    const result = await normalizeOpenApi({ input: SWAGGER2, emptyConsumes: 'application/json' });
    expect(result.sourceVersion).toBe('2.0');
    expect(result.openapi).toMatch(/^3\.0\.\d+$/);
    expect(result.document.servers).toEqual([{ url: 'https://api.example.com/restapi' }]);
    expect(result.filledConsumes).toEqual(['POST /v2.1/accounts/{accountId}/envelopes']);
    expect(refPaths(result.document)).toEqual([]);
    expect(result.refsLeft).toBe(0);
    // The definitions only existed to be referenced; nothing points at them now.
    expect(result.document).not.toHaveProperty('definitions');
    expect(result.document).not.toHaveProperty('components');

    const { def } = await load(result);
    expect(def.actions?.map((a) => a.key)).toEqual([
      'Envelopes_GetEnvelopes',
      'Envelopes_PostEnvelopes',
      'Envelopes_GetEnvelope',
    ]);
    expect(refPaths(def)).toEqual([]);
    const create = action(def.actions, 'Envelopes_PostEnvelopes').inputSchema as {
      properties: Record<string, { properties?: Record<string, unknown> }>;
      required: string[];
    };
    // The body param became a request body whose schema the action carries.
    expect(Object.keys(create.properties.body?.properties ?? {})).toEqual(['emailSubject', 'status', 'recipients']);
    expect(Object.keys(create.properties.path?.properties ?? {})).toEqual(['accountId']);
    expect(create.required).toEqual(['path', 'body']);
  });

  it('cuts a recursive schema into a typed, explained stub', async () => {
    const result = await normalizeOpenApi({ input: SWAGGER2, emptyConsumes: 'application/json' });
    const get = (result.document.paths as any)['/v2.1/accounts/{accountId}/envelopes/{envelopeId}'].get;
    const parent = get.responses['200'].content['application/json'].schema.properties.parentEnvelope;
    expect(parent.type).toBe('object');
    expect(parent.description).toContain("'#/components/schemas/envelope', a recursive reference");
    expect(result.cuts.recursive).toBeGreaterThan(0);
  });
});

describe('normalize-openapi: OpenAPI 3.0 YAML across two files (Stripe-shaped)', () => {
  it('bundles the external file, inlines every reference and keeps the security schemes', async () => {
    const result = await normalizeOpenApi({ input: OPENAPI3_YAML });
    expect(result.sourceVersion).toBe('3.0.0');
    expect(result.openapi).toBe('3.0.0');
    expect(refPaths(result.document)).toEqual([]);
    expect(result.document).not.toHaveProperty('x-ext');
    expect(result.document.components).toEqual({ securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } });

    const paths = result.document.paths as any;
    // The schema from the second file arrived.
    const balance = paths['/v1/balance'].get.responses['200'].content['application/json'].schema;
    expect(balance.properties.available.items.properties).toHaveProperty('currency');
    // A shared response, reached as `responses.default`, is inlined -- `default` is structure here.
    expect(paths['/v1/customers'].get.responses.default.content['application/json'].schema.properties).toHaveProperty('message');
    // A shared parameter is inlined (a stub there would be a parameter with no name).
    expect(paths['/v1/customers'].get.parameters).toEqual([
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
    ]);
    // A PROPERTY called `default` is a schema and is inlined; a schema's `default` VALUE stays literal.
    const customer = paths['/v1/customers/{customer}'].get.responses['200'].content['application/json'].schema;
    expect(customer.properties.default.properties).toHaveProperty('city');
    const create = paths['/v1/customers'].post.requestBody.content['application/json'].schema;
    expect(create.properties.email.default).toBe('someone@example.com');
    // A vendor extension's $ref is replaced by a stub, never left dangling.
    const sub = customer.properties.subscriptions.items;
    expect(sub.properties.customer['x-expansionResources'].oneOf[0].description).toContain('referenced from a vendor extension');
    expect(result.cuts.extension).toBeGreaterThan(0);
  });

  it('loads through the real provider, every action keyed as the provider keys it', async () => {
    const result = await normalizeOpenApi({ input: OPENAPI3_YAML });
    expect(result.operationKeys).toEqual(['GetCustomers', 'PostCustomers', 'GetCustomersCustomer', 'get_v1_balance']);
    const { def } = await load(result);
    expect(def.actions?.map((a) => a.key)).toEqual(result.operationKeys);
    expect(refPaths(def)).toEqual([]);
  });

  it('generates an include list the provider accepts, exposing exactly the matched operations', async () => {
    const result = await normalizeOpenApi({ input: OPENAPI3_YAML, includePatterns: ['^GET /v1/customers', 'balance'] });
    // `^GET /v1/customers` matches on 'METHOD /path'; `balance` matches the generated key.
    expect(result.include).toEqual(['GetCustomers', 'GetCustomersCustomer', 'get_v1_balance']);
    const { def } = await load(result, result.include);
    expect(def.actions?.map((a) => a.key)).toEqual(result.include);
  });

  it('refuses an allow-pattern that matches nothing, and one that is not a regular expression', async () => {
    expect((await refusal(normalizeOpenApi({ input: OPENAPI3_YAML, includePatterns: ['^nope$'] }))).message).toContain(
      'matched none of the 4 operation(s)',
    );
    expect((await refusal(normalizeOpenApi({ input: OPENAPI3_YAML, includePatterns: ['('] }))).message).toContain(
      "--include-pattern '('",
    );
  });

  it('inlines up to --max-depth named schemas, then stubs; the default is the documented one', async () => {
    const shallow = await normalizeOpenApi({ input: OPENAPI3_YAML, maxDepth: 0 });
    const items = (shallow.document.paths as any)['/v1/customers'].get.responses['200'].content['application/json'].schema
      .properties.data.items;
    expect(items).toEqual({
      type: 'object',
      description: "A customer.\n\n(Not expanded by normalize-openapi: '#/components/schemas/customer', deeper than --max-depth 0.)",
    });
    expect(shallow.cuts.maxDepth).toBeGreaterThan(0);
    expect(refPaths(shallow.document)).toEqual([]);
    expect(DEFAULT_MAX_DEPTH).toBe(2);
    await refusal(normalizeOpenApi({ input: OPENAPI3_YAML, maxDepth: -1 }));
  });
});

describe('normalize-openapi: --trim keeps only the matched operations', () => {
  const PATTERNS = ['^GET /v1/customers', 'balance'];

  it('writes exactly the matched operations, with the include list an untrimmed run computes', async () => {
    const untrimmed = await normalizeOpenApi({ input: OPENAPI3_YAML, includePatterns: PATTERNS });
    const trimmed = await normalizeOpenApi({ input: OPENAPI3_YAML, includePatterns: PATTERNS, trim: true });
    expect(trimmed.operationKeys).toEqual(['GetCustomers', 'GetCustomersCustomer', 'get_v1_balance']);
    expect(trimmed.include).toEqual(untrimmed.include);
    expect(trimmed.sourceOperations).toBe(4);
    const paths = trimmed.document.paths as Record<string, Record<string, unknown>>;
    expect(Object.keys(paths)).toEqual(['/v1/customers', '/v1/customers/{customer}', '/v1/balance']);
    // The unmatched POST is gone from a path item whose GET is kept.
    expect(Object.keys(paths['/v1/customers'] ?? {})).toEqual(['get']);
    expect(trimmed.text.length).toBeLessThan(untrimmed.text.length);

    const { def } = await load(trimmed);
    expect(def.actions?.map((a) => a.key)).toEqual(trimmed.include);
    expect(refPaths(def)).toEqual([]);
    expect(refPaths(trimmed.document)).toEqual([]);
    expect(trimmed.refsLeft).toBe(0);
  });

  it('carries nothing reachable only from a dropped operation, and drops path items left empty', async () => {
    const trimmed = await normalizeOpenApi({ input: OPENAPI3_YAML, includePatterns: ['balance'], trim: true });
    expect(Object.keys(trimmed.document.paths as object)).toEqual(['/v1/balance']);
    // customer, customer_create, the shared error response and the shared parameter were reachable
    // only from the customer operations.
    for (const gone of ['A customer.', 'Error response.', 'someone@example.com', '"limit"', 'subscription']) {
      expect(trimmed.text).not.toContain(gone);
    }
    // Only the kept operation is walked: none of the customer schemas' cuts are counted.
    expect(trimmed.cuts).toEqual({ recursive: 0, maxDepth: 0, extension: 0 });
    expect(trimmed.document.components).toEqual({ securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } });
    const { def } = await load(trimmed);
    expect(def.actions?.map((a) => a.key)).toEqual(['get_v1_balance']);
  });

  it('trims a Swagger 2.0 document after conversion, keyed by operationId', async () => {
    const trimmed = await normalizeOpenApi({
      input: SWAGGER2,
      emptyConsumes: 'application/json',
      includePatterns: ['^Envelopes_GetEnvelope$'],
      trim: true,
    });
    expect(trimmed.operationKeys).toEqual(['Envelopes_GetEnvelope']);
    expect(trimmed.sourceOperations).toBe(3);
    const { def } = await load(trimmed);
    expect(def.actions?.map((a) => a.key)).toEqual(['Envelopes_GetEnvelope']);
    expect(refPaths(def)).toEqual([]);
  });

  it('resolves a $ref path item before selecting its operations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'normalize-openapi-'));
    try {
      const file = join(dir, 'ref-path-item.json');
      await writeFile(
        file,
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 't', version: '1' },
          servers: [{ url: 'https://api.example.com' }],
          paths: {
            '/a': { $ref: '#/paths/~1b', summary: 'A, shaped like B' },
            '/b': {
              get: { operationId: 'getB', responses: { '200': { description: 'OK' } } },
              delete: { operationId: 'deleteB', responses: { '200': { description: 'OK' } } },
            },
          },
          webhooks: { ping: { post: { operationId: 'ping', responses: { '200': { description: 'OK' } } } } },
        }),
      );
      const trimmed = await normalizeOpenApi({ input: file, includePatterns: ['^GET /a$'], trim: true });
      expect(trimmed.document.paths).toEqual({
        '/a': { summary: 'A, shaped like B', get: { operationId: 'getB', responses: { '200': { description: 'OK' } } } },
      });
      expect(trimmed.document).not.toHaveProperty('webhooks');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses --trim without a pattern, and a pattern that matches nothing', async () => {
    expect((await refusal(normalizeOpenApi({ input: OPENAPI3_YAML, trim: true }))).message).toContain(
      'give at least one --include-pattern',
    );
    expect(
      (await refusal(normalizeOpenApi({ input: OPENAPI3_YAML, includePatterns: ['^nope$'], trim: true }))).message,
    ).toContain('matched none of the 4 operation(s)');
  });

  it('without --trim the whole document is written, as before (control)', async () => {
    const result = await normalizeOpenApi({ input: OPENAPI3_YAML, includePatterns: ['balance'] });
    expect(result.operationKeys).toEqual(['GetCustomers', 'PostCustomers', 'GetCustomersCustomer', 'get_v1_balance']);
    expect(result.sourceOperations).toBe(4);
    expect(result.include).toEqual(['get_v1_balance']);
    expect(result.text).toContain('A customer.');
  });
});

describe('normalize-openapi: servers, sources and refusals', () => {
  const doc = (servers: unknown) =>
    JSON.stringify({ openapi: '3.1.0', info: { title: 't', version: '1' }, servers, paths: { '/x': { get: { responses: {} } } } });
  const served = (body: string): typeof fetch =>
    (async (input: string | URL | Request) =>
      String(input) === 'https://specs.example.com/v1/openapi.json'
        ? new Response(body, { status: 200 })
        : new Response('missing', { status: 404 })) as typeof fetch;

  it('resolves a relative server against the source URL and fills server variables', async () => {
    const relative = await normalizeOpenApi({
      input: 'https://specs.example.com/v1/openapi.json',
      fetchImpl: served(doc([{ url: '/api/{version}', variables: { version: { default: 'v2' } } }])),
    });
    expect(relative.document.servers).toEqual([{ url: 'https://specs.example.com/api/v2' }]);
    expect(relative.openapi).toBe('3.1.0');
    const none = await normalizeOpenApi({ input: 'https://specs.example.com/v1/openapi.json', fetchImpl: served(doc([])) });
    expect(none.document.servers).toEqual([{ url: 'https://specs.example.com/' }]);
  });

  it('refuses a relative server in a file document unless --server-url names the base', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'normalize-openapi-'));
    try {
      const file = join(dir, 'relative.json');
      await writeFile(file, doc([{ url: '/api' }]));
      expect((await refusal(normalizeOpenApi({ input: file }))).message).toContain('--server-url');
      const fixed = await normalizeOpenApi({ input: file, serverUrl: 'https://api.example.com/api' });
      expect(fixed.document.servers).toEqual([{ url: 'https://api.example.com/api' }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a document that is neither Swagger 2.0 nor OpenAPI 3.x, and an unreachable URL', async () => {
    const legacy = JSON.stringify({ swaggerVersion: '1.2', apis: [] });
    expect(
      (await refusal(normalizeOpenApi({ input: 'https://specs.example.com/v1/openapi.json', fetchImpl: served(legacy) })))
        .message,
    ).toContain('neither Swagger 2.0 nor OpenAPI 3.x');
    expect(
      (await refusal(normalizeOpenApi({ input: 'https://specs.example.com/gone.json', fetchImpl: served('') }))).message,
    ).toContain('HTTP 404');
  });
});

describe('normalize-openapi: the CLI', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });
  const capture = () => {
    const chunks = { out: '', err: '' };
    return {
      chunks,
      io: {
        out: { write: (s: string) => ((chunks.out += s), true) },
        err: { write: (s: string) => ((chunks.err += s), true) },
      } as unknown as Parameters<typeof main>[1],
    };
  };

  it('prints the sha256 of exactly the bytes it wrote', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'normalize-openapi-'));
    dirs.push(dir);
    const out = join(dir, 'nested', 'billing.json');
    const { chunks, io } = capture();
    const code = await main(['--in', OPENAPI3_YAML, '--out', out, '--include-pattern', '^Get'], io);
    expect(code).toBe(0);
    const summary = JSON.parse(chunks.out) as { sha256: string; bytes: number; include: string[]; out: string };
    const written = await readFile(out);
    expect(summary.out).toBe(out);
    expect(summary.bytes).toBe(written.length);
    expect(summary.sha256).toBe(createHash('sha256').update(written).digest('hex'));
    expect(summary.include).toEqual(['GetCustomers', 'GetCustomersCustomer']);
  });

  it('with --trim, writes the trimmed bytes and prints their sha256', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'normalize-openapi-'));
    dirs.push(dir);
    const out = join(dir, 'billing.trimmed.json');
    const { chunks, io } = capture();
    const code = await main(['--in', OPENAPI3_YAML, '--out', out, '--trim', '--include-pattern', '^Get'], io);
    expect(code).toBe(0);
    const summary = JSON.parse(chunks.out) as {
      sha256: string;
      bytes: number;
      include: string[];
      operations: number;
      trimmedFrom: number;
    };
    const written = await readFile(out);
    expect(summary.bytes).toBe(written.length);
    expect(summary.sha256).toBe(createHash('sha256').update(written).digest('hex'));
    expect(summary.include).toEqual(['GetCustomers', 'GetCustomersCustomer']);
    expect(summary.operations).toBe(2);
    expect(summary.trimmedFrom).toBe(4);
    const paths = (JSON.parse(written.toString('utf8')) as { paths: Record<string, object> }).paths;
    expect(Object.keys(paths)).toEqual(['/v1/customers', '/v1/customers/{customer}']);
    expect(Object.keys(paths['/v1/customers'] ?? {})).toEqual(['get']);

    const refused = capture();
    expect(await main(['--in', OPENAPI3_YAML, '--out', join(dir, 'y.json'), '--trim'], refused.io)).toBe(1);
    expect(refused.chunks.err).toContain('--include-pattern');
    await expect(readFile(join(dir, 'y.json'))).rejects.toThrow();
  });

  it('exits 1 on a refusal and 2 on a usage error, writing nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'normalize-openapi-'));
    dirs.push(dir);
    const refused = capture();
    expect(await main(['--in', SWAGGER2, '--out', join(dir, 'x.json')], refused.io)).toBe(1);
    expect(refused.chunks.err).toContain('--empty-consumes');
    expect(refused.chunks.out).toBe('');
    await expect(readFile(join(dir, 'x.json'))).rejects.toThrow();
    const usage = capture();
    expect(await main(['--in', SWAGGER2], usage.io)).toBe(2);
    expect(await main(['--bogus', 'x'], usage.io)).toBe(2);
  });
});
