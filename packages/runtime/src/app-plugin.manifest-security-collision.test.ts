// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `AppPlugin`'s ADR-0057 security-metadata registrar flattens the manifest
 * under the stack's own collections — `{ ...manifest, ...collections }` — so a
 * manifest key the stack does not also declare reaches the registrar. Exactly
 * ONE key can arrive that way, and it arrives meaning something else.
 *
 * Measured against `ManifestSchema` (`packages/spec/src/kernel/manifest.zod.ts`)
 * for all four `SECURITY_FIELDS`, because the card that opened this asked for
 * that measurement first:
 *
 * | field          | on `ManifestSchema`                 | can collide |
 * |----------------|-------------------------------------|-------------|
 * | `permissions`  | yes — `ManifestPermissionsSchema`   | YES         |
 * | `capabilities` | yes, but a `retiredKey()` tombstone | no          |
 * | `positions`    | not declared (`strictObject`)       | no          |
 * | `sharingRules` | not declared (`strictObject`)       | no          |
 *
 * `manifest.permissions` is the ADR-0025 §3.2 capability grant a package
 * REQUESTS — the legacy flat `string[]`, or the structured
 * `{ services, hooks, network, fs }` block. The registrar wants ADR-0090
 * `PermissionSet[]`. Skipping the grant is the right OUTCOME; doing it without
 * a word is what this file pins, both directions:
 *
 *   - it SPEAKS when the manifest's value reached the registrar and nothing
 *     came of it (both arms), and
 *   - it STAYS SILENT on every shape where nothing was lost — the stack
 *     declaring its own collection, a manifest with no such key, a manifest
 *     whose entries the registrar really can read, and the artifact-door
 *     composition that owns the route.
 *
 * The second half is the point: a guard that fires on every boot is the same
 * silence with extra noise.
 *
 * ⛔ The registrar is NOT made tolerant of either arm — the two readings are
 * incompatible and widening the key was rejected by name (#14242 road C,
 * maintainer 2026-09-02). Nothing below asserts that a grant registers.
 */

import { describe, it, expect, vi } from 'vitest';
import { AppPlugin } from './app-plugin.js';

/** The substring every line this file is about carries. */
const MARKER = 'cannot read it';

type Registration = { type: string; name: string; item: any };

interface Driven {
    registrations: Registration[];
    warns: string[];
    infos: string[];
}

function fakeCtx(metadataService: unknown, sink: { warns: string[]; infos: string[] }) {
    return {
        logger: {
            info: vi.fn((msg: string) => { sink.infos.push(String(msg)); }),
            warn: vi.fn((msg: string) => { sink.warns.push(String(msg)); }),
            error: vi.fn(),
            debug: vi.fn(),
        },
        registerService: vi.fn(),
        getService: vi.fn((name: string) => {
            if (name === 'metadata') return metadataService;
            if (name === 'objectql') return {} as any;
            return undefined;
        }),
        getServices: vi.fn(() => []),
        hook: vi.fn(),
        trigger: vi.fn(),
    } as any;
}

/** Drive the real ADR-0057 block over `bundle`, capturing its writes and its log. */
async function drive(bundle: unknown, opts: ConstructorParameters<typeof AppPlugin>[2] = {}): Promise<Driven> {
    const registrations: Registration[] = [];
    const sink = { warns: [] as string[], infos: [] as string[] };
    const plugin = new AppPlugin(bundle, undefined, opts);
    await plugin.start!(
        fakeCtx(
            {
                registerInMemory: (type: string, name: string, item: unknown) => {
                    registrations.push({ type, name, item });
                },
            },
            sink,
        ),
    );
    return { registrations, warns: sink.warns, infos: sink.infos };
}

const MANIFEST = {
    id: 'com.test.issue-18034',
    name: 'Collision Probe',
    type: 'app',
    version: '1.0.0',
} as const;

/** A stack whose manifest carries `permissions` and whose top level does not. */
const stackWithManifestPermissions = (permissions: unknown): any => ({
    manifest: { ...MANIFEST, permissions },
    objects: [],
});

