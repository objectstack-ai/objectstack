// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0159 D6, card ② "Done when"] The anonymous form doors read a form over
 * BOTH metadata types — the `form` item and the three old `view` shapes, the
 * latter through ONE projection — and a withdrawal in either type, in any
 * layer, closes the form in both (narrowing only, in both directions).
 *
 * Every pin runs the REAL protocol over a real `ObjectQL` engine and a real
 * SQL store (as `public-form-withdrawal-effective-read.test.ts` does): the
 * base ships through `registerApp`, the pair and the dependent package are
 * installed through the package door, and their rows are written through the
 * draft save and the per-item publish. A row the save door refuses today (a
 * dependent package's row under a base's name; a `view` override over a base
 * that authors the name as a `form` item) is a row stored before that gate:
 * the gate's verdict is held at `not_concerned` for that one write.
 *
 * Each pin asserts the refusal's status and `code` on BOTH doors and that no
 * record was written. The ablation each pin names was run by hand (remove the
 * named read, watch the pin turn red, restore) and is recorded on the PR.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import {
  SysMetadataAuditObject,
  SysMetadataCommitObject,
  SysMetadataHistoryObject,
  SysMetadataObject,
  hashSpec,
} from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

const BASE = 'com.example.forms37086';
const PAIR = `${BASE}.custom`;
const DEPENDENT = 'com.default.acme-forms37086';
const OBJECT = 'ftt_inquiry';
const NAME = `${OBJECT}.contact`;
const SLUG = 'contact-37086';
const OTHER_SLUG = 'elsewhere-37086';

const sharing = (open: boolean, slug = SLUG) => ({ enabled: true, allowAnonymous: open, publicLink: `/forms/${slug}` });
const body = (open: boolean | null, slug = SLUG) => ({
  type: 'simple',
  sections: [{ fields: ['name', 'email'] }],
  ...(open === null ? {} : { sharing: sharing(open, slug) }),
});

/** An authored `form` item at {@link NAME}. */
const formItem = (open: boolean | null, extra: Record<string, unknown> = {}, slug = SLUG) => ({
  name: NAME, object: OBJECT, label: 'Contact us', ...body(open, slug), ...extra,
});
/** An old-shape `viewKind: 'form'` item at {@link NAME}. */
const viewItem = (open: boolean | null, extra: Record<string, unknown> = {}, slug = SLUG) => ({
  name: NAME, object: OBJECT, viewKind: 'form', label: 'Contact us',
  config: { ...body(open, slug), data: { provider: 'object', object: OBJECT } },
  ...extra,
});
/** An old-shape container whose `formViews.contact` expands to {@link NAME}. */
const container = (open: boolean | null) => ({
  object: OBJECT,
  formViews: { contact: { ...body(open), data: { provider: 'object', object: OBJECT } } },
});
const overrides = { overrides: { package: BASE, basedOn: '1.0.0' } };

const INQUIRY = {
  name: OBJECT,
  label: 'Inquiry',
  fields: {
    name: { name: 'name', type: 'text' as const, label: 'Name' },
    email: { name: 'email', type: 'text' as const, label: 'Email' },
  },
};

function mockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    header: () => res,
    setHeader: () => res,
    send: (b: unknown) => { res._json = b; return res; },
    write: () => true,
    end: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (b: unknown) => { res._json = b; return res; },
  };
  return res;
}

interface Answer { status: number; body: any }

