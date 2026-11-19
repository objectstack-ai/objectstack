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
 *   the seed rows      the managed install door below, with a data-only package whose
 *                      `data[]` holds them (`loadSeedRows` in `orchestrate.ts`): the
 *                      platform's seed loader writes them under its seed posture, which
 *                      skips the `state_machine` rule a user write meets. Measured on a
 *                      blank 18.5.0 host with the travel_expense build installed: every
 *                      row keeps the card's own `id`, a lookup value names the row
 *                      seeded under it, a user id in `owner_id` or a `user` field lands
 *                      as sent, and the answer's `data.seeded.errorList` names each row
 *                      refused (`sourceObject`, `recordIndex`, `message`; no code). A
 *                      second package claiming a namespace another holds is refused
 *                      (`PLUGIN_REGISTER_FAILED`), so each load takes its own
 *   a waiting lookup   PATCH /api/v1/data/:object/:id with the bare field patch (the
 *                      seed's second pass, `seedApp` in `orchestrate.ts`; read from the
 *                      route's source, `packages/rest/src/crud-routes.ts`, not yet
 *                      measured live)
 *   a restored row     DELETE /api/v1/data/:object/:id (a row an earlier operation added,
 *                      deleted before the next one runs, `restoreSeededRows` in
 *                      `orchestrate.ts`; read from the same route source, not yet
 *                      measured live)
 *   rows               GET  /api/v1/data/:object?limit=…
 *   the audit actor    GET  /api/v1/data/sys_audit_log?record_id=… (`user_id`)
 *   unmanaged install  POST /api/v1/marketplace/install-local { packageId, manifest,
 *                      installMode: 'unmanaged' } (ADR-0131 D6)
 *   managed install    the same door with `installMode: 'managed'`: the package is
 *                      registered and ledgered, not copied, so it may carry what an
 *                      unmanaged copy cannot hold (a `capability` item, which no
 *                      environment row can hold: the unmanaged door refuses that body
 *                      `422 UNMANAGED_INSTALL_UNCOPYABLE` and names this door)
 *   metadata           GET  /api/v1/meta/:type
 *   a persona's tool   POST /api/v1/mcp, a JSON-RPC `tools/call` with `Authorization:
 *                      Bearer <its API key>` — the door the agent uses, so the probe of a
 *                      validation operation meets the persona's own permissions and the
 *                      app's validation exactly as the agent's write would. The tool's
 *                      answer is its text content; a refusal is that text carrying
 *                      `{ error: { code, status } }` with `isError` set.
 *
 * Door mode's doors (`doorMode` in `orchestrate.ts`), read from their sources and
 * the in-process dogfood that drives the same OAuth flow, not yet measured
 * against `os dev`:
 *
 *   a writable package POST /api/v1/packages { manifest } — Studio's new-package
 *                      door; a scope-less package is a writable base (ADR-0070)
 *   the door's token   {@link mintAuthoringToken}: OAuth 2.1 + PKCE as the admin
 *   pending drafts     GET  /api/v1/meta/_drafts?package=…
 *   the person's publish POST /api/v1/packages/:id/publish-drafts — Studio's
 *                      Changes > Publish; a refusal answers `outcome: refused`
 *                      with `failed[]` on a 200
 *
 * The data API's refusal is the flat `{ error, code }` envelope; the auth and
 * install doors answer `{ success: false, error: { code, message } }`. Both
 * are read by {@link codeOf}.
 */

import { createHash, randomBytes } from 'node:crypto';

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

/** An MCP tool's answer: its text content, and whether the tool flagged it as an error. */
export interface ToolAnswer {
  output: unknown;
  isError: boolean;
}

function isBag(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The JSON-RPC response in an MCP HTTP answer: the body itself (JSON response
 * mode), or the first `data:` event carrying a result or an error (SSE).
 */
export function readJsonRpc(text: string): Record<string, unknown> | undefined {
  const candidates = text.trimStart().startsWith('{')
    ? [text]
    : text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice('data:'.length));
  for (const c of candidates) {
    try {
      const msg: unknown = JSON.parse(c);
      if (isBag(msg) && ('result' in msg || 'error' in msg)) return msg;
    } catch {
      /* not a JSON-RPC line */
    }
  }
  return undefined;
}

/** A `tools/call` result as a {@link ToolAnswer}: its text blocks joined, as the agent's transcript reads them. */
export function toolAnswerOf(result: unknown): ToolAnswer {
  const r = isBag(result) ? result : {};
  const content = Array.isArray(r.content) ? r.content : [];
  const texts = content.filter(isBag).filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text as string);
  return { output: texts.length === content.length ? texts.join('\n') : content, isError: r.isError === true };
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
  /** Set fields on a row already in (the seed's second pass: the lookups that close a reference cycle). */
  updateRow(object: string, id: string, patch: Record<string, unknown>): Promise<HttpAnswer>;
  /**
   * Delete a row, as the admin (a restore: a row an earlier operation added).
   * Optional, so a harness written before restores keeps compiling; without it
   * a restore that needs a delete cannot be done, and the operation is not
   * measured.
   */
  deleteRow?(object: string, id: string): Promise<HttpAnswer>;
  listRows(object: string): Promise<HttpAnswer & { rows: Array<Record<string, unknown>> }>;
  /** The `user_id` the newest audit row for this record names; `null` when none names one. */
  auditActorUserId(object: string, recordId: string): Promise<string | null>;
  installUnmanaged(manifest: Record<string, unknown>): Promise<HttpAnswer>;
  /**
   * The same build installed managed (`installMode: 'managed'`): what ask mode
   * falls back to when the unmanaged door refuses the build
   * `UNMANAGED_INSTALL_UNCOPYABLE` (`withInstalledBuild` in `orchestrate.ts`).
   * It is also the door the seed loads through: a data-only package whose
   * `data[]` holds the rows (`loadSeedRows` in `orchestrate.ts`).
   * Optional, so a harness written before the fallback keeps compiling; without
   * it that refusal stays the mode's finding, and every seed row is refused.
   */
  installManaged?(manifest: Record<string, unknown>): Promise<HttpAnswer>;
  /**
   * The sample-data reseed of a package the managed door installed
   * (`POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data`):
   * its `data[]` loaded again under the deliberate re-seed posture, which
   * inserts every missing row whatever the organization's record of landed
   * seed rows says. It is how a restore puts back a seeded row a turn removed,
   * which an install withholds (`loadSeedRows` in `orchestrate.ts`). Optional,
   * so a harness written before it keeps compiling; without it such a row is
   * refused, named, and the operation is not measured.
   */
  reseedManaged?(manifestId: string): Promise<HttpAnswer>;
  /** The environment's metadata of every collection the template carries, as an artifact. */
  metadataAsArtifact(collections: readonly string[]): Promise<Record<string, unknown[]>>;
  /** One MCP tool call as the owner of `apiKey`, through the door the agent uses (`mcpUrl`). */
  callTool(apiKey: string, tool: string, args: Record<string, unknown>): Promise<ToolAnswer>;
  // ── Door mode (`doorMode` in `orchestrate.ts`): each optional, so a harness
  // written before it keeps compiling; without them door mode is skipped, saying so.
  /** Studio's new-package door as the signed-in admin: `POST /api/v1/packages { manifest }`. */
  createPackage?(manifest: Record<string, unknown>): Promise<HttpAnswer>;
  /**
   * An OAuth access token for the MCP door, consented by the signed-in admin
   * and scoped `scope` (`mintAuthoringToken`, below): what a person's MCP
   * client holds after they connect it. Never written to a record.
   */
  mintAuthoringToken?(scope: string): Promise<HttpAnswer & { token?: string }>;
  /** The package's pending drafts, as Studio's Changes review lists them: `GET /api/v1/meta/_drafts?package=`. */
  listDrafts?(packageId: string): Promise<HttpAnswer & { drafts: Array<{ type: string; name: string }> }>;
  /** Studio's publish of a package's drafts, as the signed-in admin: `POST /api/v1/packages/:id/publish-drafts`. */
  publishDrafts?(packageId: string): Promise<HttpAnswer>;
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

  updateRow(object: string, id: string, patch: Record<string, unknown>): Promise<HttpAnswer> {
    return this.call('PATCH', `/api/v1/data/${encodeURIComponent(object)}/${encodeURIComponent(id)}`, patch, { session: this.admin });
  }

  deleteRow(object: string, id: string): Promise<HttpAnswer> {
    return this.call('DELETE', `/api/v1/data/${encodeURIComponent(object)}/${encodeURIComponent(id)}`, undefined, { session: this.admin });
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

  installManaged(manifest: Record<string, unknown>): Promise<HttpAnswer> {
    const packageId = typeof manifest.id === 'string' ? manifest.id : 'scenario_template';
    return this.call('POST', '/api/v1/marketplace/install-local', { packageId, manifest, installMode: 'managed' }, { session: this.admin });
  }

  reseedManaged(manifestId: string): Promise<HttpAnswer> {
    return this.call('POST', `/api/v1/marketplace/install-local/${encodeURIComponent(manifestId)}/reseed-sample-data`, {}, { session: this.admin });
  }

  async callTool(apiKey: string, tool: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    const res = await fetch(this.mcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
    });
    const text = await res.text();
    const rpc = readJsonRpc(text);
    if (!res.ok || rpc === undefined) throw new Error(`tools/call ${tool}: ${res.status} ${text.slice(0, 300)}`.trim());
    if (isBag(rpc.error)) throw new Error(`tools/call ${tool}: JSON-RPC ${String(rpc.error.code ?? '')} ${String(rpc.error.message ?? '')}`.trim());
    return toolAnswerOf(rpc.result);
  }

  createPackage(manifest: Record<string, unknown>): Promise<HttpAnswer> {
    return this.call('POST', '/api/v1/packages', { manifest }, { session: this.admin });
  }

  async mintAuthoringToken(scope: string): Promise<HttpAnswer & { token?: string }> {
    return mintAuthoringToken(this.baseUrl, this.admin.header(), scope);
  }

  async listDrafts(packageId: string): Promise<HttpAnswer & { drafts: Array<{ type: string; name: string }> }> {
    const r = await this.call('GET', `/api/v1/meta/_drafts?package=${encodeURIComponent(packageId)}`, undefined, { session: this.admin });
    const body = r.body as { drafts?: unknown; data?: { drafts?: unknown } } | null;
    const raw = body?.drafts ?? body?.data?.drafts;
    const drafts = (Array.isArray(raw) ? raw : []).filter(isBag).map((d) => ({ type: String(d.type ?? ''), name: String(d.name ?? '') }));
    return { ...r, drafts };
  }

  publishDrafts(packageId: string): Promise<HttpAnswer> {
    return this.call('POST', `/api/v1/packages/${encodeURIComponent(packageId)}/publish-drafts`, {}, { session: this.admin });
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

/** The redirect URI the runner registers for its token: never served, the code is read off the redirect itself. */
const DOOR_REDIRECT_URI = 'http://127.0.0.1:33419/callback';

/**
 * An OAuth access token for the MCP door, the way a person's MCP client gets
 * one (OAuth 2.1 with PKCE, the flow `packages/qa/dogfood` drives in process):
 * read the protected resource the app advertises
 * (`GET /.well-known/oauth-protected-resource`), register a public client
 * (`POST /api/v1/auth/oauth2/register`), authorize it as the signed-in person
 * (`cookie`), consenting when asked (`POST /api/v1/auth/oauth2/consent`), and
 * trade the code for the token (`POST /api/v1/auth/oauth2/token`). Each step
 * that answers otherwise is the answer, naming the step: absence is loud, and
 * the mode records it instead of running a client that holds no door.
 */
export async function mintAuthoringToken(baseUrl: string, cookie: string, scope: string): Promise<HttpAnswer & { token?: string }> {
  const read = async (res: Response): Promise<unknown> => {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return text;
    }
  };
  const refused = (step: string, res: Response, body: unknown): HttpAnswer => {
    const c = codeOf(body);
    const oauth = isBag(body) && typeof body.error === 'string' ? { code: body.error, message: String(body.error_description ?? '') } : {};
    return { ok: false, status: res.status, body: null, ...c, ...oauth, message: `${step}: ${c.message ?? (oauth as { message?: string }).message ?? res.statusText}`.slice(0, 500) };
  };
  const prm = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`, { headers: { accept: 'application/json' } });
  const prmBody = await read(prm);
  const resource = isBag(prmBody) && typeof prmBody.resource === 'string' ? prmBody.resource : undefined;
  if (!prm.ok || resource === undefined) return refused('the app advertises no OAuth protected resource for its MCP door', prm, prmBody);

  const reg = await fetch(`${baseUrl}/api/v1/auth/oauth2/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'scenario runner (door mode)',
      redirect_uris: [DOOR_REDIRECT_URI],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
      scope,
    }),
  });
  const regBody = await read(reg);
  const clientId = isBag(regBody) && typeof regBody.client_id === 'string' ? regBody.client_id : undefined;
  if (!reg.ok || clientId === undefined) return refused('client registration', reg, regBody);

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const qs = new URLSearchParams({ client_id: clientId, redirect_uri: DOOR_REDIRECT_URI, response_type: 'code', scope, state: 'scenario', code_challenge: challenge, code_challenge_method: 'S256', resource });
  const az = await fetch(`${baseUrl}/api/v1/auth/oauth2/authorize?${qs}`, { headers: { cookie }, redirect: 'manual' });
  const loc = az.headers.get('location') ?? '';
  let code = loc ? new URL(loc, baseUrl).searchParams.get('code') : null;
  if (!code) {
    if (!loc) return refused('authorization', az, await read(az));
    // The consent screen: the person accepts, as they would in the browser.
    const consent = await fetch(`${baseUrl}/api/v1/auth/oauth2/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', cookie, origin: baseUrl },
      body: JSON.stringify({ accept: true, oauth_query: loc.slice(loc.indexOf('?') + 1) }),
    });
    const cb = await read(consent);
    const to = isBag(cb) ? (typeof cb.redirect_uri === 'string' ? cb.redirect_uri : typeof cb.url === 'string' ? cb.url : undefined) : undefined;
    code = to ? new URL(to, baseUrl).searchParams.get('code') : null;
    if (!consent.ok || !code) return refused('consent', consent, cb);
  }
  const tok = await fetch(`${baseUrl}/api/v1/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: DOOR_REDIRECT_URI, client_id: clientId, code_verifier: verifier, resource }).toString(),
  });
  const tj = await read(tok);
  const token = isBag(tj) && typeof tj.access_token === 'string' ? tj.access_token : undefined;
  if (!tok.ok || token === undefined) return refused('token exchange', tok, tj);
  return { ok: true, status: tok.status, body: { scope: isBag(tj) && typeof tj.scope === 'string' ? tj.scope : scope }, token };
}
