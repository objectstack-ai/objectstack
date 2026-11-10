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
import { CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES } from './connector-url-credentials';

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

// One value-level rule at both connector doors: a URL is judged where a URL
// parser reads it — after its leading and trailing C0 control characters and
// spaces are trimmed (the WHATWG URL Standard's first step) — and a credential
// query parameter is refused in ANY string under `providerConfig` and `auth`,
// whether or not it starts with a scheme. The read rewrites exactly what the
// write refuses, at the position the write judged, and serves every other
// character byte for byte.
describe('a URL is judged after trimming surrounding whitespace; a credential query parameter is refused in any string of the entry', () => {
  const TAB = String.fromCharCode(0x09);
  const LF = String.fromCharCode(0x0a);
  const CR = String.fromCharCode(0x0d);
  const NUL = String.fromCharCode(0x00);
  const CLEAN = 'https://api.vendor.example.com/v1';
  const withNote = (note: string) => ({ ...rest(CLEAN), providerConfig: { baseUrl: CLEAN, note } });

  describe('REFUSED, located at the string', () => {
    it.each([
      ['a userinfo password in a URL behind a leading space', rest(` https://user:${PLACEHOLDER}@api.vendor.example.com/v1`), 'providerConfig.baseUrl'],
      ['a userinfo token in a URL behind a leading tab', rest(`${TAB}https://${PLACEHOLDER}@api.vendor.example.com/v1`), 'providerConfig.baseUrl'],
      ['a userinfo in a URL between a leading NUL and a trailing newline', rest(`${NUL}https://u:${PLACEHOLDER}@api.vendor.example.com/v1${LF}`), 'providerConfig.baseUrl'],
      ['`api_key` in the query of a URL behind a leading space', rest(` https://api.vendor.example.com/v1?api_key=${PLACEHOLDER}`), 'providerConfig.baseUrl'],
      ['`token` in the query of a string with no scheme', rest(`api.vendor.example.com/v1?page=2&token=${PLACEHOLDER}`), 'providerConfig.baseUrl'],
      ['`signature` in the query of a string that is not a URL', withNote(`see ?signature=${PLACEHOLDER}`), 'providerConfig.note'],
      [
        'the instance\'s own `auth.paramName` in the query of a string with no scheme',
        rest(`api.vendor.example.com/v1?vendor_key=${PLACEHOLDER}`, { type: 'api-key', credentialRef: 'VENDOR_KEY', paramName: 'vendor_key' }),
        'providerConfig.baseUrl',
      ],
      ['a userinfo in `auth.tokenUrl` behind a leading space', oauth2({ tokenUrl: ` https://c:${PLACEHOLDER}@auth.vendor.example.com/token` }), 'auth.tokenUrl'],
      ['`client_secret` in the query of an `auth.tokenUrl` behind a leading tab', oauth2({ tokenUrl: `${TAB}https://auth.vendor.example.com/token?client_secret=${PLACEHOLDER}` }), 'auth.tokenUrl'],
    ] as const)('%s', (_label, entry, at) => {
      const { located, messages } = refusals(entry);
      expect(located).toEqual([['custom', at]]);
      expect(messages[0]).toContain(`\`${at}\``);
      expect(messages[0]).toContain('auth: { type, credentialRef }');
      expect(messages[0]).not.toContain(PLACEHOLDER);
    });
  });

  describe('CONTROL: a string holding no credential part is accepted, surrounding whitespace or not', () => {
    it.each([
      ['a URL behind a leading space', rest(` ${CLEAN}`)],
      ['a URL with an ordinary query between a leading tab and a trailing carriage return', rest(`${TAB}${CLEAN}?region=eu${CR}`)],
      ['a string with no scheme and an ordinary query', rest('api.vendor.example.com/v1?region=eu')],
      ['a string with no scheme whose credential parameter is empty', rest('api.vendor.example.com/v1?token=')],
      ['a string that is not a URL', withNote('Billing API, EU region')],
      ['a string that is not a URL whose credential parameter is empty', withNote('for the next page append ?page=2&token=')],
    ] as const)('%s', (_label, entry) => accepts(entry));
  });

  describe('the read rewrites exactly what the write refuses, at the position the write judged', () => {
    it.each([
      [` https://user:${PLACEHOLDER}@api.vendor.example.com/v1`, ' https://api.vendor.example.com/v1'],
      [`${TAB}https://${PLACEHOLDER}@api.vendor.example.com/v1?page=2${LF}`, `${TAB}https://api.vendor.example.com/v1?page=2${LF}`],
      [` https://api.vendor.example.com/v1?api_key=${PLACEHOLDER}`, ' https://api.vendor.example.com/v1'],
      [` https://u:${PLACEHOLDER}@api.vendor.example.com/v1?region=eu&token=${PLACEHOLDER} `, ' https://api.vendor.example.com/v1?region=eu'],
      [`api.vendor.example.com/v1?page=2&token=${PLACEHOLDER}`, 'api.vendor.example.com/v1?page=2'],
    ] as const)('%j is served as %j', (stored, servedUrl) => {
      const entry = rest(stored);
      expect(refusals(entry).located).toEqual([['custom', 'providerConfig.baseUrl']]);
      const { item: served, redactedKeys } = redactConnectorItem(entry);
      expect(redactedKeys).toEqual(['providerConfig.baseUrl']);
      expect((served.providerConfig as Record<string, unknown>).baseUrl).toBe(servedUrl);
      // The served form is what the write door accepts: nothing it judges is left.
      accepts(served);
    });

    it('a credential query parameter in a string that is not a URL is rewritten the same way', () => {
      const entry = withNote(`see ?page=2&signature=${PLACEHOLDER}`);
      const { item: served, redactedKeys } = redactConnectorItem(entry);
      expect(redactedKeys).toEqual(['providerConfig.note']);
      expect((served.providerConfig as Record<string, unknown>).note).toBe('see ?page=2');
      accepts(served);
    });

    // `auth` endpoints are URLs by their own declared format, so a string with
    // no scheme is judged at a `providerConfig` position only.
    it.each([
      [` ${CLEAN}`, true],
      [`${TAB}${CLEAN}?region=eu${CR}`, true],
      [` https://user:${PLACEHOLDER}@api.vendor.example.com/v1`, true],
      [`${NUL}https://${PLACEHOLDER}@api.vendor.example.com/v1`, true],
      [` https://api.vendor.example.com/v1?apikey=${PLACEHOLDER}`, true],
      ['api.vendor.example.com/v1?token=', false],
      [`api.vendor.example.com/v1?token=${PLACEHOLDER}`, false],
      [`see ?page=2&token=${PLACEHOLDER}`, false],
    ] as const)('refused ⇔ rewritten: %j', (value, hasScheme) => {
      const entries = [rest(value), withNote(value), ...(hasScheme ? [oauth2({ tokenUrl: value })] : [])];
      for (const entry of entries) {
        const refused = !DeclarativeConnectorEntrySchema.safeParse(entry).success;
        const rewritten = redactConnectorItem(entry as Record<string, unknown>).redactedKeys.length > 0;
        expect(refused, 'refused ⇔ rewritten').toBe(rewritten);
      }
    });
  });
});

