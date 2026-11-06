// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The booted app as the runner reaches it: plain HTTP against `os dev`'s
 * server, through the same public doors a person uses. Every path here was
 * measured against a `create-objectstack` blank project on `os dev --fresh`
 * (the runner's PR records the reading):
 *
 *   sign in            POST /api/v1/auth/sign-in/email            → session cookie
 *   a persona's user   POST /api/v1/auth/admin/create-user        (self sign-up is closed
 *                      on the default `invite_only` audience) → the new user must change
 *                      the password before anything else, so: sign in, POST
 *                      /api/v1/auth/change-password, sign in again
 *   its API key        POST /api/v1/keys (a SESSION door: a key cannot mint a key) →
 *                      the raw key, returned once; it acts as its owner
 *   its access         POST /api/v1/data/sys_user_permission_set { user_id,
 *                      permission_set, organization_id } — a user with no app permission
 *                      set reads `PERMISSION_DENIED` on every app object
 *   a seed row         POST /api/v1/data/:object with the card's own `id` (accepted
 *                      verbatim, so a lookup value in the seed names the real row)
 *   rows               GET  /api/v1/data/:object?limit=…
 *   the audit actor    GET  /api/v1/data/sys_audit_log?record_id=… (`user_id`)
 *   unmanaged install  POST /api/v1/marketplace/install-local { packageId, manifest,
 *                      installMode: 'unmanaged' } (ADR-0131 D6)
 *   metadata           GET  /api/v1/meta/:type
 *
 * The data API's refusal is the flat `{ error, code }` envelope; the auth and
 * install doors answer `{ success: false, error: { code, message } }`. Both
 * are read by {@link codeOf}.
 */

import { PLURAL_TO_SINGULAR } from '@objectstack/spec/meta-spelling';

export interface HttpAnswer {
  ok: boolean;
  status: number;
  body: unknown;
  code?: string;
  message?: string;
}

/** The refusal code of either envelope this app answers with. */
export function codeOf(body: unknown): { code?: string; message?: string } {
  if (typeof body !== 'object' || body === null) return {};
  const b = body as Record<string, unknown>;
  if (typeof b.code === 'string') return { code: b.code, ...(typeof b.error === 'string' ? { message: b.error } : {}) };
  const e = b.error;
  if (typeof e === 'object' && e !== null) {
    const ee = e as Record<string, unknown>;
    return {
      ...(typeof ee.code === 'string' ? { code: ee.code } : {}),
      ...(typeof ee.message === 'string' ? { message: ee.message } : {}),
    };
  }
  return {};
}

export interface PersonaAccount {
  persona: string;
  userId: string;
  email: string;
  apiKey: string;
  /** The permission set the runner assigned, or why it could not. */
  permissionSet: { name: string; assigned: boolean; code?: string; message?: string };
}

/** What the orchestrator needs from a booted app — the seam the tests replace. */
export interface AppHarness {
  readonly baseUrl: string;
  readonly mcpUrl: string;
  signInAdmin(): Promise<void>;
  adminUserId(): string;
  organizationId(): string;
  /** One user, the permission set the build declared for it (`<namespace>_<persona>`) and one API key. */
  createPersona(persona: string, permissionSet: string): Promise<PersonaAccount>;
  /** An API key for the admin, for the questions no persona is named on. */
  adminApiKey(): Promise<string>;
  insertRow(object: string, row: Record<string, unknown>): Promise<HttpAnswer>;
  listRows(object: string): Promise<HttpAnswer & { rows: Array<Record<string, unknown>> }>;
  /** The `user_id` the newest audit row for this record names; `null` when none names one. */
  auditActorUserId(object: string, recordId: string): Promise<string | null>;
  installUnmanaged(manifest: Record<string, unknown>): Promise<HttpAnswer>;
  /** The environment's metadata of every collection the template carries, as an artifact. */
  metadataAsArtifact(collections: readonly string[]): Promise<Record<string, unknown[]>>;
}

export interface HttpAppOptions {
  baseUrl: string;
  adminEmail: string;
  adminPassword: string;
  /** Password given to every persona user (dev only; the server is the run's own throwaway). */
  personaPassword?: string;
}

class Session {
  private cookies = new Map<string, string>();

  absorb(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      if (i > 0) this.cookies.set(pair!.slice(0, i).trim(), pair!.slice(i + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

export class HttpApp implements AppHarness {
  readonly baseUrl: string;
  readonly mcpUrl: string;
  private readonly admin = new Session();
  private adminId = '';
  private orgId = '';
  private readonly opts: HttpAppOptions;

  constructor(opts: HttpAppOptions) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.mcpUrl = `${this.baseUrl}/api/v1/mcp`;
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
    auth?: { session?: Session; apiKey?: string },
  ): Promise<HttpAnswer> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth?.session) headers.cookie = auth.session.header();
    if (auth?.apiKey) headers['x-api-key'] = auth.apiKey;
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    auth?.session?.absorb(res);
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep the text */
    }
    const ok = res.ok && !(typeof parsed === 'object' && parsed !== null && (parsed as { success?: unknown }).success === false);
    return { ok, status: res.status, body: parsed, ...(ok ? {} : codeOf(parsed)) };
  }

  private async signIn(session: Session, email: string, password: string): Promise<HttpAnswer> {
    return this.call('POST', '/api/v1/auth/sign-in/email', { email, password }, { session });
  }

