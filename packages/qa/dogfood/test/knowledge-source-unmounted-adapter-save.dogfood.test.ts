// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0161 K4] A `knowledge_source` whose `adapter` names a store this
// deployment does not mount is refused at its save, on a REAL booted showcase
// (the knowledge service and its one store, `memory`):
//
//   - `PUT /meta/knowledge_source/:name` answers `400 VALIDATION_ERROR`, naming
//     the source, the adapter and the mounted stores; nothing is stored;
//   - the MCP `save_metadata_draft` tool refuses the same save the same way,
//     and no draft is stored.
//
// CONTROLS, at both doors: a source naming the mounted store, and one that
// leaves `adapter` out (the one store holds it), save as before.
//
// Before, both saves answered success, and the source was named only by the
// boot's `error` line and by the `503` its index and search answered.
//
// Not judged at these doors: a package install (the engine's own write), a
// source registered in code and `os validate`.
//
// The verify harness mounts no MCP server, so this file mounts one, as
// `objectstack dev` and `serve` do. The draft door is served only to an OAuth
// agent granted `metadata:write` whose user holds the authoring capability,
// and that agent holds its user's system capabilities only under
// `actions:execute`, so the MCP calls present a REAL access token with both
// scopes (DCR, authorize with the MCP resource, consent, token).
//
// The file is ISOLATED: it writes `/meta`, creates a package and sets
// `OS_OIDC_PROVIDER_ENABLED` for its boot.

import { createHash, randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPServerPlugin } from '@objectstack/mcp';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const OPERATOR = { email: 'admin@objectos.ai', password: 'admin123' };
const AGENT_SCOPE = 'openid profile email offline_access metadata:write actions:execute';
const REDIRECT_URI = 'http://127.0.0.1:33421/callback';
/** A writable package the drafts are saved into (the showcase's own is read-only). */
const DRAFT_PACKAGE = 'com.dogfood.ksadapter';

/** A source over the showcase's tasks, as the showcase's own `showcase_task_notes`, with the given `adapter`. */
const sourceBody = (name: string, adapter?: string) => ({
  name,
  label: name,
  ...(adapter === undefined ? {} : { adapter }),
  source: { kind: 'object', object: 'showcase_task', content: ['title', 'notes'], metadataFields: ['status', 'priority'] },
});

async function mintAgentToken(stack: VerifyStack): Promise<string> {
  const authSvc: any = await stack.kernel.getServiceAsync('auth');
  const resource = authSvc.getMcpResourceUrl();
  const reg = await stack.api('/auth/oauth2/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'knowledge adapter save probe', redirect_uris: [REDIRECT_URI], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none', application_type: 'native', scope: AGENT_SCOPE,
    }),
  });
  const regBody: any = await reg.json();
  expect(reg.status, JSON.stringify(regBody)).toBe(201);
  const signin = await stack.api('/auth/sign-in/email', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(OPERATOR),
  });
  expect(signin.status, await signin.clone().text()).toBe(200);
  const cookie = ((signin.headers as any).getSetCookie() as string[]).map((c) => c.split(';')[0]).join('; ');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const qs = new URLSearchParams({
    client_id: regBody.client_id, redirect_uri: REDIRECT_URI, response_type: 'code', scope: AGENT_SCOPE, state: 'st',
    code_challenge: challenge, code_challenge_method: 'S256', resource,
  });
  const az = await stack.api(`/auth/oauth2/authorize?${qs}`, { headers: { cookie }, redirect: 'manual' });
  const loc = az.headers.get('location') ?? '';
  let code = new URL(loc, 'http://localhost:3000').searchParams.get('code');
  if (!code) {
    const consent = await stack.api('/auth/oauth2/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:3000' },
      body: JSON.stringify({ accept: true, oauth_query: loc.slice(loc.indexOf('?')) }),
    });
    const cb: any = await consent.json().catch(() => null);
    code = new URL(cb?.redirect_uri ?? cb?.url).searchParams.get('code');
  }
  const tok = await stack.api('/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT_URI, client_id: regBody.client_id, code_verifier: verifier, resource,
    }).toString(),
  });
  const tj: any = await tok.json();
  expect(tok.status, JSON.stringify(tj)).toBe(200);
  return String(tj.access_token);
}

