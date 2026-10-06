// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21986] `declinesStoredRow` is PUBLIC on `ObjectStackProtocolImplementation`,
 * so the published-snapshot doors (`GET /meta/:type/:name/published`, the REST
 * route and its dispatcher twin) can ask it instead of `isShippedFlowName`.
 *
 * What a door relies on, pinned here once: the one predicate answers BOTH name
 * classes whose stored row the active reads decline, and nothing else.
 *
 *  - a FLOW name the loader's set holds (`isShippedFlowName`'s answer);
 *  - a CODE-DEFINED DATASOURCE name: one an installed package declares, or one
 *    the host registers from code (`code-datasource-names`, here `default`).
 *
 * Every other name answers false: a flow no package ships, a runtime
 * datasource, the same name under another type, a missing or empty name.
 *
 * The calls below go through the class's own declared type, never an `any`
 * cast, so `tsc --noEmit` over this file (the package's `typecheck` includes
 * `src/**`) fails if the member stops being public.
 */
import { describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const FLOW_PACKAGE = 'com.example.pkg';
const SHIPPED_FLOW = 'pkg_flow';
const CUSTOMER_FLOW = 'customer_flow';
const CODE_DS = 'showcase_external';
const HOST_DS = 'default';
const RUNTIME_DS = 'rt_datasource_21986';

/**
 * A partial registry: the loader's entry for {@link SHIPPED_FLOW} carries its
 * package id (the shape `lookupArtifactItem` reads off a registry with no
 * `getArtifactItem`), and one installed package declares {@link CODE_DS}. The
 * services registry carries the host's code-datasource set.
 */
function makeProtocol(): ObjectStackProtocolImplementation {
    const loaderEntry = { name: SHIPPED_FLOW, label: 'Loader', _packageId: FLOW_PACKAGE };
    const engine = {
        registry: {
            getItem: (type: string, name: string) =>
                (type === 'flow' || type === 'flows') && name === SHIPPED_FLOW ? loaderEntry : undefined,
            getAllPackages: () => [{
                manifest: { id: 'com.example.showcase', datasources: [{ name: CODE_DS, driver: 'sqlite', config: {} }] },
            }],
        },
    };
    const services = new Map<string, unknown>([['code-datasource-names', new Set([HOST_DS])]]);
    return new ObjectStackProtocolImplementation(engine as never, () => services);
}

describe('[#21986] the published predicate: declinesStoredRow answers both name classes, and only those', () => {
    it('a shipped flow name, in either type spelling — what isShippedFlowName answers', () => {
        const protocol = makeProtocol();
        for (const type of ['flow', 'flows']) {
            expect(protocol.isShippedFlowName(type, SHIPPED_FLOW), type).toBe(true);
            expect(protocol.declinesStoredRow(type, SHIPPED_FLOW), type).toBe(true);
        }
    });

    it('a code-defined datasource name: one a package declares, and one the host registers from code', () => {
        const protocol = makeProtocol();
        for (const type of ['datasource', 'datasources']) {
            expect(protocol.declinesStoredRow(type, CODE_DS), type).toBe(true);
            expect(protocol.declinesStoredRow(type, HOST_DS), type).toBe(true);
            // Not a flow answer: the datasource half is its own.
            expect(protocol.isShippedFlowName(type, CODE_DS), type).toBe(false);
        }
    });

    it('control: every other name keeps its stored row', () => {
        const protocol = makeProtocol();
        expect(protocol.declinesStoredRow('flow', CUSTOMER_FLOW)).toBe(false);
        expect(protocol.declinesStoredRow('datasource', RUNTIME_DS)).toBe(false);
        // The same names under another type.
        expect(protocol.declinesStoredRow('object', CODE_DS)).toBe(false);
        expect(protocol.declinesStoredRow('object', HOST_DS)).toBe(false);
        expect(protocol.declinesStoredRow('view', SHIPPED_FLOW)).toBe(false);
        // A name that is not one.
        for (const name of [undefined, null, '', 42]) {
            expect(protocol.declinesStoredRow('datasource', name), String(name)).toBe(false);
            expect(protocol.declinesStoredRow('flow', name), String(name)).toBe(false);
        }
    });
});
