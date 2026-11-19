// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D4, #33308] `diffMetaItem`, the third door of the history
 * family, reads the row slot the history and rollback doors read
 * (`historySlotOf`), judged against a fake host so each arm is pinned on its
 * own:
 *
 *  - bare, a name two row slots hold is refused `409` naming both, before any
 *    version is read;
 *  - `?package=P` compares P's versions alone: the default `to` side is P's
 *    own active row, the default `from` side is found among P's versions, and
 *    a named version another holder owns (or one attributed to no package,
 *    while two hold the name) is refused `404 VERSION_NOT_FOUND` saying whose;
 *  - `?package=` naming a package that neither holds nor ships the name is
 *    refused `409 not-held-by-qualifier`; the environment's slot addressed
 *    through a package (the read falls back to the package-less row) takes
 *    that row as its `to` side;
 *  - CONTROL: a name one slot holds diffs bare as before, its whole log;
 *  - `?package=` on a type not stored per package is refused `400`.
 *
 * The real-boot pins live in `history-diff-two-holders-33308.dogfood.test.ts`.
 */

import { describe, expect, it } from 'vitest';
// The source reaches `@objectstack/lint` lazily; pay that load at collection, never in a clocked case.
import '@objectstack/lint';
import { PackageScopedNameRefusedError } from '@objectstack/core';
import { ENVIRONMENT_HISTORY_MARK } from '@objectstack/metadata';
import { ProtocolDiffDeleteLoadFacet } from './protocol-diff-delete-load.js';

const ALPHA = 'com.acme.alpha.custom';
const BETA = 'com.acme.beta.custom';
const body = (label: string) => ({ name: 'shared_flow', label });

/** v1 alpha, v2 beta, v3 alpha, v4 beta, v5 attributed to no package. */
const HISTORY = [
    { version: 1, package_id: ALPHA, metadata: JSON.stringify(body('alpha r1')) },
    { version: 2, package_id: BETA, metadata: JSON.stringify(body('beta r1')) },
    { version: 3, package_id: ALPHA, metadata: JSON.stringify(body('alpha r2')) },
    { version: 4, package_id: BETA, metadata: JSON.stringify(body('beta r2')) },
    { version: 5, metadata: JSON.stringify(body('legacy')) },
];

/** Beta's row first, so a read that picks the name's first active row picks the wrong holder for alpha. */
const ACTIVE = [
    { package_id: BETA, version: 4, state: 'active', metadata: JSON.stringify(body('beta r2')) },
    { package_id: ALPHA, version: 3, state: 'active', metadata: JSON.stringify(body('alpha r2')) },
];

function fakeHost(options: { candidates: string[]; unbound?: boolean; history?: unknown[]; active?: unknown[] }) {
    const reads: string[] = [];
    const host: any = {
        engine: { registry: { readsByPackage: () => true, resolveItem: () => ({ status: 'resolved' }) } },
        packagelessAddress: async () => ({ candidates: options.candidates, unbound: options.unbound ?? false }),
        // The row a read naming the package serves: its own, else the package-less row it falls back to.
        findServedOverlayRow: async (q: { packageId: string }) => {
            const active: any[] = (options.active ?? ACTIVE) as any[];
            const row = active.find((r) => r.package_id === q.packageId) ?? active.find((r) => r.package_id === undefined);
            return row === undefined ? undefined : { row };
        },
        shippedArtifactsOf: () => [],
        resolveRowlessExpandedView: async () => undefined,
        rethrowUnlessMetadataStoreUnprovisioned: (error: unknown) => { throw error; },
        findEnvironmentRows: async (table: string) => {
            reads.push(table);
            return table === 'sys_metadata_history'
                ? (options.history ?? HISTORY).map((r: any) => ({ type: 'flow', name: 'shared_flow', ...r }))
                : (options.active ?? ACTIVE);
        },
        findEnvironmentRow: async (table: string) => {
            reads.push(table);
            return (options.active ?? ACTIVE)[0] ?? null;
        },
    };
    host.diffMetaItem = (request: any) => ProtocolDiffDeleteLoadFacet.diffMetaItem(host, request);
    return { host, reads };
}

async function refusalOf(p: Promise<unknown>): Promise<any> {
    return p.then(() => null, (e: unknown) => e);
}

const label = (answer: any) => answer.changed.find((e: any) => e.path === 'label');

