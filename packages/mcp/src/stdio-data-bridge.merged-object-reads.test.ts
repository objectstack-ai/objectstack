// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25138] The stdio data bridge reads objects from the PROTOCOL, as the HTTP
 * bridge does since #25120: `list_objects` / `describe_object` from its merged
 * listing (`getMetaItems`), and the exposure gate from its by-name read
 * (`getMetaItemForExecution`, else `getMetaItem`).
 *
 * The defect, in the doubles' terms: an object a package registers during the
 * boot of a kernel with an `environmentId` lives in the `SchemaRegistry`, which
 * the protocol reads, and has no copy in the `metadata` service, which this
 * bridge read. So the metadata double below holds NO copy of the package
 * object (`getObject` answers `undefined`, `listObjects` answers `[]`), and
 * the protocol double serves it. Measured on the real kernel through the
 * `MCPServerPlugin` stdio session before the fix: `list_objects` answered
 * `{ objects: [], totalCount: 0 }`, `describe_object` "not found", and
 * `query_records` served the object declared `apiEnabled: false`. That wire
 * reading is pinned on real kernels in the dogfood suite
 * (`packages/qa/dogfood/test/mcp-stdio-package-object-discovery.test.ts`);
 * this file pins each branch of the two reads.
 *
 * Refusals are asserted by envelope (`code` + `status`), never by a bare
 * throw, and every refusal asserts the engine was never reached.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import {
  createStdioDataBridge,
  enforceApiExposure,
  GATED_ACTIONS,
  type McpExposureError,
  type StdioProtocolObjectReads,
} from './stdio-data-bridge.js';

const PKG_OPEN = 'qa_pkg_open';
const PKG_GATED = 'qa_pkg_gated';

/** The package's two objects, as the protocol serves them; one declared off the API. */
const PACKAGE_OBJECTS = [
  {
    name: PKG_OPEN,
    label: 'Open',
    fields: {
      name: { type: 'text', label: 'Name' },
      vault_secret: { type: 'text', internal: true },
      gated_ref: { type: 'lookup', reference: PKG_GATED },
    },
  },
  { name: PKG_GATED, label: 'Gated', enable: { apiEnabled: false }, fields: { name: { type: 'text', label: 'Name' } } },
];

/** The protocol's refusal of a disabled package's object, as `@objectstack/metadata-protocol` raises it. */
function packageDisabled(object: string): Error {
  const err = new Error(`Object '${object}' belongs to a disabled package and is not being served.`) as Error & {
    code: string;
    status: number;
    object: string;
  };
  err.code = 'OBJECT_PACKAGE_DISABLED';
  err.status = 404;
  err.object = object;
  return err;
}

type ByName = (request: { type: string; name: string }) => Promise<unknown>;

/** A protocol serving `objects` through the merged listing and both by-name faces. */
function makeProtocol(objects: Array<Record<string, unknown>> = PACKAGE_OBJECTS) {
  const byName: ByName = async ({ name }) => ({ type: 'object', name, item: objects.find((o) => o.name === name) });
  return {
    getMetaItems: vi.fn(async (_request: { type: string }) => ({ type: 'object', items: objects })),
    getMetaItem: vi.fn(byName),
    getMetaItemForExecution: vi.fn(byName),
  };
}

function makeEngine() {
  return {
    find: vi.fn(async () => [{ id: 'r1', name: 'row' }]),
    findOne: vi.fn(async () => ({ id: 'r1', name: 'row' })),
    insert: vi.fn(async (_object: string, data: Record<string, unknown>): Promise<Record<string, unknown>> => ({ id: 'r9', ...data })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => true),
    count: vi.fn(async () => 1),
    aggregate: vi.fn(async () => [{ n: 1 }]),
  };
}

/** A metadata service holding `copies` and nothing else (the package object has none by default). */
function makeMetadata(copies: Array<Record<string, unknown>> = []) {
  return {
    listObjects: vi.fn(async () => copies),
    getObject: vi.fn(async (name: string) => copies.find((o) => o.name === name)),
    listDiagnosed: vi.fn(async () => ({ data: copies, degraded: false, errors: [] as string[] })),
  };
}

const PRINCIPAL = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;

function makeBridge(opts: {
  protocol?: StdioProtocolObjectReads;
  copies?: Array<Record<string, unknown>>;
} = {}) {
  const engine = makeEngine();
  const metadataService = makeMetadata(opts.copies);
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: metadataService as unknown as IMetadataService,
    protocol: () => opts.protocol,
    resolvePrincipal: async () => PRINCIPAL,
  });
  return { bridge, engine, metadataService };
}

