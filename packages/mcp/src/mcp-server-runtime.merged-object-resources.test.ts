// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25245] The `objectstack://objects` resources read the stdio transport's ONE
 * object view (`stdioObjectView`, `stdio-data-bridge.ts`): the protocol's
 * merged listing, the read `list_objects` / `describe_object` answer from since
 * #25138, and the metadata service only on a host with no merged read.
 *
 * The defect, in the doubles' terms: an object a package registers during the
 * boot of a kernel with an `environmentId` lives in the `SchemaRegistry`, which
 * the protocol reads, and has no copy in the `metadata` service, which both
 * resources read. So the metadata double below holds NO copy of the package
 * objects and the protocol double serves them. Measured on the real kernel
 * through the `MCPServerPlugin` stdio session before the fix: `resources/read`
 * of `objectstack://objects` answered `{ objects: [], totalCount: 0 }` and of
 * `objectstack://objects/qa_pkg_open` `404 RESOURCE_NOT_FOUND`, while the tools
 * listed and described both. That wire reading is pinned on real kernels in the
 * dogfood suite (`packages/qa/dogfood/test/mcp-stdio-package-object-discovery.test.ts`);
 * this file pins each branch of the two builders over the view, and the
 * runtime's two object resources reading the view their host gave it
 * (`setRuntimeObjectView`).
 *
 * What stays the metadata service's: the completeness verdict (#6504 on the
 * listing, #6055 on a miss). The protocol's listing cannot answer it, and the
 * `list_objects` tool asks the metadata service for it on the same items.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import {
  buildObjectListResource,
  buildObjectSchemaResource,
  MCPServerRuntime,
  setRuntimeObjectView,
} from './mcp-server-runtime.js';
import {
  createStdioDataBridge,
  stdioObjectView,
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
    },
  },
  { name: PKG_GATED, label: 'Gated', enable: { apiEnabled: false }, fields: { name: { type: 'text', label: 'Name' } } },
];

/** A protocol serving `objects` through its merged listing. */
function makeProtocol(objects: Array<Record<string, unknown>> = PACKAGE_OBJECTS) {
  return {
    getMetaItems: vi.fn(async (_request: { type: string }) => ({ type: 'object', items: objects })),
  };
}

/** A metadata service holding `copies` and nothing else (the package objects have none by default). */
function makeMetadata(copies: Array<Record<string, unknown>> = []) {
  return {
    listObjects: vi.fn(async () => copies),
    getObject: vi.fn(async (name: string) => copies.find((o) => o.name === name)),
    listDiagnosed: vi.fn(async () => ({ data: copies, degraded: false, errors: [] as string[] })),
    getDiagnosed: vi.fn(async (_type: string, name: string) => ({
      data: copies.find((o) => o.name === name),
      degraded: false,
      errors: [] as string[],
    })),
  };
}

/** The view and the metadata service the builders read, over `protocol` resolved at each use. */
function makeView(opts: { protocol?: () => StdioProtocolObjectReads | undefined; copies?: Array<Record<string, unknown>> } = {}) {
  const metadataService = makeMetadata(opts.copies);
  const view = stdioObjectView({
    metadataService: metadataService as unknown as IMetadataService,
    protocol: opts.protocol,
  });
  return { view, metadataService, md: metadataService as unknown as IMetadataService };
}

const parsed = (result: { contents: Array<{ text: string }> }) => JSON.parse(result.contents[0].text);

