// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// THE ANONYMOUS DOOR SWEEP — ADR-0138 acceptance criterion 2, as a test that
// lives in the tree (#22146, the test half of ruling 6134095444).
//
// ## What it proves
//
// ADR-0138 D2: an unauthenticated request is served by exactly six door
// classes, a short list of surfaces is outside the guest model by construction,
// and everything else answers 401. Criterion 2 asks that a booted reference
// deployment's anonymous answer — its status class, and what is served —
// match that table, class by class. This file is that reading, repeatable:
//
//   1. it boots the showcase the way a deployment serves it;
//   2. it reads the REGISTERED route table off the running server — nothing
//      here lists the population by hand;
//   3. it sends ONE unauthenticated request per route;
//   4. it judges each answer by the route's class in
//      `anonymous-door-sweep.classification.ts`, which is closed: a route that
//      table does not claim is in the everything-else class and must answer
//      401, so a new anonymous door nobody classified turns this file red;
//   5. and it asserts each of the six classes on a REAL subject, admitted and
//      refused, because a sweep whose every probe names nothing can only ever
//      observe the refusal half of a door.
//
// ## The matrix rows this file is the proof for
//
// ADR-0138 card E2 records the six classes in the authorization conformance
// matrix (`authz-conformance.matrix.ts`), one row per class, and every one of
// them cites this file: the admitted leg of each class below is that row's
// pin, and its refused leg is the row's standing negative control.
//
// authz-row: anonymous-door-public-form
// authz-row: anonymous-door-share-link
// authz-row: anonymous-door-public-book
// authz-row: anonymous-door-endpoint-object-operation
// authz-row: anonymous-door-endpoint-flow
// authz-row: anonymous-door-public-read-file
//
// ## Where the population comes from — three sources, each guarded
//
//   - `port`: `IHttpServer.getMountedRoutes()`, every route registered through
//     the HTTP-server contract;
//   - `raw`: the framework's own route table (`getRawApp().routes`), which
//     holds the port's routes AND the mounts made on the raw app handle,
//     outside the port by construction (`plugin-auth`'s catch-all and
//     well-known documents, the approval pages, the inbound hook, the HMR
//     stream, the runtime-config reads). The port table is asserted to be a
//     SUBSET of it, so a registration one saw and the other did not fails the
//     derivation instead of hiding from it;
//   - `declared`: the ADR-0121 endpoints the metadata service matches, which
//     the transport serves from its fallback seam, so no route table lists
//     them. Each is asserted to resolve through `matchEndpoint` to itself.
//
// ## The boot, and why each extra is on it
//
// `bootShowcase` composes what `objectstack serve` composes from the showcase's
// configuration, with three exceptions `bootStack` documents. This file adds
// back the two a deployment of the showcase has a route for:
//
//   - `MetadataPlugin` over a build-shaped artifact. The lean harness reads
//     metadata off the configuration and composes none, while
//     `createStandaloneStack` composes it unconditionally, and without it no
//     declared endpoint routes (classes 4 and 5 live there). Because
//     `bootStack` runs the development posture, it also mounts the dev-only
//     metadata HMR stream, so the classification covers that door on a
//     measured route;
//   - `MCPServerPlugin`. `serve` mounts MCP by default (`OS_MCP_SERVER_ENABLED`
//     opts out), and D2 names MCP as outside the guest model.
//
// Pinyin search, the third, mounts no route.
//
// ## The fixtures, and why they are not the showcase's own
//
// The showcase declares no `authRequired: false` endpoint and one book, which
// is public. Classes 4 and 5 and the negative half of class 3 need subjects it
// does not have, so the configuration booted is the showcase plus inline
// declarations: one anonymous `object_operation` endpoint, one anonymous `flow`
// endpoint over a flow with no data step, one `org`-audience book, and two docs
// (one the public book claims by its own include rule, one only the org book
// claims). The showcase's own two declared endpoints are `authRequired: true`
// and of the same two types, so they are the negative controls of classes 4
// and 5 as they ship. Every other subject (the public form, the shareable
// brief, the public book, an uploaded file) is the showcase's own or is
// created here, signed in, before the anonymous request.
//
// ## What a red run means
//
// A red everything-else case is a finding about the deployment: a surface that
// serves an anonymous caller without the 401 floor D2 says every surface off
// the list has. ⛔ It is never fixed here. A route moves into a door class or
// an outside family only by an amendment of ADR-0138, and the classification
// is edited after that amendment, never instead of it.
//
// ## Disclosure: what a red run prints, and the one local switch
//
// Classes, positions and functions only (#22146; ruling 6134095444: "no
// route-level readings go on GitHub"). This suite runs on `main` with the
// dogfood battery, so whatever a red case prints lands in a public CI log.
// So a red sweep case prints, BY DEFAULT, one line per class and mount family:
// the class (a door class, an outside family or the everything-else class),
// the mount family the route table names (the pattern's leading segments; the
// table records patterns, not registrars), the source, and the COUNT of red
// routes in it. ⛔ It never pairs a route with the answer it got, and it never
// prints a body. The judgement is unchanged: the same routes are judged, and a
// case is red exactly when one of them misses its class.
//
// Route-level detail (each red route's pattern and why it missed its class) is
// for a developer's own machine only, behind `OS_TEST_ANON_SWEEP_ROUTE_DETAIL`,
// which is off by default:
//
//   OS_TEST_ANON_SWEEP_ROUTE_DETAIL=1 pnpm --filter @objectstack/dogfood \
//     exec vitest run test/anonymous-door-sweep.dogfood.test.ts
//
// ⛔ Never set it in CI or in a workflow. Two belts keep it local: through
// `turbo run test` (the path CI takes) the variable is never forwarded,
// because turbo's strict env mode hands a task only what its `env` declares
// and `@objectstack/dogfood#test` declares `OS_TEST_TIERS` and `OS_TEST_SHARD`
// alone; and the switch is ignored whenever `CI` is set.
//
// Not eligible for the shared showcase project: it boots a derived
// configuration with its own plugins.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { MCPServerPlugin } from '@objectstack/mcp';
import showcaseStack from '@objectstack/example-showcase';
import type { ApiEndpoint } from '@objectstack/spec/api';
import type { Flow } from '@objectstack/spec/automation';