// The same rule, as a URL parser cleans a string: it also deletes every ASCII
// tab, LF and CR anywhere in it, so a value is judged with them deleted. And
// one userinfo grammar serves both doors: an authority starts at `scheme://`
// or a scheme-relative `//`.
describe('a URL is judged as a URL parser cleans it: tab and newline characters deleted, and one userinfo grammar at both doors', () => {
  const TAB = String.fromCharCode(0x09);
  const LF = String.fromCharCode(0x0a);
  const CR = String.fromCharCode(0x0d);
  const CLEAN = 'https://api.vendor.example.com/v1';
  const withNote = (note: string) => ({ ...rest(CLEAN), providerConfig: { baseUrl: CLEAN, note } });

  describe('REFUSED, located at the string', () => {
    it.each([
      ['a credential query parameter whose name holds a tab', rest(`${CLEAN}?page=2&api${TAB}_key=${PLACEHOLDER}`), 'providerConfig.baseUrl'],
      ['a credential query parameter whose name holds a newline, in a string that is not a URL', withNote(`see ?to${LF}ken=${PLACEHOLDER}`), 'providerConfig.note'],
      ['a userinfo behind a scheme that holds a tab', rest(`ht${TAB}tps://u:${PLACEHOLDER}@api.vendor.example.com/v1`), 'providerConfig.baseUrl'],
      ['a userinfo behind a `//` that holds a carriage return', rest(`https:/${CR}/${PLACEHOLDER}@api.vendor.example.com/v1`), 'providerConfig.baseUrl'],
      ['a userinfo in a scheme-relative authority', rest(`//u:${PLACEHOLDER}@api.vendor.example.com/v1`), 'providerConfig.baseUrl'],
      ['a userinfo in a scheme-relative authority, in a string that is not the base URL', withNote(`//${PLACEHOLDER}@hooks.vendor.example.com`), 'providerConfig.note'],
    ] as const)('%s', (_label, entry, at) => {
      const { located, messages } = refusals(entry);
      expect(located).toEqual([['custom', at]]);
      expect(messages[0]).toContain(`\`${at}\``);
      expect(messages[0]).toContain('auth: { type, credentialRef }');
      expect(messages[0]).not.toContain(PLACEHOLDER);
    });
  });

  describe('CONTROL: a value holding no credential part once cleaned is accepted', () => {
    it.each([
      ['an ordinary query parameter whose name holds a tab', rest(`${CLEAN}?reg${TAB}ion=eu`)],
      ['a credential query parameter whose value is only tab and newline characters', rest(`${CLEAN}?token=${TAB}${LF}`)],
      ['a scheme that holds a tab, with no userinfo', rest(`ht${TAB}tps://api.vendor.example.com/v1`)],
      ['a scheme-relative authority with no userinfo', rest('//api.vendor.example.com/v1')],
      ['an `@` in the path of a scheme-relative string', rest('//api.vendor.example.com/v1/users/@me')],
    ] as const)('%s', (_label, entry) => accepts(entry));
  });

  describe('the read rewrites exactly what the write refuses, at the matching position of the authored string', () => {
    it.each([
      [`${CLEAN}?page=2&api${TAB}_key=${PLACEHOLDER}`, `${CLEAN}?page=2`],
      [`ht${TAB}tps://u:${PLACEHOLDER}@api.vendor.example.com/v1`, `ht${TAB}tps://api.vendor.example.com/v1`],
      [`https:/${CR}/${PLACEHOLDER}@api.vendor.example.com/v1`, `https:/${CR}/api.vendor.example.com/v1`],
      [`//u:${PLACEHOLDER}@api.vendor.example.com/v1`, '//api.vendor.example.com/v1'],
      [` //u:${PLACEHOLDER}@api.vendor.example.com/v1?to${LF}ken=${PLACEHOLDER}&page=2`, ' //api.vendor.example.com/v1?page=2'],
      [`https://u${TAB}:${PLACEHOLDER}@api.vendor.example.com/v1`, CLEAN],
    ] as const)('%j is served as %j', (stored, servedUrl) => {
      const entry = rest(stored);
      expect(refusals(entry).located).toEqual([['custom', 'providerConfig.baseUrl']]);
      const { item: served, redactedKeys } = redactConnectorItem(entry);
      expect(redactedKeys).toEqual(['providerConfig.baseUrl']);
      expect((served.providerConfig as Record<string, unknown>).baseUrl).toBe(servedUrl);
      accepts(served);
    });

    it.each([
      `${CLEAN}?reg${TAB}ion=eu`,
      `${CLEAN}?token=${TAB}`,
      `${CLEAN}?api${TAB}_key=${PLACEHOLDER}`,
      `ht${TAB}tps://${PLACEHOLDER}@api.vendor.example.com/v1`,
      '//api.vendor.example.com/v1',
      `//u:${PLACEHOLDER}@api.vendor.example.com/v1`,
      `see ?to${CR}ken=${PLACEHOLDER}`,
    ])('refused ⇔ rewritten: %j', (value) => {
      for (const entry of [rest(value), withNote(value)]) {
        const refused = !DeclarativeConnectorEntrySchema.safeParse(entry).success;
        const rewritten = redactConnectorItem(entry as Record<string, unknown>).redactedKeys.length > 0;
        expect(refused, 'refused ⇔ rewritten').toBe(rewritten);
      }
    });
  });
});