async function boot(ships: { forms?: unknown[]; views?: unknown[] }, opts: { i18n?: unknown } = {}) {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    engine.registry.registerObject(o as any, 'test-package');
  }
  engine.registerApp({
    id: BASE,
    name: 'forms37086',
    version: '1.0.0',
    namespace: 'ftt',
    objects: [INQUIRY],
    ...(ships.forms ? { forms: ships.forms } : {}),
    ...(ships.views ? { views: ships.views } : {}),
  } as any);
  await engine.syncSchemas();
  const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => new Map());
  const rest = new RestServer(
    mockServer() as any, protocol, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    // i18nServiceProvider — the 14th constructor argument.
    opts.i18n !== undefined ? async () => opts.i18n as any : undefined,
  );
  rest.registerRoutes();
  const route = (method: string, path: string) => {
    const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(found, `${method} ${path} is registered`).toBeDefined();
    return found!;
  };
  const resolve = route('GET', '/api/v1/forms/:slug');
  const submit = route('POST', '/api/v1/forms/:slug/submit');
  const get = async (slug = SLUG, headers: Record<string, string> = {}): Promise<Answer> => {
    const res = makeRes();
    await resolve.handler({ params: { slug }, query: {}, headers } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const post = async (slug = SLUG): Promise<Answer> => {
    const res = makeRes();
    await submit.handler({ params: { slug }, body: { name: 'Ada', email: 'ada@example.test' }, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const records = async () => ((await engine.find(OBJECT, {}, { context: { isSystem: true } })) as unknown[]).length;
  const install = async (id: string) => protocol.installPackage({
    manifest: {
      id, name: id.split('.').join('-'), version: '0.1.0', type: 'app',
      ...(id === PAIR ? { namespace: 'ftt_custom', dependencies: { [BASE]: '^1' } } : { dependencies: { [BASE]: '*' } }),
    },
  });
  const saveInto = async (type: 'view' | 'form', packageId: string | undefined, item: Record<string, unknown>, name = NAME) => {
    await protocol.saveMetaItem({ type, name, item, mode: 'draft', ...(packageId ? { packageId } : {}) });
    await protocol.publishMetaItem({ type, name, ...(packageId ? { packageId } : {}) });
  };
  /** A write the override gate refuses today, stored as a pre-gate save left it. */
  const saveBeforeTheGate = async (type: 'view' | 'form', packageId: string | undefined, item: Record<string, unknown>, name = NAME) => {
    protocol.overrideWriteVerdict = () => ({ verdict: 'not_concerned' });
    try {
      await saveInto(type, packageId, item, name);
    } finally {
      delete protocol.overrideWriteVerdict;
    }
  };
  /** A stored row as it exists at rest, written past every door (a body no door admits). */
  const seedRow = async (type: string, name: string, packageId: string | null, item: Record<string, unknown>) => {
    const now = new Date().toISOString();
    await engine.insert('sys_metadata', {
      id: `seed_${type}_${name}_${packageId ?? 'unbound'}`, type, name,
      package_id: packageId, state: 'active', metadata: JSON.stringify(item), checksum: hashSpec(item, type),
      version: 1, created_at: now, updated_at: now,
    }, { context: { isSystem: true } });
  };
  /** `GET /api/v1/meta/:type/:name` as `caller` (`systemPermissions`), or anonymous-free when `caller` is omitted. */
  const meta = async (type: string, name: string, caller?: { systemPermissions: string[] }, headers: Record<string, string> = {}): Promise<Answer> => {
    (rest as any).resolveExecCtx = async () => (caller ? { userId: 'u_reader', ...caller } : undefined);
    const item = route('GET', '/api/v1/meta/:type/:name');
    const res = makeRes();
    await item.handler({ method: 'GET', path: `/api/v1/meta/${type}/${name}`, params: { type, name }, query: {}, body: {}, headers } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  return { engine, protocol, rest, get, post, records, install, saveInto, saveBeforeTheGate, seedRow, meta };
}

type Booted = Awaited<ReturnType<typeof boot>>;
const answered = (a: Answer) => [a.status, a.body?.code];

/** Both doors refuse with `404 FORM_NOT_FOUND`, and nothing was written. */
async function closedOnBothDoors(b: Booted, slug = SLUG) {
  const before = await b.records();
  expect(answered(await b.get(slug))).toEqual([404, 'FORM_NOT_FOUND']);
  expect(answered(await b.post(slug))).toEqual([404, 'FORM_NOT_FOUND']);
  expect(await b.records()).toBe(before);
}

/**
 * Both doors match the form: the resolve door serves it, and the submit door
 * gets past the match (the tenancy intake rule, which runs after the match,
 * answers for this bare fixture — ADR-0159 D6 rule 8).
 */
async function openOnBothDoors(b: Booted, slug = SLUG) {
  const served = await b.get(slug);
  expect(served.status, JSON.stringify(served.body)).toBe(200);
  expect(answered(await b.post(slug))).not.toEqual([404, 'FORM_NOT_FOUND']);
}

describe('[ADR-0159 D6] the form doors read both types: a withdrawal in either closes the form in both', () => {
  const engines: ObjectQL[] = [];
  const savedWritable = process.env.OS_METADATA_WRITABLE;
  beforeAll(() => {
    delete process.env.OS_METADATA_WRITABLE;
    // Pin 6 reads the boot report off console.error, so the REST log level is declared (check:rest-log-spy-declared).
    vi.stubEnv('OS_REST_LOG', 'info');
  });
  beforeEach(() => {
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (savedWritable === undefined) delete process.env.OS_METADATA_WRITABLE;
    else process.env.OS_METADATA_WRITABLE = savedWritable;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
    for (const engine of engines) await engine.destroy().catch(() => {});
  });
  const booted = async (ships: { forms?: unknown[]; views?: unknown[] }): Promise<Booted> => {
    const b = await boot(ships);
    engines.push(b.engine);
    return b;
  };

  it('CONTROL: an authored `form` item open in the base is served on both doors', async () => {
    const b = await booted({ forms: [formItem(true)] });
    const forms = ((await b.protocol.getMetaItems({ type: 'form' })).items as any[]).filter((f) => f?.name === NAME);
    expect(forms.map((f) => [f._packageId, f.sharing?.allowAnonymous])).toEqual([[BASE, true]]);
    await openOnBothDoors(b);
  });

  it('CONTROL: an old-shape form open in the base is served on both doors, and read as a `form` item', async () => {
    const b = await booted({ views: [container(true)] });
    const forms = ((await b.protocol.getMetaItems({ type: 'form' })).items as any[]).filter((f) => f?.name === NAME);
    expect(forms.map((f) => [f._packageId, f.object, f._formDefinedIn])).toEqual([[BASE, OBJECT, 'view']]);
    await openOnBothDoors(b);
  });

  it('pin 1 — withdrawn by a `view` override in `.custom`, open as an authored `form` item: closed (ablate: the `view` half of the layer)', async () => {
    const b = await booted({ forms: [formItem(true)] });
    await b.install(PAIR);
    await b.saveBeforeTheGate('view', PAIR, viewItem(false, overrides));
    await closedOnBothDoors(b);
  });

  it('pin 2 — the mirror: withdrawn by a `form` override, open as an old-shape item in the base (ablate: the `form` half)', async () => {
    const b = await booted({ views: [container(true)] });
    await b.install(PAIR);
    await b.saveInto('form', PAIR, formItem(false, overrides));
    await closedOnBothDoors(b);
  });

  it('pin 3 — withdrawn in a container\'s `formViews` entry, open as a `form` item named for the expansion (ablate: the projection step)', async () => {
    // One package authors both: an old-shape container whose `formViews.contact`
    // withdraws the form, and an open `form` item under the name that entry
    // expands to. The authored item shadows the projection for what is SERVED;
    // it never removes the withdrawal (rule 5).
    const b = await booted({ forms: [formItem(true)], views: [container(false)] });
    await closedOnBothDoors(b);
  });

  it('pin 4 — withdrawn in a body of the same name whose link names another slug: closed at the open definition\'s address (ablate: the whole-item match)', async () => {
    // The open definition is the base's old-shape form at SLUG; the effective
    // lists serve it alone. A dependent package's row of the same name keeps
    // its link on ANOTHER slug, switched off: the body of the name withdraws
    // the form, whatever slug it points at (rule 6).
    const b = await booted({ views: [container(true)] });
    await b.install(DEPENDENT);
    await b.saveBeforeTheGate('view', DEPENDENT, viewItem(false, {}, OTHER_SLUG));
    const effective = ((await b.protocol.getMetaItems({ type: 'form' })).items as any[]).filter((f) => f?.name === NAME);
    expect(effective.map((f) => [f._packageId, f.sharing?.publicLink, f.sharing?.allowAnonymous])).toEqual([[BASE, `/forms/${SLUG}`, true]]);
    await closedOnBothDoors(b);
  });

  it.each(['form', 'view'] as const)('pin 5 — a per-package-layer withdrawal in `%s` closes the form (ablate: getMetaItemsPerPackage for that type)', async (type) => {
    // The base ships the name in the withdrawing row's own type, so the
    // effective list of that type serves the base's document alone and the
    // dependent's row sits in the per-package layer only.
    const b = await booted(type === 'form' ? { forms: [formItem(true)] } : { views: [container(true)] });
    await b.install(DEPENDENT);
    if (type === 'form') await b.seedRow('form', NAME, DEPENDENT, formItem(false));
    else await b.saveBeforeTheGate('view', DEPENDENT, viewItem(false));
    // The premise, for `view`: the effective read serves the base's open
    // form alone, and the withdrawing row sits in the per-package layer only.
    // (A dependent's `form` row under the base's name is sealed at the write
    // door; at rest the effective `form` read itself serves its withdrawal.)
    if (type === 'view') {
      const effective = ((await b.protocol.getMetaItems({ type: 'form' })).items as any[]).filter((f) => f?.name === NAME);
      expect(effective.map((f) => f.sharing?.allowAnonymous)).toEqual([true]);
    }
    await closedOnBothDoors(b);
  });

  it('pin 6 — an unreadable old-shape body closes the links it names, and says so once at error (ablate: rule 7)', async () => {
    const b = await booted({ forms: [formItem(true)] });
    // A `viewKind: 'form'` item with no `config`: no door admits it, so it is a row at rest.
    await b.seedRow('view', `${OBJECT}.broken`, null, { name: `${OBJECT}.broken`, viewKind: 'form', sharing: sharing(true) });
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
    try {
      const unreadable = await b.protocol.getUnreadableFormBodies();
      expect(unreadable.map((u: any) => [u.name, u.links])).toEqual([[`${OBJECT}.broken`, [SLUG]]]);
      await b.protocol.getUnreadableFormBodies();
    } finally {
      spy.mockRestore();
    }
    const said = lines.filter((l) => l.includes(`${OBJECT}.broken`));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(SLUG);
    await closedOnBothDoors(b);
  });

  it('pin 7 — replacement across the types: a `view` override with no link over an open authored `form` item closes the address (ablate: the cross-type resolution of D5)', async () => {
    const b = await booted({ forms: [formItem(true)] });
    await b.install(PAIR);
    await b.saveBeforeTheGate('view', PAIR, viewItem(null, overrides));
    await closedOnBothDoors(b);
  });

  it('pin 7, twin — a package-less `view` row with no link over an open authored `form` item closes the address', async () => {
    const b = await booted({ forms: [formItem(true)] });
    await b.seedRow('view', NAME, null, viewItem(null));
    await closedOnBothDoors(b);
  });

  it('narrowing only: an open `form` override cannot re-open a form the base\'s old shape withdraws', async () => {
    const b = await booted({ views: [container(false)] });
    await closedOnBothDoors(b);
    await b.install(PAIR);
    await b.saveInto('form', PAIR, formItem(true, overrides));
    await closedOnBothDoors(b);
  });
});

describe('[ADR-0159 ruled question 3 = A] a `form` left open on an address another form holds is refused', () => {
  const engines: ObjectQL[] = [];
  afterAll(async () => {
    for (const engine of engines) await engine.destroy().catch(() => {});
  });
  const booted = async (ships: { forms?: unknown[]; views?: unknown[] }): Promise<Booted> => {
    const b = await boot(ships);
    engines.push(b.engine);
    return b;
  };
  const SECOND = `${OBJECT}.second`;

  it('refuses a second open form on a held address with 409 FORM_ADDRESS_TAKEN, naming both forms', async () => {
    const b = await booted({ views: [container(true)] });
    await b.install(PAIR);
    const err = await b.protocol.saveMetaItem({ type: 'form', name: SECOND, packageId: PAIR, mode: 'draft', item: { ...formItem(true), name: SECOND } })
      .then(() => undefined, (e: any) => e);
    expect(err).toMatchObject({ code: 'FORM_ADDRESS_TAKEN', status: 409 });
    expect(String(err.message)).toContain(NAME);
    expect(String(err.message)).toContain(SECOND);
  });

  it('a switched-off form that keeps its link still holds the address', async () => {
    const b = await booted({ forms: [formItem(false)] });
    await b.install(PAIR);
    await expect(b.protocol.saveMetaItem({ type: 'form', name: SECOND, packageId: PAIR, mode: 'draft', item: { ...formItem(true), name: SECOND } }))
      .rejects.toMatchObject({ code: 'FORM_ADDRESS_TAKEN', status: 409 });
  });

  it('CONTROL: a save that leaves the form closed is never refused', async () => {
    const b = await booted({ forms: [formItem(true)] });
    await b.install(PAIR);
    await expect(b.saveInto('form', PAIR, { ...formItem(false), name: SECOND }, SECOND)).resolves.toBeUndefined();
  });
});

describe('[ADR-0159 D5] the `form` writes: the old-shape row goes with the save; a list of the name stays', () => {
  const engines: ObjectQL[] = [];
  afterAll(async () => {
    for (const engine of engines) await engine.destroy().catch(() => {});
  });
  const booted = async (ships: { forms?: unknown[]; views?: unknown[] }): Promise<Booted> => {
    const b = await boot(ships);
    engines.push(b.engine);
    return b;
  };
  /** The pair's ACTIVE stored `view` rows of the name, read off the store itself. */
  const storedViews = async (b: Booted, name = NAME) => {
    const rows = (await b.engine.find('sys_metadata', { where: { type: 'view', name, package_id: PAIR, state: 'active' } }, { context: { isSystem: true } })) as any[];
    return rows.map((r) => (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata));
  };

  it('a `form` save at a package removes that package\'s old-shape row of the name, in the same write', async () => {
    const b = await booted({ views: [container(true)] });
    await b.install(PAIR);
    await b.saveInto('view', PAIR, viewItem(true, { ...overrides, label: 'Old shape' }));
    expect((await storedViews(b)).length).toBe(1);
    await b.saveInto('form', PAIR, formItem(true, { ...overrides, label: 'New type' }));
    expect(await storedViews(b)).toEqual([]);
    const served = await b.get();
    expect(served.status, JSON.stringify(served.body)).toBe(200);
    expect(JSON.stringify(served.body)).toContain('New type');
  });

  it('a `form` write leaves a list row of the same name untouched', async () => {
    const b = await booted({ views: [container(true)] });
    await b.install(PAIR);
    const list = { name: NAME, object: OBJECT, viewKind: 'list', label: 'A list', config: { type: 'grid', columns: ['name'], data: { provider: 'object', object: OBJECT } } };
    await b.saveBeforeTheGate('view', PAIR, list);
    await b.saveInto('form', PAIR, formItem(true, overrides));
    expect((await storedViews(b)).map((v) => v.viewKind)).toEqual(['list']);
  });
});

describe('[ADR-0159 D5] a package-less list at the name a read-only package authors as a `form` is refused', () => {
  const engines: ObjectQL[] = [];
  afterAll(async () => {
    for (const engine of engines) await engine.destroy().catch(() => {});
  });
  const booted = async (ships: { forms?: unknown[]; views?: unknown[] }): Promise<Booted> => {
    const b = await boot(ships);
    engines.push(b.engine);
    return b;
  };
  const list = { name: NAME, object: OBJECT, viewKind: 'list', label: 'A list', config: { type: 'grid', columns: ['name'], data: { provider: 'object', object: OBJECT } } };

  it('refuses the save of a list item with 400 VALIDATION_ERROR, naming the package', async () => {
    const b = await booted({ forms: [formItem(true)] });
    const err = await b.protocol.saveMetaItem({ type: 'view', name: NAME, mode: 'draft', item: list }).then(() => undefined, (e: any) => e);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(String(err.message)).toContain(BASE);
  });

  it('refuses a container whose expansion writes a list at the name', async () => {
    const b = await booted({ forms: [{ ...formItem(true), name: `${OBJECT}.all`, sharing: undefined }] });
    // A package-less container on the package's object expands under its own
    // name: its bare `list` is `<object>.<container name>`, here the form's.
    const listContainer = { name: 'all', object: OBJECT, list: { type: 'grid', columns: ['name'], data: { provider: 'object', object: OBJECT } } };
    await expect(b.protocol.saveMetaItem({ type: 'view', name: 'all', mode: 'draft', item: listContainer }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('refuses the publish of a list draft saved before the gate', async () => {
    const b = await booted({ forms: [formItem(true)] });
    const shipped = b.protocol.shippedArtifactsOf;
    b.protocol.shippedArtifactsOf = (type: string, name: string) => (type === 'form' ? [] : shipped.call(b.protocol, type, name));
    try {
      await b.protocol.saveMetaItem({ type: 'view', name: NAME, mode: 'draft', item: list });
    } finally {
      b.protocol.shippedArtifactsOf = shipped;
    }
    await expect(b.protocol.publishMetaItem({ type: 'view', name: NAME }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('CONTROL: a form-carrying view at the name is not a list, and the same list in an app of the environment\'s own is admitted', async () => {
    const b = await booted({ forms: [formItem(true)] });
    const err = await b.protocol.saveMetaItem({ type: 'view', name: NAME, mode: 'draft', item: viewItem(true) }).then(() => undefined, (e: any) => e);
    expect(err?.code).not.toBe('VALIDATION_ERROR');
    await b.install(DEPENDENT);
    const other = await b.protocol.saveMetaItem({ type: 'view', name: NAME, mode: 'draft', packageId: DEPENDENT, item: list }).then(() => undefined, (e: any) => e);
    expect(other?.code).not.toBe('VALIDATION_ERROR');
  });
});

describe('[ADR-0159 D7-b, measure first] does a write door admit a declared override that carries no form at a form\'s name?', () => {
  const engines: ObjectQL[] = [];
  afterAll(async () => {
    for (const engine of engines) await engine.destroy().catch(() => {});
  });

  const listOverride = { name: NAME, object: OBJECT, viewKind: 'list', ...overrides, config: { type: 'grid', columns: ['name'], data: { provider: 'object', object: OBJECT } } };
  const measure = async (ships: { forms?: unknown[]; views?: unknown[] }) => {
    const b = await boot(ships);
    engines.push(b.engine);
    await b.install(PAIR);
    const outcome = await b.saveInto('view', PAIR, listOverride).then(() => 'admitted', (e: any) => `${e.status} ${e.code}`);
    return { b, outcome };
  };

  it('over a base that authors the name as a `form` item: refused, 403 NOT_OVERRIDABLE (the base ships no `view` there)', async () => {
    expect((await measure({ forms: [formItem(true)] })).outcome).toBe('403 NOT_OVERRIDABLE');
  });

  it('over a base that ships the form as an old shape: ADMITTED, and the stored list closes the base\'s address (D7-b, rule 11)', async () => {
    const { b, outcome } = await measure({ views: [container(true)] });
    expect(outcome).toBe('admitted');
    await closedOnBothDoors(b);
  });
});

/** The pair's (or `packageId`'s) ACTIVE stored rows of `type` at `name`, as the store holds them: metadata bytes and checksum. */
async function rawRows(b: Booted, type: string, name: string, packageId: string | null) {
  const rows = (await b.engine.find('sys_metadata', { where: { type, name, state: 'active' } }, { context: { isSystem: true } })) as any[];
  return rows
    .filter((r) => (r.package_id ?? null) === packageId)
    .map((r) => ({ metadata: typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata), checksum: r.checksum }));
}

/** The newest version the history holds for `(type, name)` at `packageId`. */
async function newestVersion(b: Booted, type: string, name: string): Promise<number> {
  const history: any = await b.protocol.historyMetaItem({ type, name });
  return Math.max(...(history.events as any[]).map((e) => Number(e.version)).filter((v) => Number.isFinite(v)));
}

const LIST = { name: NAME, object: OBJECT, viewKind: 'list', label: 'A list', config: { type: 'grid', columns: ['name'], data: { provider: 'object', object: OBJECT } } };
/** A container on {@link OBJECT} whose bare `list` expands to `<object>.<container name>`. */
const listContainer = (name: string) => ({ name, object: OBJECT, list: { type: 'grid', columns: ['name'], data: { provider: 'object', object: OBJECT } } });

describe('[ADR-0159 D6, D5] the `form` half of the layer, served rows only, and the closed reading', () => {
  const engines: ObjectQL[] = [];
  afterAll(async () => {
    for (const engine of engines) await engine.destroy().catch(() => {});
  });
  const booted = async (ships: { forms?: unknown[]; views?: unknown[] }): Promise<Booted> => {
    const b = await boot(ships);
    engines.push(b.engine);
    return b;
  };
  const servedAt = async (b: Booted) => ((await b.protocol.getMetaItems({ type: 'form' })).items as any[])
    .filter((f) => f?.name === NAME)
    .map((f) => [f._packageId ?? null, f.sharing?.allowAnonymous ?? null]);

  it('pin 2b — the `form` half alone: the base authors the form switched off with its link kept, and a dependent\'s old-shape row of the name stands open on that link (ablate: the `form` half of the layer)', async () => {
    const b = await booted({ forms: [formItem(false)] });
    await b.install(DEPENDENT);
    await b.saveBeforeTheGate('view', DEPENDENT, viewItem(true));
    // The premise: the open old shape is a candidate, and the only body that
    // withdraws the name is the base's `form` item: no `view` body does.
    expect(await servedAt(b)).toEqual(expect.arrayContaining([[BASE, false], [DEPENDENT, true]]));
    const views = ((await b.protocol.getMetaItems({ type: 'view' })).items as any[]).filter((v) => v?.name === NAME);
    expect(views.map((v) => v.config?.sharing?.allowAnonymous)).toEqual([true]);
    await closedOnBothDoors(b);
  });

  it('pin 2b, twin — a package-less old-shape row open over the base\'s switched-off `form` item: the base\'s own document still withdraws it', async () => {
    const b = await booted({ forms: [formItem(false)] });
    await b.seedRow('view', NAME, null, viewItem(true));
    await closedOnBothDoors(b);
  });

  it('served rows only — a writable package\'s own list beside a package-less open old shape of the name: 404 before and after (ablate: project every stored `view` row)', async () => {
    const b = await booted({});
    await b.install(DEPENDENT);
    await b.saveInto('view', DEPENDENT, LIST);
    await b.seedRow('view', NAME, null, viewItem(true));
    await closedOnBothDoors(b);
  });

  it('served rows only, at the address — a read-only package\'s open `form` item under a package-less row whose form has no link: 404 before and after a list of the name is saved beside it (ablate: take the served rows from the effective `view` list)', async () => {
    const b = await booted({ forms: [formItem(true)] });
    await b.seedRow('view', NAME, null, viewItem(null));
    await closedOnBothDoors(b);
    await b.install(DEPENDENT);
    await b.saveInto('view', DEPENDENT, LIST);
    await b.install(PAIR);
    await b.saveInto('view', PAIR, LIST);
    await closedOnBothDoors(b);
  });

  it('the closed reading — a stored package-less list at the name keeps both doors at 404 at the package\'s address (ablate: fall through to the package\'s source `form` item)', async () => {
    const b = await booted({ forms: [formItem(true)] });
    await openOnBothDoors(b);
    await b.seedRow('view', NAME, null, LIST);
    await closedOnBothDoors(b);
  });

  it('the closed reading — so does a stored package-less container whose expansion writes a list at the name', async () => {
    const ALL = `${OBJECT}.all`;
    const b = await booted({ forms: [{ ...formItem(true), name: ALL }] });
    await openOnBothDoors(b);
    await b.seedRow('view', 'all', null, listContainer('all'));
    await closedOnBothDoors(b);
  });
});

describe('[ADR-0159 D5, card ② item 5] the bound: a package-less list at the form\'s name is refused, the saves beside it are admitted', () => {
  const engines: ObjectQL[] = [];
  afterAll(async () => {
    for (const engine of engines) await engine.destroy().catch(() => {});
  });
  const booted = async (ships: { forms?: unknown[]; views?: unknown[] }): Promise<Booted> => {
    const b = await boot(ships);
    engines.push(b.engine);
    return b;
  };
  const ALL = `${OBJECT}.all`;
  const refused = async (p: Promise<unknown>) => {
    const err: any = await p.then(() => undefined, (e: any) => e);
    expect(err, 'refused').toBeDefined();
    expect([err.status, err.code]).toEqual([400, 'VALIDATION_ERROR']);
  };

  it('refused where the base\'s pair cannot be ensured too; the list saved into an app of the environment\'s own and into the pair as its own item saves; after all of them the doors serve the package\'s form (ablate: the bound; the expansion half)', async () => {
    const b = await booted({ forms: [formItem(true), { ...formItem(true, {}, OTHER_SLUG), name: ALL }] });
    await refused(b.protocol.saveMetaItem({ type: 'view', name: NAME, mode: 'draft', item: LIST }));
    await refused(b.protocol.saveMetaItem({ type: 'view', name: 'all', mode: 'draft', item: listContainer('all') }));
    // Another package holds the namespace the pair would take: the ensure door refuses to form it.
    await b.protocol.installPackage({ manifest: { id: 'com.default.squatter37086', name: 'squatter', version: '0.1.0', type: 'app', namespace: 'ftt_custom' } });
    const ensured = await b.protocol.ensureCustomizationPackage({ basePackageId: BASE }).then(() => 'ensured', (e: any) => e.status);
    expect(ensured).not.toBe('ensured');
    await refused(b.protocol.saveMetaItem({ type: 'view', name: NAME, mode: 'draft', item: LIST }));
    await refused(b.protocol.saveMetaItem({ type: 'view', name: 'all', mode: 'draft', item: listContainer('all') }));
    expect(await rawRows(b, 'view', NAME, null)).toEqual([]);
    expect(await rawRows(b, 'view', 'all', null)).toEqual([]);
    await openOnBothDoors(b);
    await openOnBothDoors(b, OTHER_SLUG);
  });

  it('…and with the pair ensurable: the list into an app of the environment\'s own and into the pair as its own item saves, and the doors still serve the package\'s form', async () => {
    const b = await booted({ forms: [formItem(true)] });
    await b.install(DEPENDENT);
    await expect(b.saveInto('view', DEPENDENT, LIST)).resolves.toBeUndefined();
    await b.install(PAIR);
    await expect(b.saveInto('view', PAIR, LIST)).resolves.toBeUndefined();
    await refused(b.protocol.saveMetaItem({ type: 'view', name: NAME, mode: 'draft', item: LIST }));
    await openOnBothDoors(b);
  });
});

describe('[ADR-0159 D5, D6 rule 9, card ② items 2, 5 and 7] the `form` write doors', () => {
  const engines: ObjectQL[] = [];
  afterAll(async () => {
    for (const engine of engines) await engine.destroy().catch(() => {});
  });
  const booted = async (ships: { forms?: unknown[]; views?: unknown[] }): Promise<Booted> => {
    const b = await boot(ships);
    engines.push(b.engine);
    return b;
  };
  const SECOND = `${OBJECT}.second`;
  const THIRD = `${OBJECT}.third`;
  const failure = (p: Promise<unknown>) => p.then(() => undefined, (e: any) => e);

  it('rule 9 — an organization-scoped `form` save is refused as the same `view` save is, the withdrawal held in the other type, and nothing is written', async () => {
    // A form withdrawn in `form`, an organization-scoped `view` save that would leave it open…
    const a = await booted({ forms: [formItem(false)] });
    const viewErr = await failure(a.protocol.saveMetaItem({ type: 'view', name: NAME, mode: 'draft', item: viewItem(true), organizationId: 'org_a' } as any));
    expect([viewErr?.status, viewErr?.code]).toEqual([403, 'NOT_OVERRIDABLE']);
    // …and the mirror: withdrawn in an old shape, an organization-scoped `form` save.
    const b = await booted({ views: [container(false)] });
    const formErr = await failure(b.protocol.saveMetaItem({ type: 'form', name: NAME, mode: 'draft', item: formItem(true), organizationId: 'org_a' } as any));
    expect([formErr?.status, formErr?.code]).toEqual([403, 'NOT_OVERRIDABLE']);
    expect(await rawRows(a, 'view', NAME, null)).toEqual([]);
    expect((await b.engine.find('sys_metadata', { where: { type: 'form' } }, { context: { isSystem: true } }) as any[]).length).toBe(0);
    await closedOnBothDoors(a);
    await closedOnBothDoors(b);
  });

  it('a `form` override of a name the base ships in neither type is refused `declared_package_ships_no_such_item` (ablate: the projection half of the gate\'s "ships" read; the CONTROL below is then refused)', async () => {
    const b = await booted({ views: [container(true)] });
    await b.install(PAIR);
    const verdicts: any[] = [];
    const real = b.protocol.overrideWriteVerdict.bind(b.protocol);
    b.protocol.overrideWriteVerdict = (...a: any[]) => { const v = real(...a); verdicts.push(v); return v; };
    const NOWHERE = `${OBJECT}.nowhere`;
    const err = await failure(b.protocol.saveMetaItem({ type: 'form', name: NOWHERE, packageId: PAIR, mode: 'draft', item: { ...formItem(null, overrides), name: NOWHERE } }));
    expect([err?.status, err?.code]).toEqual([403, 'NOT_OVERRIDABLE']);
    expect(verdicts.map((v) => v.rule)).toContain('declared_package_ships_no_such_item');
    // CONTROL: the same override of the name the base ships as an old shape is admitted.
    verdicts.length = 0;
    await expect(b.saveInto('form', PAIR, formItem(false, overrides))).resolves.toBeUndefined();
    expect(verdicts.map((v) => v.verdict)).toContain('admit');
    await closedOnBothDoors(b);
  });

  it('an old-shape `view` write on a taken slug still saves as before', async () => {
    const b = await booted({ forms: [formItem(true)] });
    await b.install(DEPENDENT);
    await expect(b.saveInto('view', DEPENDENT, viewItem(true, { name: SECOND }, SLUG), SECOND)).resolves.toBeUndefined();
    expect((await rawRows(b, 'view', SECOND, DEPENDENT)).length).toBe(1);
  });

  it('publish — a `form` draft left open on an address another form took after the draft was saved is refused 409 FORM_ADDRESS_TAKEN, naming both forms, and nothing is promoted', async () => {
    const b = await booted({});
    await b.install(PAIR);
    await b.protocol.saveMetaItem({ type: 'form', name: SECOND, packageId: PAIR, mode: 'draft', item: { ...formItem(true), name: SECOND } });
    await b.saveInto('form', PAIR, { ...formItem(true), name: THIRD }, THIRD);
    const err = await failure(b.protocol.publishMetaItem({ type: 'form', name: SECOND, packageId: PAIR }));
    expect([err?.status, err?.code]).toEqual([409, 'FORM_ADDRESS_TAKEN']);
    expect(String(err.message)).toContain(SECOND);
    expect(String(err.message)).toContain(THIRD);
    expect(await rawRows(b, 'form', SECOND, PAIR)).toEqual([]);
  });

  it('publish CONTROL — the same draft, its address free, is promoted', async () => {
    const b = await booted({});
    await b.install(PAIR);
    await b.protocol.saveMetaItem({ type: 'form', name: SECOND, packageId: PAIR, mode: 'draft', item: { ...formItem(true), name: SECOND } });
    await expect(b.protocol.publishMetaItem({ type: 'form', name: SECOND, packageId: PAIR })).resolves.toBeDefined();
    expect((await rawRows(b, 'form', SECOND, PAIR)).length).toBe(1);
    await openOnBothDoors(b);
  });

  it('restore — a rollback to a version open on an address another form holds now is refused 409 FORM_ADDRESS_TAKEN, and the row stays as it is; CONTROL: the address free, it is restored', async () => {
    const run = async (holderTakesIt: boolean) => {
      const b = await booted({});
      await b.install(PAIR);
      await b.saveInto('form', PAIR, { ...formItem(true), name: SECOND }, SECOND);
      const openVersion = await newestVersion(b, 'form', SECOND);
      await b.saveInto('form', PAIR, { ...formItem(null), name: SECOND }, SECOND);
      if (holderTakesIt) await b.saveInto('form', PAIR, { ...formItem(true), name: THIRD }, THIRD);
      const before = await rawRows(b, 'form', SECOND, PAIR);
      const outcome = await b.protocol.rollbackMetaItem({ type: 'form', name: SECOND, toVersion: openVersion })
        .then(() => 'restored', (e: any) => e);
      return { b, outcome, before };
    };
    const taken = await run(true);
    expect([taken.outcome?.status, taken.outcome?.code]).toEqual([409, 'FORM_ADDRESS_TAKEN']);
    expect(String(taken.outcome.message)).toContain(THIRD);
    expect(await rawRows(taken.b, 'form', SECOND, PAIR)).toEqual(taken.before);
    const free = await run(false);
    expect(free.outcome).toBe('restored');
    await openOnBothDoors(free.b);
  });
});

describe('[ADR-0159 D5] a `form` save, reset and delete: the old-shape row of the address goes in the same transaction, a list of the name stays byte-equal', () => {
  const engines: ObjectQL[] = [];
  afterAll(async () => {
    for (const engine of engines) await engine.destroy().catch(() => {});
  });
  const booted = async (ships: { forms?: unknown[]; views?: unknown[] }): Promise<Booted> => {
    const b = await boot(ships);
    engines.push(b.engine);
    return b;
  };
  const failure = (p: Promise<unknown>) => p.then(() => undefined, (e: any) => e);

  it('a list row of the name stays byte-equal across the `form` draft save, its publish and its reset (ablate: the form-content test of the old-shape row removal)', async () => {
    const b = await booted({ forms: [formItem(true)] });
    await b.install(PAIR);
    await b.saveInto('view', PAIR, LIST);
    const list = await rawRows(b, 'view', NAME, PAIR);
    expect(list.length).toBe(1);
    await b.protocol.saveMetaItem({ type: 'form', name: NAME, packageId: PAIR, mode: 'draft', item: formItem(false, overrides) });
    expect(await rawRows(b, 'view', NAME, PAIR)).toEqual(list);
    await b.protocol.publishMetaItem({ type: 'form', name: NAME, packageId: PAIR });
    expect(await rawRows(b, 'view', NAME, PAIR)).toEqual(list);
    const reset: any = await b.protocol.deleteMetaItem({ type: 'form', name: NAME, packageId: PAIR });
    expect(reset.success).toBe(true);
    expect(await rawRows(b, 'form', NAME, PAIR)).toEqual([]);
    expect(await rawRows(b, 'view', NAME, PAIR)).toEqual(list);
  });

  it('…and across the `form` delete of an override whose base ships the form as an old shape', async () => {
    const b = await booted({ views: [container(true)] });
    await b.install(PAIR);
    await b.saveBeforeTheGate('view', PAIR, LIST);
    const list = await rawRows(b, 'view', NAME, PAIR);
    await b.saveInto('form', PAIR, formItem(false, overrides));
    expect(await rawRows(b, 'view', NAME, PAIR)).toEqual(list);
    await b.protocol.deleteMetaItem({ type: 'form', name: NAME, packageId: PAIR });
    expect(await rawRows(b, 'form', NAME, PAIR)).toEqual([]);
    expect(await rawRows(b, 'view', NAME, PAIR)).toEqual(list);
  });

  it('a `form` reset at the pair removes the pair\'s old-shape row of the name', async () => {
    const b = await booted({ forms: [formItem(true)] });
    await b.install(PAIR);
    await b.saveInto('form', PAIR, formItem(false, overrides));
    await b.saveBeforeTheGate('view', PAIR, viewItem(false, overrides));
    expect((await rawRows(b, 'view', NAME, PAIR)).length).toBe(1);
    await b.protocol.deleteMetaItem({ type: 'form', name: NAME, packageId: PAIR });
    expect(await rawRows(b, 'form', NAME, PAIR)).toEqual([]);
    expect(await rawRows(b, 'view', NAME, PAIR)).toEqual([]);
    await openOnBothDoors(b);
  });

  it('a `form` delete at the pair removes the pair\'s old-shape row of the name', async () => {
    const b = await booted({ views: [container(true)] });
    await b.install(PAIR);
    await b.saveInto('form', PAIR, formItem(false, overrides));
    await b.saveInto('view', PAIR, viewItem(false, overrides));
    expect((await rawRows(b, 'view', NAME, PAIR)).length).toBe(1);
    await b.protocol.deleteMetaItem({ type: 'form', name: NAME, packageId: PAIR });
    expect(await rawRows(b, 'form', NAME, PAIR)).toEqual([]);
    expect(await rawRows(b, 'view', NAME, PAIR)).toEqual([]);
    await openOnBothDoors(b);
  });

  it('a stored container is re-saved without the member, its lists byte-equal', async () => {
    const b = await booted({ forms: [formItem(true)] });
    await b.install(PAIR);
    const stored = { name: 'intake', object: OBJECT, list: { type: 'grid', columns: ['name', 'email'], data: { provider: 'object', object: OBJECT } }, formViews: { contact: { ...body(false), data: { provider: 'object', object: OBJECT } } } };
    await b.saveBeforeTheGate('view', PAIR, stored, 'intake');
    const [before] = await rawRows(b, 'view', 'intake', PAIR);
    expect(JSON.parse(before.metadata).formViews?.contact).toBeDefined();
    await b.saveInto('form', PAIR, formItem(false, overrides));
    const [after] = await rawRows(b, 'view', 'intake', PAIR);
    expect(after).toBeDefined();
    const was = JSON.parse(before.metadata);
    const now = JSON.parse(after.metadata);
    expect(now.formViews).toBeUndefined();
    expect(JSON.stringify(now.list)).toBe(JSON.stringify(was.list));
  });

  it('a `form` write that fails leaves both rows as they were', async () => {
    const b = await booted({ views: [container(true)] });
    await b.install(PAIR);
    await b.saveInto('view', PAIR, viewItem(true, overrides));
    const view = await rawRows(b, 'view', NAME, PAIR);
    await b.protocol.saveMetaItem({ type: 'form', name: NAME, packageId: PAIR, mode: 'draft', item: formItem(false, overrides) });
    // The old-shape row's removal, the second write of the transaction, fails.
    const realRepo = b.protocol.getOverlayRepo.bind(b.protocol);
    b.protocol.getOverlayRepo = (...a: any[]) => {
      const repo = realRepo(...a);
      return new Proxy(repo, {
        get(target, prop, receiver) {
          if (prop === 'delete') {
            return async (ref: any, ...rest: any[]) => {
              if (ref?.type === 'view') throw new Error('the old-shape removal failed');
              return target.delete(ref, ...rest);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    let err: any;
    try {
      err = await failure(b.protocol.publishMetaItem({ type: 'form', name: NAME, packageId: PAIR }));
    } finally {
      b.protocol.getOverlayRepo = realRepo;
    }
    expect(String(err?.message)).toContain('the old-shape removal failed');
    expect(await rawRows(b, 'form', NAME, PAIR)).toEqual([]);
    expect(await rawRows(b, 'view', NAME, PAIR)).toEqual(view);
  });
});

describe('[ADR-0159 card ② item 2, D5, ADR-0029 D9.2a] the `/meta/form` read: its audience, one definition per address, the override\'s own text', () => {
  const engines: ObjectQL[] = [];
  afterAll(async () => {
    for (const engine of engines) await engine.destroy().catch(() => {});
  });
  const booted = async (ships: { forms?: unknown[]; views?: unknown[] }, opts: { i18n?: unknown } = {}): Promise<Booted> => {
    const b = await boot(ships, opts);
    engines.push(b.engine);
    return b;
  };
  const CAP = 'ftt.legal_desk';
  const holder = { systemPermissions: [CAP] };
  const stranger = { systemPermissions: [] as string[] };

  it('a caller refused a form\'s document at `/api/v1/meta/view/NAME` is refused it at `/api/v1/meta/form/NAME`; its holder is served both', async () => {
    // A view item's own audience gate travels with the form it projects. On
    // this tree only a row at rest carries one on a form (the `view` write
    // door refuses an item-level `requiredPermissions`, and a form body
    // declares none), so the row is seeded as stored.
    const b = await booted({});
    await b.seedRow('view', NAME, null, viewItem(true, { requiredPermissions: [CAP] }));
    const view = await b.meta('view', NAME, stranger);
    const form = await b.meta('form', NAME, stranger);
    expect(view.status, JSON.stringify(view.body)).toBe(403);
    expect([form.status, form.body?.error?.code ?? form.body?.code]).toEqual([view.status, view.body?.error?.code ?? view.body?.code]);
    expect(JSON.stringify(form.body)).not.toContain('Contact us');
    // CONTROL: the holder reads both.
    expect((await b.meta('view', NAME, holder)).status).toBe(200);
    const served = await b.meta('form', NAME, holder);
    expect(served.status, JSON.stringify(served.body)).toBe(200);
    expect(JSON.stringify(served.body)).toContain('Contact us');
  });

  it('one definition per address: a package-less stored `form` row over a base that ships the form as an old shape is listed once, at the base\'s address, with the row\'s body (D5 served-row order)', async () => {
    const b = await booted({ views: [container(true)] });
    await b.seedRow('form', NAME, null, formItem(false, { label: 'Package-less row' }));
    const listed = ((await b.protocol.getMetaItems({ type: 'form' })).items as any[]).filter((f) => f?.name === NAME);
    expect(listed.map((f) => [f._packageId, f.label, f._formDefinedIn ?? null])).toEqual([[BASE, 'Package-less row', null]]);
    const byName: any = await b.protocol.getMetaItem({ type: 'form', name: NAME });
    expect(byName.item?.label).toBe('Package-less row');
    // Fail-closed as before: the row switches the form off.
    await closedOnBothDoors(b);
  });

  it('an override\'s own changed text outranks the base\'s catalog on `/meta/form` and on the public door; text it kept is translated (ablate: the `form` row of PACKAGED_BASE_ACCESSORS)', async () => {
    const BUNDLE: Record<string, any> = {
      en: {},
      de: { forms: { [NAME]: { title: 'Kontaktieren Sie uns' } } },
    };
    const i18n = { getLocales: () => ['en', 'de'], getTranslations: (l: string) => BUNDLE[l], getDefaultLocale: () => 'en' };
    const de = { 'accept-language': 'de' };
    const b = await booted({ forms: [formItem(true, { title: 'Contact us' })] }, { i18n });
    // CONTROL: the base's own title is translated.
    expect((await b.get(SLUG, de)).body?.form?.title).toBe('Kontaktieren Sie uns');
    await b.install(PAIR);
    await b.saveInto('form', PAIR, formItem(true, { ...overrides, title: 'Write to us' }));
    const door = await b.get(SLUG, de);
    expect(door.status, JSON.stringify(door.body)).toBe(200);
    expect(door.body?.form?.title).toBe('Write to us');
    const read = await b.meta('form', NAME, stranger, de);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(JSON.stringify(read.body)).toContain('Write to us');
    expect(JSON.stringify(read.body)).not.toContain('Kontaktieren Sie uns');
    // An override that keeps the base's title is served the translation.
    await b.saveInto('form', PAIR, formItem(true, { ...overrides, title: 'Contact us' }));
    expect((await b.get(SLUG, de)).body?.form?.title).toBe('Kontaktieren Sie uns');
  });
});