import { bootShowcase } from './showcase-boot.js';
import { writeBuildShapedArtifact } from './build-shaped-artifact.js';
import {
  DOOR_CLASSES,
  EVERYTHING_ELSE,
  MIDDLEWARE,
  OUTSIDE_FAMILIES,
  classify,
  probePathOf,
  type SweepAnswer,
  type SweepClass,
  type SweptRoute,
} from './anonymous-door-sweep.classification.js';

const SYS = { isSystem: true } as const;
/** ADR-0121 D6: an anonymous endpoint publishes only with an armed budget. */
const ARMED = { enabled: true, windowMs: 60_000, maxRequests: 1_000 };

// ── The inline declarations (see the header) ────────────────────────────────

/** start → assignment → end, under `runAs: 'user'`: a flow that touches no data. */
const EchoFlow = {
  name: 'anon_sweep_echo',
  label: 'Anonymous sweep echo',
  type: 'autolaunched',
  runAs: 'user',
  variables: [{ name: 'answer', type: 'text', isOutput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'assign', type: 'assignment', label: 'Answer', config: { assignments: [{ variable: 'answer', value: 'served' }] } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'assign' },
    { id: 'e2', source: 'assign', target: 'end' },
  ],
} as unknown as Flow;

const GUEST_FIND_PATH = '/api/v1/apps/showcase/anon-sweep/tasks';
const GUEST_FLOW_PATH = '/api/v1/apps/showcase/anon-sweep/echo';
/** The showcase's own session-gated twins of the two fixtures (classes 4 and 5's negative controls). */
const GATED_FIND_PATH = '/api/v1/apps/showcase/tasks';
const GATED_FLOW_PATH = '/api/v1/apps/showcase/inquiries/purge';

