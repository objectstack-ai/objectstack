// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11368 — the datasource editor sends the `external` block that a
 * non-managed datasource needs.
 *
 * `DatasourceSchema` (objectstack `packages/spec/src/data/datasource.zod.ts`)
 * refuses a record whose `schemaMode` is `external` or `validate-only` and that
 * carries no `external` block. Since objectstack#21133 the admin door
 * (`POST` / `PATCH /api/v1/datasources`) judges the record it will persist
 * against that schema and answers `400 DATASOURCE_ADMIN_ERROR`. The editor
 * offered both modes and never sent the block, so a Save without a credential
 * was refused, and the form had no field that could satisfy it.
 *
 * The double below is that door, reduced to what the editor reaches. It judges
 * with the installed `@objectstack/spec`'s own `DatasourceSchema` (no copy of
 * the refinement anywhere), it binds a supplied secret the way
 * `DatasourceAdminService.withSecretBinding` does, and its `PATCH` merges the
 * way `DatasourceAdminService.updateDatasource` does: a patch that omits
 * `external` keeps the stored block whole, one that carries it replaces the
 * stored block and keeps only `credentialsRef`. Its `GET /:name` serves what
 * `DatasourceAdminService.getDatasource` serves, which is no `external` at all,
 * only `hasSecret`.
 *
 * What is pinned:
 *  - Create in External and in Validate only, with and without a credential:
 *    the body carries `external: {}`, the door answers 2xx, and the stored
 *    record parses (the meta read path's `_diagnostics.valid: true`).
 *  - CONTROL: Managed sends no `external`, with and without a credential.
 *  - Edit of a federated datasource sends no `external`, so the stored block,
 *    which the read path never serves, survives the Save whole.
 *  - Edit that moves a Managed datasource into a federated mode sends
 *    `external: {}`; a stored `credentialsRef` survives it.
 *  - CONTROL: the door refuses for another reason, and the page shows the
 *    door's own message.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@object-ui/i18n';
import { DatasourceSchema } from '@objectstack/spec/data';

type FetchLike = (url: string, init?: RequestInit) => Promise<unknown>;

const state = vi.hoisted(() => ({
  fetch: (async () => undefined) as unknown as (url: string, init?: RequestInit) => Promise<unknown>,
  // STABLE identity, like the real memoized client.
  metadataClient: {},
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => (url: string, init?: RequestInit) => state.fetch(url, init),
}));
vi.mock('../useMetadata.js', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() },
}));

import { toast } from 'sonner';
import { DatasourceResourcePage } from './DatasourceResourcePage';

