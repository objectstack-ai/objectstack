// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect, afterEach } from 'vitest';
import { PLATFORM_PLUGIN_WIRED_RUNTIMES } from '@objectstack/spec';
import {
    registerMultiNodeGate,
    checkMultiNodeAllowed,
    __resetMultiNodeGate,
} from './multi-node-gate.js';
import {
    mountMultiNodeGateFromHost,
    MULTI_NODE_GATE_CARRIER_PACKAGES,
} from './multi-node-gate-mount.js';

afterEach(() => __resetMultiNodeGate());

/** An always-allowing gate, standing in for a distribution's licence check. */
const FAKE_GATE = { allowMultiNode: () => ({ allowed: true, reason: 'fake licence' }) };

describe('mountMultiNodeGateFromHost', () => {
    it('registers via a carrier whose module load registers, and stops there', async () => {
        const imported: string[] = [];
        const reading = await mountMultiNodeGateFromHost(async (specifier) => {
            imported.push(specifier);
            // The carrier contract: registration is a SIDE EFFECT of module
            // load. The fake registers on first import, like a real carrier
            // whose module scope calls `registerMultiNodeGate`.
            registerMultiNodeGate(FAKE_GATE);
            return {};
        });
        expect(reading).toEqual({
            alreadyRegistered: false,
            registered: true,
            attempts: [{ package: MULTI_NODE_GATE_CARRIER_PACKAGES[0], outcome: 'registered' }],
        });
        // Mount done after the first carrier — the second is never imported.
        expect(imported).toEqual([MULTI_NODE_GATE_CARRIER_PACKAGES[0]]);
        // And the mounted gate is the one the consult now reads.
        expect(checkMultiNodeAllowed(3)).toMatchObject({ allowed: true, reason: 'fake licence' });
    });

    it('reports every carrier unavailable when none resolves, and stays unregistered', async () => {
        const reading = await mountMultiNodeGateFromHost(async (specifier) => {
            throw new Error(`Cannot find package '${specifier}'`);
        });
        expect(reading.alreadyRegistered).toBe(false);
        expect(reading.registered).toBe(false);
        expect(reading.attempts).toEqual(
            MULTI_NODE_GATE_CARRIER_PACKAGES.map((pkg) => ({
                package: pkg,
                outcome: 'unavailable',
                error: `Cannot find package '${pkg}'`,
            })),
        );
        // The open-core outcome: nothing mounted, so the fail-closed default
        // answers the consult that follows (#13537).
        expect(checkMultiNodeAllowed(3).allowed).toBe(false);
    });

    it('never throws: a rejecting importer becomes an `unavailable` attempt', async () => {
        await expect(
            mountMultiNodeGateFromHost(async () => {
                throw 'not-an-Error'; // eslint-disable-line no-throw-literal
            }),
        ).resolves.toMatchObject({
            registered: false,
            attempts: expect.arrayContaining([
                expect.objectContaining({ outcome: 'unavailable', error: 'not-an-Error' }),
            ]),
        });
    });

    it('records a carrier that loads without registering (the #13330 split, or an old carrier)', async () => {
        const reading = await mountMultiNodeGateFromHost(async () => ({}));
        expect(reading.registered).toBe(false);
        expect(reading.attempts).toEqual(
            MULTI_NODE_GATE_CARRIER_PACKAGES.map((pkg) => ({
                package: pkg,
                outcome: 'loaded-without-gate',
            })),
        );
    });

    it('does not import anything when a gate is already registered', async () => {
        registerMultiNodeGate(FAKE_GATE);
        const imported: string[] = [];
        const reading = await mountMultiNodeGateFromHost(async (specifier) => {
            imported.push(specifier);
            return {};
        });
        expect(reading).toEqual({ alreadyRegistered: true, registered: true, attempts: [] });
        expect(imported).toEqual([]);
    });

    it('names only real, roster-declared distribution runtimes as carriers', () => {
        // Drift guard (#10921): every carrier must be a package the spec
        // roster declares as a real out-of-repo `plugins[]`-wired runtime —
        // a fabricated name would sit here looking identical and simply never
        // resolve. The list itself is owned by the mount module (the roster
        // is provenance, not a resolution registry, by its own contract).
        for (const pkg of MULTI_NODE_GATE_CARRIER_PACKAGES) {
            expect(PLATFORM_PLUGIN_WIRED_RUNTIMES[pkg]).toBeDefined();
        }
        expect(MULTI_NODE_GATE_CARRIER_PACKAGES.length).toBeGreaterThan(0);
    });
});