const FIXTURE_APIS = [
  {
    name: 'anon_sweep_guest_find', path: GUEST_FIND_PATH, method: 'GET',
    summary: 'Guest find', description: 'ADR-0138 D2 class 4 fixture: an anonymous object_operation door.',
    type: 'object_operation', objectParams: { object: 'showcase_task', operation: 'find' },
    authRequired: false, rateLimit: ARMED,
  },
  {
    name: 'anon_sweep_guest_flow', path: GUEST_FLOW_PATH, method: 'POST',
    summary: 'Guest flow', description: 'ADR-0138 D2 class 5 fixture: an anonymous flow door.',
    type: 'flow', target: EchoFlow.name,
    authRequired: false, rateLimit: ARMED,
  },
] as unknown as ApiEndpoint[];

const PUBLIC_BOOK = 'showcase_manual';
const ORG_BOOK = 'anon_sweep_org_manual';
/** Joins the public book by its own derived rule (`include: 'showcase_*_guide'`). */
const PUBLIC_DOC = 'showcase_anon_sweep_guide';
/** Claimed by the org book alone. */
const ORG_DOC = 'anon_sweep_org_page';
const OrgBook = {
  name: ORG_BOOK,
  label: 'Anonymous sweep org manual',
  slug: 'anon-sweep-org-manual',
  audience: 'org',
  groups: [{ key: 'start', label: 'Start', order: 1, pages: [ORG_DOC] }],
};
const FIXTURE_DOCS = [
  { name: PUBLIC_DOC, label: 'Anonymous sweep guide', content: '# Anonymous sweep guide\n\nA doc the public book claims.' },
  { name: ORG_DOC, label: 'Anonymous sweep org page', content: '# Anonymous sweep org page\n\nA doc only the org book claims.' },
];

const showcase = showcaseStack as unknown as Record<string, unknown[] | undefined>;
const SWEPT = {
  ...(showcaseStack as Record<string, unknown>),
  apis: [...(showcase.apis ?? []), ...FIXTURE_APIS],
  flows: [...(showcase.flows ?? []), EchoFlow],
  books: [...(showcase.books ?? []), OrgBook],
  docs: [...(showcase.docs ?? []), ...FIXTURE_DOCS],
};

// ── Probing ─────────────────────────────────────────────────────────────────

/** One request, judged later. A request that never settles fails here, loudly. */
async function send(stack: VerifyStack, method: string, path: string, init: RequestInit = {}): Promise<SweepAnswer> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as Record<string, string>) };
  const withBody = method !== 'GET' && method !== 'HEAD';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    // Path-free unless the local switch is on: a hang is an answer too (header, Disclosure).
    timer = setTimeout(
      () => reject(new Error(`a request did not answer within 15s${ROUTE_DETAIL ? `: ${method} ${path}` : ''}`)),
      15_000,
    );
  });
  try {
    const res = await Promise.race([
      stack.raw(path, { ...init, method, headers, ...(withBody && init.body === undefined ? { body: '{}' } : {}) }),
      timeout,
    ]);
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      // A stream never ends on its own; its status and type are the answer.
      await res.body?.cancel();
      return { status: res.status, contentType };
    }
    const text = await res.text();
    if (!contentType.includes('json')) return { status: res.status, contentType };
    let json: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      json = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed };
    } catch {
      json = { unparsable: true };
    }
    return { status: res.status, contentType, json };
  } finally {
    clearTimeout(timer);
  }
}

const keyOf = (r: { method: string; pattern: string }) => `${r.method} ${r.pattern}`;

/**
 * The local-only switch for route-level failure detail (header, Disclosure).
 * Off by default, and ignored whenever `CI` is set.
 */
const ROUTE_DETAIL = process.env.OS_TEST_ANON_SWEEP_ROUTE_DETAIL === '1' && !process.env.CI;

/**
 * The mount family a route belongs to: the pattern's leading segments past the
 * API base, which is as much as the route table can say about who registered
 * it. A declared endpoint is in no route table, so its family is its kind.
 */
function mountFamilyOf(route: SweptRoute): string {
  if (route.source === 'declared') {
    return `declared ${route.endpoint?.type ?? 'unknown-type'} endpoints (authRequired: ${String(route.endpoint?.authRequired)})`;
  }
  const segs = route.pattern.split('/').filter((x) => x !== '');
  const base = segs[0] === 'api' ? (segs[1] === 'v1' ? 2 : 1) : 0;
  const head = segs[base];
  const kept = head === undefined || head.startsWith(':') || head === '*' ? segs.slice(0, base) : segs.slice(0, base + 1);
  return `/${kept.join('/')}`;
}

