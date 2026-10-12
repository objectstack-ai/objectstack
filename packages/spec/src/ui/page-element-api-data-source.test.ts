// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23016 — a page element's `dataSource` gains a second shape, the API binding
 * `{ provider: 'api', read: { url, method? }, path? }`, beside the object one.
 *
 * The maintainer's ruling, and the triage grade that sets what these pins owe:
 *
 * - "`url` is a same-origin API path"; "Same-origin only. No credentials in
 *   metadata; the console's authenticated fetch is reused. A cross-origin
 *   `url` is refused at parse with a migration-named message."
 * - "The parse-time refusal covers every cross-origin URL class, not only an
 *   absolute `http(s)` URL, and the pins name each class."
 *
 * So the refusal battery below is one row per CLASS the schema names, each
 * asserted on the issue envelope (code + path) and on the class the message
 * names — never on the full prose — and the projection pins hold the published
 * JSON Schema `pattern` to the same verdicts, so a validator reading
 * `json-schema/` refuses exactly what the parse refuses.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ElementApiDataSourceSchema,
  ElementDataSourceSchema,
  PageComponentSchema,
  PageSchema,
  type ElementApiDataSource,
} from './page.zod';

type Issue = { path: PropertyKey[]; code: string; message: string; errors?: Issue[][] };

/**
 * Every issue a parse raised, with each `invalid_union` branch flattened in
 * under the union's own path — the API arm's refusal is read wherever the
 * union's selection put it, so these pins do not depend on zod returning the
 * lone non-aborted branch directly.
 */
function flatIssues(issues: readonly Issue[], prefix: PropertyKey[] = []): Issue[] {
  const out: Issue[] = [];
  for (const issue of issues) {
    const path = [...prefix, ...issue.path];
    out.push({ ...issue, path });
    if (issue.code === 'invalid_union' && issue.errors) {
      for (const branch of issue.errors) out.push(...flatIssues(branch, path));
    }
  }
  return out;
}

const issuesAt = (result: { success: boolean; error?: { issues: unknown[] } }, path: string): Issue[] =>
  result.success ? [] : flatIssues(result.error!.issues as Issue[]).filter((i) => i.path.join('.') === path);

