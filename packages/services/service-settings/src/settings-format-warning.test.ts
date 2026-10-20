// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24882 — the format each specifier TYPE declares (ADR-0007: `email` / `url` /
 * `phone` "format validation", `color` "hex string") is judged at both doors
 * and, under the standing rule 「甲」, REPORTED rather than refused.
 *
 * Refusing these values narrows what the settings door has always accepted,
 * and no ADR-0087 conversion can carry that: stored values are runtime state
 * and an `OS_*` override is a deployment's environment. So this major version
 * ships only the loud half, and these pins hold both of its halves:
 *
 *  - ACCEPTED, unchanged: a malformed save still answers `200` and the value is
 *    stored and served as written; a malformed override is still in force,
 *    still served with `source: 'env'` and still locks the key.
 *  - REPORTED: exactly one `warn` line, naming namespace, key and type — and
 *    never the value, for any key, so a secret-bearing key's value cannot reach
 *    a log line through it.
 *
 * The save door is driven through the real route (`registerSettingsRoutes`
 * over a real `SettingsService`, as `settings-routes.test.ts` does); the env
 * door through the service's own read and write paths, which is where an
 * override takes effect. Shipped manifests are used wherever a shipped key has
 * the type; `phone` and a secret-bearing key are synthetic because no shipped
 * manifest authors either, and both fixtures are parsed against
 * `SettingsManifestSchema` below so they pin a shape an author can write.
 */

import { describe, expect, it, vi } from 'vitest';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
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

/** A diagnostics sink that records both levels, so an `error` line would be seen too. */
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

/** The value a secret-bearing pin must never see in a log line. */
const SECRET_MALFORMED = 'billing-desk-at-corp-internal';

const ADMIN = () => ({
  enforced: true,
  permissions: ['setup.access', 'setup.write', 'manage_platform_settings'],
  userId: 'usr_admin',
  organizationId: 'org_a',
});

function makeStack(env: Record<string, string> = {}) {
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
  const http = new MockHttp();
  registerSettingsRoutes(http, svc, { contextFromRequest: ADMIN });
  return { svc, http, ...spy };
}

/** `PUT /api/settings/:namespace` through the real route; status starts at 0 so `200` is asserted, not defaulted. */
async function put(http: MockHttp, namespace: string, body: Record<string, unknown>) {
  const req: IHttpRequest = { params: { namespace }, query: {}, body, headers: {}, method: 'PUT', path: '/' };
  const state: { status: number; body?: any } = { status: 0 };
  const res: IHttpResponse = {
    json: vi.fn((data) => { state.body = data; }) as any,
    send: vi.fn() as any,
    status: vi.fn((code: number) => { state.status = code; return res; }) as any,
    header: vi.fn(() => res) as any,
  };
  await http.routes.get('PUT /api/settings/:namespace')!(req, res);
  return state;
}

/** One malformed and one well-formed value per type, each on a key whose type declares it. */
const PER_TYPE = [
  { type: 'url', ns: 'branding', key: 'logo_url', bad: 'not a url', good: 'https://cdn.example.com/logo.svg' },
  { type: 'url', ns: 'company', key: 'website', bad: 'example dot com', good: 'https://example.com' },
  { type: 'color', ns: 'branding', key: 'accent_color', bad: 'e11d48', good: '#e11d48' },
  { type: 'email', ns: 'company', key: 'primary_contact_email', bad: 'ops at example.com', good: 'ops@example.com' },
  { type: 'email', ns: 'mail', key: 'from_email', bad: 'no-reply@localhost', good: 'no-reply@example.com' },
  { type: 'phone', ns: 'format_lab', key: 'support_phone', bad: 'call the desk', good: '+1 415 555 0100' },
] as const;

describe('synthetic fixture is a spec-valid authoring surface', () => {
  it('format_lab parses under SettingsManifestSchema', () => {
    // A fixture spelling a key the schema rejects would pin behaviour no author
    // can reach.
    expect(() => SettingsManifestSchema.parse(formatLabManifest)).not.toThrow();
  });
});

