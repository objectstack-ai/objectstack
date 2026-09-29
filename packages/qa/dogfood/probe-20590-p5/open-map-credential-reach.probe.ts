// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20590 position 5 — MEASUREMENT PROBE, not a test of record (see
 * `vitest.probe.config.mts` for why nothing in CI reaches this directory).
 *
 * Question (triage regrade on the card): at a member-level flow DEFINITION
 * read, is a literal typed into an `http` node's open `config.headers` map, or
 * into a `connector_action` node's open `connectorConfig.input` map, served
 * back intact? Controls on the same flow: the declared credential key
 * `http.config.signingSecret` is withheld (the registered projection is live),
 * and a non-credential header / input value is served.
 *
 * Two authoring routes are measured on two composed in-process boots
 * (`@objectstack/verify` `bootStack`, `automation: true`):
 *
 *   A. `examples/app-crm` + a flow an admin authors through the `/meta` save
 *      door (the door positions 1 and 3 were measured through);
 *   B. a minimal fixture app declaring the same flow in its SOURCE (the route
 *      every in-repo composition — showcase, examples — uses).
 *
 * The reader is a freshly signed-up member (no roles, no grants). The reads:
 * the `/meta` item, list and `/published` reads, and the `/automation`
 * domain's definition read.
 *
 * Results are printed as one JSON line (`P5-RESULT …`) and written to
 * `$P5_OUT` when set. Hard expectations are only the preconditions that keep
 * the reading from being vacuous (boot, save accepted, member read answered).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import crmStack from '@objectstack/example-crm';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { bootStack, type VerifyStack } from '@objectstack/verify';

import { S, CREDENTIAL_LITERALS, DECLARED_KEY_CONTROLS, NON_CREDENTIAL_CONTROLS, TEMPLATE_HEADER, URL_LITERALS, probeFlow } from './probe-flow.js';

type ReadName = 'meta_item' | 'meta_list' | 'meta_published' | 'automation_item';

interface ReadOutcome {
  status: number;
  /** Was the probe flow in the answer at all (so absence of a sentinel means something)? */
  flowPresent: boolean;
  /** Per sentinel key: served intact in the body text. */
  served: Record<string, boolean>;
  templateHeaderServed: boolean;
}

async function readAs(stack: VerifyStack, token: string, read: ReadName, name: string): Promise<ReadOutcome> {
  const path = read === 'meta_item' ? `/meta/flow/${name}`
    : read === 'meta_list' ? '/meta/flow'
    : read === 'meta_published' ? `/meta/flow/${name}/published`
    : `/automation/${name}`;
  const res = await stack.apiAs(token, 'GET', path);
  const text = await res.text();
  const served: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(S)) served[k] = text.includes(v);
  return {
    status: res.status,
    // Every flow body carries its node ids; `call_top` is this probe's.
    flowPresent: text.includes(name) && text.includes('call_top'),
    served,
    templateHeaderServed: text.includes(TEMPLATE_HEADER),
  };
}

function verdict(o: ReadOutcome) {
  return {
    status: o.status,
    flowPresent: o.flowPresent,
    credentialLiteralsServed: CREDENTIAL_LITERALS.filter((k) => o.served[k]),
    declaredKeyControlsServed: DECLARED_KEY_CONTROLS.filter((k) => o.served[k]),
    nonCredentialControlsServed: NON_CREDENTIAL_CONTROLS.filter((k) => o.served[k]),
    templateHeaderServed: o.templateHeaderServed,
    urlLiteralsServed: URL_LITERALS.filter((k) => o.served[k]),
  };
}

const results: Record<string, unknown> = {};

afterAll(() => {
  const line = JSON.stringify(results);
  // eslint-disable-next-line no-console
  console.log(`P5-RESULT ${line}`);
  if (process.env.P5_OUT) writeFileSync(process.env.P5_OUT, JSON.stringify(results, null, 2));
});

const READS: ReadName[] = ['meta_item', 'meta_list', 'meta_published', 'automation_item'];