/** A component bound through the API arm, reading `url`. */
const apiComponent = (read: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  PageComponentSchema.safeParse({ type: 'stat', dataSource: { provider: 'api', read, ...extra } });

describe('page element dataSource — both shapes parse (#23016 acceptance 1)', () => {
  it('the object binding still parses at the component door, unchanged', () => {
    const r = PageComponentSchema.safeParse({
      type: 'element:number',
      properties: { aggregate: 'count' },
      dataSource: { object: 'order', view: 'open', limit: 5 },
    });
    expect(r.success).toBe(true);
    expect(r.data!.dataSource).toEqual({ object: 'order', view: 'open', limit: 5 });
  });

  it('the API binding parses — the ruling\'s own example, with and without `path` and `method`', () => {
    const bare = apiComponent({ url: '/api/v1/cloud/home' });
    expect(bare.success).toBe(true);
    expect(bare.data!.dataSource).toEqual({ provider: 'api', read: { url: '/api/v1/cloud/home' } });

    const full = apiComponent({ url: '/api/v1/cloud/home', method: 'GET' }, { path: 'data.environments' });
    expect(full.success).toBe(true);
    const ds: ElementApiDataSource = {
      provider: 'api',
      read: { url: '/api/v1/cloud/home', method: 'GET' },
      path: 'data.environments',
    };
    expect(full.data!.dataSource).toEqual(ds);
  });

  it('a page carries both shapes side by side', () => {
    const r = PageSchema.safeParse({
      name: 'cloud_home',
      label: 'Home',
      type: 'app',
      regions: [{
        name: 'main',
        components: [
          { type: 'stat', dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data.plan' } },
          { type: 'list-view', dataSource: { object: 'account', limit: 10 } },
        ],
      }],
    });
    expect(r.success).toBe(true);
  });

  it('the object shape is not widened: `ElementDataSourceSchema` alone still refuses `provider`', () => {
    // The API arm is told apart by `provider: 'api'`; the object arm grew no
    // `provider: 'object'` spelling of its own.
    const r = ElementDataSourceSchema.safeParse({ provider: 'object', object: 'account' });
    expect(r.success).toBe(false);
    expect(issuesAt(r, '').map((i) => i.code)).toEqual(['unrecognized_keys']);
  });
});

describe('`read.url` — same-origin API path only; every cross-origin class is refused at parse', () => {
  it.each([
    ['/api/v1/cloud/home'],
    ['/api/v1/cloud/home?environment=prod&limit=5'],
    ['/'],
  ])('admits the same-origin path %j', (url) => {
    expect(apiComponent({ url }).success).toBe(true);
  });

  // [class, the subject the refusal names for it, the refused values]
  const CLASSES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['scheme — an absolute URL of any scheme', 'absolute URL', [
      'https://evil.example/api', 'http://evil.example/api', 'HTTPS://evil.example/api',
      'javascript:alert(1)', 'data:application/json,{}', 'mailto:ops@evil.example',
      'localhost:3000/api/v1/x',
    ]],
    ['protocol-relative — `//host`', 'protocol-relative', ['//evil.example/api']],
    ['backslash read as a slash — `/` then a backslash, or a backslash first', 'backslash', [
      '/\\evil.example/api', '\\\\evil.example/api', '\\/evil.example/api',
    ]],
    ['whitespace or control — a tab, line feed or carriage return anywhere, a space at an end', 'control character', [
      '/\t/evil.example/api', '/\n/evil.example/api', '/\r/evil.example/api',
      ' //evil.example/api', '/api/v1/cloud/home ', '/api/v1/a b',
    ]],
    ['relative — no leading `/`, resolved against the page, never the API', 'relative path', [
      './home', '../home', 'api/v1/cloud/home', '?q=1', '#home', '',
    ]],
  ];

  for (const [klass, subject, values] of CLASSES) {
    describe(klass, () => {
      it.each(values.map((v) => [v]))('refuses %j at `dataSource.read.url`, naming the class', (url) => {
        const r = apiComponent({ url });
        expect(r.success).toBe(false);
        const at = issuesAt(r, 'dataSource.read.url');
        expect(at.map((i) => i.code)).toEqual(['invalid_format']);
        expect(at[0].message).toContain(subject);
        // The rule and the fix ride every class; the value is never echoed
        // (a pasted URL may carry a credential), so its host never appears.
        expect(at[0].message).toContain('same-origin API path');
        expect(at[0].message).not.toContain('evil.example');
      });
    });
  }

  it('the published JSON Schema carries the rule as `pattern`, and it agrees with the parse on every value above', () => {
    // A `.regex()` projects exactly; a refinement would be dropped from the
    // published file, and a validator reading `json-schema/` would accept a
    // URL the parse refuses.
    const json = z.toJSONSchema(ElementApiDataSourceSchema) as {
      properties: { read: { properties: Record<string, { pattern?: string }> } };
    };
    const pattern = json.properties.read.properties.url.pattern;
    expect(typeof pattern).toBe('string');
    const published = new RegExp(pattern!, 'u');
    for (const [, , values] of CLASSES) {
      for (const url of values) expect(published.test(url), JSON.stringify(url)).toBe(false);
    }
    for (const url of ['/api/v1/cloud/home', '/api/v1/cloud/home?environment=prod', '/']) {
      expect(published.test(url), url).toBe(true);
    }
  });
});

describe('no credential in metadata — the console\'s signed-in fetch is reused', () => {
  it('the read block declares `url` and `method` and nothing else; the binding declares no credential key', () => {
    const json = z.toJSONSchema(ElementApiDataSourceSchema) as {
      properties: Record<string, { properties?: Record<string, unknown>; additionalProperties?: unknown }>;
      additionalProperties?: unknown;
    };
    expect(Object.keys(json.properties).sort()).toEqual(['path', 'provider', 'read']);
    expect(Object.keys(json.properties.read.properties!).sort()).toEqual(['method', 'url']);
    expect(json.additionalProperties).toBe(false);
    expect(json.properties.read.additionalProperties).toBe(false);
  });

  it.each([
    ['headers', { headers: { Authorization: 'Bearer x' } }],
    ['credentials', { credentials: 'include' }],
    ['token', { token: 'x' }],
    ['apiKey', { apiKey: 'x' }],
  ])('a `%s` key on the read block is refused, with the reuse prescription', (key, extra) => {
    const r = apiComponent({ url: '/api/v1/cloud/home', ...extra });
    expect(r.success).toBe(false);
    const at = issuesAt(r, 'dataSource.read');
    expect(at.map((i) => i.code)).toContain('unrecognized_keys');
    expect(at.find((i) => i.code === 'unrecognized_keys')!.message).toContain('signed-in');
  });
});

describe('`read.method` — the closed set the renderer sends', () => {
  it('admits `GET` and an omitted method', () => {
    expect(apiComponent({ url: '/api/x', method: 'GET' }).success).toBe(true);
    expect(apiComponent({ url: '/api/x' }).success).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'get'])('refuses %j at `dataSource.read.method`', (method) => {
    const r = apiComponent({ url: '/api/x', method });
    expect(r.success).toBe(false);
    expect(issuesAt(r, 'dataSource.read.method').map((i) => i.code)).toEqual(['invalid_value']);
  });
});

describe('`path` — a dotted path into the response', () => {
  it.each(['data', 'data.environments', 'data.items.0', 'data.ai_seats', 'data.plan-tier'])('admits %j', (path) => {
    expect(apiComponent({ url: '/api/x' }, { path }).success).toBe(true);
  });

  it.each(['$.data', 'data[0]', 'data..items', '.data', 'data.', 'data/items', 'data items', ''])(
    'refuses %j at `dataSource.path`',
    (path) => {
      const r = apiComponent({ url: '/api/x' }, { path });
      expect(r.success).toBe(false);
      expect(issuesAt(r, 'dataSource.path').map((i) => i.code)).toEqual(['invalid_format']);
    },
  );
});

describe('the API arm is closed', () => {
  it.each([
    ['object', { object: 'account' }],
    ['write', { write: { url: '/api/x' } }],
    ['url', { url: '/api/x' }],
  ])('refuses a top-level `%s` on the API binding', (key, extra) => {
    const r = ElementApiDataSourceSchema.safeParse({ provider: 'api', read: { url: '/api/x' }, ...extra });
    expect(r.success).toBe(false);
    expect(issuesAt(r, '').map((i) => i.code)).toEqual(['unrecognized_keys']);
  });

  it('requires `read`', () => {
    const r = ElementApiDataSourceSchema.safeParse({ provider: 'api' });
    expect(r.success).toBe(false);
    expect(issuesAt(r, 'read').map((i) => i.code)).toEqual(['invalid_type']);
  });
});