describe('[#25245] objectstack://objects lists the merged view', () => {
  it('lists the package objects the metadata service holds no copy of, with a complete totalCount', async () => {
    const protocol = makeProtocol();
    const { view, md, metadataService } = makeView({ protocol: () => protocol });

    const body = parsed(await buildObjectListResource(md, undefined, view));

    expect(body).toEqual({
      objects: [
        { name: PKG_OPEN, label: 'Open', fieldCount: 2 },
        { name: PKG_GATED, label: 'Gated', fieldCount: 1 },
      ],
      totalCount: 2,
    });
    expect(protocol.getMetaItems).toHaveBeenCalledWith({ type: 'object' });
    expect(metadataService.listObjects).not.toHaveBeenCalled();
  });

  it('omits what the listing omits, even where the metadata service still holds a copy (a disabled package)', async () => {
    const protocol = makeProtocol([]);
    const { view, md } = makeView({ protocol: () => protocol, copies: [PACKAGE_OBJECTS[0]] });

    expect(parsed(await buildObjectListResource(md, undefined, view))).toEqual({ objects: [], totalCount: 0 });
  });

  it('keeps the completeness verdict from the metadata service, the items from the merged listing', async () => {
    const protocol = makeProtocol();
    const { view, md, metadataService } = makeView({ protocol: () => protocol });
    metadataService.listDiagnosed.mockResolvedValueOnce({ data: [], degraded: true, errors: ['loader x failed'] });

    const body = parsed(await buildObjectListResource(md, undefined, view));

    expect(body.objects.map((o: { name: string }) => o.name)).toEqual([PKG_OPEN, PKG_GATED]);
    expect(body).toMatchObject({ partial: true, returnedCount: 2, code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(body).not.toHaveProperty('totalCount');
  });

  it('a merged read that throws travels to the caller, never a fallback to the copy', async () => {
    const boom = new Error('sys_metadata unreadable');
    const { view, md, metadataService } = makeView({
      protocol: () => ({ getMetaItems: vi.fn(async () => { throw boom; }) }),
      copies: PACKAGE_OBJECTS,
    });

    await expect(buildObjectListResource(md, undefined, view)).rejects.toBe(boom);
    expect(metadataService.listObjects).not.toHaveBeenCalled();
  });
});

describe('[#25245] objectstack://objects/{objectName} answers from the same listing', () => {
  it('answers each package object as describe_object does, the one declared apiEnabled: false included', async () => {
    const protocol = makeProtocol();
    const { view, md, metadataService } = makeView({ protocol: () => protocol });
    const bridge = createStdioDataBridge({
      engine: {} as IDataEngine,
      metadataService: md,
      protocol: () => protocol,
      resolvePrincipal: async () => ({ userId: 'u1' }) as unknown as ExecutionContext,
    });

    for (const name of [PKG_OPEN, PKG_GATED]) {
      expect(parsed(await buildObjectSchemaResource(md, name, undefined, view))).toEqual(await bridge.describeObject(name));
    }
    expect(parsed(await buildObjectSchemaResource(md, PKG_GATED, undefined, view)))
      .toMatchObject({ name: PKG_GATED, enableFeatures: { apiEnabled: false } });
    expect(metadataService.getObject).not.toHaveBeenCalled();
  });

  it('a name the listing omits is the coded miss, even where the metadata service still holds a copy', async () => {
    const protocol = makeProtocol([]);
    const { view, md } = makeView({ protocol: () => protocol, copies: [PACKAGE_OBJECTS[0]] });

    expect(parsed(await buildObjectSchemaResource(md, PKG_OPEN, undefined, view))).toEqual({
      error: `Object "${PKG_OPEN}" not found`,
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
  });

  it('a miss during a metadata outage is still SERVICE_UNAVAILABLE, the verdict asked of the metadata service', async () => {
    const protocol = makeProtocol([]);
    const { view, md, metadataService } = makeView({ protocol: () => protocol });
    metadataService.getDiagnosed.mockResolvedValueOnce({ data: undefined, degraded: true, errors: ['loader x failed'] });

    expect(parsed(await buildObjectSchemaResource(md, PKG_OPEN, undefined, view)))
      .toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(metadataService.getDiagnosed).toHaveBeenCalledWith('object', PKG_OPEN);
  });

  it('a merged read that throws travels to the caller, never a fallback to the copy', async () => {
    const boom = new Error('sys_metadata unreadable');
    const { view, md, metadataService } = makeView({
      protocol: () => ({ getMetaItems: vi.fn(async () => { throw boom; }) }),
      copies: PACKAGE_OBJECTS,
    });

    await expect(buildObjectSchemaResource(md, PKG_OPEN, undefined, view)).rejects.toBe(boom);
    expect(metadataService.getObject).not.toHaveBeenCalled();
  });
});

describe('[#25245] a host with no merged read reads the metadata service, as before', () => {
  for (const [label, protocol] of [
    ['no protocol registered', () => undefined],
    ['a protocol without getMetaItems', () => ({})],
  ] as const) {
    it(`${label}: both resources answer byte-identically to the metadata service alone`, async () => {
      const { view, md } = makeView({ protocol, copies: PACKAGE_OBJECTS });

      expect(await buildObjectListResource(md, undefined, view)).toEqual(await buildObjectListResource(md));
      for (const name of [PKG_OPEN, 'qa_pkg_nowhere']) {
        expect(await buildObjectSchemaResource(md, name, undefined, view)).toEqual(await buildObjectSchemaResource(md, name));
      }
    });
  }

  it('the protocol is resolved at each read, never captured: one registered later is read on the next call', async () => {
    let registered: StdioProtocolObjectReads | undefined;
    const { view, md } = makeView({ protocol: () => registered });

    expect(parsed(await buildObjectListResource(md, undefined, view)).objects).toEqual([]);
    registered = makeProtocol();
    expect(parsed(await buildObjectListResource(md, undefined, view)).totalCount).toBe(2);
  });
});

/** An in-process MCP transport: the server's replies are matched back to the request that asked. */
function inProcessTransport() {
  const waiting = new Map<number, (frame: any) => void>();
  let nextId = 1;
  const transport: any = {
    onmessage: undefined,
    onclose: undefined,
    onerror: undefined,
    async start() {},
    async close() { transport.onclose?.(); },
    async send(message: any) {
      const resolve = typeof message?.id === 'number' ? waiting.get(message.id) : undefined;
      if (resolve) { waiting.delete(message.id); resolve(message); }
    },
  };
  const rpc = (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
    const id = nextId++;
    const giveUp = setTimeout(() => reject(new Error(`no answer to "${method}" (id ${id}) within 10s`)), 10_000);
    waiting.set(id, (frame) => { clearTimeout(giveUp); resolve(frame); });
    transport.onmessage?.({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
  });
  return { transport, rpc, notify: (method: string) => transport.onmessage?.({ jsonrpc: '2.0', method }) };
}

/** A runtime with the resources bridged over `md`, and a session reading them over JSON-RPC. */
async function openResources(md: IMetadataService, before?: (runtime: MCPServerRuntime) => void) {
  const runtime = new MCPServerRuntime({ name: 'objectstack-test', version: '9.9.9' });
  before?.(runtime);
  runtime.bridgeResources(md);
  const session = inProcessTransport();
  await runtime.server.connect(session.transport as never);
  await session.rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'merged-object-resources', version: '0.0.0' },
  });
  session.notify('notifications/initialized');
  const read = async (uri: string) => {
    const frame = await session.rpc('resources/read', { uri });
    expect(frame.error, `resources/read ${uri} failed at the protocol level`).toBeUndefined();
    return JSON.parse(frame.result.contents[0].text as string);
  };
  return { runtime, read, close: () => session.transport.close() };
}

describe('[#25245] the runtime\'s object resources read the view its host gave (setRuntimeObjectView)', () => {
  it('resources/read of both URIs answers from that view, never the metadata service', async () => {
    const protocol = makeProtocol();
    const { view, md, metadataService } = makeView({ protocol: () => protocol });
    const s = await openResources(md, (runtime) => setRuntimeObjectView(runtime, view));

    expect((await s.read('objectstack://objects')).totalCount).toBe(2);
    expect(await s.read(`objectstack://objects/${PKG_OPEN}`)).toMatchObject({ name: PKG_OPEN, label: 'Open' });
    expect(metadataService.listObjects).not.toHaveBeenCalled();
    expect(metadataService.getObject).not.toHaveBeenCalled();
    await s.close();
  });

  it('the view is read at each resources/read, so one given after bridgeResources is read too', async () => {
    const protocol = makeProtocol();
    const { view, md } = makeView({ protocol: () => protocol });
    const s = await openResources(md);

    expect((await s.read('objectstack://objects')).totalCount).toBe(0);
    setRuntimeObjectView(s.runtime, view);
    expect((await s.read('objectstack://objects')).totalCount).toBe(2);
    await s.close();
  });

  it('a runtime whose host gave no view reads the metadata service, and another runtime\'s view is not its own', async () => {
    const protocol = makeProtocol();
    const { view } = makeView({ protocol: () => protocol });
    const { md, metadataService } = makeView({ copies: [PACKAGE_OBJECTS[1]] });
    setRuntimeObjectView(new MCPServerRuntime({ name: 'objectstack-other', version: '9.9.9' }), view);
    const s = await openResources(md);

    expect((await s.read('objectstack://objects')).objects.map((o: { name: string }) => o.name)).toEqual([PKG_GATED]);
    expect(await s.read(`objectstack://objects/${PKG_OPEN}`)).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(metadataService.listObjects).toHaveBeenCalled();
    await s.close();
  });
});