  async signInAdmin(): Promise<void> {
    const r = await this.signIn(this.admin, this.opts.adminEmail, this.opts.adminPassword);
    if (!r.ok) throw new Error(`admin sign-in refused: ${r.status} ${r.code ?? ''} ${r.message ?? ''}`.trim());
    this.adminId = String((r.body as { user?: { id?: unknown } }).user?.id ?? '');
    const s = await this.call('GET', '/api/v1/auth/get-session', undefined, { session: this.admin });
    const session = (s.body as { session?: { activeOrganizationId?: unknown } } | null)?.session;
    this.orgId = typeof session?.activeOrganizationId === 'string' ? session.activeOrganizationId : '';
  }

  adminUserId(): string {
    return this.adminId;
  }

  organizationId(): string {
    return this.orgId;
  }

  async createPersona(persona: string, permissionSet: string): Promise<PersonaAccount> {
    const email = `${persona}@scenario.test`;
    const first = `${this.opts.personaPassword ?? 'Scenario-Run-1'}a`;
    const password = this.opts.personaPassword ?? 'Scenario-Run-1';
    const created = await this.call('POST', '/api/v1/auth/admin/create-user', { email, password: first, name: persona, role: 'user' }, { session: this.admin });
    if (!created.ok) throw new Error(`create-user ${persona}: ${created.status} ${created.code ?? ''} ${created.message ?? ''}`.trim());
    const data = (created.body as { data?: { user?: { id?: string }; organizationId?: string } }).data;
    const userId = String(data?.user?.id ?? '');
    if (!this.orgId && data?.organizationId) this.orgId = data.organizationId;

    const s = new Session();
    await this.signIn(s, email, first);
    const changed = await this.call('POST', '/api/v1/auth/change-password', { currentPassword: first, newPassword: password, revokeOtherSessions: false }, { session: s });
    if (!changed.ok) throw new Error(`change-password ${persona}: ${changed.status} ${changed.code ?? ''}`.trim());
    const again = await this.signIn(s, email, password);
    if (!again.ok) throw new Error(`sign-in ${persona}: ${again.status} ${again.code ?? ''}`.trim());

    const grant = await this.call(
      'POST',
      '/api/v1/data/sys_user_permission_set',
      { user_id: userId, permission_set: permissionSet, organization_id: this.orgId },
      { session: this.admin },
    );
    const key = await this.call('POST', '/api/v1/keys', { name: `scenario-${persona}` }, { session: s });
    const raw = (key.body as { data?: { key?: unknown } } | null)?.data?.key;
    if (!key.ok || typeof raw !== 'string') throw new Error(`mint key ${persona}: ${key.status} ${key.code ?? ''}`.trim());
    return {
      persona,
      userId,
      email,
      apiKey: raw,
      permissionSet: {
        name: permissionSet,
        assigned: grant.ok,
        ...(grant.code ? { code: grant.code } : {}),
        ...(grant.message ? { message: grant.message.slice(0, 300) } : {}),
      },
    };
  }

  async adminApiKey(): Promise<string> {
    const key = await this.call('POST', '/api/v1/keys', { name: 'scenario-admin' }, { session: this.admin });
    const raw = (key.body as { data?: { key?: unknown } } | null)?.data?.key;
    if (!key.ok || typeof raw !== 'string') throw new Error(`mint admin key: ${key.status} ${key.code ?? ''}`.trim());
    return raw;
  }

  insertRow(object: string, row: Record<string, unknown>): Promise<HttpAnswer> {
    return this.call('POST', `/api/v1/data/${encodeURIComponent(object)}`, row, { session: this.admin });
  }

  async listRows(object: string): Promise<HttpAnswer & { rows: Array<Record<string, unknown>> }> {
    const r = await this.call('GET', `/api/v1/data/${encodeURIComponent(object)}?limit=1000`, undefined, { session: this.admin });
    const records = (r.body as { records?: unknown } | null)?.records;
    return { ...r, rows: Array.isArray(records) ? (records as Array<Record<string, unknown>>) : [] };
  }

  async auditActorUserId(object: string, recordId: string): Promise<string | null> {
    const q = `object_name=${encodeURIComponent(object)}&record_id=${encodeURIComponent(recordId)}&limit=200`;
    const r = await this.call('GET', `/api/v1/data/sys_audit_log?${q}`, undefined, { session: this.admin });
    const rows = ((r.body as { records?: unknown } | null)?.records ?? []) as Array<Record<string, unknown>>;
    const mine = rows.filter((x) => x.record_id === recordId && x.object_name === object);
    mine.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const actor = mine[0]?.user_id;
    return typeof actor === 'string' ? actor : null;
  }

  installUnmanaged(manifest: Record<string, unknown>): Promise<HttpAnswer> {
    const packageId = typeof manifest.id === 'string' ? manifest.id : 'scenario_template';
    return this.call('POST', '/api/v1/marketplace/install-local', { packageId, manifest, installMode: 'unmanaged' }, { session: this.admin });
  }

  async metadataAsArtifact(collections: readonly string[]): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    for (const plural of collections) {
      const type = PLURAL_TO_SINGULAR[plural];
      if (!type) continue;
      const r = await this.call('GET', `/api/v1/meta/${type}`, undefined, { session: this.admin });
      const items = (r.body as { items?: unknown } | null)?.items;
      out[plural] = Array.isArray(items) ? items.filter((i) => !String((i as { name?: unknown }).name ?? '').match(/^(sys_|ai_)/)) : [];
    }
    return out;
  }
}