describe('save door — a format miss is accepted and stored, and warned about once (#24882, 「甲」)', () => {
  for (const c of PER_TYPE) {
    it(`${c.ns}.${c.key} (${c.type}): a malformed value answers 200, is stored as written, and draws exactly one warning`, async () => {
      const { svc, http, warns, errors } = makeStack();
      const r = await put(http, c.ns, { [c.key]: c.bad });

      // ACCEPTED: no refusal anywhere — the status, the envelope and the store.
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      expect(r.body.error).toBeUndefined();
      expect(r.body.data.values[c.key].value).toBe(c.bad);
      const stored = await svc.get(c.ns, c.key, ADMIN());
      expect(stored.value).toBe(c.bad);
      expect(stored.source).not.toBe('default');

      // REPORTED: exactly one line, at warn, naming namespace, key and type.
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain(`'${c.ns}.${c.key}'`);
      expect(warns[0]).toContain(`(type '${c.type}')`);
      expect(warns[0]).toContain('The save is accepted');
      // Never the value itself.
      expect(warns[0]).not.toContain(c.bad);
      expect(errors).toHaveLength(0);
    });

    it(`${c.ns}.${c.key} (${c.type}): a well-formed value draws no warning`, async () => {
      const { svc, http, warns, errors } = makeStack();
      const r = await put(http, c.ns, { [c.key]: c.good });
      expect(r.status).toBe(200);
      expect((await svc.get(c.ns, c.key, ADMIN())).value).toBe(c.good);
      expect(warns).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });
  }

  it('the other shapes each grammar admits draw no warning either', async () => {
    // The readers' own contracts: `logoUrl` is "absolute or relative", storage
    // hands back a root-relative path for an upload, and CSS hex colours come
    // in four lengths.
    const { http, warns } = makeStack();
    for (const logo of ['/api/v1/storage/files/abc123', 'data:image/svg+xml;base64,PHN2Zy8+', 'http://intranet.local/logo.png']) {
      expect((await put(http, 'branding', { logo_url: logo })).status).toBe(200);
    }
    for (const colour of ['#abc', '#abcd', '#AABBCC', '#aabbccdd']) {
      expect((await put(http, 'branding', { accent_color: colour })).status).toBe(200);
    }
    expect(warns).toEqual([]);
  });

  it('a secret-bearing key: the malformed save is accepted, and its warning never carries the value', async () => {
    const { svc, http, warns } = makeStack();
    const r = await put(http, 'format_lab', { billing_email: SECRET_MALFORMED });
    expect(r.status).toBe(200);
    // Stored: the in-process read decrypts the real plaintext back.
    expect((await svc.get('format_lab', 'billing_email', ADMIN())).value).toBe(SECRET_MALFORMED);

    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("'format_lab.billing_email'");
    expect(warns[0]).toContain("(type 'email')");
    expect(warns[0]).not.toContain(SECRET_MALFORMED);
    // Not a fragment of it either.
    expect(warns[0]).not.toContain('billing-desk');
    expect(warns[0]).not.toContain('corp-internal');
  });

  it('a refused patch carries exactly the errors it carried before, and draws no format warning', async () => {
    const { svc, http, warns } = makeStack();
    // `docs_url` declares `maxLength: 12`: the length refusal keeps precedence
    // over the format, and the one FieldError for the key is the length one.
    const r = await put(http, 'format_lab', { docs_url: 'not a url at all' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('SETTINGS_VALIDATION');
    expect(r.body.error.details.fields).toHaveLength(1);
    expect(r.body.error.details.fields[0].field).toBe('docs_url');
    expect(r.body.error.details.fields[0].code).toBe('max_length');
    // A batch refused for one key is refused whole: the malformed neighbour is
    // not stored, so it is not reported either.
    const r2 = await put(http, 'format_lab', { docs_url: 'not a url at all', support_phone: 'call the desk' });
    expect(r2.status).toBe(400);
    expect(r2.body.error.details.fields.map((f: { field: string }) => f.field)).toEqual(['docs_url']);
    expect((await svc.get('format_lab', 'support_phone', ADMIN())).source).toBe('default');
    expect(warns).toEqual([]);
  });

  it('an empty or blank value is not a format miss', async () => {
    const { http, warns } = makeStack();
    expect((await put(http, 'branding', { logo_url: '' })).status).toBe(200);
    expect((await put(http, 'branding', { logo_url: '   ' })).status).toBe(200);
    expect(warns).toEqual([]);
  });
});

describe('env door — a format-missing override stays in force, and is warned about once (#24882, 「甲」)', () => {
  for (const c of PER_TYPE) {
    const envName = `OS_${c.ns}_${c.key}`.toUpperCase();

    it(`${envName} (${c.type}): a malformed override is in force, served and locking, with exactly one warning`, async () => {
      const { svc, http, warns, errors } = makeStack({ [envName]: c.bad });
      // Reported at boot — `registerManifest` audits the overrides — not on a
      // first read that may never come.
      expect(warns).toHaveLength(1);

      const r = await svc.get(c.ns, c.key, ADMIN());
      expect(r.value).toBe(c.bad);
      expect(r.source).toBe('env');
      expect(r.locked).toBe(true);
      // Still locking: a save of the key is refused 409 exactly as before.
      const w = await put(http, c.ns, { [c.key]: c.good });
      expect(w.status).toBe(409);
      expect(w.body.error.code).toBe('SETTINGS_LOCKED');
      // Re-reads and the namespace payload do not repeat the line.
      await svc.get(c.ns, c.key, ADMIN());
      await svc.getNamespace(c.ns, ADMIN());

      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain(envName);
      expect(warns[0]).toContain(`'${c.ns}.${c.key}'`);
      expect(warns[0]).toContain(`(type '${c.type}')`);
      expect(warns[0]).toContain('It IS in force');
      // An environment variable's value never reaches the log line.
      expect(warns[0]).not.toContain(c.bad);
      expect(errors).toHaveLength(0);
    });

    it(`${envName} (${c.type}): a well-formed override draws no warning`, async () => {
      const { svc, warns, errors } = makeStack({ [envName]: c.good });
      const r = await svc.get(c.ns, c.key, ADMIN());
      expect(r.value).toBe(c.good);
      expect(r.source).toBe('env');
      expect(warns).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });
  }

  it('a secret-bearing key: the override is in force, and its warning never carries the value', async () => {
    const { svc, warns } = makeStack({ OS_FORMAT_LAB_BILLING_EMAIL: SECRET_MALFORMED });
    const r = await svc.get('format_lab', 'billing_email', ADMIN());
    expect(r.value).toBe(SECRET_MALFORMED);
    expect(r.source).toBe('env');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('OS_FORMAT_LAB_BILLING_EMAIL');
    expect(warns[0]).toContain("'format_lab.billing_email'");
    expect(warns[0]).toContain("(type 'email')");
    expect(warns[0]).not.toContain(SECRET_MALFORMED);
    expect(warns[0]).not.toContain('billing-desk');
    expect(warns[0]).not.toContain('corp-internal');
  });

  it('an override REJECTED by a refusal family is reported as rejected, not as a format miss', async () => {
    // `docs_url` declares `maxLength: 12`; a 16-character override is ignored
    // with the existing `error` line, and the format judgment never runs on a
    // value that is not in force.
    const { svc, warns, errors } = makeStack({ OS_FORMAT_LAB_DOCS_URL: 'not a url at all' });
    const r = await svc.get('format_lab', 'docs_url', ADMIN());
    expect(r.source).not.toBe('env');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('IGNORED');
    expect(warns).toEqual([]);
  });
});
