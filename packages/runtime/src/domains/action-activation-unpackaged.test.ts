// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22817] ADR-0126 §4 — the action activation door switches an action NO
// package ships, as its docblock declares, and its row names no package.
//
// ## What was measured before this file existed (showcase boot, `6364375b5`)
//
// Two actions saved through `PUT /api/v1/meta/action/:name`, then switched off
// through `POST /api/v1/actions/_activation/:object/:action`:
//
//   - object-less (`global`) → 503 SERVICE_UNAVAILABLE carrying the store's
//     TypeScript-caller sentence, and no row: the door wrote `?? ''`, the store
//     refuses `''`, and the door's `catch` defaulted every undeclared status to
//     503;
//   - bound to the packaged `showcase_task` → 200, and the row named
//     `com.example.showcase`: the door fell back to the ROUTE OBJECT's package,
//     crediting the environment's action to a package that does not ship it.
//
// Over the same boot's 146 resolvable declarations, the door's new reading
// (`shippingPackageOf`) changes exactly those two and leaves every shipped one
// byte-identical — including the 73 platform actions declared unstamped inside
// a code object's `actions` (`sys_user`'s `invite_user`, …), which keep naming
// the object's package. The controls below are those two shapes.
//
// ## Why the REAL projection and store, not a `setActionActive` spy
//
// The acceptance fact is "the row lands with `package_id` null", which is a
// property of three layers at once: this door, objectql's projection (which
// hands the row to the store unchanged) and core's store (which writes `null`
// for an absent package and refuses `''`). A spy on `setActionActive` would pin
// the first layer's argument and none of the rest — the posture-gate file
// already does that for the packaged case.

import { describe, it, expect } from 'vitest';
import { ActionActivationProjection, ObjectStoreActionActivationStore } from '@objectstack/objectql';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const LEDGER = 'sys_metadata_activation';
const OBJECT = 'crm_lead';
const PACKAGE = 'crm';

/** Shipped by `crm`, stamped on itself — the ordinary packaged action. */
const PACKAGED = {
    name: 'convert_lead', label: 'Convert Lead', objectName: OBJECT, type: 'script',
    _packageId: PACKAGE, _provenance: 'package',
};
/** Declared inside its code object's `actions`, unstamped — the platform objects' shape. */
const EMBEDDED_UNSTAMPED = { name: 'invite_lead', label: 'Invite Lead', objectName: OBJECT, type: 'script' };
/** Saved through the metadata door and bound to the packaged object — the measured mis-attribution. */
const ENV_ON_PACKAGED_OBJECT = {
    name: 'env_ping_lead', label: 'Env Ping Lead', objectName: OBJECT, type: 'script', _provenance: 'org',
};
/** Saved through the metadata door with no object — the measured 503. */
const ENV_GLOBAL = { name: 'env_ping_global', label: 'Env Ping Global', type: 'script', _provenance: 'org' };
/** Stamps that are not a shipping package (ADR-0029 D9.6). */
const SENTINEL_STAMPED = { name: 'rehydrated_ping', objectName: OBJECT, type: 'script', _packageId: 'sys_metadata' };
const ORG_BOUND = { name: 'org_bound_ping', objectName: OBJECT, type: 'script', _packageId: 'app.crm', _provenance: 'org' };

const STANDALONE = [ENV_ON_PACKAGED_OBJECT, ENV_GLOBAL, SENTINEL_STAMPED, ORG_BOUND];

type Row = Record<string, unknown>;

/**
 * The double's WHERE predicate, at module scope so `pnpm check:where-matcher`
 * can lift it. Equality only, and a loud refusal for anything else: the store's
 * reads are `{ metadata_type }` and `{ metadata_type, name }`.
 */
function matches(row: Row, where: Row | undefined): boolean {
    return Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$') || (v !== null && typeof v === 'object')) {
            throw new Error(`fake engine: unsupported WHERE combinator '${k}' — this double implements equality only`);
        }
        return row[k] === v;
    });
}

/**
 * The in-memory `sys_metadata_activation` the durable store writes into: the
 * store's keyed `find` and its `insert`, and nothing else. At module scope, on
 * its own, so `pnpm check:objectql-double-limit` can lift and drive the `find`.
 *
 * `writeError` is thrown from every write — a store or record-validation
 * failure arriving through the door's own `catch`.
 *
 * ⛔ No `update`: every case here writes a FIRST row, which the store inserts.
 * The store's update leg for a package-less row is core's to pin
 * (`metadata-activation-store.test.ts`, "UPDATES its row with no package on the
 * way back on"); a second update double here would pin nothing that one does not.
 */