const classLabelOf = (cls: SweepClass): string =>
  cls.kind === 'door' ? `door class ${cls.door.id}` : cls.kind === 'outside' ? `outside family ${cls.family.id}` : cls.kind;

interface Swept {
  readonly route: SweptRoute;
  readonly probePath: string;
  readonly cls: SweepClass;
  answer?: SweepAnswer;
}

// ── The boot ────────────────────────────────────────────────────────────────

let stack: VerifyStack;
let tempDir: string;
let adminToken: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ql: any;

let portRoutes: ReadonlyArray<{ method: string; pattern: string }>;
let tableKeys: Set<string>;
let population: Swept[];

/** The context each engine `find` on the class-4 object was handed. */
const engineFinds: Array<Record<string, unknown> | undefined> = [];
/** The context each flow run was started with. */
const flowContexts: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'os-anon-sweep-'));
  const artifactPath = join(tempDir, 'objectstack.json');
  writeBuildShapedArtifact(SWEPT, artifactPath);
  stack = await bootShowcase(
    {
      extraPlugins: [
        new MetadataPlugin({
          rootDir: tempDir,
          watch: false,
          artifactWatch: false,
          registerSystemObjects: false,
          artifactSource: { mode: 'local-file', path: artifactPath },
        }),
        new MCPServerPlugin(),
      ],
    },
    SWEPT,
  );
  adminToken = await stack.signIn();
  ql = await stack.kernel.getServiceAsync('objectql');

  // ── The population, read off the running server ──
  const http = await stack.kernel.getServiceAsync<{
    getMountedRoutes?(): ReadonlyArray<{ method: string; pattern: string }>;
    getRawApp?(): { routes?: Array<{ method?: string; path?: string }> };
  }>('http-server');
  expect(typeof http.getMountedRoutes, 'the booted http-server exposes no getMountedRoutes(): the sweep cannot read the port and must not pass').toBe('function');
  expect(typeof http.getRawApp, 'the booted http-server exposes no getRawApp(): the raw-app mounts are unreadable and must not pass').toBe('function');
  portRoutes = http.getMountedRoutes!();
  const portKeys = new Set(portRoutes.map(keyOf));
  const table = (http.getRawApp!().routes ?? []).filter(
    (r): r is { method: string; path: string } => typeof r?.method === 'string' && typeof r?.path === 'string',
  );
  tableKeys = new Set(table.map((r) => `${r.method.toUpperCase()} ${r.path}`));

  const routes: SweptRoute[] = [...tableKeys].map((key) => {
    const sp = key.indexOf(' ');
    return { method: key.slice(0, sp), pattern: key.slice(sp + 1), source: portKeys.has(key) ? 'port' : 'raw' };
  });

  const metadata = await stack.kernel.getServiceAsync<{
    list(type: string): Promise<unknown[]>;
    matchEndpoint?(q: { path: string; method: string }): Promise<{ endpoint: { name: string } } | undefined>;
  }>('metadata');
  for (const item of (await metadata.list('api')) as Array<Record<string, unknown>>) {
    routes.push({
      method: String(item.method).toUpperCase(),
      pattern: String(item.path),
      source: 'declared',
      endpoint: { type: item.type as string | undefined, authRequired: item.authRequired as boolean | undefined },
    });
  }

  population = routes
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
    .map((route) => {
      const probePath = route.source === 'declared' ? route.pattern : probePathOf(route.pattern);
      return { route, probePath, cls: classify(route, probePath) };
    });

  // ── Witnesses for what classes 4 and 5 run as ──
  const find = ql.find.bind(ql);
  vi.spyOn(ql, 'find').mockImplementation(async (...args: any[]) => {
    if (args[0] === 'showcase_task') engineFinds.push(args[1]?.context);
    return find(...args);
  });
  const automation = stack.kernel.getService('automation') as { execute(n: string, c: unknown): Promise<unknown> };
  const execute = automation.execute.bind(automation);
  vi.spyOn(automation, 'execute').mockImplementation(async (name: string, context: any) => {
    if (name === EchoFlow.name) flowContexts.push(context);
    return execute(name, context);
  });
}, 240_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await stack?.stop();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