describe('[ADR-0161 K4] a knowledge_source naming an adapter the deployment does not mount is refused at its save', () => {
  let stack: VerifyStack;
  let admin = '';
  let agent = '';
  const priorOidc = process.env.OS_OIDC_PROVIDER_ENABLED;

  const put = async (name: string, body: unknown) => {
    const res = await stack.apiAs(admin, 'PUT', `/meta/knowledge_source/${name}`, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, error: json?.error, json };
  };
  const saveDraft = async (name: string, item: unknown) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${agent}` },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'save_metadata_draft', arguments: { type: 'knowledge_source', name, item, package: DRAFT_PACKAGE } },
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, JSON.stringify(rpc.error)).toBeUndefined();
    const text = String(rpc.result?.content?.[0]?.text ?? '');
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    return { isError: rpc.result?.isError === true, payload, text };
  };
  const knowledge = async () => stack.kernel.getServiceAsync<any>('knowledge');

  beforeAll(async () => {
    process.env.OS_OIDC_PROVIDER_ENABLED = 'true';
    stack = await bootShowcase({ extraPlugins: [new MCPServerPlugin()] });
    admin = await stack.signIn();
    const created = await stack.apiAs(admin, 'POST', '/packages', {
      manifest: { id: DRAFT_PACKAGE, name: 'Knowledge adapter drafts', version: '0.1.0', type: 'app', namespace: 'ksadapter' },
    });
    expect(created.status, await created.clone().text()).toBe(201);
    agent = await mintAgentToken(stack);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (priorOidc === undefined) delete process.env.OS_OIDC_PROVIDER_ENABLED;
    else process.env.OS_OIDC_PROVIDER_ENABLED = priorOidc;
  });

  it('the booted deployment mounts one store, memory', async () => {
    expect((await knowledge()).listAdapters()).toEqual(['memory']);
  });

  it('PUT /meta/knowledge_source refuses a retired or mistyped adapter 400 VALIDATION_ERROR, naming the source, the adapter and the mounted stores; nothing is stored', async () => {
    for (const [name, adapter] of [['ks_retired_store', 'ragflow'], ['ks_typo_store', 'memroy']] as const) {
      const saved = await put(name, sourceBody(name, adapter));
      expect(saved.status, JSON.stringify(saved.json)).toBe(400);
      expect(saved.error, JSON.stringify(saved.json)).toMatchObject({ code: 'VALIDATION_ERROR' });
      const message = String(saved.error?.message ?? '');
      expect(message).toContain(name);
      expect(message).toContain(`names adapter '${adapter}', which this deployment does not mount (mounted: memory)`);
      expect((await stack.apiAs(admin, 'GET', `/meta/knowledge_source/${name}`)).status, name).toBe(404);
      expect((await knowledge()).listSources().map((s: { name: string }) => s.name), name).not.toContain(name);
    }
  });

  it('save_metadata_draft refuses the same save 400 VALIDATION_ERROR, and no draft is stored', async () => {
    const refused = await saveDraft('ks_draft_retired_store', sourceBody('ks_draft_retired_store', 'ragflow'));
    expect(refused.isError, refused.text).toBe(true);
    expect(refused.payload.error, refused.text).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(String(refused.payload.error?.message)).toContain("names adapter 'ragflow', which this deployment does not mount (mounted: memory)");
    const draft = await stack.apiAs(admin, 'GET', `/meta/knowledge_source/ks_draft_retired_store?state=draft&package=${DRAFT_PACKAGE}`);
    expect(draft.status, await draft.clone().text()).toBe(404);
  });

  it('CONTROL: a source naming the mounted store, and one leaving `adapter` out, save at both doors', async () => {
    for (const [name, adapter] of [['ks_named_store', 'memory'], ['ks_omitted_store', undefined]] as const) {
      const saved = await put(name, sourceBody(name, adapter));
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      const drafted = await saveDraft(`${name}_draft`, sourceBody(`${name}_draft`, adapter));
      expect(drafted.isError, drafted.text).toBe(false);
      expect(drafted.payload.saved, drafted.text).toMatchObject({ type: 'knowledge_source', name: `${name}_draft`, package: DRAFT_PACKAGE });
    }
  });
});
