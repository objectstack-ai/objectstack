// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24882 — the format each specifier TYPE declares (ADR-0007: `email` / `url` /
 * `phone` "format validation", `color` "hex string") is judged at both doors
 * and REFUSED.
 *
 * Refusing these values narrows what the settings door accepted, and no
 * ADR-0087 conversion can carry that: stored values are runtime state and an
 * `OS_*` override is a deployment's environment. Under the standing rule 「甲」
 * as the maintainer amended it, such a narrowing ships now, as a breaking
 * minor. These pins hold each part of it:
 *
 *  - SAVE DOOR: a malformed value answers `400 SETTINGS_VALIDATION` with one
 *    `FieldError` naming the key and the ADR-0114 code the verdict carries
 *    (`invalid_email` / `invalid_url` / `invalid_phone` / `invalid_format`), and
 *    nothing is stored. A well-formed value saves.
 *  - ENV DOOR: a malformed override is rejected the way every other family's
 *    miss is — not in force, reported once at `error`, never printing the
 *    value — and the key resolves from the stored value, else the default. A
 *    well-formed override is in force.
 *  - STORED ROWS: a value stored before the check existed is still served by
 *    every read, and it does not block a save that does not touch its key.
 *
 * The save door is driven through the real route (`registerSettingsRoutes`
 * over a real `SettingsService`, as `settings-routes.test.ts` does); the env
 * door through the service's own read and write paths, which is where an
 * override takes effect. Shipped manifests are used wherever a shipped key has
 * the type; `phone`, a secret-bearing key and a `visible`-gated key are
 * synthetic because no shipped manifest authors them, and each fixture is
 * parsed against `SettingsManifestSchema` below so it pins a shape an author
 * can write.
 */

import { describe, expect, it, vi } from 'vitest';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { FieldErrorSchema } from '@objectstack/spec/api';
import { SettingsManifestSchema, type SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { brandingSettingsManifest } from './manifests/branding.manifest.js';
import { companySettingsManifest } from './manifests/company.manifest.js';
import { mailSettingsManifest } from './manifests/mail.manifest.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

/** A diagnostics sink that records both levels, so a stray `warn` would be seen too. */
function spyLogger() {
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    warns,
    errors,
    logger: {
      warn: (m: string) => void warns.push(m),
      error: (m: string) => void errors.push(m),
    },
  };
}

/** Synthetic: a `phone` specifier (no shipped manifest authors one) and a secret-bearing `email`. */
const formatLabManifest = {
  namespace: 'format_lab',
  version: 1,
  label: 'Format Lab',
  scope: 'global',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [
    { type: 'phone', key: 'support_phone', label: 'Support phone', required: false },
    { type: 'email', key: 'billing_email', label: 'Billing email', required: false, encrypted: true },
    { type: 'url', key: 'docs_url', label: 'Docs URL', required: false, maxLength: 12 },
  ],
} as unknown as SettingsManifest;

/** Synthetic: a format-typed key whose `visible` reads another key, so a save of that key TOUCHES it. */
const hookLabManifest = {
  namespace: 'hook_lab',
  version: 1,
  label: 'Hook Lab',
  scope: 'global',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [
    { type: 'select', key: 'mode', label: 'Mode', required: false, default: 'off',
      options: [{ value: 'off', label: 'Off' }, { value: 'hook', label: 'Hook' }] },
    { type: 'url', key: 'callback_url', label: 'Callback URL', required: false,
      visible: "${data.mode === 'hook'}" },
  ],
} as unknown as SettingsManifest;

/** The value a secret-bearing pin must never see in a log line or an answer. */
const SECRET_MALFORMED = 'billing-desk-at-corp-internal';

const ADMIN = () => ({
  enforced: true,
  permissions: ['setup.access', 'setup.write', 'manage_platform_settings'],
  userId: 'usr_admin',
  organizationId: 'org_a',
});

function makeStack(env: Record<string, string | undefined> = {}) {
  const spy = spyLogger();
  const secretRows = new Map<string, any>();
  const svc = new SettingsService({
    env,
    logger: spy.logger,
    // A confidentiality-providing crypto pair, so a write to the secret-bearing
    // key is accepted by the fail-closed encryption gate and actually stored.
    cryptoProvider: new LocalCryptoProvider(),
    secretStore: {
      async insert(row) { secretRows.set(row.id, row); return { id: row.id }; },
      async get(id) { return secretRows.get(id) ?? null; },
      async update(id, patch) { secretRows.set(id, { ...secretRows.get(id), ...patch }); },
    },
  });
  svc.registerManifest(brandingSettingsManifest);
  svc.registerManifest(companySettingsManifest);
  svc.registerManifest(mailSettingsManifest);
  svc.registerManifest(formatLabManifest);
  svc.registerManifest(hookLabManifest);
  const http = new MockHttp();
  registerSettingsRoutes(http, svc, { contextFromRequest: ADMIN });
  return { svc, http, ...spy };
}

