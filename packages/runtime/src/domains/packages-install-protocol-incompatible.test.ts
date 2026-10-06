// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21727] `POST /api/v1/packages` answers ADR-0087 D1's protocol refusal as a
 * 422 carrying its structured diagnostic, and still installs nothing.
 *
 * ## The defect this file pins shut
 *
 * A manifest whose `engines.protocol` range excludes this runtime's major was
 * refused, but the refusal reached the caller as
 * `500 OS_PROTOCOL_INCOMPATIBLE`, with `requiredRange`, `rangeSource`,
 * `protocolVersion`, `targetMajor` and `migrateCommand` present only inside the
 * prose. That broke two promises. A manifest the caller wrote was reported as
 * a server fault. And the machine-readable diagnostic ADR-0087 D1 promises
 * ("a structured diagnostic … a stable error code, the two versions … the exact
 * replay command") was not machine-readable.
 *
 * ## Why the door, and not the shared resolver
 *
 * `resolveThrownHttpError` (`@objectstack/types`) builds `details` from a
 * closed list (`.code` when it is not a string, `.issues`, a validation's
 * `.fields`) and drops a thrown `.diagnostic`. The list is closed by the
 * maintainer's #9585 ruling, so the install branch recognises the typed
 * refusal ahead of its generic catch, which is the `FlowActionRefusal` idiom.
 * The answer is `protocolIncompatibleAnswer` (`@objectstack/metadata-core`),
 * shared with the other HTTP door that reaches `assertProtocolCompat`,
 * `POST /api/v1/marketplace/install-local` (#21762), whose suite holds the two
 * doors' answers byte-equal. The boot seam, `AppPlugin.init`, has no HTTP
 * answer, and `app-plugin.test.ts` pins its thrown value.
 *
 * ## The harness
 *
 * The protocol primitive and the registry are REAL
 * (`ObjectStackProtocolImplementation` over a `SchemaRegistry`), so the
 * refusal under test is the one production throws, and "not installed" is read
 * back through the same door's `GET`. Each refusal asserts the ADR-0112
 * envelope (`code` and `status`), never a bare throw. `OS_HOME` is redirected
 * because the lit controls really install, and the door persists enable state
 * under it.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaRegistry } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ApiErrorSchema } from '@objectstack/spec/api';
import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from '@objectstack/spec/kernel';
import { HttpDispatcher } from '../http-dispatcher.js';

let home: string;
let priorHome: string | undefined;

beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-install-protocol-'));
    process.env.OS_HOME = home;
});

afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const ADMIN = () => ({
    request: {},
    environmentId: 'pkg-install-protocol-test',
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/** A major this runtime no longer accepts, derived from the runtime, never a literal. */
const OLD_MAJOR = PROTOCOL_MAJOR - 1;
const OLD_RANGE = `^${OLD_MAJOR}`;

/** The card's reproduction, with the range derived from the running protocol. */
const INCOMPATIBLE = {
    id: 'com.example.qaold', name: 'Old', version: '1.0.0', scope: 'project', type: 'app',
    engines: { protocol: OLD_RANGE },
};
/** The lit control: the same manifest under a range this runtime admits. */
const COMPATIBLE = { ...INCOMPATIBLE, id: 'com.example.qacurrent', engines: { protocol: `^${PROTOCOL_MAJOR}` } };

/** The five diagnostic members the wire carries: a CLOSED set. */
const DETAIL_KEYS = ['migrateCommand', 'protocolVersion', 'rangeSource', 'requiredRange', 'targetMajor'];

function silentRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as unknown as { logLevel: string }).logLevel = 'silent';
    return registry;
}

/**
 * The composed door: the real protocol primitive over a real registry. Pass
 * `protocol: null` for the composition with no `protocol` service, which takes
 * the door's fallback arm.
 */
function door(options: { protocol?: unknown } = {}) {
    const registry = silentRegistry();
    const engine: any = { registry, find: async () => [], manifests: new Map() };
    const protocol = options.protocol === undefined
        ? new ObjectStackProtocolImplementation(engine, () => new Map())
        : options.protocol;
    const ql: any = { registry, manifests: new Map() };
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') return protocol ? Promise.resolve(protocol) : null;
            if (name === 'objectql') return Promise.resolve(ql);
            return null;
        },
        context: { getService: (name: string) => (name === 'objectql' ? ql : null) },
    };
    return { dispatcher: new HttpDispatcher(kernel), registry };
}

