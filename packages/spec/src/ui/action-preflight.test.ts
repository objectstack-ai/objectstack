// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#31840 — `ActionSchema.preflight`: one same-origin `GET` the
// param dialog sends before submit, whose answer it shows above the params and
// from which it may seed params. The console half is #31808.
//
// These pins hold the spec half: the cloud-shaped example parses, and each
// refusal class fires at parse with its issue path. Each refusal is asserted
// on the issue envelope (code + path) and on the slot or class the message
// names, never on the full prose. The page element read's own behaviour after
// the shared-module move is pinned in `page-element-api-data-source.test.ts`.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ActionSchema, InlineActionSchema } from './action.zod';

/** The parent card's cloud-shaped example (step-1 report, option A). */
const cloud = {
  name: 'install_package',
  label: 'Install Package',
  type: 'api',
  target: '/api/v1/cloud/packages/${ctx.recordId}/install',
  params: [
    { name: 'environment_id', type: 'lookup', reference: 'sys_environment', required: true },
    { name: 'version', type: 'text', required: true },
    { name: 'confirm_schema_upgrade', label: 'Schema change confirmation', type: 'text', required: true },
  ],
  preflight: {
    read: {
      url: '/api/v1/cloud/packages/${ctx.recordId}/upgrade-plan?environment_id=${param.environment_id}&version=${param.version}',
    },
    path: 'data',
    fields: [{ path: 'findings', label: 'Schema findings', format: 'json' }],
    seed: [{ param: 'confirm_schema_upgrade', path: 'verdict.findingSet' }],
  },
} as const;

type Preflight = Record<string, unknown>;
const withPreflight = (preflight: Preflight, extra: Record<string, unknown> = {}) =>
  ActionSchema.safeParse({ ...cloud, ...extra, preflight: { ...cloud.preflight, ...preflight } });
const withUrl = (url: string, extra: Record<string, unknown> = {}) => withPreflight({ read: { url } }, extra);

type Issue = { path: PropertyKey[]; code: string; message: string };
const issuesAt = (result: { success: boolean; error?: { issues: unknown[] } }, path: string): Issue[] =>
  result.success ? [] : (result.error!.issues as Issue[]).filter((i) => i.path.join('.') === path);