/** Drive one route; status starts at 0 so `200` is asserted, not defaulted. */
async function call(http: MockHttp, route: string, namespace: string, body?: Record<string, unknown>) {
  const req: IHttpRequest = { params: { namespace }, query: {}, body, headers: {}, method: route.split(' ')[0], path: '/' };
  const state: { status: number; body?: any } = { status: 0 };
  const res: IHttpResponse = {
    json: vi.fn((data) => { state.body = data; }) as any,
    send: vi.fn() as any,
    status: vi.fn((code: number) => { state.status = code; return res; }) as any,
    header: vi.fn(() => res) as any,
  };
  await http.routes.get(route)!(req, res);
  return state;
}

/** `PUT /api/settings/:namespace` through the real route. */
const put = (http: MockHttp, namespace: string, body: Record<string, unknown>) =>
  call(http, 'PUT /api/settings/:namespace', namespace, body);

/** One malformed and one well-formed value per type, each on a key whose type declares it. */
const PER_TYPE = [
  { type: 'url', code: 'invalid_url', ns: 'branding', key: 'logo_url', bad: 'not a url', good: 'https://cdn.example.com/logo.svg' },
  { type: 'url', code: 'invalid_url', ns: 'company', key: 'website', bad: 'example dot com', good: 'https://example.com' },
  { type: 'color', code: 'invalid_format', ns: 'branding', key: 'accent_color', bad: 'e11d48', good: '#e11d48' },
  { type: 'email', code: 'invalid_email', ns: 'company', key: 'primary_contact_email', bad: 'ops at example.com', good: 'ops@example.com' },
  { type: 'email', code: 'invalid_email', ns: 'mail', key: 'from_email', bad: 'no-reply@localhost', good: 'no-reply@example.com' },
  { type: 'phone', code: 'invalid_phone', ns: 'format_lab', key: 'support_phone', bad: 'call the desk', good: '+1 415 555 0100' },
] as const;

/** A key in the same namespace, with no declared format, that a save can write instead. */
const OTHER_KEY: Record<string, { key: string; value: string }> = {
  branding: { key: 'workspace_name', value: 'Acme' },
  company: { key: 'legal_name', value: 'Acme Ltd' },
  mail: { key: 'from_name', value: 'Acme Ops' },
  format_lab: { key: 'docs_url', value: '/docs' },
};

/** The manifest a namespace is registered with in {@link makeStack}. */
const MANIFEST: Record<string, SettingsManifest> = {
  branding: brandingSettingsManifest,
  company: companySettingsManifest,
  mail: mailSettingsManifest,
  format_lab: formatLabManifest,
  hook_lab: hookLabManifest,
};

/**
 * Store `value` under `key` the way a row stored before this check existed got
 * there: save it while the key is declared `text` (no format), then register
 * the real manifest over the namespace again — the method the option-table and
 * value-domain TOUCH pins in `settings-service.test.ts` use.
 */
async function storeUnjudged(stack: ReturnType<typeof makeStack>, ns: string, patch: Record<string, unknown>) {
  const real = MANIFEST[ns];
  const FORMAT_TYPES = new Set(['email', 'url', 'phone', 'color']);
  stack.svc.registerManifest({
    ...real,
    specifiers: (real.specifiers as Array<Record<string, unknown>>).map((s) =>
      Object.keys(patch).includes(String(s.key)) && FORMAT_TYPES.has(String(s.type)) ? { ...s, type: 'text' } : s),
  } as unknown as SettingsManifest);
  const seeded = await put(stack.http, ns, patch);
  expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
  stack.svc.registerManifest(real);
}

describe('synthetic fixtures are a spec-valid authoring surface', () => {
  it('format_lab and hook_lab parse under SettingsManifestSchema', () => {
    // A fixture spelling a key the schema rejects would pin behaviour no author
    // can reach.
    expect(() => SettingsManifestSchema.parse(formatLabManifest)).not.toThrow();
    expect(() => SettingsManifestSchema.parse(hookLabManifest)).not.toThrow();
  });
});