afterEach(() => {
  cleanup();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

// ── The admin door double ───────────────────────────────────────────────────

interface StoredDatasource {
  name: string;
  label?: string;
  driver: string;
  schemaMode?: 'managed' | 'external' | 'validate-only';
  config?: Record<string, unknown>;
  external?: Record<string, unknown>;
  origin?: 'code' | 'runtime';
  active?: boolean;
}

interface SeenRequest {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  status: number;
  /** The refusal message the door answered with, for a 4xx. */
  refusal?: string;
}

/** A postgres catalog entry: one credential field, the rest plain config. */
const POSTGRES = {
  id: 'postgres',
  label: 'PostgreSQL',
  configSchema: {
    properties: {
      host: { type: 'string', title: 'Host' },
      database: { type: 'string', title: 'Database' },
      username: { type: 'string', title: 'Username' },
      password: { type: 'string', format: 'password', title: 'Password' },
    },
  },
};

/** The stand-in ref the door judges a supplied secret under (`PENDING_SECRET_REF`). */
const PENDING_SECRET_REF = 'pending:secret-binding';

/** Patch keys whose write the door judges the record for (`RECORD_JUDGED_PATCH_KEYS`). */
const JUDGED_PATCH_KEYS = ['driver', 'schemaMode', 'config', 'external', 'pool'] as const;

function createAdminDoor(seed: StoredDatasource[] = []) {
  const store = new Map<string, StoredDatasource>(seed.map((r) => [r.name, structuredClone(r)]));
  const requests: SeenRequest[] = [];
  let minted = 0;

  const reply = (status: number, payload: unknown) => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(payload),
  });
  const ok = (data: unknown, status = 200) => reply(status, { success: true, data });

  /** `DatasourceSchema.safeParse` of the record as it will be persisted, binding included. */
  const refusal = (record: StoredDatasource, secret: unknown): string | undefined => {
    const judged = secret
      ? { ...record, external: { ...(record.external ?? {}), credentialsRef: PENDING_SECRET_REF } }
      : record;
    const result = DatasourceSchema.safeParse(judged);
    if (result.success) return undefined;
    const detail = result.error.issues
      .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('\n');
    return `Invalid datasource '${record.name}'.\n${detail}`;
  };

  const summary = (r: StoredDatasource) => ({
    name: r.name,
    label: r.label,
    driver: r.driver,
    schemaMode: r.schemaMode ?? 'managed',
    origin: r.origin ?? 'runtime',
    active: r.active ?? true,
    status: 'unvalidated',
  });

  const fetch: FetchLike = async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    const seen: SeenRequest = { method, path: url, body, status: 200 };
    requests.push(seen);
    const refuse = (message: string) => {
      seen.status = 400;
      seen.refusal = message;
      return reply(400, { success: false, error: { code: 'DATASOURCE_ADMIN_ERROR', message } });
    };

    if (url === '/api/v1/datasources/drivers') return ok({ drivers: [POSTGRES] });
    if (url === '/api/v1/datasources' && method === 'GET') {
      return ok({ datasources: [...store.values()].map(summary) });
    }
    if (url === '/api/v1/datasources' && method === 'POST') {
      const { secret, ...draft } = body ?? {};
      const record: StoredDatasource = {
        ...(draft as unknown as StoredDatasource),
        origin: 'runtime',
      };
      if (store.has(record.name)) return refuse(`Datasource '${record.name}' already exists.`);
      const why = refusal(record, secret);
      if (why) return refuse(why);
      if (secret) record.external = { ...(record.external ?? {}), credentialsRef: `secret:${record.name}:${++minted}` };
      store.set(record.name, record);
      seen.status = 201;
      return ok({ datasource: summary(record) }, 201);
    }
    const one = /^\/api\/v1\/datasources\/([^/]+)$/.exec(url);
    if (one) {
      const name = decodeURIComponent(one[1]);
      const existing = store.get(name);
      if (!existing) return refuse(`Datasource '${name}' not found.`);
      if (method === 'GET') {
        // What `getDatasource` serves: `external` is not in it, only `hasSecret`.
        return ok({
          datasource: {
            name: existing.name,
            label: existing.label,
            driver: existing.driver,
            schemaMode: existing.schemaMode ?? 'managed',
            config: existing.config,
            active: existing.active ?? true,
            origin: existing.origin ?? 'code',
            hasSecret: Boolean(existing.external?.credentialsRef),
            redactedConfigKeys: [],
          },
        });
      }
      if (method === 'PATCH') {
        const { secret, ...patch } = (body ?? {}) as Record<string, unknown> & { secret?: unknown };
        const merged: StoredDatasource = { ...existing };
        for (const key of ['label', 'driver', 'schemaMode', 'config', 'pool', 'active'] as const) {
          if (patch[key] !== undefined) (merged as unknown as Record<string, unknown>)[key] = patch[key];
        }
        if (patch.external !== undefined) {
          merged.external = {
            ...(patch.external as Record<string, unknown>),
            credentialsRef: existing.external?.credentialsRef,
          };
        }
        if (secret !== undefined || JUDGED_PATCH_KEYS.some((key) => patch[key] !== undefined)) {
          const why = refusal(merged, secret);
          if (why) return refuse(why);
        }
        if (secret) merged.external = { ...(merged.external ?? {}), credentialsRef: `secret:${name}:${++minted}` };
        store.set(name, merged);
        return ok({ datasource: summary(merged) });
      }
    }
    return refuse(`unexpected ${method} ${url}`);
  };

  /** What the meta read path's `_diagnostics.valid` reports for a stored row. */
  const storedRecordValid = (name: string) => DatasourceSchema.safeParse(store.get(name)).success;

  return { fetch, store, requests, storedRecordValid };
}

// ── Driving the real page ───────────────────────────────────────────────────

const MODE_OPTION = {
  managed: /^Managed/,
  external: /^External/,
  'validate-only': /^Validate only$/,
} as const;
type Mode = keyof typeof MODE_OPTION;

function renderPage(door: ReturnType<typeof createAdminDoor>) {
  state.fetch = door.fetch as typeof state.fetch;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <DatasourceResourcePage />
    </I18nProvider>,
  );
}

