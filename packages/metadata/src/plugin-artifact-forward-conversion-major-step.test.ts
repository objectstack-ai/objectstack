// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23001] A `^18` artifact built during the v18 prerelease boots on a later
 * runtime, and the boot log names the conversion that let it.
 *
 * The fixture carries the shape a prerelease build from before a step-18
 * retirement carries: a declared index with bare `unique: true`, under
 * `engines.protocol: '^18'`. `declared-index-unique-scope` retires that shape
 * (stamped at the prerelease label, like every retirement landing in the
 * prerelease), and the strict parse in `_parseAndRegisterArtifact` refuses it.
 * A `^18` floor is 18.0.0, above every stamp of the 17.x line, so the door's
 * per-entry half never opened for it and the boot rolled back. The major-step
 * half replays every retired entry of step 18 for that floor.
 *
 * The window's version boundaries — the prerelease labels, GA, 18.0.1, a
 * non-first-release floor — and both directions over every step-18 entry are
 * pinned in `@objectstack/metadata-core`'s `artifact-forward-conversion.test.ts`
 * with injected labels. This file pins the real door on this tree's installed
 * label: the artifact boots, the conversion is named once, and the same
 * artifact built after the retirement boots with nothing converted.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveInstalledSpecVersion } from '@objectstack/metadata-core';
import { MetadataPlugin } from './plugin.js';

const SUBJECT = 'declared-index-unique-scope';

/** A `^18` artifact; `unique: true` is the shape the subject retires, `'global'` its canonical spelling. */
function artifact(unique: unknown): any {
    return {
        manifest: {
            id: 'com.example.prerelease-probe', namespace: 'pre', name: 'prerelease_probe', version: '1.0.0', type: 'app',
            engines: { protocol: '^18' },
        },
        objects: [{
            name: 'pre_contact', label: 'Contact',
            fields: { email: { type: 'text', label: 'Email' } },
            indexes: [{ name: 'pre_contact_email', fields: ['email'], unique }],
        }],
    };
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

/** Order two versions by their leading `x.y.z` (a prerelease tail is ignored). */
function compareVersions(a: string, b: string): number {
    const triple = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10));
    const [x, y] = [triple(a), triple(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
    return 0;
}

/** The conversion summary lines the door logged, keyed by conversion id. */
function conversionWarns(ctx: any): Map<string, string[]> {
    const byId = new Map<string, string[]>();
    for (const [line] of ctx.logger.warn.mock.calls as [string][]) {
        const id = /ADR-0087 conversion '([a-z0-9-]+)'/.exec(String(line))?.[1];
        if (!id) continue;
        byId.set(id, [...(byId.get(id) ?? []), String(line)]);
    }
    return byId;
}

describe('[#23001] artifact door — a ^18 artifact built during the v18 prerelease boots on a later runtime', () => {
    it('boots: the object registers with the retired spelling converted to its canonical scope', async () => {
        const plugin = newPlugin();
        const total = await plugin._parseAndRegisterArtifact(fakeCtx(), artifact(true), 'prerelease-probe');
        expect(total).toBeGreaterThan(0);

        const object = await plugin.manager.get('object', 'pre_contact');
        expect(object, 'the object registers').toBeDefined();
        expect((object as any).indexes).toEqual([{ name: 'pre_contact_email', fields: ['email'], unique: 'global' }]);
    });

    it('logs one summary naming the conversion and its site count, with the clause of the half that opened it', async () => {
        const plugin = newPlugin();
        const ctx = fakeCtx();
        await plugin._parseAndRegisterArtifact(ctx, artifact(true), 'prerelease-probe');

        const warns = conversionWarns(ctx);
        expect([...warns.keys()]).toEqual([SUBJECT]);
        expect(warns.get(SUBJECT)).toHaveLength(1);
        const [line] = warns.get(SUBJECT)!;
        expect(line).toContain('1 site(s)');
        expect(line).toContain('objects[0].indexes[0].unique');

        // WHICH half opened it is decided by the installed label, and the
        // version pass moves that label, so the clause is pinned per half. At or
        // below 18.0.0 (this tree's 17.x label, every 18.0.0 prerelease, GA) the
        // floor is not below the label: the line names the floor as the first
        // release of protocol 18 and never claims the artifact "predates" a
        // runtime printed below it. From 18.0.1 on the label half opened it, and
        // "predates" is exactly the claim the line owes.
        const installed = resolveInstalledSpecVersion();
        expect(installed).toMatch(/^\d+\.\d+\.\d+/); // spec is always resolvable here
        if (compareVersions(installed!, '18.0.0') > 0) {
            expect(line).toContain(`predates this runtime's spec (authored engines.protocol floor 18.0.0, runtime spec ${installed})`);
        } else {
            expect(line).not.toContain("predates this runtime's spec");
            expect(line).toContain('declares the first release of protocol 18 (authored engines.protocol floor 18.0.0)');
            expect(line).toContain(`runtime spec ${installed}`);
        }
    });

    it('the same artifact built after the retirement boots with nothing converted and nothing logged', async () => {
        const plugin = newPlugin();
        const ctx = fakeCtx();
        const total = await plugin._parseAndRegisterArtifact(ctx, artifact('global'), 'prerelease-probe-current');
        expect(total).toBeGreaterThan(0);
        expect([...conversionWarns(ctx).keys()]).toEqual([]);

        const object = await plugin.manager.get('object', 'pre_contact');
        expect((object as any).indexes).toEqual([{ name: 'pre_contact_email', fields: ['email'], unique: 'global' }]);
    });
});