describe('save door — a format miss is refused with one FieldError, and nothing is stored (#24882)', () => {
  for (const c of PER_TYPE) {
    it(`${c.ns}.${c.key} (${c.type}): a malformed value answers 400 SETTINGS_VALIDATION with one ${c.code}, and is not stored`, async () => {
      const { svc, http, warns, errors } = makeStack();
      const r = await put(http, c.ns, { [c.key]: c.bad });

      expect(r.status).toBe(400);
      expect(r.body.success).toBe(false);
      expect(r.body.error.code).toBe('SETTINGS_VALIDATION');
      expect(r.body.error.details.namespace).toBe(c.ns);
      const fields = r.body.error.details.fields;
      expect(fields).toHaveLength(1);
      expect(FieldErrorSchema.safeParse(fields[0]).success).toBe(true);
      expect(fields[0]).toMatchObject({ field: c.key, code: c.code, constraint: { type: c.type } });
      // The answer names what to send, never what was sent.
      expect(fields[0]).not.toHaveProperty('value');
      expect(JSON.stringify(r.body)).not.toContain(c.bad);

      // Nothing stored: the key still resolves from its default.
      const after = await svc.get(c.ns, c.key, ADMIN());
      expect(after.source).toBe('default');
      expect(after.value).not.toBe(c.bad);
      // A refusal handed to the caller is not a degradation: no log line.
      expect(warns).toEqual([]);
      expect(errors).toEqual([]);
    });

    it(`${c.ns}.${c.key} (${c.type}): a well-formed value saves`, async () => {
      const { svc, http, warns, errors } = makeStack();
      const r = await put(http, c.ns, { [c.key]: c.good });
      expect(r.status).toBe(200);
      expect(r.body.data.values[c.key].value).toBe(c.good);
      const stored = await svc.get(c.ns, c.key, ADMIN());
      expect(stored.value).toBe(c.good);
      expect(stored.source).not.toBe('default');
      expect(warns).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  it('the other shapes each grammar admits save too', async () => {
    // The readers' own contracts: `logoUrl` is "absolute or relative", storage
    // hands back a root-relative path for an upload, and CSS hex colours come
    // in four lengths.
    const { http } = makeStack();
    for (const logo of ['/api/v1/storage/files/abc123', 'data:image/svg+xml;base64,PHN2Zy8+', 'http://intranet.local/logo.png']) {
      expect((await put(http, 'branding', { logo_url: logo })).status).toBe(200);
    }
    for (const colour of ['#abc', '#abcd', '#AABBCC', '#aabbccdd']) {
      expect((await put(http, 'branding', { accent_color: colour })).status).toBe(200);
    }
    // Surrounding whitespace is trimmed by both live readers before use, so it
    // is not a format miss; inner whitespace still is (the per-type cases above).
    expect((await put(http, 'company', { primary_contact_email: ' ops@example.com ' })).status).toBe(200);
  });

  it('an empty or blank value is not a format miss', async () => {
    const { http } = makeStack();
    expect((await put(http, 'branding', { logo_url: '' })).status).toBe(200);
    expect((await put(http, 'branding', { logo_url: '   ' })).status).toBe(200);
  });

  it('a secret-bearing key: the malformed save is refused, and the answer never carries the value', async () => {
    const { svc, http, warns, errors } = makeStack();
    const r = await put(http, 'format_lab', { billing_email: SECRET_MALFORMED });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('SETTINGS_VALIDATION');
    expect(r.body.error.details.fields).toHaveLength(1);
    expect(r.body.error.details.fields[0]).toMatchObject({ field: 'billing_email', code: 'invalid_email' });
    const answer = JSON.stringify(r.body);
    expect(answer).not.toContain(SECRET_MALFORMED);
    // Not a fragment of it either.
    expect(answer).not.toContain('billing-desk');
    expect(answer).not.toContain('corp-internal');
    expect((await svc.get('format_lab', 'billing_email', ADMIN())).source).toBe('default');
    expect([...warns, ...errors]).toEqual([]);
  });

  it('precedence: a value that breaks a declared bound is refused for the bound, once', async () => {
    const { svc, http } = makeStack();
    // `docs_url` declares `maxLength: 12`: the length refusal keeps precedence
    // over the format, and the one FieldError for the key is the length one.
    const r = await put(http, 'format_lab', { docs_url: 'not a url at all' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('SETTINGS_VALIDATION');
    expect(r.body.error.details.fields).toHaveLength(1);
    expect(r.body.error.details.fields[0]).toMatchObject({ field: 'docs_url', code: 'max_length' });
    // Each key speaks once, for its own first breach; the batch stores nothing.
    const r2 = await put(http, 'format_lab', { docs_url: 'not a url at all', support_phone: 'call the desk' });
    expect(r2.status).toBe(400);
    expect(r2.body.error.details.fields.map((f: { field: string; code: string }) => [f.field, f.code])).toEqual([
      ['support_phone', 'invalid_phone'],
      ['docs_url', 'max_length'],
    ]);
    expect((await svc.get('format_lab', 'support_phone', ADMIN())).source).toBe('default');
    expect((await svc.get('format_lab', 'docs_url', ADMIN())).source).toBe('default');
  });

  it('a batch with one malformed key is refused whole: its well-formed neighbour is not stored', async () => {
    const { svc, http } = makeStack();
    const r = await put(http, 'branding', { workspace_name: 'Acme', logo_url: 'not a url' });
    expect(r.status).toBe(400);
    expect(r.body.error.details.fields.map((f: { field: string }) => f.field)).toEqual(['logo_url']);
    expect((await svc.get('branding', 'workspace_name', ADMIN())).source).toBe('default');
  });
});

describe('env door — a format-missing override is rejected: not in force, reported once, never the value (#24882)', () => {
  for (const c of PER_TYPE) {
    const envName = `OS_${c.ns}_${c.key}`.toUpperCase();

    it(`${envName} (${c.type}): a malformed override is not in force, falls back to the default, and is reported once`, async () => {
      const { svc, http, warns, errors } = makeStack({ [envName]: c.bad });
      // Reported at boot — `registerManifest` audits the overrides — not on a
      // first read that may never come.
      expect(errors).toHaveLength(1);

      // Not in force: no stored value yet, so the default answers.
      const r = await svc.get(c.ns, c.key, ADMIN());
      expect(r.source).toBe('default');
      expect(r.value).not.toBe(c.bad);
      expect(r.locked).toBe(false);
      expect(r.cascadeChain.some((e) => e.scope === 'env')).toBe(false);
      // Re-reads and the namespace payload do not repeat the line.
      await svc.get(c.ns, c.key, ADMIN());
      await svc.getNamespace(c.ns, ADMIN());
      expect((await call(http, 'GET /api/settings/:namespace', c.ns)).body.data.values[c.key].source).toBe('default');

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(envName);
      expect(errors[0]).toContain(`'${c.ns}.${c.key}'`);
      expect(errors[0]).toContain(`type '${c.type}'`);
      expect(errors[0]).toContain('IGNORED');
      // An environment variable's value never reaches the log line.
      expect(errors[0]).not.toContain(c.bad);
      expect(warns).toEqual([]);

      // Not locking either: the key is configurable through the settings door,
      // and a stored value now answers in the override's place.
      const w = await put(http, c.ns, { [c.key]: c.good });
      expect(w.status).toBe(200);
      const stored = await svc.get(c.ns, c.key, ADMIN());
      expect(stored.value).toBe(c.good);
      expect(stored.source).not.toBe('env');
      expect(stored.source).not.toBe('default');
      expect(errors).toHaveLength(1);
    });

    it(`${envName} (${c.type}): a well-formed override is in force and locks the key`, async () => {
      const { svc, http, warns, errors } = makeStack({ [envName]: c.good });
      const r = await svc.get(c.ns, c.key, ADMIN());
      expect(r.value).toBe(c.good);
      expect(r.source).toBe('env');
      expect(r.locked).toBe(true);
      const w = await put(http, c.ns, { [c.key]: c.good });
      expect(w.status).toBe(409);
      expect(w.body.error.code).toBe('SETTINGS_LOCKED');
      expect(warns).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  it('a malformed override set over a stored value: the stored value answers', async () => {
    // `env` is read live (it may be `process.env`), so an override can arrive
    // after a value was saved — the deployment that sets a bad variable on a
    // workspace that already configured the key.
    const env: Record<string, string | undefined> = {};
    const { svc, http, errors } = makeStack(env);
    expect((await put(http, 'branding', { logo_url: 'https://cdn.example.com/logo.svg' })).status).toBe(200);
    env.OS_BRANDING_LOGO_URL = 'not a url';

    const r = await svc.get('branding', 'logo_url', ADMIN());
    expect(r.value).toBe('https://cdn.example.com/logo.svg');
    expect(r.source).toBe('tenant');
    expect(r.locked).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_BRANDING_LOGO_URL');
    expect(errors[0]).not.toContain('not a url');
  });

  it('a secret-bearing key: the override is rejected, and its line never carries the value', async () => {
    const { svc, warns, errors } = makeStack({ OS_FORMAT_LAB_BILLING_EMAIL: SECRET_MALFORMED });
    const r = await svc.get('format_lab', 'billing_email', ADMIN());
    expect(r.source).toBe('default');
    expect(r.locked).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_FORMAT_LAB_BILLING_EMAIL');
    expect(errors[0]).toContain("'format_lab.billing_email'");
    expect(errors[0]).toContain("type 'email'");
    expect(errors[0]).not.toContain(SECRET_MALFORMED);
    expect(errors[0]).not.toContain('billing-desk');
    expect(errors[0]).not.toContain('corp-internal');
    expect(warns).toEqual([]);
  });

  it('precedence: an override that breaks a declared bound is rejected for the bound, once', async () => {
    // `docs_url` declares `maxLength: 12`; a 16-character override is ignored
    // for its length, the family the save door names first too.
    const { svc, warns, errors } = makeStack({ OS_FORMAT_LAB_DOCS_URL: 'not a url at all' });
    const r = await svc.get('format_lab', 'docs_url', ADMIN());
    expect(r.source).toBe('default');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('IGNORED');
    expect(errors[0]).toContain('outside the declared length');
    expect(errors[0]).not.toContain("type 'url'");
    expect(warns).toEqual([]);
  });
});

describe('stored rows — a value stored before the check existed (#24882)', () => {
  for (const c of PER_TYPE) {
    const other = OTHER_KEY[c.ns];

    it(`${c.ns}.${c.key} (${c.type}): a read still serves it, and a save of ${other.key} is not blocked by it`, async () => {
      const stack = makeStack();
      await storeUnjudged(stack, c.ns, { [c.key]: c.bad });
      const { svc, http } = stack;

      // Reads judge nothing: the service and the route both serve it.
      const read = await svc.get(c.ns, c.key, ADMIN());
      expect(read.value).toBe(c.bad);
      expect(read.source).not.toBe('default');
      const viaRoute = await call(http, 'GET /api/settings/:namespace', c.ns);
      expect(viaRoute.status).toBe(200);
      expect(viaRoute.body.data.values[c.key].value).toBe(c.bad);

      // A save that does not touch the key is not refused on its account.
      const w = await put(http, c.ns, { [other.key]: other.value });
      expect(w.status, JSON.stringify(w.body)).toBe(200);
      expect((await svc.get(c.ns, other.key, ADMIN())).value).toBe(other.value);
      expect((await svc.get(c.ns, c.key, ADMIN())).value).toBe(c.bad);

      // Only a save of the key itself is judged: the malformed value is
      // refused, a well-formed one replaces it.
      const again = await put(http, c.ns, { [c.key]: c.bad });
      expect(again.status).toBe(400);
      expect(again.body.error.details.fields).toMatchObject([{ field: c.key, code: c.code }]);
      expect((await put(http, c.ns, { [c.key]: c.good })).status).toBe(200);
      expect((await svc.get(c.ns, c.key, ADMIN())).value).toBe(c.good);
    });
  }

  it('a reset clears a stored malformed value: an all-null patch is never blocked', async () => {
    const stack = makeStack();
    await storeUnjudged(stack, 'branding', { logo_url: 'not a url' });
    expect((await put(stack.http, 'branding', { logo_url: null })).status).toBe(200);
    expect((await stack.svc.get('branding', 'logo_url', ADMIN())).source).toBe('default');
  });

  it('a save TOUCHES a key through its `visible` predicate, and that judges the stored value', async () => {
    // `validatePatch`'s TOUCH gate counts a key whose `visible` reads a patched
    // key (switching a mode must validate the fields it reveals). No shipped
    // format-typed key declares `visible`; this synthetic one does.
    const stack = makeStack();
    await storeUnjudged(stack, 'hook_lab', { mode: 'hook', callback_url: 'not a url' });
    const { http } = stack;
    const touched = await put(http, 'hook_lab', { mode: 'hook' });
    expect(touched.status).toBe(400);
    expect(touched.body.error.details.fields).toMatchObject([{ field: 'callback_url', code: 'invalid_url' }]);
    // Hidden by the patch, the key is not judged (hidden specifiers never are).
    expect((await put(http, 'hook_lab', { mode: 'off' })).status).toBe(200);
  });
});