/** The input or select trigger beside a form label (the page's labels carry no `htmlFor`). */
function controlUnder(label: string | RegExp): HTMLElement {
  const lab = screen.getByText(label, { selector: 'label' });
  const control = lab.parentElement?.querySelector('input, [role="combobox"]');
  expect(control, `no control beside the "${String(label)}" label`).toBeTruthy();
  return control as HTMLElement;
}

function type(label: string | RegExp, value: string) {
  fireEvent.change(controlUnder(label), { target: { value } });
}

async function chooseMode(mode: Mode) {
  await userEvent.click(controlUnder('Schema mode'));
  await userEvent.click(await screen.findByRole('option', { name: MODE_OPTION[mode] }));
}

/** Waits for the Save to settle either way, and returns the write request it sent. */
async function saveAndSettle(door: ReturnType<typeof createAdminDoor>, method: 'POST' | 'PATCH', button: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: button }));
  await waitFor(() => {
    expect(vi.mocked(toast.success).mock.calls.length + vi.mocked(toast.error).mock.calls.length).toBeGreaterThan(0);
  });
  const writes = door.requests.filter((r) => r.method === method);
  expect(writes, `exactly one ${method} reached the door`).toHaveLength(1);
  return writes[0];
}

async function createThroughThePage(
  door: ReturnType<typeof createAdminDoor>,
  opts: { mode: Mode; secret?: string; database?: string },
) {
  renderPage(door);
  fireEvent.click(await screen.findByRole('button', { name: /New datasource/ }));
  await screen.findByText('Host', { selector: 'label' });
  type('Name *', 'warehouse');
  type('Host', 'db.internal');
  if (opts.database !== '') type('Database', opts.database ?? 'wh');
  type('Username', 'reader');
  if (opts.secret) type('Password', opts.secret);
  if (opts.mode !== 'managed') await chooseMode(opts.mode);
  return saveAndSettle(door, 'POST', /Create datasource/);
}

async function editThroughThePage(
  door: ReturnType<typeof createAdminDoor>,
  edit: { label?: string; mode?: Mode },
) {
  renderPage(door);
  fireEvent.click(await screen.findByTitle('Edit'));
  await screen.findByText(/Edit “warehouse”/);
  if (edit.label !== undefined) type('Label', edit.label);
  if (edit.mode) await chooseMode(edit.mode);
  return saveAndSettle(door, 'PATCH', /Save changes/);
}

const PG_CONFIG = { host: 'db.internal', database: 'wh', username: 'reader' };

// ── Pins ────────────────────────────────────────────────────────────────────

describe('objectui#11368 — create: a federated mode sends `external`, and the door answers 2xx', () => {
  const cases: Array<[Mode, string | undefined]> = [
    ['external', undefined],
    ['external', 's3cret'],
    ['validate-only', undefined],
    ['validate-only', 's3cret'],
  ];
  it.each(cases)('schemaMode %s, credential %s', async (mode, secret) => {
    const door = createAdminDoor();
    const post = await createThroughThePage(door, { mode, secret });

    expect.soft(post.refusal, 'the door refused the Save').toBeUndefined();
    expect.soft(toast.error).not.toHaveBeenCalled();
    expect.soft(post.body).toMatchObject({ schemaMode: mode, driver: 'postgres', config: PG_CONFIG });
    expect.soft(post.body?.external, `the body carries the block the schema requires; body ${JSON.stringify(post.body)}`).toEqual({});
    expect.soft(post.body?.secret).toBe(secret);
    expect(post.status).toBe(201);
    expect(toast.success).toHaveBeenCalledWith('Created warehouse.');
    expect(door.storedRecordValid('warehouse'), 'the stored row parses as a Datasource').toBe(true);
    expect(Boolean(door.store.get('warehouse')?.external?.credentialsRef)).toBe(Boolean(secret));
  });
});

describe('objectui#11368 — CONTROL: Managed sends no `external`', () => {
  it.each([[undefined], ['s3cret']])('credential %s', async (secret) => {
    const door = createAdminDoor();
    const post = await createThroughThePage(door, { mode: 'managed', secret });

    expect(post.body).toMatchObject({ schemaMode: 'managed' });
    expect(post.body).not.toHaveProperty('external');
    expect(post.status).toBe(201);
    expect(door.storedRecordValid('warehouse')).toBe(true);
  });
});

