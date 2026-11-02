// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An authored connector entry (`DeclarativeConnectorEntrySchema`, behind
// `defineStack({ connectors })`, `os validate` / `os compile`, the artifact load
// and `PUT /meta/connector/:name`) keeps no credential part in a URL: under
// `providerConfig` (any key, any depth, array elements included) and under
// `auth` (`tokenUrl`, `authorizationUrl`, `resource`), a URL holding a userinfo
// or a credential query parameter is refused, one issue per URL, located at
// the URL. Every refusal has a CONTROL accept beside it, so a refusal that fired
// on everything could not pass, and the last block pins that the write door
// refuses exactly what the read redactor rewrites.
//
// Every value below is an obviously-fake placeholder, and the refusal must
// never echo it.

import { describe, it, expect } from 'vitest';
import { ConnectorSchema, DeclarativeConnectorEntrySchema } from './connector.zod';
import { redactConnectorItem } from './connector-credential-redaction';
import { ObjectStackDefinitionSchema } from '../stack.zod';

const PLACEHOLDER = 'TEST_PLACEHOLDER_NOT_A_SECRET';

const rest = (baseUrl: string, auth: Record<string, unknown> = { type: 'bearer', credentialRef: 'VENDOR_TOKEN' }) => ({
  name: 'vendor',
  label: 'Vendor',
  type: 'api',
  provider: 'rest',
  providerConfig: { baseUrl },
  auth,
});

const mcp = (url: string) => ({
  name: 'tools',
  label: 'Tools',
  type: 'api',
  provider: 'mcp',
  providerConfig: { transport: { kind: 'http', url } },
});

const openapi = (spec: string) => ({
  name: 'billing',
  label: 'Billing',
  type: 'api',
  provider: 'openapi',
  providerConfig: { spec },
  auth: { type: 'bearer', credentialRef: 'BILLING_TOKEN' },
});

const oauth2 = (over: Record<string, unknown>) => rest('https://api.vendor.example.com', {
  type: 'oauth2',
  grant: 'authorization_code',
  authorizationUrl: 'https://auth.vendor.example.com/authorize',
  tokenUrl: 'https://auth.vendor.example.com/token',
  clientId: 'client-1',
  credentialRef: 'VENDOR_CLIENT_SECRET',
  ...over,
});

/** Every issue of a refused parse, as `[code, path]`, and the messages. */
function refusals(input: unknown): { located: Array<[string, string]>; messages: string[] } {
  const result = DeclarativeConnectorEntrySchema.safeParse(input);
  expect(result.success, 'the entry must be refused').toBe(false);
  const issues = result.error!.issues;
  return {
    located: issues.map((issue) => [issue.code, issue.path.join('.')]),
    messages: issues.map((issue) => issue.message),
  };
}

const accepts = (input: unknown): void => {
  const result = DeclarativeConnectorEntrySchema.safeParse(input);
  expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
};