function makeLedgerTable(writeError?: Error) {
    const rows: Row[] = [];
    let nextId = 1;
    const engine = {
        async find(object: string, options?: any) {
            const found = object === 'sys_metadata_activation' ? rows.filter((r) => matches(r, options?.where)) : [];
            // The caller's bound, AFTER the filter, by presence: the store's
            // table probe reads `limit: 1`.
            return typeof options?.limit === 'number' ? found.slice(0, options.limit) : found;
        },
        async insert(object: string, data: Row) {
            if (writeError) throw writeError;
            const row = { id: `act_${nextId++}`, ...data };
            if (object === LEDGER) rows.push(row);
            return row;
        },
    };
    return { rows, engine };
}

interface Harness {
    dispatcher: HttpDispatcher;
    rows: Row[];
    executed: () => number;
}

/**
 * One deployment: the route object is a code artifact shipped by `crm`, the
 * engine carries the REAL action activation projection over the REAL durable
 * store, and that store writes into {@link makeLedgerTable}.
 */
function boot(opts: { writeError?: Error; metadata?: unknown } = {}): Harness {
    const { rows, engine: ledger } = makeLedgerTable(opts.writeError);
    let executed = 0;
    const objectDef = {
        name: OBJECT, _packageId: PACKAGE, _provenance: 'package', actions: [PACKAGED, EMBEDDED_UNSTAMPED],
    };
    const projection = new ActionActivationProjection();
    const ql: any = {
        ...ledger,
        executeAction: async () => {
            executed++;
            return { ran: 'script' };
        },
        getSchema: (name: string) => (name === OBJECT ? objectDef : undefined),
        registry: {
            getObject: (name: string) => (name === OBJECT ? objectDef : undefined),
            getItem: (type: string, name: string) =>
                (type === 'action' ? STANDALONE.find((a) => a.name === name) : undefined),
        },
        isActionEnabled: (name: string) => projection.isEnabled(name),
        describeDisabledAction: (name: string) => projection.describeDisabled(name),
        setActionActive: (row: any, options?: any) => projection.setActive(row, options),
    };
    projection.attach(new ObjectStoreActionActivationStore(ql));

    const metadata: any = opts.metadata ?? {
        load: async () => null,
        loadDiagnosed: async () => ({ data: null, degraded: false, errors: [] }),
        loadMany: async (type: string) => (type === 'action' ? STANDALONE : []),
        listObjects: async () => [objectDef],
        getObject: async () => objectDef,
    };
    const services: Record<string, unknown> = { objectql: ql, data: ql, metadata };
    const resolve = (name: string): unknown => services[name] ?? null;
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel as never), rows, executed: () => executed };
}

/** A single-tenant administrator holding `manage_metadata`: every authority gate passes. */
const ADMIN = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: {
        userId: 'u_admin',
        positions: ['org_owner', 'org_admin'],
        permissions: ['organization_admin'],
        systemPermissions: ['manage_metadata'],
        organizationId: 'org_acme',
    },
} as unknown as HttpProtocolContext);

const statusOf = (r: any): unknown => r?.response?.status;
const codeOf = (r: any): unknown => r?.response?.body?.error?.code;
const bodyOf = (r: any): string => JSON.stringify(r?.response?.body);

const flip = (h: Harness, objectName: string, actionName: string, enabled: boolean) =>
    h.dispatcher.handleActions(`/_activation/${objectName}/${actionName}`, 'POST', { enabled }, ADMIN());