const anon = (path: string, init: RequestInit = {}) =>
  stack.raw(path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } });

// ── 0. The derivation reads a real table ────────────────────────────────────

describe('ADR-0138 D2 anonymous sweep: the population is read off the running server', () => {
  it('reads a non-trivial table from all three sources', () => {
    const by = (s: SweptRoute['source']) => population.filter((p) => p.route.source === s).length;
    expect(by('port'), 'the port table is empty: every assertion below would be vacuous').toBeGreaterThan(100);
    expect(by('raw'), 'no raw-app mount was read: the framework table did not resolve').toBeGreaterThan(10);
    expect(by('declared'), 'no declared endpoint was read: the fallback seam is unobserved').toBeGreaterThanOrEqual(4);
  });

  it('the port table is a subset of the framework table, so no source hides a registration', () => {
    const missing = portRoutes.map(keyOf).filter((k) => !tableKeys.has(k));
    expect(missing, 'registered through the port but absent from the framework table').toEqual([]);
  });

  it('carries one anchor from each source, and every declared endpoint resolves to itself', async () => {
    const keys = new Set(population.map((p) => keyOf(p.route)));
    for (const anchor of [
      'GET /api/v1/meta/:type', // port
      'POST /api/v1/approvals/act', // raw
      'ALL /api/v1/auth/*', // raw: the auth catch-all
      `GET ${GUEST_FIND_PATH}`, // declared
      `POST ${GUEST_FLOW_PATH}`, // declared
    ]) {
      expect(keys.has(anchor), `the population lost an anchor: ${anchor}`).toBe(true);
    }
    const metadata = await stack.kernel.getServiceAsync<{
      matchEndpoint(q: { path: string; method: string }): Promise<{ endpoint: { path: string } } | undefined>;
    }>('metadata');
    for (const p of population.filter((x) => x.route.source === 'declared')) {
      const match = await metadata.matchEndpoint({ path: p.route.pattern, method: p.route.method });
      expect(match?.endpoint.path, `${keyOf(p.route)} is listed but the fallback seam does not match it`).toBe(p.route.pattern);
    }
  });
});

// ── 1–6. Each door class, on a real subject: admitted, and refused ──────────

describe('ADR-0138 D2 class 1: the public form doors', () => {
  it('admit an anonymous resolve and submit of a form that declares anonymous sharing', async () => {
    const resolve = await send(stack, 'GET', '/api/v1/forms/contact-us');
    expect(resolve.status).toBe(200);
    expect(resolve.json?.object, 'the resolve serves the declared form').toBe('showcase_inquiry');

    const submit = await send(stack, 'POST', '/api/v1/forms/contact-us/submit', {
      body: JSON.stringify({ name: 'Anon Sweep', email: 'anon.sweep@example.com', company: 'Sweep Co', message: 'class 1' }),
    });
    expect(submit.status, 'the submit is admitted').toBeGreaterThanOrEqual(200);
    expect(submit.status).toBeLessThan(300);
    expect(Object.keys(submit.json ?? {}), 'the submit answers the created id and nothing it stored').toEqual(['id']);
  });

  it('refuse a slug no form declares', async () => {
    const res = await send(stack, 'GET', '/api/v1/forms/anon-sweep-undeclared');
    expect(DOOR_CLASSES[0]!.expect!(res), 'an undeclared form is no door').toBeUndefined();
  });
});

