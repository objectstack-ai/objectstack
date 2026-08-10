// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ACCEPTANCE for the declarative `apis:` endpoint executor (#5040 E8, #5112).
//
// ## What this file is
//
// The whole #5040 program was built E1–E7 with every unit landing BEHIND a
// publish gate that made it structurally unreachable, so every test written
// along the way drove one link with the next one stubbed — a matcher against a
// fake store, a step against a fake matcher, an executor against a fake
// `callData`. That is the right way to build a chain nobody can reach yet, and
// it is exactly the shape #4936 caught being wrong: `handleApiEndpoint` was
// unit-tested by calling `dispatch()` directly, which is why nobody noticed
// that no route ever mounted the paths it claimed to serve.
//
// So this file stubs NOTHING. It boots the real showcase app, through the real
// artifact ingestion path (`MetadataPlugin` + a `local-file` artifact — the
// same path `objectstack dev` / `serve` take), over the real Hono transport,
// and asks the questions a caller asks:
//
//   1. does a declared endpoint answer at all, and with the SAME body the
//      built-in route gives for the same operation (#5040 §4's red line);
//   2. does `authRequired` actually gate (401 for anonymous), rather than
//      parsing green and gating nothing as it did before #4936;
//   3. does `cacheTtl` reach the wire as `Cache-Control`;
//   4. does an UNDECLARED path under the mount still answer the transport's
//      own bare 404, byte for byte — the seam must cost non-endpoint traffic
//      nothing (#5090);
//   5. do the two machine-readable faces — `GET /meta/api` and
//      `GET /openapi.json` — describe exactly what is mounted (ADR-0076 §4:
//      a machine-readable surface must not lie).
//
// ## RED-first
//
// Written and run BEFORE `examples/app-showcase` restored its `apis:` block.
// Against the pre-restore stack every endpoint case failed with the bare 404
// that #4936 recorded — which is the point: the assertions describe behaviour
// that did not exist, and the showcase restoration is what makes them pass.
//
// ## The one thing deliberately NOT asserted
//
// `components.schemas` and `$ref` resolution in the OpenAPI document. That
// document ships six built-in dangling refs today (#5168) and this program did
// not introduce them; asserting on them here would make an unrelated pre-
// existing defect fail the executor's acceptance. Scope is the endpoint PATH
// entries, which are this program's output.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { ConnectorRestPlugin } from '@objectstack/connector-rest';
import { ConnectorOpenApiPlugin } from '@objectstack/connector-openapi';
import { ConnectorMcpPlugin } from '@objectstack/connector-mcp';
import showcaseStack from '@objectstack/example-showcase';

import { buildShapedArtifact, writeBuildShapedArtifact } from './build-shaped-artifact.js';

/** The ADR-0121 D1 mount, spelled here as a caller would type it. */
const TASKS = '/apps/showcase/tasks';
const PURGE = '/apps/showcase/inquiries/purge';

/** Two negative controls: undeclared UNDER the mount, and off the mount entirely. */
const UNDECLARED_UNDER_MOUNT = '/apps/showcase/no-such-endpoint-e8';
const OFF_MOUNT = '/no-such-route-e8';

/**
 * The showcase's declarative connectors resolve their file-path specs and stdio
 * commands relative to the APP ROOT, exactly as `os dev`/`serve` run them — so
 * the boot chdirs there for its duration (vitest gives each test FILE its own
 * process, so this is isolated). Same note as
 * `showcase-declarative-mcp.dogfood.test.ts`, which boots the same way.
 */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));

let tempDir: string;
let prevCwd: string;
let stack: VerifyStack;
let adminToken: string;
/** Read back off disk — what `MetadataPlugin` actually ingested, not what we meant to write. */
let artifactOnDisk: Record<string, unknown>;

/**
 * Boot the showcase the way a deployment boots it.
 *
 * `@objectstack/verify`'s lean harness composes no `MetadataPlugin` — its
 * proofs are data/authorization ones that read metadata straight off the
 * config. A declared endpoint cannot be reached without one: `matchEndpoint`
 * is `IMetadataService`'s member, and `NodeMetadataManager` is its only
 * implementation. So this file supplies it through the harness's `extraPlugins`
 * seam, pointed at an artifact written from the showcase's own stack
 * definition — the SAME `artifactSource: { mode: 'local-file' }` ingestion
 * `createStandaloneStack` uses, which is what maps `apis:` → `api` metadata
 * items (`ARTIFACT_FIELD_TO_TYPE` in `packages/metadata/src/plugin.ts`).
 *
 * Writing the artifact through `ObjectStackDefinitionSchema` — which the
 * ingest performs on load — means this boot ALSO re-proves the E7 publish
 * gates accept the restored declarations. A declaration that could not publish
 * could not be ingested here either.
 */