const VERBS = {
  query: (b: ReturnType<typeof makeBridge>['bridge'], o: string) => b.query(o, { limit: 5 }),
  get: (b: ReturnType<typeof makeBridge>['bridge'], o: string) => b.get(o, 'r1'),
  create: (b: ReturnType<typeof makeBridge>['bridge'], o: string) => b.create(o, { name: 'x' }),
  update: (b: ReturnType<typeof makeBridge>['bridge'], o: string) => b.update(o, 'r1', { name: 'x' }),
  remove: (b: ReturnType<typeof makeBridge>['bridge'], o: string) => b.remove(o, 'r1'),
  aggregate: (b: ReturnType<typeof makeBridge>['bridge'], o: string) =>
    b.aggregate!(o, { aggregations: [{ function: 'count', field: 'id', alias: 'n' }] }),
} as const;

const ALL_VERBS = Object.keys(VERBS) as Array<keyof typeof VERBS>;

/** The engine methods a data verb reaches; none may be called when the gate refuses. */
function engineUntouched(engine: ReturnType<typeof makeEngine>) {
  for (const method of ['find', 'findOne', 'insert', 'update', 'delete', 'count', 'aggregate'] as const) {
    expect(engine[method], `engine.${method} was reached`).not.toHaveBeenCalled();
  }
}

async function refusalOf(run: () => Promise<unknown>): Promise<{ code?: string; status?: number }> {
  const err = (await run().then(() => null, (e: unknown) => e)) as McpExposureError | null;
  expect(err, 'the call resolved: nothing was refused').toBeTruthy();
  return { code: err!.code, status: err!.status };
}

// ---------------------------------------------------------------------------
// Discovery: `list_objects` / `describe_object`
// ---------------------------------------------------------------------------