describe('ADR-0138 D2 class 2: share links', () => {
  it('admit the capability token to its one record, and refuse it once revoked', async () => {
    const brief = await ql.findOne('showcase_client_brief', {
      where: { title: 'Northwind — Website Relaunch brief' },
      context: SYS,
    });
    expect(brief?.id, 'the seeded published brief').toBeTruthy();
    const minted = await stack.apiAs(adminToken, 'POST', '/share-links', { object: 'showcase_client_brief', recordId: brief.id });
    expect(minted.status, 'minted signed in').toBe(201);
    const link = ((await minted.json()) as { data: { id: string; token: string } }).data;

    const resolved = await send(stack, 'GET', `/api/v1/share-links/${link.token}/resolve`);
    expect(resolved.status).toBe(200);
    const served = resolved.json?.data as { record?: { id?: unknown } } | undefined;
    expect(served?.record?.id, 'the token serves the one record it names').toBe(brief.id);

    const revoked = await stack.apiAs(adminToken, 'DELETE', `/share-links/${link.id}`);
    expect(revoked.status, 'revoked signed in').toBeLessThan(300);
    const after = await send(stack, 'GET', `/api/v1/share-links/${link.token}/resolve`);
    expect(DOOR_CLASSES[1]!.expect!(after), 'a revoked token is no door').toBeUndefined();
  });
});

describe('ADR-0138 D2 class 3: the public book and doc metadata reads', () => {
  it('admit an anonymous read of the public book and its tree', async () => {
    const book = await send(stack, 'GET', `/api/v1/meta/book/${PUBLIC_BOOK}`);
    expect(book.status, 'the public book').toBe(200);
    expect(JSON.stringify(book.json)).toContain(PUBLIC_BOOK);
    const tree = await send(stack, 'GET', `/api/v1/meta/book/${PUBLIC_BOOK}/tree`);
    expect(tree.status, 'the public book tree').toBe(200);
  });

  it('admit an anonymous read of a doc the public book claims', async () => {
    const doc = await send(stack, 'GET', `/api/v1/meta/doc/${PUBLIC_DOC}`);
    expect(doc.status, 'a doc of the public book').toBe(200);
    expect(JSON.stringify(doc.json)).toContain(PUBLIC_DOC);
  });

  it('refuse a book that is not public, and any write to the public one, with 401', async () => {
    // The fixture book is there for a signed-in reader: the refusal is the audience gate's.
    const signedIn = await stack.apiAs(adminToken, 'GET', `/meta/book/${ORG_BOOK}`);
    expect(signedIn.status, 'the org book exists for a signed-in reader').toBe(200);
    expect(EVERYTHING_ELSE(await send(stack, 'GET', `/api/v1/meta/book/${ORG_BOOK}`)), 'the org book').toBeUndefined();
    const orgDoc = await stack.apiAs(adminToken, 'GET', `/meta/doc/${ORG_DOC}`);
    expect(orgDoc.status, 'the org doc exists for a signed-in reader').toBe(200);
    expect(EVERYTHING_ELSE(await send(stack, 'GET', `/api/v1/meta/doc/${ORG_DOC}`)), 'a doc only the org book claims').toBeUndefined();
    expect(
      EVERYTHING_ELSE(await send(stack, 'PUT', `/api/v1/meta/book/${PUBLIC_BOOK}`, { body: JSON.stringify({ name: PUBLIC_BOOK }) })),
      'a write to the public book',
    ).toBeUndefined();
  });

  it('rides the shared /meta read routes, every one of them in the population', () => {
    const keys = new Set(population.map((p) => keyOf(p.route)));
    const class3 = DOOR_CLASSES.find((d) => d.id === 3)!;
    for (const route of class3.ridesOn!) expect(keys.has(route), `class 3 rides ${route}`).toBe(true);
  });
});

describe('ADR-0138 D2 class 4: authRequired: false object_operation endpoints', () => {
  it('admit the guest envelope, which holds no grant and is denied (D3 empty state)', async () => {
    engineFinds.length = 0;
    const res = await send(stack, 'GET', GUEST_FIND_PATH);
    expect(DOOR_CLASSES[3]!.expect!(res)).toBeUndefined();
    expect(engineFinds, 'the engine is asked once').toHaveLength(1);
    expect(engineFinds[0]).toMatchObject({ principalKind: 'guest', positions: ['guest'], isSystem: false });
    expect(engineFinds[0]).not.toHaveProperty('userId');
  });

  it('refuse the session-gated sibling of the same type with 401', async () => {
    expect(EVERYTHING_ELSE(await send(stack, 'GET', GATED_FIND_PATH))).toBeUndefined();
  });
});