beforeAll(async () => {
  prevCwd = process.cwd();
  process.chdir(SHOWCASE_DIR);
  tempDir = mkdtempSync(join(tmpdir(), 'os-e8-endpoints-'));
  const artifactPath = join(tempDir, 'objectstack.json');
  // The artifact is written the way `objectstack build` writes one — the same
  // `normalizeStackInput` → `lowerCallables` → `ObjectStackDefinitionSchema`
  // pipeline `packages/cli/src/commands/compile.ts` runs, reusing those exact
  // functions rather than re-deriving them (#6293).
  //
  // Until #6293 this line was `JSON.stringify(stack)` minus `functions`, and
  // the omission was deliberate and declared (#4976) because the substitute
  // could not carry them: `JSON.stringify` drops a bare callable KEY AND ALL
  // and reduces a declared one (`{ handler: fn, effect }`) to the headless husk
  // `{ effect }`. The husk at least fails the parse — that red CI job is how
  // anybody found out — but the bare entry left `functions: {}` behind and
  // parsed green, so this boot advertised "the way a deployment boots it" while
  // ingesting zero of the showcase's two functions, invisibly, for its whole
  // existence. Declaring the omission was honest; agreeing with the build BY
  // CONSTRUCTION is better, and the first test below is what keeps it true.
  writeBuildShapedArtifact(showcaseStack as Record<string, unknown>, artifactPath);
  artifactOnDisk = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, unknown>;

  stack = await bootStack(showcaseStack, {
    // The `flow`-typed endpoint delegates to `IAutomationService.execute`;
    // without the service the honest answer is a 501, not a flow run.
    automation: true,
    extraPlugins: [
      // The showcase declares `connectors:` bound to these providers; the
      // automation service refuses to start without their factories (ADR-0097),
      // exactly as `objectstack dev` would.
      new ConnectorRestPlugin(),
      new ConnectorOpenApiPlugin(),
      new ConnectorMcpPlugin({ declarativeStdio: ['node'] }),
      new MetadataPlugin({
        rootDir: tempDir,
        watch: false,
        artifactWatch: false,
        registerSystemObjects: false,
        artifactSource: { mode: 'local-file', path: artifactPath },
      }),
    ],
  });
  adminToken = await stack.signIn();
}, 120_000);