describe('#22817 — an action no package ships is switched, and its row names no package', () => {
    it('an OBJECT-LESS environment action switches off: 200, and the row lands with package_id null', async () => {
        const h = boot();

        const res = await flip(h, 'global', ENV_GLOBAL.name, false);

        expect(statusOf(res), bodyOf(res)).toBe(200);
        expect(h.rows).toEqual([
            { id: 'act_1', metadata_type: 'action', name: ENV_GLOBAL.name, package_id: null, active: false },
        ]);
    });

    it('…and switching it ON first writes the same package-less row, armed', async () => {
        const h = boot();

        const res = await flip(h, 'global', ENV_GLOBAL.name, true);

        expect(statusOf(res), bodyOf(res)).toBe(200);
        expect(h.rows).toEqual([
            { id: 'act_1', metadata_type: 'action', name: ENV_GLOBAL.name, package_id: null, active: true },
        ]);
    });

    it('an environment action BOUND TO A PACKAGED OBJECT is not credited to the object\'s package', async () => {
        const h = boot();

        const res = await flip(h, OBJECT, ENV_ON_PACKAGED_OBJECT.name, false);

        expect(statusOf(res), bodyOf(res)).toBe(200);
        // It used to name `crm` — the route object's package, which ships the
        // object and not this action.
        expect(h.rows).toEqual([
            { id: 'act_1', metadata_type: 'action', name: ENV_ON_PACKAGED_OBJECT.name, package_id: null, active: false },
        ]);
    });

    it.each([
        ['the `sys_metadata` rehydration sentinel', SENTINEL_STAMPED],
        ['a tenant-authored action bound to an app package', ORG_BOUND],
    ])('a stamp that is not a shipping package names none: %s', async (_label, action) => {
        const h = boot();

        const res = await flip(h, OBJECT, action.name, false);

        expect(statusOf(res), bodyOf(res)).toBe(200);
        expect(h.rows.map((r) => r.package_id)).toEqual([null]);
    });

    it('the switch it records is honoured: the environment action is then refused at dispatch', async () => {
        const h = boot();

        await flip(h, 'global', ENV_GLOBAL.name, false);
        const res = await h.dispatcher.handleActions(`/global/${ENV_GLOBAL.name}`, 'POST', {}, ADMIN());

        expect(statusOf(res), bodyOf(res)).toBe(409);
        expect(codeOf(res)).toBe('ACTION_DISABLED');
        expect(h.executed()).toBe(0);
    });
});

describe('#22817 CONTROL — a shipped action\'s row still names the package that ships it', () => {
    it('an action stamped by its package', async () => {
        const h = boot();

        const res = await flip(h, OBJECT, PACKAGED.name, false);

        expect(statusOf(res), bodyOf(res)).toBe(200);
        expect(h.rows).toEqual([
            { id: 'act_1', metadata_type: 'action', name: PACKAGED.name, package_id: PACKAGE, active: false },
        ]);
    });

    it('an action declared unstamped INSIDE its code object\'s `actions` names the object\'s package', async () => {
        const h = boot();

        const res = await flip(h, OBJECT, EMBEDDED_UNSTAMPED.name, false);

        expect(statusOf(res), bodyOf(res)).toBe(200);
        expect(h.rows).toEqual([
            { id: 'act_1', metadata_type: 'action', name: EMBEDDED_UNSTAMPED.name, package_id: PACKAGE, active: false },
        ]);
    });
});

describe('#22817 — a refused ledger write keeps ADR-0112\'s code and status together', () => {
    it('a record validation refusal is 400 VALIDATION_FAILED, and nothing lands', async () => {
        const refusal = Object.assign(new Error('Package is required'), {
            name: 'ValidationError', code: 'VALIDATION_FAILED',
            fields: [{ field: 'package_id', code: 'required', message: 'Package is required' }],
        });
        const h = boot({ writeError: refusal });

        const res = await flip(h, OBJECT, PACKAGED.name, false);

        // It used to be served as 503 VALIDATION_FAILED: a retryable status on
        // a refusal no retry clears.
        expect(statusOf(res)).toBe(400);
        expect(codeOf(res)).toBe('VALIDATION_FAILED');
        expect(h.rows).toEqual([]);
    });

    it('a store failure that declares no status is 503 SERVICE_UNAVAILABLE, never a 200', async () => {
        const h = boot({ writeError: new Error('connection reset') });

        const res = await flip(h, 'global', ENV_GLOBAL.name, false);

        expect(statusOf(res)).toBe(503);
        expect(codeOf(res)).toBe('SERVICE_UNAVAILABLE');
        expect(h.rows).toEqual([]);
    });
});