describe('ActionSchema.preflight — the parse', () => {
  it('the cloud-shaped example parses, and the key is kept as written', () => {
    const r = ActionSchema.safeParse(cloud);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(r.success && r.data.preflight).toEqual(cloud.preflight);
  });

  it('`read` alone is a whole preflight: no path, fields or seed, and `method: \'GET\'` is admitted', () => {
    const r = ActionSchema.safeParse({ ...cloud, preflight: { read: { url: '/api/v1/x', method: 'GET' } } });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it.each([
    ['/api/v1/x/${ctx.recordId}'],
    ['/api/v1/x?owner=${ctx.record.owner}'],
    ['/api/v1/x?v=${param.version}&e=${param.environment_id}'],
    ['/'],
  ])('admits the closed hole set and plain paths: %j', (url) => {
    const r = withUrl(url);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('a param named by `field` (no `name`) is a declared param for holes and seeds', () => {
    const r = ActionSchema.safeParse({
      ...cloud,
      params: [{ field: 'stage' }, { name: 'token', type: 'text' }],
      preflight: { read: { url: '/api/v1/x?stage=${param.stage}' }, seed: [{ param: 'token', path: 'token' }] },
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('`execution: \'perRecord\'` and an omitted `execution` both carry a preflight', () => {
    expect(ActionSchema.safeParse({ ...cloud, execution: 'perRecord' }).success).toBe(true);
  });

  it('an inline action does not pick `preflight`: its host draws no param-dialog read', () => {
    const r = InlineActionSchema.safeParse({ type: 'api', target: '/api/v1/x', params: cloud.params, preflight: cloud.preflight });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });
});

describe('refusal 1 — `read.url` is a same-origin API path, the class named', () => {
  // [class, the subject the refusal names for it, the refused values]
  const CLASSES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['scheme', 'absolute URL', ['https://evil.example/api', 'javascript:alert(1)', 'data:application/json,{}']],
    ['protocol-relative', 'protocol-relative', ['//evil.example/api']],
    ['backslash', 'backslash', ['/\\evil.example/api', '\\\\evil.example/api']],
    ['whitespace or control', 'control character', ['/\t/evil.example/api', ' //evil.example/api', '/api/a b']],
    ['relative', 'relative path', ['./home', 'api/v1/x', '']],
  ];
  for (const [klass, subject, values] of CLASSES) {
    it.each(values.map((v) => [v]))(`${klass}: refuses %j at \`preflight.read.url\``, (url) => {
      const at = issuesAt(withUrl(url), 'preflight.read.url');
      expect(at.map((i) => i.code)).toEqual(['invalid_format']);
      expect(at[0].message).toContain('`preflight.read.url`');
      expect(at[0].message).toContain(subject);
      expect(at[0].message).not.toContain('evil.example');
    });
  }

  it('a URL that opens with a hole is refused once, naming the hole as the cause', () => {
    const at = issuesAt(withUrl('${ctx.origin}/api/v1/x'), 'preflight.read.url');
    expect(at.map((i) => i.code)).toEqual(['invalid_format']);
    expect(at[0].message).toContain('`${…}` hole');
  });

  it('the published JSON Schema carries the rule as `pattern`, the page element read\'s own', () => {
    const json = z.toJSONSchema(ActionSchema, { io: 'input', unrepresentable: 'any' }) as unknown as {
      properties: { preflight: { properties: { read: { properties: { url: { pattern: string } } } } } };
    };
    const pattern = json.properties.preflight.properties.read.properties.url.pattern;
    expect(pattern).toBe(String.raw`^\/(?:[^/\\\x00-\x20\x7F][^\x00-\x20\x7F]*)?$`);
    const published = new RegExp(pattern, 'u');
    for (const [, , values] of CLASSES) for (const url of values) expect(published.test(url), url).toBe(false);
    expect(published.test(cloud.preflight.read.url)).toBe(true);
  });
});

describe('refusal 2 — `read.method` is `GET`', () => {
  it.each([['POST'], ['get'], ['DELETE']])('refuses %j at `preflight.read.method`', (method) => {
    const at = issuesAt(withPreflight({ read: { url: '/api/v1/x', method } }), 'preflight.read.method');
    expect(at.map((i) => i.code)).toEqual(['invalid_value']);
  });
});

describe('refusal 3 — a credential-shaped or unknown key', () => {
  it.each([['headers'], ['auth'], ['authorization'], ['token'], ['credentials'], ['apiKey']])(
    'refuses `%s` in the read block and on the preflight, with the no-credentials guidance',
    (key) => {
      for (const [r, path] of [
        [withPreflight({ read: { url: '/api/v1/x', [key]: 'x' } }), 'preflight.read'],
        [withPreflight({ [key]: 'x' }), 'preflight'],
      ] as const) {
        const at = issuesAt(r, path);
        expect(at.map((i) => i.code)).toEqual(['unrecognized_keys']);
        expect(at[0].message).toContain('signed-in');
      }
    },
  );

  it.each([['body'], ['params']])('refuses `%s` in the read block: a preflight is a bodyless GET', (key) => {
    const at = issuesAt(withPreflight({ read: { url: '/api/v1/x', [key]: {} } }), 'preflight.read');
    expect(at.map((i) => i.code)).toEqual(['unrecognized_keys']);
  });

  it('refuses `title` with the generic-heading guidance, and an unknown key by name', () => {
    const title = issuesAt(withPreflight({ title: 'Upgrade plan' }), 'preflight');
    expect(title.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(title[0].message).toContain('generic translated heading');
    expect(issuesAt(withPreflight({ cache: true }), 'preflight').map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(issuesAt(withPreflight({ seed: [{ param: 'confirm_schema_upgrade', path: 'a', when: 'x' }] }), 'preflight.seed.0')
      .map((i) => i.code)).toEqual(['unrecognized_keys']);
  });

  it('`fields` is `resultDialog.fields`\' row: its aliases and its format set', () => {
    const alias = issuesAt(withPreflight({ fields: [{ key: 'findings' }] }), 'preflight.fields.0');
    expect(alias.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect(alias[0].message).toContain('path');
    const format = issuesAt(withPreflight({ fields: [{ path: 'findings', format: 'table' }] }), 'preflight.fields.0.format');
    expect(format.map((i) => i.code)).toEqual(['invalid_value']);
  });

  it.each([['$.data'], ['data/findings'], ['data[0]']])('refuses the answer path %j on `path` and on a seed', (path) => {
    expect(issuesAt(withPreflight({ path }), 'preflight.path').map((i) => i.code)).toEqual(['invalid_format']);
    expect(issuesAt(withPreflight({ seed: [{ param: 'confirm_schema_upgrade', path }] }), 'preflight.seed.0.path')
      .map((i) => i.code)).toEqual(['invalid_format']);
  });
});

describe('refusal 4 — a hole outside the closed set, or one naming no declared param', () => {
  it.each([
    ['/api/v1/x/${result.id}', '${result.id}'],
    ['/api/v1/x?o=${ctx.origin}', '${ctx.origin}'],
    ['/api/v1/x?u=${ctx.user.id}', '${ctx.user.id}'],
    ['/api/v1/x?r=${ctx.record.owner.name}', '${ctx.record.owner.name}'],
    ['/api/v1/x?v=${param.version.major}', '${param.version.major}'],
    ['/api/v1/x?v=${version}', '${version}'],
  ])('refuses %j at `preflight.read.url`, naming the hole', (url, hole) => {
    const at = issuesAt(withUrl(url), 'preflight.read.url');
    expect(at.map((i) => i.code)).toEqual(['custom']);
    expect(at[0].message).toContain(hole);
  });

  it('`${result.*}` is refused because there is no answer before the read', () => {
    expect(issuesAt(withUrl('/api/v1/x/${result.id}'), 'preflight.read.url')[0].message).toContain('no result yet');
  });

  it('refuses a `${param.NAME}` naming no declared param', () => {
    const at = issuesAt(withUrl('/api/v1/x?v=${param.release}'), 'preflight.read.url');
    expect(at.map((i) => i.code)).toEqual(['custom']);
    expect(at[0].message).toContain('`release`');
  });

  it('refuses an unterminated `${`', () => {
    const at = issuesAt(withUrl('/api/v1/x?v=${param.version'), 'preflight.read.url');
    expect(at.map((i) => i.code)).toEqual(['custom']);
    expect(at[0].message).toContain('never closes');
  });
});

describe('refusal 5 — no non-empty `params`, so no param dialog opens', () => {
  it.each([[undefined], [[]]])('refuses `preflight` on an action whose params are %j', (params) => {
    const r = ActionSchema.safeParse({ ...cloud, params, preflight: { read: { url: '/api/v1/x' } } });
    const at = issuesAt(r, 'preflight');
    expect(at.map((i) => i.code)).toEqual(['custom']);
    expect(at[0].message).toContain('declares no `params`');
  });
});

describe('refusal 6 — a seed must fill one declared, answer-owned param', () => {
  it('refuses a seed naming no declared param', () => {
    const at = issuesAt(withPreflight({ seed: [{ param: 'token', path: 'token' }] }), 'preflight.seed.0.param');
    expect(at.map((i) => i.code)).toEqual(['custom']);
    expect(at[0].message).toContain('`token`');
  });

  it('refuses a param seeded twice, at the second seed', () => {
    const r = withPreflight({
      seed: [{ param: 'confirm_schema_upgrade', path: 'a' }, { param: 'confirm_schema_upgrade', path: 'b' }],
    });
    expect(issuesAt(r, 'preflight.seed.0.param')).toEqual([]);
    const at = issuesAt(r, 'preflight.seed.1.param');
    expect(at.map((i) => i.code)).toEqual(['custom']);
    expect(at[0].message).toContain('seeded twice');
  });

  it.each([
    ['defaultValue', { defaultValue: 'yes' }],
    ['defaultFromRow', { defaultFromRow: true }],
    ['carryOver', { defaultFromRow: true, carryOver: true }],
  ])('refuses a seeded param that declares `%s`', (key, extra) => {
    const r = ActionSchema.safeParse({
      ...cloud,
      params: [cloud.params[0], cloud.params[1], { ...cloud.params[2], ...extra }],
    });
    const at = issuesAt(r, 'preflight.seed.0.param');
    expect(at.map((i) => i.code)).toEqual(['custom']);
    expect(at[0].message).toContain(`\`${key}\``);
  });

  it('refuses a seeded param that a hole of the read reads (a cycle)', () => {
    const at = issuesAt(withPreflight({ seed: [{ param: 'version', path: 'latest' }] }), 'preflight.seed.0.param');
    expect(at.map((i) => i.code)).toEqual(['custom']);
    expect(at[0].message).toContain('read by a hole');
  });
});

describe('refusal 7 — not beside `execution: \'aggregate\'`', () => {
  it('refuses `preflight` on an aggregate action, at `preflight`', () => {
    const at = issuesAt(ActionSchema.safeParse({ ...cloud, execution: 'aggregate' }), 'preflight');
    expect(at.map((i) => i.code)).toEqual(['custom']);
    expect(at[0].message).toContain('`execution: \'aggregate\'`');
  });
});