afterAll(async () => {
  await stack?.stop();
  if (prevCwd) process.chdir(prevCwd);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// 0. The artifact this boot ingests is the shape the build writes (#6293)
// ============================================================================

describe('[#6293] the stand-in artifact carries what a built one carries', () => {
  it('holds BOTH showcase callables as string refs — the bare form and the declared one', () => {
    // The assertion the old shape could not make, and the reason this file
    // spent its whole existence green while carrying nothing. Both spellings
    // are pinned because they fail DIFFERENTLY: the declared entry degrades
    // into a husk the schema refuses (loud), the bare entry disappears without
    // a trace (silent) — and it is the silent one that has to be asserted by
    // name, since nothing downstream can miss what was never there.
    const functions = artifactOnDisk.functions as Record<string, unknown> | undefined;
    expect(functions, 'a built artifact carries `functions`; JSON.stringify would not').toBeDefined();

    expect(
      functions!.summarizeCompletedTask,
      'the BARE callable must reach the artifact as a resolvable string ref',
    ).toBe('summarizeCompletedTask');

    expect(
      functions!.sweepProjectHealth,
      'the DECLARED callable keeps its declaration AND gains a ref — never one without the other',
    ).toEqual({ handler: 'sweepProjectHealth', effect: 'writes' });
  });

  it('the substitute it replaced still drops them — the trap, pinned', () => {
    // Not a test of `JSON.stringify`: a test of why the helper above exists,
    // executable at the one call site that was bitten. If this ever stops
    // holding, the helper's whole premise is up for re-reading.
    const naive = JSON.parse(JSON.stringify(showcaseStack)) as Record<string, unknown>;
    expect(
      naive.functions,
      'the bare entry vanishes key and all; the declared one is left a headless husk',
    ).toEqual({ sweepProjectHealth: { effect: 'writes' } });
  });

  it('REFUSES to build an artifact out of that residue instead of quietly shrinking', () => {
    // The reverse verification, kept in the suite rather than done once by hand:
    // feed the helper the very thing this fixture used to write and it must
    // fail, loudly, naming what went missing. Direction predicted before it was
    // run — and the mechanism is NOT the one #4976 documented. The schema never
    // sees the husk: `lowerCallables` rebuilds the `functions` map from the three
    // shapes it recognises and deletes everything else, so the residue would have
    // reached the parse as `functions: {}` and passed. The gate that speaks here
    // is the helper's own key-for-key reconciliation.
    const residue = JSON.parse(JSON.stringify(showcaseStack)) as Record<string, unknown>;
    expect(() => buildShapedArtifact(residue)).toThrowError(/dropped 1 `functions` entr.*sweepProjectHealth/s);
  });
});

// ============================================================================
// 1. The declarations are ingested and visible on the metadata face
// ============================================================================

describe('[#5112] the showcase declares endpoints again, and the store holds them', () => {
  it('GET /meta/api returns both restored declarations', async () => {
    const res = await stack.apiAs(adminToken, 'GET', '/meta/api');
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { data?: unknown; items?: unknown };
    const items = (Array.isArray((body as any).data) ? (body as any).data
      : Array.isArray((body as any).items) ? (body as any).items
      : Array.isArray((body as any).data?.items) ? (body as any).data.items
      : []) as Array<Record<string, unknown>>;
    const byName = new Map(items.map((i) => [String(i.name), i]));

    expect(
      [...byName.keys()],
      'the two endpoints #4936 commented out are declared again',
    ).toEqual(expect.arrayContaining(['showcase_task_feed', 'showcase_inquiry_purge_api']));

    // ADR-0121 D1: the namespace carve-out is not decoration — it is the
    // reason an app can never claim a built-in domain or a sibling's URL.
    for (const name of ['showcase_task_feed', 'showcase_inquiry_purge_api']) {
      expect(String(byName.get(name)?.path)).toMatch(/^\/api\/v1\/apps\/showcase\//);
    }
  });
});

// ============================================================================
// 2. object_operation — match, execute, and answer what /data answers
// ============================================================================

describe('[#5112] object_operation endpoint: same pipeline, same answer', () => {
  it('answers 200 for an authenticated caller', async () => {
    const res = await stack.apiAs(adminToken, 'GET', TASKS);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { success?: boolean; data?: unknown };
    expect(body.success, 'the declared endpoint uses the platform success envelope').toBe(true);
    expect(body.data, 'a find endpoint answers with data').toBeDefined();
  });

  it('answers EXACTLY what the built-in /data route answers (#5040 §4)', async () => {
    // The ruling this whole program is built on: a declared endpoint is a
    // stable URL plus a policy layer over an EXISTING pipeline, never a second
    // execution dialect. Two pipelines for one operation drift; this assertion
    // is what makes the claim falsifiable.
    //
    // The comparison is payload-to-payload, and that asymmetry is real rather
    // than a convenience: `packages/rest` — the sole owner of
    // `/api/v1/data/:object` — serializes the pipeline's payload BARE, while
    // the endpoint executor wraps the identical payload in the platform's
    // `{ success, data, meta }` envelope (`successAnswer`, mirroring
    // `HttpDispatcher.success`). Same records, same totals, same field values,
    // one wrapper apart. Asserting `a.data === b` states exactly that, and
    // fails the moment the two pipelines disagree about the data itself.
    const viaEndpoint = await stack.apiAs(adminToken, 'GET', TASKS);
    const viaBuiltin = await stack.apiAs(adminToken, 'GET', '/data/showcase_task');
    expect(viaBuiltin.status).toBe(200);
    const a = (await viaEndpoint.json()) as { data?: unknown };
    const b = await viaBuiltin.json();
    expect(a.data).toEqual(b);
  });

  it('carries the declared cacheTtl as a Cache-Control header — `private` included', async () => {
    // Both halves of this header are pinned, and the FIRST one is the reason
    // this assertion exists at all (#5396).
    //
    // `private` is not a tuning choice on this chain, it is a security rule:
    // every endpoint answer may have been trimmed per-caller by RLS, so a
    // shared cache must never store one and hand it to somebody else. The
    // producer states that in `computeCacheControl`
    // (`packages/runtime/src/endpoint-policy.ts`), and the unit tests below it
    // pin the RETURN VALUE. This assertion is the only layer that sees what a
    // caller actually receives after the whole stack has run — so if any layer
    // between the policy chain and the socket ever rewrites `private` to
    // `public`, this is the only place that can notice. It pinned `max-age=30`
    // alone until #5396, i.e. it would have stayed green through exactly that
    // rewrite.
    const res = await stack.apiAs(adminToken, 'GET', TASKS);
    expect(
      res.headers.get('cache-control'),
      'cacheTtl: 30 must reach the wire, and reach it as `private`',
    ).toMatch(/^private, max-age=30$/);
  }, 60_000);

  it('DENIES an anonymous caller with 401 — authRequired finally gates', async () => {
    // The security semantic #4936 found parsing green and enforcing nothing.
    const res = await stack.api(TASKS, { method: 'GET' });
    expect(res.status, await res.clone().text()).toBe(401);
    const body = (await res.json()) as { success?: boolean; error?: unknown };
    expect(body.success).toBe(false);
  });

  it('never lets an error answer carry a cache directive', async () => {
    const res = await stack.api(TASKS, { method: 'GET' });
    expect(res.status).toBe(401);
    expect(
      res.headers.get('cache-control') ?? '',
      'telling a client to cache a 401 for 30s is worse than saying nothing',
    ).not.toMatch(/max-age=30/);
  });
});

// ============================================================================
// 3. flow — match, execute through the automation service
// ============================================================================

describe('[#5112] flow endpoint: invokes the real flow over HTTP', () => {
  it('answers 200 for an authenticated caller and runs the janitor flow', async () => {
    const res = await stack.apiAs(adminToken, 'POST', PURGE, {});
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { success?: boolean; data?: unknown };
    expect(body.success).toBe(true);
    expect(body.data, 'the flow run result is the endpoint answer').toBeDefined();
  });

  it('DENIES an anonymous caller with 401', async () => {
    const res = await stack.api(PURGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status, await res.clone().text()).toBe(401);
  });

  it('does not answer a flow endpoint on the wrong method', async () => {
    // GET on a POST-only declaration is a MISS, not a 405: nothing mounted a
    // route for this path, so the transport's own unmatched answer stands.
    const res = await stack.apiAs(adminToken, 'GET', PURGE);
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// 4. Negative controls — the seam costs unmatched traffic nothing (#5090)
// ============================================================================

describe('[#5112] undeclared paths keep the transport’s own answer, byte for byte', () => {
  async function bare(path: string) {
    const res = await stack.apiAs(adminToken, 'GET', path);
    return { status: res.status, text: await res.text() };
  }

  it('an undeclared path UNDER the endpoint mount is the same bare 404 as one off it', async () => {
    const underMount = await bare(UNDECLARED_UNDER_MOUNT);
    const offMount = await bare(OFF_MOUNT);
    expect(underMount.status).toBe(404);
    expect(offMount.status).toBe(404);
    expect(
      underMount.text,
      'the endpoint step writes NOTHING on a miss — a declared-endpoint mount must not ' +
        'turn a 404 into a different 404 for everybody else (#5090)',
    ).toBe(offMount.text);
  });

  it('a declared path on the wrong METHOD is the same bare 404', async () => {
    const res = await stack.apiAs(adminToken, 'POST', TASKS, {});
    const offMount = await bare(OFF_MOUNT);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(offMount.text);
  });
});

// ============================================================================
// 5. The documentation face describes exactly what is mounted (ADR-0076 §4)
// ============================================================================

describe('[#5112] /openapi.json carries the declared endpoints (#5040 E6)', () => {
  let paths: Record<string, any>;

  beforeAll(async () => {
    const res = await stack.apiAs(adminToken, 'GET', '/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths?: Record<string, any> };
    paths = doc.paths ?? {};
  });

  it('documents the object_operation endpoint under its declared path', () => {
    const entry = paths['/api/v1/apps/showcase/tasks'];
    expect(entry, 'the declared path must appear verbatim in `paths`').toBeDefined();
    expect(entry.get.operationId).toBe('showcase_task_feed');
    expect(entry.get.summary).toBe('Task feed');
    // `authRequired: true` → the document's own security requirement, never an
    // invented scheme name.
    expect(entry.get.security, 'a session-gated endpoint must not read as public').toBeDefined();
    expect(entry.get.security).not.toEqual([]);
    expect(entry.get.responses['200']).toBeDefined();
    expect(entry.get.responses['401']).toBeDefined();
  });

  it('documents the flow endpoint under its declared path', () => {
    const entry = paths['/api/v1/apps/showcase/inquiries/purge'];
    expect(entry).toBeDefined();
    expect(entry.post.operationId).toBe('showcase_inquiry_purge_api');
    expect(entry.post.summary).toBe('Purge closed inquiries');
    expect(entry.post.requestBody, 'a flow endpoint reads the body as flow input').toBeDefined();
    expect(entry.post.security).not.toEqual([]);
  });

  it('does not document an endpoint the runtime would not serve', () => {
    // The document is generated from the same stored items the matcher reads,
    // so anything it names must be reachable. Prove the converse direction on
    // the one path we know is undeclared.
    expect(paths['/api/v1/apps/showcase/no-such-endpoint-e8']).toBeUndefined();
  });
});