/** One readable ADR-0090 permission set, for the stack's own collection. */
const PERMISSION_SET = { name: 'support_agent', label: 'Support Agent' };

const marked = (lines: string[]): string[] => lines.filter((l) => l.includes(MARKER));

describe('#18034 — the manifest-stage `permissions` grant reaching the ADR-0090 registrar is named, not dropped in silence', () => {
    it('legacy ADR-0025 arm (flat string list): registers nothing, and says so once, naming the arm and the remedy', async () => {
        const { registrations, warns } = await drive(
            stackWithManifestPermissions(['system.user.read', 'system.data.write']),
        );

        // The OUTCOME is unchanged — a capability grant is not a permission set.
        expect(registrations.filter((r) => r.type === 'permission')).toEqual([]);

        const lines = marked(warns);
        expect(lines, 'the drop must be audible exactly once').toHaveLength(1);
        expect(lines[0]).toContain('manifest.permissions');
        expect(lines[0]).toContain('2 of 2');        // both members named as lost
        expect(lines[0]).toContain('ADR-0025');     // which reading was found
        expect(lines[0]).toContain('defineStack');  // where the sets belong
    });

    it('structured ADR-0025 arm (`{ services, hooks, … }`): registers nothing, and says so once', async () => {
        const { registrations, warns } = await drive(
            stackWithManifestPermissions({ services: ['object', 'http'], hooks: ['record.beforeInsert'] }),
        );

        expect(registrations.filter((r) => r.type === 'permission')).toEqual([]);

        const lines = marked(warns);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('manifest.permissions');
        expect(lines[0]).toContain('defineStack');
    });

    // ── Discrimination: the shapes that must stay silent ──────────────────
    //
    // Without these, the assertions above are satisfied by a line that fires on
    // every boot, which reports nothing at all.

    it('stays silent when the stack declares its own `permissions` collection — the manifest key never reaches the registrar', async () => {
        const { registrations, warns } = await drive({
            manifest: { ...MANIFEST, permissions: ['system.user.read'] },
            permissions: [PERMISSION_SET],
            objects: [],
        });

        expect(registrations.filter((r) => r.type === 'permission').map((r) => r.name)).toEqual(['support_agent']);
        expect(marked(warns)).toEqual([]);
    });

    it('stays silent on a manifest that declares no `permissions` at all', async () => {
        const { registrations, warns } = await drive({
            manifest: { ...MANIFEST },
            permissions: [PERMISSION_SET],
            objects: [],
        });

        expect(registrations.filter((r) => r.type === 'permission').map((r) => r.name)).toEqual(['support_agent']);
        expect(marked(warns)).toEqual([]);
    });

    it('stays silent when the manifest value IS readable — nothing was lost, so there is nothing to report', async () => {
        // Off-spec as authored (`defineStack` strict refuses it with
        // `invalid_union` on `manifest.permissions`), but reachable through a
        // non-strict or hand-built bundle — and on that path the registrar
        // reads the entries today. The guard must not turn a working shape into
        // a warning.
        const { registrations, warns } = await drive(stackWithManifestPermissions([PERMISSION_SET]));

        expect(registrations.filter((r) => r.type === 'permission').map((r) => r.name)).toEqual(['support_agent']);
        expect(marked(warns)).toEqual([]);
    });

    it('stays silent under the artifact-door registrar — that composition owns the route and prints its own summary', async () => {
        const { registrations, warns } = await drive(
            stackWithManifestPermissions(['system.user.read']),
            { securityMetadataRegistrar: 'artifact-door' },
        );

        expect(registrations).toEqual([]);
        expect(marked(warns)).toEqual([]);
    });

    it('a partially readable list still registers what it can, and names only the members it lost', async () => {
        const { registrations, warns } = await drive(
            stackWithManifestPermissions([PERMISSION_SET, 'system.user.read']),
        );

        expect(registrations.filter((r) => r.type === 'permission').map((r) => r.name)).toEqual(['support_agent']);

        const lines = marked(warns);
        expect(lines).toHaveLength(1);
        // One member lost, not two — the count is measured, not the array length.
        expect(lines[0]).toContain('1 of 2');
    });
});