describe('an authored connector URL holds no credential part', () => {
  describe('CONTROL: a URL with no credential part is accepted at every position', () => {
    it.each([
      ['a rest baseUrl', rest('https://api.vendor.example.com/v1')],
      ['a baseUrl with an ordinary query', rest('https://api.vendor.example.com/v1?region=eu&page=2')],
      ['a baseUrl whose credential parameter is empty', rest('https://api.vendor.example.com/v1?token=&api_key=')],
      ['a baseUrl whose credential name sits in the fragment', rest(`https://api.vendor.example.com/v1#token=${PLACEHOLDER}`)],
      ['an mcp http transport url', mcp('https://mcp.vendor.example.com/mcp')],
      ['an openapi spec URL', openapi('https://api.vendor.example.com/openapi.json')],
      ['an openapi spec that is a path, not a URL', openapi('./specs/billing.yaml')],
      ['oauth2 endpoints and resource', oauth2({ resource: 'https://api.vendor.example.com/' })],
      ['a credentialRef-only instance', rest('https://api.vendor.example.com', { type: 'api-key', credentialRef: 'VENDOR_KEY', paramName: 'key' })],
    ] as const)('%s', (_label, entry) => accepts(entry));
  });

  describe('REFUSED: a userinfo or a credential query parameter, at each URL position', () => {
    it.each([
      ['a userinfo password in the baseUrl', rest(`https://user:${PLACEHOLDER}@api.vendor.example.com/v1`), 'providerConfig.baseUrl'],
      ['a userinfo token in the baseUrl', rest(`https://${PLACEHOLDER}@api.vendor.example.com/v1`), 'providerConfig.baseUrl'],
      ['`api_key` in the baseUrl query', rest(`https://api.vendor.example.com/v1?api_key=${PLACEHOLDER}`), 'providerConfig.baseUrl'],
      ['`token` in the baseUrl query', rest(`https://api.vendor.example.com/v1?region=eu&token=${PLACEHOLDER}`), 'providerConfig.baseUrl'],
      ['`access_token` in the baseUrl query', rest(`https://api.vendor.example.com/v1?access_token=${PLACEHOLDER}`), 'providerConfig.baseUrl'],
      ['a credential name spelled in another case', rest(`https://api.vendor.example.com/v1?Access_Token=${PLACEHOLDER}`), 'providerConfig.baseUrl'],
      ['a percent-encoded credential name', rest(`https://api.vendor.example.com/v1?api%5Fkey=${PLACEHOLDER}`), 'providerConfig.baseUrl'],
      [
        'the instance\'s own `auth.paramName` in the baseUrl query',
        rest(`https://api.vendor.example.com/v1?vendor_key=${PLACEHOLDER}`, { type: 'api-key', credentialRef: 'VENDOR_KEY', paramName: 'vendor_key' }),
        'providerConfig.baseUrl',
      ],
      ['a userinfo password in an mcp transport url', mcp(`https://user:${PLACEHOLDER}@mcp.vendor.example.com/mcp`), 'providerConfig.transport.url'],
      ['`token` in an openapi spec URL', openapi(`https://api.vendor.example.com/openapi.json?token=${PLACEHOLDER}`), 'providerConfig.spec'],
      ['a userinfo password in `auth.tokenUrl`', oauth2({ tokenUrl: `https://c:${PLACEHOLDER}@auth.vendor.example.com/token` }), 'auth.tokenUrl'],
      ['`client_secret` in `auth.tokenUrl`', oauth2({ tokenUrl: `https://auth.vendor.example.com/token?client_secret=${PLACEHOLDER}` }), 'auth.tokenUrl'],
      ['a userinfo in `auth.authorizationUrl`', oauth2({ authorizationUrl: `https://c:${PLACEHOLDER}@auth.vendor.example.com/authorize` }), 'auth.authorizationUrl'],
      ['`key` in `auth.resource`', oauth2({ resource: `https://api.vendor.example.com/?key=${PLACEHOLDER}` }), 'auth.resource'],
    ] as const)('%s', (_label, entry, at) => {
      const { located, messages } = refusals(entry);
      expect(located).toEqual([['custom', at]]);
      expect(messages[0]).toContain(`\`${at}\``);
      expect(messages[0]).toContain('auth: { type, credentialRef }');
      expect(messages[0]).not.toContain(PLACEHOLDER);
    });

    it('a URL at any depth under `providerConfig`, an array element and a dotted key included', () => {
      const entry = {
        ...rest('https://api.vendor.example.com'),
        providerConfig: {
          baseUrl: 'https://api.vendor.example.com',
          mirrors: ['https://eu.vendor.example.com', `https://us.vendor.example.com?sig=${PLACEHOLDER}`],
          'x.callback': `https://hooks.vendor.example.com?secret=${PLACEHOLDER}`,
          nested: { deeper: { url: `https://u:${PLACEHOLDER}@deep.vendor.example.com` } },
        },
      };
      expect(refusals(entry).located).toEqual([
        ['custom', 'providerConfig.mirrors.1'],
        ['custom', 'providerConfig.x.callback'],
        ['custom', 'providerConfig.nested.deeper.url'],
      ]);
    });

    it('one issue per URL, naming every credential part it holds', () => {
      const entry = oauth2({ tokenUrl: `https://c:${PLACEHOLDER}@auth.vendor.example.com/token?token=${PLACEHOLDER}&key=${PLACEHOLDER}` });
      const { located, messages } = refusals(entry);
      expect(located).toEqual([['custom', 'auth.tokenUrl']]);
      expect(messages[0]).toContain('a userinfo');
      expect(messages[0]).toContain('the `token` query parameter');
      expect(messages[0]).toContain('the `key` query parameter');
    });

    it('inside a stack, the issue is located under the entry', () => {
      const result = ObjectStackDefinitionSchema.safeParse({
        manifest: { id: 'com.example.app', name: 'app', version: '1.0.0', type: 'app' },
        connectors: [rest(`https://api.vendor.example.com?token=${PLACEHOLDER}`)],
      });
      expect(result.success).toBe(false);
      const paths = result.error!.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('connectors.0.providerConfig.baseUrl');
    });
  });

  it('CONTROL: a URL inside a header or environment map is left to the map\'s own rules (the read withholds the map whole)', () => {
    accepts({
      ...rest('https://api.vendor.example.com'),
      providerConfig: { baseUrl: 'https://api.vendor.example.com', headers: { Referer: `https://u:${PLACEHOLDER}@app.example.com` } },
    });
    accepts({
      name: 'local_tools', label: 'Local tools', type: 'api', provider: 'mcp',
      providerConfig: { transport: { kind: 'stdio', command: 'tools', env: { UPSTREAM_URL: `https://u:${PLACEHOLDER}@db.example.com` } } },
    });
  });

  it('CONTROL: the open runtime carrier `ConnectorSchema` keeps its posture', () => {
    expect(ConnectorSchema.safeParse(rest(`https://api.vendor.example.com?token=${PLACEHOLDER}`)).success).toBe(true);
  });

  describe('the write door refuses exactly what the read redactor rewrites', () => {
    const urls = [
      'https://api.vendor.example.com/v1',
      'https://api.vendor.example.com/v1?page=2',
      'https://api.vendor.example.com/v1?token=',
      `https://user:${PLACEHOLDER}@api.vendor.example.com/v1`,
      `https://${PLACEHOLDER}@api.vendor.example.com/v1`,
      `https://api.vendor.example.com/v1?apikey=${PLACEHOLDER}`,
      `https://api.vendor.example.com/v1?page=2&signature=${PLACEHOLDER}#token=x`,
      `https://api.vendor.example.com/v1#api_key=${PLACEHOLDER}`,
    ];
    it.each(urls)('%s', (url) => {
      for (const entry of [rest(url), oauth2({ tokenUrl: url })]) {
        const refused = !DeclarativeConnectorEntrySchema.safeParse(entry).success;
        const rewritten = redactConnectorItem(entry as Record<string, unknown>).redactedKeys.length > 0;
        expect(refused, `${url}: refused ⇔ rewritten`).toBe(rewritten);
      }
    });

    it('at every depth, one walk: each refused URL is withheld by the read, at the position it can address', () => {
      const entry = {
        ...rest('https://api.vendor.example.com'),
        providerConfig: {
          baseUrl: `https://u:${PLACEHOLDER}@api.vendor.example.com`,
          mirrors: [
            'https://eu.vendor.example.com',
            `https://us.vendor.example.com?sig=${PLACEHOLDER}`,
            `https://ap.vendor.example.com?token=${PLACEHOLDER}`,
          ],
          'x.callback': { url: `https://hooks.vendor.example.com?secret=${PLACEHOLDER}` },
          nested: { deeper: { url: `https://u:${PLACEHOLDER}@deep.vendor.example.com` }, plain: 'https://plain.vendor.example.com' },
          headers: { Referer: `https://u:${PLACEHOLDER}@app.example.com` },
        },
      };
      expect(refusals(entry).located.map(([, path]) => path)).toEqual([
        'providerConfig.baseUrl',
        'providerConfig.mirrors.1',
        'providerConfig.mirrors.2',
        'providerConfig.x.callback.url',
        'providerConfig.nested.deeper.url',
      ]);
      const { item: served, redactedKeys } = redactConnectorItem(entry);
      // An array and a dotted key are withheld whole, once; the header map is
      // withheld whole by its own rule (item 3), the one position the write
      // door leaves to the map's own rules.
      expect(redactedKeys).toEqual([
        'providerConfig.baseUrl',
        'providerConfig.headers',
        'providerConfig.mirrors',
        'providerConfig.nested.deeper.url',
        'providerConfig.x.callback',
      ]);
      expect(JSON.stringify(served)).not.toContain(PLACEHOLDER);
      expect((served.providerConfig as Record<string, any>).nested.plain).toBe('https://plain.vendor.example.com');
    });
  });
});