/**
 * [#32517 location 2, ADR-0126 §4, ADR-0150] A host whose `protocol` serves no
 * merged listing reads declarations from the metadata service's
 * `loadMany('action')`: the bare-route holder rule and the activation door's
 * ambiguity refusal both do. Two packages may each ship a standalone action of
 * one name. The artifact door's `MemoryLoader` keeps both, but the unscoped
 * `loadMany` folded them into the one saved last, so this host saw one holder
 * and the flip of the name (one ledger row) switched both packages' actions.
 * The real `MetadataManager` over the real `MemoryLoader` is the metadata
 * service here.
 *
 * A stack whose `protocol` serves the merged listing (the composed artifact
 * on `MetadataPlugin` + `ObjectQLPlugin` + `AppPlugin`) already saw both and
 * answers the same before and after: 409 for the pair on two objects, 404 for
 * the object-less pair. This host now answers what that stack answers.
 *
 * BASE (main `874166b60`'s `@objectstack/metadata` built): 200 and one row
 * (`package_id` = the package saved last) in both cases.
 */
describe('[#32517] two packages\' same-named actions: the metadata-service-only host answers the flip as the merged-listing stack does', () => {
    const OTHER = 'crm_contact';
    const shipped = (packageId: string, objectName: string | undefined) => ({
        name: 'shared_ping', label: `ping ${packageId}`, type: 'script',
        ...(objectName === undefined ? {} : { objectName }),
        _packageId: packageId, _provenance: 'package',
    });

    async function bootWithDoor(objectsOf: readonly [string | undefined, string | undefined]): Promise<Harness> {
        const { MetadataManager, MemoryLoader } = await import('@objectstack/metadata');
        const door = new MemoryLoader();
        await door.save('action', 'shared_ping', shipped('com.acme.alpha', objectsOf[0]));
        await door.save('action', 'shared_ping', shipped('com.acme.beta', objectsOf[1]));
        const manager = new MetadataManager({ formats: ['json'], loaders: [door] });
        const objects = [
            { name: OBJECT, _packageId: PACKAGE, _provenance: 'package', actions: [] },
            { name: OTHER, _packageId: PACKAGE, _provenance: 'package', actions: [] },
        ];
        const metadata: any = {
            load: (type: string, name: string) => manager.load(type, name),
            loadDiagnosed: (type: string, name: string) => manager.loadDiagnosed(type, name),
            loadMany: (type: string) => manager.loadMany(type),
            listObjects: async () => objects,
            getObject: async (name: string) => objects.find((o) => o.name === name),
        };
        return boot({ metadata });
    }

    it('NARROWING — bound to two objects: 409 RESOURCE_CONFLICT naming both objects, and no row (BASE: 200 and one row)', async () => {
        const h = await bootWithDoor([OBJECT, OTHER]);
        const res = await flip(h, OTHER, 'shared_ping', false);
        expect(statusOf(res), bodyOf(res)).toBe(409);
        expect(codeOf(res)).toBe('RESOURCE_CONFLICT');
        expect(bodyOf(res)).toContain(`'${OBJECT}'`);
        expect(bodyOf(res)).toContain(`'${OTHER}'`);
        expect(h.rows).toEqual([]);
    });

    it('NARROWING — both object-less: 404, no row, as the merged-listing stack answers (BASE: 200 and one row)', async () => {
        const h = await bootWithDoor([undefined, undefined]);
        const res = await flip(h, 'global', 'shared_ping', false);
        expect(statusOf(res), bodyOf(res)).toBe(404);
        expect(codeOf(res)).toBe('RESOURCE_NOT_FOUND');
        expect(h.rows).toEqual([]);
    });

    it('CONTROL — one package\'s action on one object: the flip writes its row (unchanged)', async () => {
        const { MetadataManager, MemoryLoader } = await import('@objectstack/metadata');
        const door = new MemoryLoader();
        await door.save('action', 'shared_ping', shipped('com.acme.alpha', OTHER));
        const manager = new MetadataManager({ formats: ['json'], loaders: [door] });
        const objects = [{ name: OTHER, _packageId: PACKAGE, _provenance: 'package', actions: [] }];
        const h = boot({ metadata: {
            load: (type: string, name: string) => manager.load(type, name),
            loadDiagnosed: (type: string, name: string) => manager.loadDiagnosed(type, name),
            loadMany: (type: string) => manager.loadMany(type),
            listObjects: async () => objects,
            getObject: async (name: string) => objects.find((o) => o.name === name),
        } });
        const res = await flip(h, OTHER, 'shared_ping', false);
        expect(statusOf(res), bodyOf(res)).toBe(200);
        expect(h.rows.map((r) => [r.name, r.package_id, r.active])).toEqual([['shared_ping', 'com.acme.alpha', false]]);
    });
});