describe('[#25138] list_objects / describe_object read the protocol\'s merged listing', () => {
  it('lists a package object the metadata service holds no copy of', async () => {
    const protocol = makeProtocol();
    const { bridge, metadataService } = makeBridge({ protocol });

    const listed = await bridge.listObjects();

    expect(listed.map((o) => o.name)).toEqual([PKG_OPEN, PKG_GATED]);
    expect(listed[0]).toMatchObject({ name: PKG_OPEN, label: 'Open', fieldCount: 3 });
    expect(protocol.getMetaItems).toHaveBeenCalledWith({ type: 'object' });
    expect(metadataService.listObjects).not.toHaveBeenCalled();
  });

  it('describes both package objects, the one declared apiEnabled: false included', async () => {
    const { bridge, metadataService } = makeBridge({ protocol: makeProtocol() });

    expect(await bridge.describeObject(PKG_OPEN)).toMatchObject({
      name: PKG_OPEN,
      fields: expect.arrayContaining([expect.objectContaining({ name: 'name', type: 'text' })]),
    });
    expect(await bridge.describeObject(PKG_GATED)).toMatchObject({
      name: PKG_GATED,
      enableFeatures: { apiEnabled: false },
    });
    expect(metadataService.getObject).not.toHaveBeenCalled();
  });

  it('describes nothing the listing omits, even where the metadata service still holds a copy', async () => {
    // A disabled package's object: the listing omits it, while the copy the
    // boot made outlives the disable.
    const { bridge } = makeBridge({ protocol: makeProtocol([]), copies: [PACKAGE_OBJECTS[0]] });

    expect(await bridge.listObjects()).toEqual([]);
    expect(await bridge.describeObject(PKG_OPEN)).toBeNull();
  });

  it('keeps the completeness verdict from the metadata service, the items from the merged listing', async () => {
    const protocol = makeProtocol();
    const { bridge, metadataService } = makeBridge({ protocol });
    metadataService.listDiagnosed.mockResolvedValueOnce({ data: [], degraded: true, errors: ['loader x failed'] });

    const listing = await bridge.listObjectsDiagnosed!();

    expect(listing.objects.map((o) => o.name)).toEqual([PKG_OPEN, PKG_GATED]);
    expect(listing).toMatchObject({ degraded: true, errors: ['loader x failed'] });
  });

  it('accepts the bare-array answer the skill read next door accepts', async () => {
    const protocol = { getMetaItems: vi.fn(async () => PACKAGE_OBJECTS) };
    const { bridge } = makeBridge({ protocol });

    expect((await bridge.listObjects()).map((o) => o.name)).toEqual([PKG_OPEN, PKG_GATED]);
  });

  it('a merged read that throws travels to the caller, never a fallback to the copy', async () => {
    const outage = Object.assign(new Error('metadata store unavailable'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
    const protocol = { ...makeProtocol(), getMetaItems: vi.fn(async () => { throw outage; }) };
    const { bridge, metadataService } = makeBridge({ protocol, copies: [PACKAGE_OBJECTS[0]] });

    await expect(bridge.listObjects()).rejects.toBe(outage);
    await expect(bridge.describeObject(PKG_OPEN)).rejects.toBe(outage);
    expect(metadataService.listObjects).not.toHaveBeenCalled();
    expect(metadataService.getObject).not.toHaveBeenCalled();
  });

  it.each([
    ['no protocol on this host', undefined],
    ['a protocol without the merged listing', { getMetaItem: vi.fn() }],
  ])('CONTROL: %s reads the metadata service, as before', async (_label, protocol) => {
    const { bridge, metadataService } = makeBridge({ protocol, copies: [PACKAGE_OBJECTS[0]] });

    expect((await bridge.listObjects()).map((o) => o.name)).toEqual([PKG_OPEN]);
    expect(await bridge.describeObject(PKG_OPEN)).toMatchObject({ name: PKG_OPEN });
    expect(metadataService.listObjects).toHaveBeenCalled();
    expect(metadataService.getObject).toHaveBeenCalledWith(PKG_OPEN);
  });
});

// ---------------------------------------------------------------------------
// The exposure gate: the protocol's by-name read
// ---------------------------------------------------------------------------

describe('[#25138] the exposure gate reads the object through the protocol\'s by-name read', () => {
  it.each(ALL_VERBS)('%s refuses a package object declared apiEnabled: false that has no copy, 404 OBJECT_API_DISABLED', async (verb) => {
    const protocol = makeProtocol();
    const { bridge, engine, metadataService } = makeBridge({ protocol });

    expect(await refusalOf(() => VERBS[verb](bridge, PKG_GATED))).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
    engineUntouched(engine);
    expect(protocol.getMetaItemForExecution).toHaveBeenCalledWith({ type: 'object', name: PKG_GATED });
    expect(protocol.getMetaItem).not.toHaveBeenCalled();
    expect(metadataService.getObject).not.toHaveBeenCalled();
  });

  it('reads the served by-name face where the protocol has no execution face', async () => {
    const { getMetaItemForExecution: _absent, ...protocol } = makeProtocol();
    const { bridge, engine } = makeBridge({ protocol });

    expect(await refusalOf(() => VERBS.query(bridge, PKG_GATED))).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
    expect(protocol.getMetaItem).toHaveBeenCalledWith({ type: 'object', name: PKG_GATED });
    engineUntouched(engine);
  });

  it('CONTROL: the package\'s exposed object is served', async () => {
    const { bridge, engine } = makeBridge({ protocol: makeProtocol() });

    expect(await VERBS.query(bridge, PKG_OPEN)).toMatchObject({ object: PKG_OPEN, total: 1 });
    expect(engine.find).toHaveBeenCalled();
  });

  it('judges the definition the protocol serves over a stale copy that says otherwise', async () => {
    const { bridge, engine } = makeBridge({
      protocol: makeProtocol(),
      copies: [{ name: PKG_GATED, enable: { apiEnabled: true } }],
    });

    expect(await refusalOf(() => VERBS.query(bridge, PKG_GATED))).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
    engineUntouched(engine);
  });

  it('an item under another name is no declaration: the engine answers existence, as before', async () => {
    const protocol = { getMetaItemForExecution: vi.fn(async () => ({ item: { name: 'someone_else', enable: { apiEnabled: false } } })) };
    const { bridge, engine } = makeBridge({ protocol });

    await VERBS.query(bridge, PKG_OPEN);
    expect(engine.find).toHaveBeenCalled();
  });

  it('the record resource\'s gate (`enforceApiExposure`) asks the same read', async () => {
    const metadataService = makeMetadata() as unknown as IMetadataService;
    const err = (await enforceApiExposure(
      { metadataService, protocol: () => makeProtocol() },
      PKG_GATED,
      GATED_ACTIONS.get,
      PRINCIPAL,
    ).then(() => null, (e: unknown) => e)) as McpExposureError | null;

    expect(err && { code: err.code, status: err.status }).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
  });
});

describe('[#25138] a disabled package\'s object is refused on every verb, 404 OBJECT_PACKAGE_DISABLED', () => {
  // Every verb of this bridge asks the engine, never the protocol, and the
  // engine serves a disabled package's objects: the gate is the only refusal.
  const disabledProtocol = () => {
    const refuse: ByName = async ({ name }) => { throw packageDisabled(name); };
    return { ...makeProtocol([]), getMetaItem: vi.fn(refuse), getMetaItemForExecution: vi.fn(refuse) };
  };

  for (const [label, copies] of [
    ['no copy', []],
    ['a copy that declares it exposed', [PACKAGE_OBJECTS[0]]],
  ] as const) {
    it.each(ALL_VERBS)(`%s, with ${label}`, async (verb) => {
      const { bridge, engine } = makeBridge({ protocol: disabledProtocol(), copies: [...copies] });

      expect(await refusalOf(() => VERBS[verb](bridge, PKG_OPEN))).toEqual({ code: 'OBJECT_PACKAGE_DISABLED', status: 404 });
      engineUntouched(engine);
    });
  }

  it('the record resource\'s gate refuses it too, and the system caller is still let through', async () => {
    const metadataService = makeMetadata([PACKAGE_OBJECTS[0]]) as unknown as IMetadataService;
    const reads = { metadataService, protocol: disabledProtocol };

    const err = (await enforceApiExposure(reads, PKG_OPEN, GATED_ACTIONS.get, PRINCIPAL)
      .then(() => null, (e: unknown) => e)) as McpExposureError | null;
    expect(err && { code: err.code, status: err.status }).toEqual({ code: 'OBJECT_PACKAGE_DISABLED', status: 404 });

    await expect(
      enforceApiExposure(reads, PKG_OPEN, GATED_ACTIONS.get, { isSystem: true } as unknown as ExecutionContext),
    ).resolves.toBeUndefined();
  });
});

describe('[#25138] an outage of the by-name read never widens exposure', () => {
  const outageProtocol = () => ({
    ...makeProtocol(),
    getMetaItemForExecution: vi.fn(async () => { throw new Error('metadata store unavailable'); }),
  });

  it('judges the metadata service\'s copy, which still refuses the object it declares off', async () => {
    const { bridge, engine, metadataService } = makeBridge({
      protocol: outageProtocol(),
      copies: [{ name: PKG_GATED, enable: { apiEnabled: false } }],
    });

    expect(await refusalOf(() => VERBS.create(bridge, PKG_GATED))).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
    expect(metadataService.getObject).toHaveBeenCalledWith(PKG_GATED);
    engineUntouched(engine);
  });

  it('with no copy either, falls open to the schema defaults, as the gate always has', async () => {
    const { bridge, engine } = makeBridge({ protocol: outageProtocol() });

    await VERBS.query(bridge, PKG_GATED);
    expect(engine.find).toHaveBeenCalled();
  });

  it.each([
    ['no protocol on this host', undefined],
    ['a protocol without a by-name read', { getMetaItems: vi.fn(async () => ({ items: [] })) }],
  ])('CONTROL: %s judges the copy, as before', async (_label, protocol) => {
    const { bridge, engine, metadataService } = makeBridge({
      protocol,
      copies: [{ name: PKG_GATED, enable: { apiEnabled: false } }],
    });

    expect(await refusalOf(() => VERBS.query(bridge, PKG_GATED))).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
    expect(metadataService.getObject).toHaveBeenCalledWith(PKG_GATED);
    engineUntouched(engine);
  });
});

// ---------------------------------------------------------------------------
// The two other reads of the definition: relation targets and the write strip
// ---------------------------------------------------------------------------

describe('[#25138] the relation-target gate and the write-response strip read the same definition', () => {
  it('finds a package object\'s nested-relation condition and refuses its unexposed target', async () => {
    const { bridge, engine } = makeBridge({ protocol: makeProtocol() });

    const err = (await bridge.query(PKG_OPEN, { where: { gated_ref: { name: 'x' } } })
      .then(() => null, (e: unknown) => e)) as McpExposureError | null;

    expect(err && { code: err.code, status: err.status }).toEqual({ code: 'OBJECT_API_DISABLED', status: 404 });
    expect(err!.message).toContain("at 'where.gated_ref'");
    engineUntouched(engine);
  });

  it('omits a package object\'s internal: true field from the create response', async () => {
    const { bridge, engine } = makeBridge({ protocol: makeProtocol() });
    engine.insert.mockResolvedValueOnce({ id: 'r9', name: 'x', vault_secret: 's3cr3t' });

    const created = (await bridge.create(PKG_OPEN, { name: 'x' })) as { record: Record<string, unknown> };

    expect(created.record).toMatchObject({ id: 'r9', name: 'x' });
    expect(created.record).not.toHaveProperty('vault_secret');
  });

  it('omits it from the update echo too', async () => {
    const { bridge } = makeBridge({ protocol: makeProtocol() });

    const updated = (await bridge.update(PKG_OPEN, 'r1', { vault_secret: 'guess' })) as { record: Record<string, unknown> };

    expect(updated.record).not.toHaveProperty('vault_secret');
  });
});
