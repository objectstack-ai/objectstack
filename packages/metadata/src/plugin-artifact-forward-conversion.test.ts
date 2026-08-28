// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The artifact-ingestion door runs the versioned ADR-0087 forward conversion
 * (#12772) — pinned on the REAL incident fixture, both directions.
 *
 * `__fixtures__/hotcrm-17.1-built-permissions.artifact.json` is the manifest
 * and permissions blocks, verbatim, of `dist/objectstack.json` as built by
 * released `@objectstack/cli` 17.1.0 from a source tree containing ZERO
 * `allowPurge`/`allowRestore` occurrences — the released builder injected the
 * then-legal bits (75 of each), and spec 17.2.0 retired the keys with a
 * `retiredKey()` tombstone. On main before this fix, booting that artifact
 * through any framework artifact door (`OS_ARTIFACT_URL`, `OS_ARTIFACT_PATH`,
 * `<cwd>/dist/objectstack.json`, the HMR reload) failed here, in
 * `_parseAndRegisterArtifact`'s strict parse:
 *
 *     Plugin startup failed: com.objectstack.metadata … "expected": "never",
 *     "code": "invalid_type", "path": ["permissions", 0, "objects",
 *     "crm_lead", "allowRestore"] …
 *
 * Direction one pins the fix: the 17.1-authored artifact converts forward and
 * registers. Direction two pins the boundary that keeps the conversion
 * *versioned* — the retired window opens on version evidence, never as a
 * blanket amnesty (the keys return with M2, #1883) — as re-shaped by the
 * #12845 ruling (maintainer 2026-08-28): at the CURRENT spec version a
 * NON-default retired-key value still refuses with the tombstone, while the
 * emitted default parses as inert residue stripped silently at the SCHEMA
 * layer (`acceptRetiredDefaultResidue`), with this door's versioned window
 * staying closed (no conversion notice) — both halves pinned below.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInstalledSpecVersion } from '@objectstack/metadata-core';
import { MetadataPlugin } from './plugin.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, '__fixtures__/hotcrm-17.1-built-permissions.artifact.json');

/** Fresh parse per test — `_parseAndRegisterArtifact` mutates items in place. */
function loadFixture(): any {
    return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

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

describe('artifact door — 17.1-built artifact converts forward and registers (#12772)', () => {
    it('the real fixture carries the incident shape (premise guard)', () => {
        const raw = readFileSync(FIXTURE_PATH, 'utf8');
        // The measured numbers from the repro artifact — if a regeneration
        // ever launders these away, the accept-direction test below stops
        // testing the incident.
        expect((raw.match(/allowPurge/g) ?? []).length).toBe(75);
        expect((raw.match(/allowRestore/g) ?? []).length).toBe(75);
        expect(loadFixture().manifest.engines.protocol).toBe('^17.1.0');
    });

    it('parses, strips the retired keys, preserves every other grant bit, and registers all permission sets', async () => {
        const plugin = newPlugin();
        const ctx = fakeCtx();
        const fixture = loadFixture();
        const before = loadFixture(); // pristine copy for the preservation diff

        const total = await plugin._parseAndRegisterArtifact(ctx, fixture, 'fixture-17.1');
        expect(total).toBe(before.permissions.length);

        for (const pristine of before.permissions) {
            const registered = await plugin.manager.get('permission', pristine.name);
            expect(registered, `permission '${pristine.name}' should register`).toBeDefined();
            for (const [objName, grantRaw] of Object.entries<any>(pristine.objects ?? {})) {
                const grant = (registered as any).objects[objName];
                expect(grant, `${pristine.name}.objects.${objName}`).toBeDefined();
                expect(grant).not.toHaveProperty('allowPurge');
                expect(grant).not.toHaveProperty('allowRestore');
                // Everything else preserved: every bit the built artifact
                // authored (minus exactly the two retired keys) survives with
                // its authored value. `toMatchObject`, not `toEqual` — the
                // strict parse has always applied schema defaults for omitted
                // bits, and that pre-existing door behaviour is not under test
                // here (the conversion's own byte-preservation is pinned by
                // reference-identity in metadata-core's unit suite).
                const { allowPurge: _p, allowRestore: _r, ...rest } = grantRaw;
                expect(grant).toMatchObject(rest);
            }
        }
    });

    it('surfaces the conversion operator-visibly, deduped per artifact — not silently, not 150 lines', async () => {
        const plugin = newPlugin();
        const ctx = fakeCtx();

        await plugin._parseAndRegisterArtifact(ctx, loadFixture(), 'fixture-17.1');

        const conversionWarns = (ctx.logger.warn.mock.calls as any[])
            .map((c) => String(c[0]))
            .filter((m) => m.includes('permission-allow-restore-purge-removed'));
        expect(conversionWarns).toHaveLength(1);
        // The summary names the version evidence, the volume, and the remedy.
        expect(conversionWarns[0]).toContain('17.1.0');
        expect(conversionWarns[0]).toContain('150 site(s)');
        expect(conversionWarns[0]).toContain("'os build'");

        // The HMR watcher replays the same artifact — the summary must not.
        await plugin._parseAndRegisterArtifact(ctx, loadFixture(), 'fixture-17.1');
        const after = (ctx.logger.warn.mock.calls as any[])
            .map((c) => String(c[0]))
            .filter((m) => m.includes('permission-allow-restore-purge-removed'));
        expect(after).toHaveLength(1);
    });
});

describe('artifact door — the conversion is versioned, not a blanket amnesty (#12772)', () => {
    // Direction two split in half by the #12845 ruling (maintainer 2026-08-28,
    // recorded on the cloud#1685 thread; `acceptRetiredDefaultResidue` in
    // `packages/spec/src/shared/retired-key.ts`): a retired DEFAULTED key is
    // refused only when it carries a NON-default value — the emitted default
    // (`false` for both bits, materialized by the released 17.x builder into
    // every entry) parses as inert residue and is silently stripped at the
    // SCHEMA layer. So the refusal surface this door must keep pinned is the
    // non-default value; the pure-residue artifact at the current version now
    // parses clean WITHOUT this door's conversion opening (and that
    // distinction — schema-layer silent strip vs the door's noticed,
    // version-gated strip — is itself pinned below).

    it('an artifact claiming the CURRENT spec version with a NON-default retired-key value still refuses with the tombstone', async () => {
        const installed = resolveInstalledSpecVersion();
        expect(installed).toMatch(/^\d+\.\d+\.\d+/); // spec is always resolvable here

        const plugin = newPlugin();
        const fixture = loadFixture();
        // The manifest claims the running spec's own surface — the retired
        // window must stay closed. `^X.Y.Z` floors at exactly the installed
        // version, so this pin survives every future spec release without
        // edits.
        fixture.manifest.engines.protocol = `^${installed}`;
        // The real 17.1-built artifact carries only the emitted default
        // (150 × `false` — the premise guard above pins that), which is the
        // residue class #12845 now tolerates. The surviving refusal is the
        // NON-default value — legal to author on the 17.1 surface, never
        // emitted by a default — so construct that probe from the fixture:
        const firstGrant = Object.values<any>(fixture.permissions[0].objects)[0];
        expect(firstGrant.allowRestore).toBe(false); // was the residue value
        firstGrant.allowRestore = true;

        // The refusal must reach the operator carrying the prescription — the
        // tombstone's FROM → TO payload and the standardized migrate sentence
        // — not a generic "unrecognized key". (This door answers no HTTP
        // request — every refusal here fires before a server binds — so the
        // pin is on the tombstone message, not an ADR-0112 envelope.)
        try {
            await plugin._parseAndRegisterArtifact(fakeCtx(), fixture, 'fixture-current');
            expect.unreachable('the strict parse must refuse');
        } catch (e: any) {
            const message = String(e?.message ?? e);
            expect(message).toContain('allowRestore');
            expect(message).toContain('was removed in @objectstack/spec 17 (#12497, ADR-0049)');
            expect(message).toContain('Run `os migrate meta --from 17`');
        }
    });

    it('an artifact claiming the CURRENT spec version whose retired keys carry only the emitted default parses clean — the #12845 residue tolerance, at the schema layer, not this door', async () => {
        const installed = resolveInstalledSpecVersion();
        const plugin = newPlugin();
        const ctx = fakeCtx();
        const fixture = loadFixture(); // untouched: 150 × the emitted default
        const before = loadFixture();
        fixture.manifest.engines.protocol = `^${installed}`;

        const total = await plugin._parseAndRegisterArtifact(ctx, fixture, 'fixture-current-residue');
        expect(total).toBe(before.permissions.length);

        // The keys are gone from what registered — stripped by the schema's
        // residue tolerance…
        for (const pristine of before.permissions) {
            const registered = await plugin.manager.get('permission', pristine.name);
            for (const objName of Object.keys(pristine.objects ?? {})) {
                const grant = (registered as any).objects[objName];
                expect(grant).not.toHaveProperty('allowRestore');
                expect(grant).not.toHaveProperty('allowPurge');
            }
        }
        // …and NOT by this door's conversion: the authored floor is current,
        // so the versioned window stayed closed and no conversion summary was
        // emitted. This is the boundary that keeps the door's amnesty
        // versioned even now that the schema tolerates pure residue.
        const conversionWarns = (ctx.logger.warn.mock.calls as any[])
            .map((c) => String(c[0]))
            .filter((m) => m.includes('permission-allow-restore-purge-removed'));
        expect(conversionWarns).toHaveLength(0);
    });
});

describe('artifact door — environment-artifact envelope takes the same policy (#12772)', () => {
    it('converts the envelope `metadata` block forward when its manifest floor predates the runtime', async () => {
        const plugin = newPlugin();
        const ctx = fakeCtx();
        const envelope = {
            schemaVersion: '0.1',
            environmentId: 'proj_test',
            commitId: 'commit-1',
            checksum: 'a'.repeat(64),
            metadata: {
                manifest: {
                    id: 'app.example.mini',
                    name: 'mini',
                    version: '1.0.0',
                    type: 'app',
                    engines: { protocol: '^17.1.0' },
                },
                permissions: [
                    {
                        name: 'agent',
                        label: 'Agent',
                        objects: { crm_ticket: { allowRead: true, allowRestore: true, allowPurge: false } },
                    },
                ],
            },
        };

        const total = await plugin._parseAndRegisterArtifact(ctx, envelope, 'envelope-17.1');
        expect(total).toBe(1);
        const registered = await plugin.manager.get('permission', 'agent');
        const grant = (registered as any).objects.crm_ticket;
        // The retired keys are converted away (an unconverted envelope would
        // have refused at the tombstone); the authored bit survives. Schema
        // defaults for omitted bits are the parse's pre-existing behaviour.
        expect(grant).not.toHaveProperty('allowRestore');
        expect(grant).not.toHaveProperty('allowPurge');
        expect(grant).toMatchObject({ allowRead: true });
    });
});
