// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The artifact door registers stack-declared `capabilities` (#12892 step 1).
 *
 * `capabilities` is an authorable top-level stack collection (ADR-0066 D1).
 * Until this entry landed, `ARTIFACT_FIELD_TO_TYPE` did not map it while
 * `AppPlugin`'s ADR-0057 `SECURITY_FIELDS` block did — so on an artifact boot
 * that block was the collection's SOLE registrar, and it registers the raw
 * bundle bytes: no strict parse, no schema default, no ADR-0010 provenance.
 * That asymmetry is what `scripts/check-stack-collection-maps.mjs` waived as
 * "DRIFT with a real, bounded consequence"; the maintainer's ruling on #12892
 * (2026-08-29, option 1 — "the door owns the registration route") closes it,
 * and this file is the door half.
 *
 * Driven through the real `_parseAndRegisterArtifact`, so what is asserted is
 * what a sealed (`bootstrap: 'artifact-only'`) runtime actually serves under
 * `GET /meta/capability`, not what the map literal says.
 *
 * ⚠️ This does NOT make the door the only registrar: `AppPlugin` still
 * registers `capabilities`, and on a real artifact boot it runs LAST, so its
 * unparsed copy still wins the registry. Measured on a real artifact-only
 * kernel boot for the PR, and that is precisely why step 2 of the ruling
 * exists. What step 1 changes on its own is the boot where `AppPlugin` does
 * not run: there, `GET /meta/capability` answered EMPTY and now answers the
 * parsed, defaulted, provenance-stamped item.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataPlugin } from './plugin.js';

function fakeCtx() {
    return {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn(() => undefined),
        trigger: vi.fn(),
    } as any;
}

function newPlugin(): any {
    return new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' } });
}

/** The authored bytes — deliberately the MINIMUM a capability may declare. */
function artifact(overrides: Record<string, unknown> = {}): any {
    return {
        manifest: {
            id: 'com.test.cap-door',
            name: 'Capability Door Probe',
            type: 'app',
            version: '3.4.5',
        },
        capabilities: [{ name: 'crm.export', label: 'Export CRM data' }],
        ...overrides,
    };
}

describe('artifact door — stack-declared capabilities (#12892 step 1, ADR-0066 D1)', () => {
    it('registers a declared capability under the `capability` metadata type', async () => {
        const plugin = newPlugin();
        await plugin._parseAndRegisterArtifact(fakeCtx(), artifact(), 'cap-door-probe');

        const registered = await plugin.manager.get('capability', 'crm.export');
        expect(registered, 'the door must register the declared capability').toBeDefined();
        expect(await plugin.manager.list('capability')).toHaveLength(1);
    });

    it('the registered copy carries what only the door can add: the schema default and the ADR-0010 provenance envelope', async () => {
        const plugin = newPlugin();
        await plugin._parseAndRegisterArtifact(fakeCtx(), artifact(), 'cap-door-probe');
        const registered: any = await plugin.manager.get('capability', 'crm.export');

        // The authored bytes carry NEITHER of these — this is the whole
        // difference between the door's copy and the bundle reader's, and
        // asserting the authored keys alone would pass on either.
        expect(registered.scope, 'CapabilitySchema default (authored bytes omit it)').toBe('platform');
        expect(registered._packageId).toBe('com.test.cap-door');
        expect(registered._packageVersion).toBe('3.4.5');
        expect(registered._provenance).toBe('package');

        // …and the authored fields survive unchanged.
        expect(registered).toMatchObject({ name: 'crm.export', label: 'Export CRM data' });
    });

    it('NEGATIVE control — an artifact declaring no capabilities registers none', async () => {
        // Guards the two cases above against passing on a constant: the
        // assertion has to track the input, not the map.
        const plugin = newPlugin();
        const bare = artifact();
        delete bare.capabilities;
        await plugin._parseAndRegisterArtifact(fakeCtx(), bare, 'cap-door-probe-empty');
        expect(await plugin.manager.list('capability')).toEqual([]);
    });

    it('the strict parse still governs the item — a malformed capability reaches no registry', async () => {
        // #12894 measured that the map entry adds NO validation: the door
        // strict-parses the whole definition BEFORE consulting the map, so a
        // malformed capability was already refused and still is. Pinned here so
        // "the door registers capabilities" is never read as "the door
        // registers whatever the bytes say".
        const plugin = newPlugin();
        const bad = artifact({ capabilities: [{ name: 'crm.export', label: 'Export CRM data', nope: 1 }] });
        await plugin._parseAndRegisterArtifact(fakeCtx(), bad, 'cap-door-probe-bad').catch(() => undefined);
        expect(await plugin.manager.list('capability')).toEqual([]);
    });
});