describe('ADR-0138 D2 class 5: authRequired: false flow endpoints', () => {
  it('admit the guest envelope at the door and serve the flow output only', async () => {
    flowContexts.length = 0;
    const res = await send(stack, 'POST', GUEST_FLOW_PATH, { body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    const run = res.json?.data as { output?: unknown } | undefined;
    expect(run?.output, 'the flow output, and nothing else').toEqual({ answer: 'served' });
    expect(flowContexts, 'the flow runs once').toHaveLength(1);
    expect(flowContexts[0]!.positions).toEqual(['guest']);
    expect(flowContexts[0]).not.toHaveProperty('userId');
    expect(flowContexts[0]).not.toHaveProperty('isSystem');
  });

  it('refuse the session-gated sibling of the same type with 401', async () => {
    expect(EVERYTHING_ELSE(await send(stack, 'POST', GATED_FLOW_PATH))).toBeUndefined();
  });
});

describe("ADR-0138 D2 class 6: the acl: 'public_read' file download", () => {
  const BYTES = 'anon-sweep-bytes';
  const toPath = (url: string): string => url.replace(/^https?:\/\/[^/]+/, '');

  /** The real three-step upload, signed in, of a file no record claims. */
  const upload = async (name: string): Promise<string> => {
    const presign = await stack.apiAs(adminToken, 'POST', '/storage/upload/presigned', {
      filename: name, mimeType: 'text/plain', size: BYTES.length,
    });
    expect(presign.status, 'presign').toBe(200);
    const { data } = (await presign.json()) as { data: { uploadUrl: string; fileId: string; headers?: Record<string, string> } };
    const put = await stack.raw(toPath(String(data.uploadUrl)), {
      method: 'PUT', headers: data.headers ?? { 'content-type': 'text/plain' }, body: BYTES,
    });
    expect(put.status, 'upload').toBeLessThan(300);
    const complete = await stack.apiAs(adminToken, 'POST', '/storage/upload/complete', { fileId: data.fileId });
    expect(complete.status, 'complete').toBe(200);
    return String(data.fileId);
  };

  it("serve an acl: 'public_read' file's bytes anonymously, and refuse a private one with 401", async () => {
    const opened = await upload('anon-sweep-public.txt');
    const closed = await upload('anon-sweep-private.txt');
    await ql.update('sys_file', { acl: 'public_read' }, { where: { id: opened }, context: SYS });

    const redirect = await anon(`/api/v1/storage/files/${opened}`, { redirect: 'manual' } as RequestInit);
    expect(redirect.status, 'the download door admits the declared file').toBe(302);
    const location = redirect.headers.get('location');
    expect(location, 'a 302 with a Location').toBeTruthy();
    const bytes = await stack.raw(toPath(String(location)));
    expect(bytes.status).toBe(200);
    expect(await bytes.text(), "the file's own bytes, nothing else").toBe(BYTES);
    expect((await send(stack, 'GET', `/api/v1/storage/files/${opened}/url`)).status, 'the URL door admits it too').toBe(200);

    for (const door of [`/api/v1/storage/files/${closed}`, `/api/v1/storage/files/${closed}/url`]) {
      const res = await send(stack, 'GET', door, { redirect: 'manual' } as RequestInit);
      expect(res.status, `a private file with no scope and no field owner, at ${door.endsWith('/url') ? 'the URL door' : 'the download door'}`).toBe(401);
    }
  });
});

// ── 7. The sweep: one anonymous request per route ───────────────────────────
//
// Last, because the population holds the dev HMR door, whose POST reloads the
// artifact, and the class legs above should not race that reload.

describe('ADR-0138 D2 anonymous sweep: one unauthenticated request per registered route', () => {
  beforeAll(async () => {
    // Middleware answers no request of its own, and the HMR reload goes last.
    const order = (p: Swept) => (p.cls.kind === 'outside' && p.cls.family.id === 'dev-metadata-hmr' ? 1 : 0);
    for (const p of [...population].sort((a, b) => order(a) - order(b))) {
      if (p.cls.kind === 'middleware') continue;
      try {
        p.answer = await send(stack, p.route.method === 'ALL' ? 'GET' : p.route.method, p.probePath);
      } catch {
        // No answer is recorded as status 0: it misses every class and is
        // counted, never thrown with its route (header, Disclosure).
        p.answer = { status: 0, contentType: '' };
      }
    }
  }, 300_000);

  /**
   * The red routes of one case, as that case prints them. By default one line
   * per class and mount family with the COUNT of red routes in it; with the
   * local switch, one line per route. Non-empty exactly when a route is red,
   * so the switch changes what is printed and never what is judged.
   */
  const failures = (pick: (p: Swept) => string | undefined): string[] => {
    const red = population.flatMap((p) => {
      const why = pick(p);
      return why ? [{ p, why }] : [];
    });
    if (ROUTE_DETAIL) return red.map(({ p, why }) => `${keyOf(p.route)} (${p.route.source}) — ${why}`);
    const counts = new Map<string, number>();
    for (const { p } of red) {
      const group = `${classLabelOf(p.cls)} · ${mountFamilyOf(p.route)} (${p.route.source})`;
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([group, n]) => `${group}: ${n} route(s) red`);
  };

  const DETAIL_HINT = ROUTE_DETAIL
    ? ''
    : 'Route-level detail is local only: set OS_TEST_ANON_SWEEP_ROUTE_DETAIL=1 and run this file directly (see its header).';

  it('every route but middleware got exactly one answer', () => {
    const unanswered = population.filter((p) => p.cls.kind !== 'middleware' && !(p.answer && p.answer.status > 0));
    expect(unanswered.map((p) => keyOf(p.route))).toEqual([]);
  });

  it('the everything-else class answers 401 throughout, with nothing served', () => {
    const swept = population.filter((p) => p.cls.kind === 'everything-else');
    expect(swept.length, 'the everything-else class is the bulk of the table').toBeGreaterThan(100);
    const red = failures((p) => (p.cls.kind === 'everything-else' ? EVERYTHING_ELSE(p.answer!) : undefined));
    expect(
      red,
      `\nADR-0138 D2: the everything-else class (no door class, no outside family) answers 401.\n${red.join('\n')}\n${DETAIL_HINT}\n`,
    ).toEqual([]);
  });

  it('every door-class route answers its class, asked about no declared subject', () => {
    const red = failures((p) => (p.cls.kind === 'door' && p.cls.door.expect ? p.cls.door.expect(p.answer!) : undefined));
    expect(red, `\nADR-0138 D2: a door-class route asked about no declared subject answers its class.\n${red.join('\n')}\n${DETAIL_HINT}\n`).toEqual([]);
  });

  it('the outside families answer as D2 states, where it states an answer', () => {
    const red = failures((p) => (p.cls.kind === 'outside' && p.cls.family.expect ? p.cls.family.expect(p.answer!) : undefined));
    expect(red, `\nADR-0138 D2: an outside family answers as D2 states, where it states an answer.\n${red.join('\n')}\n${DETAIL_HINT}\n`).toEqual([]);
  });

  it('every row of the classification claims a route on this boot: none is stale', () => {
    const claimed = new Set<string>();
    for (const p of population) {
      if (p.cls.kind === 'door') claimed.add(`door ${p.cls.door.id}`);
      if (p.cls.kind === 'outside') claimed.add(`outside ${p.cls.family.id}`);
      if (p.cls.kind === 'middleware') claimed.add(`middleware ${keyOf(p.route)}`);
    }
    const stale = [
      ...DOOR_CLASSES.filter((d) => d.match && !claimed.has(`door ${d.id}`)).map((d) => `door class ${d.id}`),
      ...OUTSIDE_FAMILIES.filter((f) => !claimed.has(`outside ${f.id}`)).map((f) => `outside family ${f.id}`),
      ...MIDDLEWARE.filter((m) => !claimed.has(`middleware ${m.key}`)).map((m) => `middleware ${m.key}`),
    ];
    expect(stale, 'a classification row that matches nothing on this boot is a row nobody can trust').toEqual([]);
  });
});