// A URL with a special scheme — `http`, `https`, `ws`, `wss`, `ftp`, in any
// letter case — is read for credentials the way a URL parser reads it: its
// authority starts after the whole run of `/` and `\` that follows the scheme,
// however long, none included. Every other scheme keeps `scheme://` (or a
// scheme-relative `//`), and `file:` carries no userinfo. Both doors read the
// one grammar, so the write refusal and the read rewrite move together.
describe('a URL with a special scheme is read for credentials the way a URL parser reads it, however many slashes follow the scheme', () => {
  const BS = String.fromCharCode(0x5c);
  const HOST = 'api.vendor.example.com/v1';
  const withNote = (note: string) => ({ ...rest(`https://${HOST}`), providerConfig: { baseUrl: `https://${HOST}`, note } });
  /** [form, the scheme and the run after it] — `s` is the scheme. */
  const FORMS: Array<[string, (s: string) => string]> = [
    ['no slash', (s) => `${s}:`],
    ['one slash', (s) => `${s}:/`],
    ['a backslash', (s) => `${s}:${BS}`],
    ['three slashes', (s) => `${s}:///`],
    ['a run of slashes and backslashes', (s) => `${s}:/${BS}/`],
    ['an uppercase scheme and no slash', (s) => `${s.toUpperCase()}:`],
    ['an uppercase scheme and three slashes', (s) => `${s.toUpperCase()}:///`],
  ];
  const leadsOf = (schemes: readonly string[]) =>
    schemes.flatMap((scheme) => FORMS.map(([form, lead]) => [`\`${scheme}:\` with ${form}`, lead(scheme)] as [string, string]));
  const SPECIAL = leadsOf(['http', 'https', 'ws', 'wss', 'ftp']);
  const NO_AUTHORITY = leadsOf(['file', 'postgres', 'libsql']).filter(([, lead]) => !lead.endsWith('///'));

  describe('REFUSED at the string, and the read rewrites it at the position the write judged', () => {
    it.each(SPECIAL)('a userinfo after %s', (_label, lead) => {
      for (const userinfo of [`u:${PLACEHOLDER}@`, `${PLACEHOLDER}@`]) {
        const entry = rest(`${lead}${userinfo}${HOST}`);
        const { located, messages } = refusals(entry);
        expect(located).toEqual([['custom', 'providerConfig.baseUrl']]);
        expect(messages[0]).toContain('auth: { type, credentialRef }');
        expect(messages[0]).not.toContain(PLACEHOLDER);
        const { item: served, redactedKeys } = redactConnectorItem(entry);
        expect(redactedKeys).toEqual(['providerConfig.baseUrl']);
        expect((served.providerConfig as Record<string, unknown>).baseUrl).toBe(`${lead}${HOST}`);
        accepts(served);
      }
    });

    it.each(SPECIAL)('a userinfo after %s, in a string that is not the base URL', (_label, lead) => {
      const entry = withNote(`${lead}u:${PLACEHOLDER}@hooks.vendor.example.com`);
      expect(refusals(entry).located).toEqual([['custom', 'providerConfig.note']]);
      const { item: served, redactedKeys } = redactConnectorItem(entry);
      expect(redactedKeys).toEqual(['providerConfig.note']);
      expect((served.providerConfig as Record<string, unknown>).note).toBe(`${lead}hooks.vendor.example.com`);
      accepts(served);
    });
  });

  describe('CONTROL: what a URL parser reads no userinfo from is accepted and served as stored', () => {
    it.each(SPECIAL)('a URL after %s with no userinfo, and with an `@` only in its path', (_label, lead) => {
      for (const value of [`${lead}${HOST}`, `${lead}${HOST}/users/@me`]) {
        accepts(rest(value));
        expect(redactConnectorItem(rest(value)).redactedKeys).toEqual([]);
      }
    });

    it.each(NO_AUTHORITY)('no authority without `//` after a scheme that is not special, or `file:` — %s', (_label, lead) => {
      const value = `${lead}u:${PLACEHOLDER}@${HOST}`;
      accepts(rest(value));
      expect(redactConnectorItem(rest(value)).redactedKeys).toEqual([]);
    });

    it.each(['file', 'postgres', 'libsql'])('a `%s:///` authority is empty, so what follows the third slash is path', (scheme) => {
      const value = `${scheme}:///u:${PLACEHOLDER}@${HOST}`;
      accepts(rest(value));
      expect(redactConnectorItem(rest(value)).redactedKeys).toEqual([]);
    });

    it('the `//` forms keep their reading: a userinfo after `scheme://` or `//` is refused, none is accepted', () => {
      for (const value of [`https://u:${PLACEHOLDER}@${HOST}`, `postgres://u:${PLACEHOLDER}@${HOST}`, `//u:${PLACEHOLDER}@${HOST}`]) {
        expect(refusals(rest(value)).located).toEqual([['custom', 'providerConfig.baseUrl']]);
      }
      for (const value of [`https://${HOST}`, `postgres://${HOST}`, `//${HOST}`]) accepts(rest(value));
    });
  });

  it.each([...SPECIAL, ...NO_AUTHORITY])('refused ⇔ rewritten after %s', (_label, lead) => {
    for (const value of [`${lead}u:${PLACEHOLDER}@${HOST}`, `${lead}${PLACEHOLDER}@${HOST}`, `${lead}${HOST}`]) {
      for (const entry of [rest(value), withNote(value)]) {
        const refused = !DeclarativeConnectorEntrySchema.safeParse(entry).success;
        const rewritten = redactConnectorItem(entry as Record<string, unknown>).redactedKeys.length > 0;
        expect(refused, 'refused ⇔ rewritten').toBe(rewritten);
      }
    }
  });
});

