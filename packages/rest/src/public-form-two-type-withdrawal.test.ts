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
    end: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (b: unknown) => { res._json = b; return res; },
  };
  return res;
}

interface Answer { status: number; body: any }

async function boot(ships: { forms?: unknown[]; views?: unknown[] }) {
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
  const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
  rest.registerRoutes();
  const route = (method: string, path: string) => {
    const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(found, `${method} ${path} is registered`).toBeDefined();
    return found!;
  };
  const resolve = route('GET', '/api/v1/forms/:slug');
  const submit = route('POST', '/api/v1/forms/:slug/submit');
  const get = async (slug = SLUG): Promise<Answer> => {
    const res = makeRes();
    await resolve.handler({ params: { slug }, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const post = async (slug = SLUG): Promise<Answer> => {
    const res = makeRes();
    await submit.handler({ params: { slug }, body: { name: 'Ada', email: 'ada@example.test' }, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const records = async () => ((await engine.find(OBJECT, {}, { context: { isSystem: true } } as any)) as unknown[]).length;
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
    }, { context: { isSystem: true } } as any);
  };
  return { engine, protocol, get, post, records, install, saveInto, saveBeforeTheGate, seedRow };
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
  });
  beforeEach(() => {
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
  });
  afterAll(async () => {
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
    const rows = (await b.engine.find('sys_metadata', { where: { type: 'view', name, package_id: PAIR, state: 'active' } }, { context: { isSystem: true } } as any)) as any[];
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