describe('diffMetaItem reads one holder\'s versions of a by-package name (#33308)', () => {
    it('bare, a name two row slots hold is refused 409 naming both, before any version is read', async () => {
        const { host, reads } = fakeHost({ candidates: [ALPHA, BETA] });
        for (const request of [{}, { fromVersion: 1, toVersion: 2 }]) {
            const err = await refusalOf(host.diffMetaItem({ type: 'flow', name: 'shared_flow', ...request }));
            expect(err, JSON.stringify(request)).toBeInstanceOf(PackageScopedNameRefusedError);
            expect(err.code).toBe('RESOURCE_CONFLICT');
            expect(err.status).toBe(409);
            expect(err.refusal.candidates.map((c: any) => c.packageId)).toEqual([ALPHA, BETA]);
        }
        expect(reads).toEqual([]);
    });

    it('?package= compares that holder\'s own active row against its own nearest earlier version', async () => {
        const { host } = fakeHost({ candidates: [ALPHA, BETA] });
        const alpha = await host.diffMetaItem({ type: 'flow', name: 'shared_flow', packageId: ALPHA });
        expect([alpha.fromVersion, alpha.toVersion]).toEqual([1, 3]);
        expect(label(alpha)).toEqual({ path: 'label', from: 'alpha r1', to: 'alpha r2' });
        const beta = await host.diffMetaItem({ type: 'flow', name: 'shared_flow', packageId: BETA });
        expect([beta.fromVersion, beta.toVersion]).toEqual([2, 4]);
        expect(label(beta)).toEqual({ path: 'label', from: 'beta r1', to: 'beta r2' });
    });

    it('?package= with a named range of its own versions answers it', async () => {
        const { host } = fakeHost({ candidates: [ALPHA, BETA] });
        const answer = await host.diffMetaItem({ type: 'flow', name: 'shared_flow', packageId: ALPHA, fromVersion: 1, toVersion: 3 });
        expect(label(answer)).toEqual({ path: 'label', from: 'alpha r1', to: 'alpha r2' });
    });

    it('?package= refuses a version another holder owns 404 saying whose, on either side', async () => {
        const { host } = fakeHost({ candidates: [ALPHA, BETA] });
        for (const request of [{ fromVersion: 2, toVersion: 3 }, { fromVersion: 1, toVersion: 4 }, { fromVersion: 2 }]) {
            const err = await refusalOf(host.diffMetaItem({ type: 'flow', name: 'shared_flow', packageId: ALPHA, ...request }));
            expect(err?.code, JSON.stringify(request)).toBe('VERSION_NOT_FOUND');
            expect(err.status).toBe(404);
            expect(err.message).toContain(`package '${BETA}'`);
        }
    });

    it('?package= refuses a version attributed to no package while two hold the name', async () => {
        const { host } = fakeHost({ candidates: [ALPHA, BETA] });
        const err = await refusalOf(host.diffMetaItem({ type: 'flow', name: 'shared_flow', packageId: ALPHA, fromVersion: 5 }));
        expect(err?.code).toBe('VERSION_NOT_FOUND');
        expect(err.status).toBe(404);
    });

    it('?package= on a slot no row holds compares nothing on the to side and finds no earlier version', async () => {
        const { host } = fakeHost({ candidates: [ALPHA, BETA], active: [ACTIVE[0]] });
        const answer = await host.diffMetaItem({ type: 'flow', name: 'shared_flow', packageId: ALPHA });
        expect([answer.fromVersion, answer.toVersion]).toEqual([null, null]);
    });

    it('CONTROL: a name one slot holds diffs bare across its whole log, as before', async () => {
        const history = HISTORY.filter((r) => r.package_id !== BETA);
        const active = [ACTIVE[1]];
        const { host } = fakeHost({ candidates: [ALPHA], history, active });
        const range = await host.diffMetaItem({ type: 'flow', name: 'shared_flow' });
        expect([range.fromVersion, range.toVersion]).toEqual([1, 3]);
        // The unattributed version is the sole slot's.
        const legacy = await host.diffMetaItem({ type: 'flow', name: 'shared_flow', fromVersion: 5, toVersion: 3 });
        expect(label(legacy)).toEqual({ path: 'label', from: 'legacy', to: 'alpha r2' });
    });

    it('?package= naming a package that neither holds nor ships the name is refused 409 not-held-by-qualifier, before any version is read', async () => {
        const { host, reads } = fakeHost({ candidates: [ALPHA, BETA] });
        const err = await refusalOf(host.diffMetaItem({ type: 'flow', name: 'shared_flow', packageId: 'com.acme.gamma' }));
        expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
        expect(err.code).toBe('RESOURCE_CONFLICT');
        expect(err.status).toBe(409);
        expect(err.refusal.reason).toBe('not-held-by-qualifier');
        expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: ALPHA }, { kind: 'package', packageId: BETA }]);
        expect(reads).toEqual([]);
    });

    it('the environment\'s slot addressed through a package: the package-less row is the to side, never the bound one', async () => {
        // Alpha's row first, so a read that picks the name's first active row picks the wrong slot.
        const active = [
            { package_id: ALPHA, version: 3, state: 'active', metadata: JSON.stringify(body('alpha r1')) },
            { version: 2, state: 'active', metadata: JSON.stringify(body('env r2')) },
        ];
        const history = [
            { version: 1, package_id: ENVIRONMENT_HISTORY_MARK, metadata: JSON.stringify(body('env r1')) },
            { version: 2, package_id: ENVIRONMENT_HISTORY_MARK, metadata: JSON.stringify(body('env r2')) },
            { version: 3, package_id: ALPHA, metadata: JSON.stringify(body('alpha r1')) },
        ];
        const { host } = fakeHost({ candidates: [ALPHA], unbound: true, history, active });
        const bare = await refusalOf(host.diffMetaItem({ type: 'flow', name: 'shared_flow' }));
        expect(bare.refusal.candidates).toEqual([{ kind: 'package', packageId: ALPHA }, { kind: 'environment' }]);
        const env = await host.diffMetaItem({ type: 'flow', name: 'shared_flow', packageId: BETA });
        expect([env.fromVersion, env.toVersion]).toEqual([1, 2]);
        expect(label(env)).toEqual({ path: 'label', from: 'env r1', to: 'env r2' });
        const err = await refusalOf(host.diffMetaItem({ type: 'flow', name: 'shared_flow', packageId: BETA, toVersion: 3 }));
        expect(err?.code).toBe('VERSION_NOT_FOUND');
        expect(err.message).toContain(`package '${ALPHA}'`);
    });

    it('?package= on a type not stored per package is refused 400 VALIDATION_ERROR naming the parameter', async () => {
        const { host, reads } = fakeHost({ candidates: [] });
        const err = await refusalOf(host.diffMetaItem({ type: 'view', name: 'any_view', packageId: ALPHA }));
        expect(err?.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(err.param).toBe('package');
        expect(reads).toEqual([]);
    });
});