// Whatever a URL parser reads a credential from is judged as a URL, at the
// write door and the read door alike. A provider builds its request with
// `new URL()` (the rest and openapi `baseUrl`, the mcp `transport.url`, a URL
// openapi `spec`), so the parser itself is the oracle here: every spelling
// below is one it reads a userinfo or a credential query parameter from, and
// at every provider URL position the entry is refused at that position, while
// the read serves a value the parser reads no credential from.
describe('whatever a URL parser reads a credential from is refused on write and withheld on read, at every provider URL position', () => {
  const BS = String.fromCharCode(0x5c);
  const TAB = String.fromCharCode(0x09);

  const openapiBase = (baseUrl: string) => ({
    ...openapi('openapi/billing.json'),
    providerConfig: { spec: 'openapi/billing.json', baseUrl },
  });
  /** [position label, the entry holding `url` there, the path it sits at]. */
  const POSITIONS: Array<[string, (url: string) => Record<string, unknown>, string]> = [
    ['the rest `baseUrl`', (url) => rest(url), 'providerConfig.baseUrl'],
    ['the mcp `transport.url`', (url) => mcp(url), 'providerConfig.transport.url'],
    ['the openapi `spec` URL', (url) => openapi(url), 'providerConfig.spec'],
    ['the openapi `baseUrl`', (url) => openapiBase(url), 'providerConfig.baseUrl'],
  ];
  const valueAt = (item: Record<string, unknown>, path: string): unknown =>
    path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], item);

  const CREDENTIAL_PARAMS = CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES.map((name) => name.toLowerCase());
  /** Whether a URL parser reads a userinfo or a credential query parameter from `value`. */
  const parserReadsCredential = (value: string): boolean => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return url.username !== ''
      || url.password !== ''
      || [...url.searchParams].some(([name, v]) => v !== '' && CREDENTIAL_PARAMS.includes(name.toLowerCase()));
  };

  /** Refused at `at`, withheld by the read, and the served value carries nothing a URL parser reads as a credential. */
  const judgedAtBothDoors = (entry: Record<string, unknown>, at: string): void => {
    const { located, messages } = refusals(entry);
    expect(located).toEqual([['custom', at]]);
    expect(messages[0]).not.toContain(PLACEHOLDER);
    const { item: served, redactedKeys } = redactConnectorItem(entry);
    expect(redactedKeys).toEqual([at]);
    expect(JSON.stringify(served)).not.toContain(PLACEHOLDER);
    const servedValue = valueAt(served, at);
    expect(typeof servedValue).toBe('string');
    expect(parserReadsCredential(servedValue as string), `served ${JSON.stringify(servedValue)}`).toBe(false);
    accepts(served);
  };

  /** [spelling, a value a URL parser reads a credential from]. */
  const SPELLINGS: Array<[string, string]> = [
    ['a userinfo behind a leading space', ` https://u:${PLACEHOLDER}@h.example/v1`],
    ['a userinfo behind a leading tab', `${TAB}https://${PLACEHOLDER}@h.example/v1`],
    ['a userinfo after one slash', `https:/u:${PLACEHOLDER}@h.example/v1`],
    ['a userinfo after no slash', `https:u:${PLACEHOLDER}@h.example/v1`],
    ['a userinfo after backslashes', `https:${BS}${BS}u:${PLACEHOLDER}@h.example${BS}v1`],
    ['a query credential behind a leading space', ` https://h.example/v1?api_key=${PLACEHOLDER}`],
    ['a query credential behind a leading tab', `${TAB}https://h.example/v1?token=${PLACEHOLDER}`],
    ['a query credential after one slash', `https:/h.example/v1?token=${PLACEHOLDER}`],
    ['a query credential after no slash', `https:h.example/v1?token=${PLACEHOLDER}`],
    ['a query credential after backslashes', `https:${BS}${BS}h.example${BS}v1?token=${PLACEHOLDER}`],
    ['a userinfo and a query credential after one slash, behind a leading tab', `${TAB}https:/u:${PLACEHOLDER}@h.example/v1?sig=${PLACEHOLDER}`],
  ];

  describe.each(POSITIONS)('at %s', (_position, entryWith, at) => {
    it.each(SPELLINGS)('%s', (_spelling, value) => {
      expect(parserReadsCredential(value), 'the URL parser reads a credential from this spelling').toBe(true);
      judgedAtBothDoors(entryWith(value), at);
    });

    it('CONTROL: the same spellings with no credential part are accepted and served as stored', () => {
      for (const value of [' https://h.example/v1', `${TAB}https://h.example/v1?page=2`, 'https:/h.example/v1', 'https:h.example/v1', `https:${BS}${BS}h.example${BS}v1`]) {
        expect(parserReadsCredential(value)).toBe(false);
        const entry = entryWith(value);
        accepts(entry);
        const { item: served, redactedKeys } = redactConnectorItem(entry);
        expect(redactedKeys).toEqual([]);
        expect(valueAt(served, at)).toBe(value);
      }
    });
  });

  // Every C0 control character and the space, U+0000 to U+0020, is what a URL
  // parser trims from both ends of a URL before it reads it — the whole range,
  // not only the whitespace a regular expression's `\s` names.
  const C0_AND_SPACE = Array.from({ length: 0x21 }, (_, code) => code);
  const hex = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

  describe.each(C0_AND_SPACE.map((code) => [hex(code), String.fromCharCode(code)] as [string, string]))('%s, leading or trailing', (_label, c) => {
    const values = [
      `${c}https:/u:${PLACEHOLDER}@h.example/v1`,
      `https:/u:${PLACEHOLDER}@h.example/v1${c}`,
      `${c}${c}https:h.example/v1?token=${PLACEHOLDER}${c}`,
    ];

    it.each(POSITIONS)('is trimmed before the credential is judged, at %s', (_position, entryWith, at) => {
      for (const value of values) {
        expect(parserReadsCredential(value), JSON.stringify(value)).toBe(true);
        judgedAtBothDoors(entryWith(value), at);
      }
    });

    it('CONTROL: around a URL with no credential part, it is accepted and served as stored', () => {
      const value = `${c}https:/h.example/v1?page=2${c}`;
      for (const [, entryWith, at] of POSITIONS) {
        accepts(entryWith(value));
        const { item: served, redactedKeys } = redactConnectorItem(entryWith(value));
        expect(redactedKeys).toEqual([]);
        expect(valueAt(served, at)).toBe(value);
      }
    });
  });
});