describe('A — examples/app-crm, flow authored by an admin through PUT /meta/flow/:name', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;
  const NAME = 'probe_open_map_p5_meta';

  beforeAll(async () => {
    stack = await bootStack(crmStack as never, { automation: true });
    admin = await stack.signIn();
    member = await stack.signUp('p5-member-a@issue20590.test');
  });
  afterAll(async () => { await stack?.stop(); });

  it('the save door: status and any advisory it answers', async () => {
    const res = await stack.apiAs(admin, 'PUT', `/meta/flow/${NAME}`, probeFlow(NAME));
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    const lowered = text.toLowerCase();
    const advisories = (body as any)?.advisories;
    results.A_save = {
      status: res.status,
      // Any wording in the answer that would read as a refusal or advisory about the literal.
      mentionsCredential: /credential|secret|authorization|api[-_ ]?key|header|p5-/.test(lowered),
      topLevelKeys: body && typeof body === 'object' ? Object.keys(body as object) : typeof body,
      advisoriesCount: Array.isArray(advisories) ? advisories.length : advisories === undefined ? 'absent' : typeof advisories,
      advisoryCodes: Array.isArray(advisories) ? advisories.map((a: any) => a?.code ?? a?.rule ?? a?.id ?? '?') : null,
      state: (body as any)?.state ?? null,
    };
    expect(res.status, `save refused: ${text.slice(0, 600)}`).toBeLessThan(300);
  });

  it('control: the save door\'s advisory channel is live (a try region with no catch draws one)', async () => {
    const flow = probeFlow(`${NAME}_advisory`) as any;
    const guard = flow.nodes.find((n: any) => n.id === 'guard');
    delete guard.config.catch;
    const res = await stack.apiAs(admin, 'PUT', `/meta/flow/${NAME}_advisory`, flow);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    const advisories = body?.advisories;
    const flat = JSON.stringify(advisories ?? null).toLowerCase();
    results.A_save_advisory_control = {
      status: res.status,
      advisoriesCount: Array.isArray(advisories) ? advisories.length : 'absent',
      advisoryRules: Array.isArray(advisories) ? advisories.map((a: any) => a?.rule ?? a?.code ?? a?.id ?? '?') : null,
      // Same flow, same literals: does any advisory name them?
      anyAdvisoryMentionsCredential: /credential|secret|authorization|api[-_ ]?key|header|p5-/.test(flat),
    };
    expect(res.status).toBeLessThan(300);
    expect(Array.isArray(advisories) && advisories.length > 0, `no advisory answered: ${text.slice(0, 300)}`).toBe(true);
  });

  it('control: the member is not an author (the save door refuses the member)', async () => {
    const res = await stack.apiAs(member, 'PUT', `/meta/flow/${NAME}_member`, probeFlow(`${NAME}_member`));
    const text = await res.text();
    let code: unknown = null;
    try { const j = JSON.parse(text); code = j?.error?.code ?? j?.code ?? null; } catch { /* not JSON */ }
    results.A_member_save_control = { status: res.status, code };
    expect(res.status, `member save not refused: ${text.slice(0, 300)}`).toBe(403);
  });

  it('the member reads', async () => {
    const out: Record<string, unknown> = {};
    for (const read of READS) out[read] = verdict(await readAs(stack, member, read, NAME));
    results.A_member = out;
    const item = out.meta_item as ReturnType<typeof verdict>;
    expect(item.status, 'member item read not answered 200').toBe(200);
    expect(item.flowPresent, 'probe flow absent from the member item read').toBe(true);
  });

  it('the admin reads (comparison)', async () => {
    const out: Record<string, unknown> = {};
    for (const read of READS) out[read] = verdict(await readAs(stack, admin, read, NAME));
    results.A_admin = out;
  });
});

const FIXTURE_FLOW = 'probe_open_map_p5_src';

const fixtureStack = defineStack({
  manifest: {
    id: 'com.probe.p5-open-map',
    namespace: 'probe',
    version: '0.0.0',
    type: 'app',
    name: 'P5 open-map probe',
    description: 'Declares one flow carrying credential-shaped literals in open maps, for a served-read measurement.',
  },
  objects: [
    ObjectSchema.create({
      name: 'probe_note',
      sharingModel: 'public_read_write',
      label: 'Probe Note',
      pluralLabel: 'Probe Notes',
      fields: { name: Field.text({ label: 'Name', required: true }) },
    }),
  ],
  flows: [probeFlow(FIXTURE_FLOW) as never],
});

describe('B — fixture app declaring the flow in source (code layer)', () => {
  let stack: VerifyStack;
  let admin: string;
  let member: string;

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as never, { automation: true });
    admin = await stack.signIn();
    member = await stack.signUp('p5-member-b@issue20590.test');
  });
  afterAll(async () => { await stack?.stop(); });

  it('control: the member is not an author (the save door refuses the member)', async () => {
    const res = await stack.apiAs(member, 'PUT', `/meta/flow/${FIXTURE_FLOW}_member`, probeFlow(`${FIXTURE_FLOW}_member`));
    results.B_member_save_control = { status: res.status };
    expect(res.status).toBe(403);
  });

  it('the member reads', async () => {
    const out: Record<string, unknown> = {};
    for (const read of READS) out[read] = verdict(await readAs(stack, member, read, FIXTURE_FLOW));
    results.B_member = out;
    const item = out.meta_item as ReturnType<typeof verdict>;
    expect(item.status, 'member item read not answered 200').toBe(200);
    expect(item.flowPresent, 'probe flow absent from the member item read').toBe(true);
  });

  it('the admin reads (comparison)', async () => {
    const out: Record<string, unknown> = {};
    for (const read of READS) out[read] = verdict(await readAs(stack, admin, read, FIXTURE_FLOW));
    results.B_admin = out;
  });
});