const install = (d: ReturnType<typeof door>, manifest: unknown) =>
    d.dispatcher.handlePackages('', 'POST', { manifest }, {}, ADMIN());
const read = (d: ReturnType<typeof door>, id: string) =>
    d.dispatcher.handlePackages(`/${id}`, 'GET', undefined, {}, ADMIN());

/** Pin 1's assertions, shared by both arms of the door. */
function expectStructuredRefusal(r: any) {
    expect(r.handled).toBe(true);
    expect(r.response.status).toBe(422);
    const error = r.response.body.error;
    expect(r.response.body.success).toBe(false);
    expect(error.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
    expect(error.httpStatus).toBe(422);
    expect(ApiErrorSchema.safeParse(error).success).toBe(true);

    // Exactly the five members, so `code` is in `error.code` (ADR-0112 D5),
    // never in `error.details.code`, and nothing beyond the ruled set leaks.
    expect(Object.keys(error.details).sort()).toEqual(DETAIL_KEYS);
    expect(error.details).toEqual({
        requiredRange: OLD_RANGE,
        rangeSource: 'engines.protocol',
        protocolVersion: PROTOCOL_VERSION,
        targetMajor: OLD_MAJOR,
        migrateCommand: `objectstack migrate meta --from ${OLD_MAJOR}`,
    });

    // Each member equals what the prose states, so the two channels cannot drift.
    const { requiredRange, rangeSource, protocolVersion, targetMajor, migrateCommand } = error.details;
    expect(error.message).toContain(`targets protocol ${requiredRange} (${rangeSource})`);
    expect(error.message).toContain(`this runtime is protocol ${protocolVersion}.`);
    expect(error.message.endsWith(`Run: ${migrateCommand}`)).toBe(true);
    expect(migrateCommand.endsWith(`--from ${targetMajor}`)).toBe(true);
}

describe('POST /api/v1/packages: the protocol refusal is a 422 with its diagnostic (composed door)', () => {
    it('pin 1: answers 422 OS_PROTOCOL_INCOMPATIBLE with all five diagnostic fields in error.details', async () => {
        expectStructuredRefusal(await install(door(), INCOMPATIBLE));
    });

    it('pin 2: the refused package is still not installed (GET → 404)', async () => {
        const d = door();
        await install(d, INCOMPATIBLE);
        const r: any = await read(d, INCOMPATIBLE.id);
        expect(r.response.status).toBe(404);
        expect(r.response.body.error.code).toBe('RESOURCE_NOT_FOUND');
        expect(d.registry.getPackage(INCOMPATIBLE.id)).toBeUndefined();
    });

    it('lit control: a compatible range installs and reads back', async () => {
        const d = door();
        const r: any = await install(d, COMPATIBLE);
        expect(r.response.status).toBe(201);
        expect((await read(d, COMPATIBLE.id) as any).response.status).toBe(200);
    });

    it('recognises the BRAND, not the field names: a lookalike throw is served by the generic catch', async () => {
        // A plain Error that copies the code and the diagnostic is not the
        // refusal. It must not reach the structured channel; it gets the
        // shared resolver's answer (the 500 fallback, no diagnostic).
        const lookalike = Object.assign(new Error('lookalike refusal'), {
            code: 'OS_PROTOCOL_INCOMPATIBLE',
            diagnostic: { requiredRange: OLD_RANGE, migrateCommand: 'x' },
        });
        const installPackage = vi.fn(async () => { throw lookalike; });
        const r: any = await install(door({ protocol: { installPackage } }), INCOMPATIBLE);
        expect(installPackage).toHaveBeenCalledTimes(1);
        expect(r.response.status).toBe(500);
        expect(r.response.body.error.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
        expect(r.response.body.error.details).toBeUndefined();
    });
});

describe('POST /api/v1/packages: the no-protocol-service fallback runs the same handshake', () => {
    it('refuses an incompatible range with the same 422 and diagnostic, and writes nothing', async () => {
        const d = door({ protocol: null });
        expectStructuredRefusal(await install(d, INCOMPATIBLE));
        expect(d.registry.getPackage(INCOMPATIBLE.id)).toBeUndefined();
        expect((await read(d, INCOMPATIBLE.id) as any).response.status).toBe(404);
    });

    it('lit control: a compatible range still installs through the fallback', async () => {
        const d = door({ protocol: null });
        const r: any = await install(d, COMPATIBLE);
        expect(r.response.status).toBe(201);
        expect(d.registry.getPackage(COMPATIBLE.id)).toBeDefined();
    });
});