describe('objectui#11368 — edit keeps the stored `external` block the read path never serves', () => {
  // A federation policy the console has no field for, as an author writes it
  // through `PUT /api/v1/meta/datasource/:name`.
  const POLICY = { allowWrites: true, allowedSchemas: ['public'], queryTimeoutMs: 5000 };

  it.each([
    ['without a stored credential', {}],
    ['with a stored credential', { credentialsRef: 'secret:warehouse:seed' }],
  ])('%s: a label edit sends no `external`, and the policy survives whole', async (_arm, binding) => {
    const stored = { ...POLICY, ...binding };
    const door = createAdminDoor([
      { name: 'warehouse', driver: 'postgres', schemaMode: 'external', config: PG_CONFIG, external: stored, origin: 'runtime' },
    ]);
    const patch = await editThroughThePage(door, { label: 'Warehouse' });

    // Soft, so a body that does carry the block still reports what it cost.
    expect.soft(patch.body).not.toHaveProperty('external');
    expect.soft(patch.status).toBe(200);
    expect(door.store.get('warehouse')?.external, 'the stored policy survives the Save').toEqual(stored);
    expect(door.store.get('warehouse')?.label).toBe('Warehouse');
  });

  it('External → Validate only sends no `external`, and the policy survives whole', async () => {
    const door = createAdminDoor([
      { name: 'warehouse', driver: 'postgres', schemaMode: 'external', config: PG_CONFIG, external: POLICY, origin: 'runtime' },
    ]);
    const patch = await editThroughThePage(door, { mode: 'validate-only' });

    expect(patch.body).toMatchObject({ schemaMode: 'validate-only' });
    expect.soft(patch.body).not.toHaveProperty('external');
    expect.soft(patch.status).toBe(200);
    expect(door.store.get('warehouse')?.external, 'the stored policy survives the Save').toEqual(POLICY);
    expect(door.storedRecordValid('warehouse')).toBe(true);
  });

  it('a row the fixed editor created (`external: {}`) edits and moves to Managed without sending `external`', async () => {
    const door = createAdminDoor([
      { name: 'warehouse', driver: 'postgres', schemaMode: 'external', config: PG_CONFIG, external: {}, origin: 'runtime' },
    ]);
    const patch = await editThroughThePage(door, { mode: 'managed' });

    expect(patch.body).toMatchObject({ schemaMode: 'managed' });
    expect(patch.body).not.toHaveProperty('external');
    expect(patch.status).toBe(200);
    expect(door.storedRecordValid('warehouse')).toBe(true);
  });
});

describe('objectui#11368 — edit that moves a Managed datasource into a federated mode sends `external: {}`', () => {
  it.each([
    ['external', undefined],
    ['validate-only', undefined],
    ['external', { credentialsRef: 'secret:warehouse:seed' }],
  ] as Array<[Mode, Record<string, unknown> | undefined]>)('to %s, stored binding %o', async (mode, external) => {
    const door = createAdminDoor([
      { name: 'warehouse', driver: 'postgres', schemaMode: 'managed', config: PG_CONFIG, ...(external ? { external } : {}), origin: 'runtime' },
    ]);
    const patch = await editThroughThePage(door, { mode });

    expect.soft(patch.refusal, 'the door refused the Save').toBeUndefined();
    expect.soft(patch.body?.external).toEqual({});
    expect(patch.status).toBe(200);
    expect(door.storedRecordValid('warehouse')).toBe(true);
    expect(door.store.get('warehouse')?.external?.credentialsRef).toBe(external?.credentialsRef);
  });
});

describe('objectui#11368 — CONTROL: the door stays the judge, and the page shows its message', () => {
  it('an External datasource with no connection target is refused, and the refusal is rendered', async () => {
    const door = createAdminDoor();
    const post = await createThroughThePage(door, { mode: 'external', database: '' });

    expect(post.body?.external, 'the block is sent; it is not what the door refuses').toEqual({});
    expect(post.status).toBe(400);
    expect(post.refusal).toBeTruthy();
    expect(post.refusal).not.toMatch(/^external:/m);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(post.refusal!));
    expect(door.store.has('warehouse')).toBe(false);
    expect(screen.getByRole('button', { name: /Create datasource/ }), 'the dialog stays open').toBeInTheDocument();
  });
});
