// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12359 / #12159] This plugin does NOT register the ADR-0126 §4 activation
// ledger's object — the other half of "MOVE, not add".
//
// ## Why the pin lives here and not beside the new registrant
//
// Registration follows the DECLARATION since the maintainer's 2026-08-26
// ruling (verbatim and untranslated: 「同意」), so `sys_metadata_activation` is
// registered by `PlatformObjectsPlugin`, where the object is declared. That
// package's own suite pins the positive half — the ledger IS registered there,
// under its own manifest, carrying the routing triple.
//
// The negative half has to be pinned in THIS package, because this is the file
// a later edit would touch. Re-adding the object to the manifest below would
// not produce a harmless duplicate: `SchemaRegistry.registerObject` throws
//
//     Object "sys_metadata_activation" is already owned by package
//     "com.objectstack.platform-objects.activation-ledger". Package
//     "com.objectstack.service-automation" cannot claim ownership.
//
// (ADR-0029 D3's single-owner invariant, D7's contributor kinds — measured; it
// is also the answer to the question #12359's triage left open, which is why
// MOVE was the only shape available). So the regression this guards against is
// a BOOT FAILURE for every composition carrying both plugins — i.e. every
// composition `objectstack serve` produces, since it auto-injects
// platform-objects unconditionally.
//
// Asserted BEHAVIOURALLY, over a real `init()` against a recording manifest
// service, rather than by grepping the module: a grep would pass against an
// object added through some other spelling, and this is exactly the kind of
// invariant that gets re-broken by a well-meaning refactor rather than by
// someone typing the old symbol name back.

import { describe, it, expect, vi } from 'vitest';

import { AutomationServicePlugin } from './plugin.js';

/** The slice of `PluginContext` this plugin's `init()` touches. */
function pluginCtx(manifest: { register(m: unknown): void }) {
    const services = new Map<string, unknown>([['manifest', manifest]]);
    return {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        getService(name: string) {
            if (services.has(name)) return services.get(name);
            throw new Error(`Service '${name}' not registered`);
        },
        registerService(name: string, svc: unknown) { services.set(name, svc); },
        hook() {},
        async trigger() {},
    } as never;
}

async function registeredObjectNames(): Promise<string[]> {
    const registered: Array<{ objects?: Array<{ name?: string }> }> = [];
    await new AutomationServicePlugin().init(
        pluginCtx({ register: (m: unknown) => { registered.push(m as never); } }),
    );
    return registered.flatMap((m) => (m.objects ?? []).map((o) => String(o?.name)));
}

describe('#12359 — the automation service is NOT the activation ledger\'s registrant', () => {
    it('registers its own two objects and nothing else', async () => {
        // Equality, not `not.toContain`: an assertion that only names the
        // absent object would stay green while this manifest grew a THIRD
        // registration nobody reviewed, which is the same class of drift.
        expect(await registeredObjectNames()).toEqual(['sys_automation_run', 'sys_flow_dispatch']);
    });

    it('does not name sys_metadata_activation in any manifest it registers', async () => {
        // Stated separately from the equality above so a failure reads as the
        // SPECIFIC regression — the ledger came back — rather than as "the
        // object list changed".
        expect(await registeredObjectNames()).not.toContain('sys_metadata_activation');
    });
});
