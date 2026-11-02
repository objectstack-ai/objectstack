// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0010] The registration door and the build door judge a collection
 * item's body `_packageId` with ONE judge (`judgeCollectionItemOwnerStamp`,
 * `@objectstack/spec/kernel`), so the two cannot disagree. This file holds
 * them equal from the registration side:
 *
 *  - the same stamp gets the same verdict at both doors — `registerApp`
 *    (boot / install) and the stack schema's parse (`defineStack`,
 *    `os validate`, `os build`) — and each door's words are the judge's own;
 *  - the build door judges exactly the collections `registerApp` refuses a
 *    foreign stamp in (`OWNER_STAMP_JUDGED_COLLECTIONS`), key by key over the
 *    stack schema's whole key set, so the build door neither misses a
 *    collection the boot refuses nor refuses one the boot accepts.
 *
 * The registration door's envelope and its exemption for a stamp a
 * registration wrote stay pinned in `collection-item-owner-stamp.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackDefinitionSchema, STACK_DEFINITION_KEYS } from '@objectstack/spec';
import { judgeCollectionItemOwnerStamp, OWNER_STAMP_JUDGED_COLLECTIONS } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';

const PKG = 'com.probe.pkg';
const FOREIGN = 'com.probe.host';

const connector = (stamp?: unknown) => ({
    name: 'probe_conn',
    label: 'Probe',
    type: 'api',
    provider: 'openapi',
    providerConfig: { spec: './specs/billing.json' },
    ...(stamp === undefined ? {} : { _packageId: stamp }),
});

/** The registration door's answer: the thrown error, or `undefined`. */
function boot(body: Record<string, unknown>): any {
    try {
        new ObjectQL().registerApp(body as any);
        return undefined;
    } catch (e) {
        return e;
    }
}

/** The build door's answer: the parse's issues at a `_packageId`. */
function build(stack: Record<string, unknown>) {
    const result = ObjectStackDefinitionSchema.safeParse(stack);
    return result.success ? [] : result.error.issues.filter((i) => i.path[i.path.length - 1] === '_packageId');
}

describe('[ADR-0010] one verdict at the registration door and the build door', () => {
    const manifest = { id: PKG, name: 'probe', namespace: 'probe', version: '1.0.0', type: 'app' };

    it('a foreign stamp, `\'\'`, an equal stamp and no stamp: refused at both or accepted at both', () => {
        const cases: Array<[unknown, boolean]> = [[FOREIGN, true], ['', true], [PKG, false], [undefined, false]];
        for (const [stamp, refused] of cases) {
            const atBoot = boot({ ...manifest, connectors: [connector(stamp)] });
            const atBuild = build({ manifest, connectors: [connector(stamp)] });
            const label = `stamp ${JSON.stringify(stamp)}`;
            if (!refused) {
                expect(atBoot, label).toBeUndefined();
                expect(atBuild, label).toEqual([]);
                continue;
            }
            expect(atBoot, label).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
            expect(atBoot.issues, label).toEqual([{ path: '_packageId', code: 'custom', message: expect.any(String) }]);
            expect(atBuild.map((i) => [i.path.join('.'), i.code]), label).toEqual([['connectors.0._packageId', 'custom']]);
            // Each door's words are the one judge's, for its own door.
            const judged = (door: 'build' | 'register') => judgeCollectionItemOwnerStamp(connector(stamp), 'connector', 'probe_conn', PKG, door)!;
            expect(atBoot.message, label).toBe(judged('register').message);
            expect(atBoot.issues[0].message, label).toBe(judged('register').issueMessage);
            expect(atBuild[0].message, label).toBe(judged('build').message);
        }
    });

    it('`null`: refused at both — by the judge at boot, by the item schema\'s type check at build, both at `_packageId`', () => {
        expect(boot({ ...manifest, connectors: [connector(null)] })).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
        expect(build({ manifest, connectors: [connector(null)] }).map((i) => [i.path.join('.'), i.code]))
            .toEqual([['connectors.0._packageId', 'invalid_type']]);
    });
});

describe('[ADR-0010] the build door judges exactly the collections the registration door refuses a foreign stamp in', () => {
    it('key by key over the stack schema\'s whole key set', () => {
        const refusedAtBoot: string[] = [];
        for (const key of STACK_DEFINITION_KEYS) {
            const probe = { name: 'probe_item', object: 'probe_item', records: [], _packageId: FOREIGN };
            const error = boot({ id: PKG, name: 'probe', [key]: [probe] });
            const atStamp = error?.code === 'VALIDATION_ERROR'
                && Array.isArray(error.issues) && error.issues.some((i: any) => i?.path === '_packageId');
            if (atStamp) refusedAtBoot.push(key);
        }
        expect(refusedAtBoot.sort()).toEqual([...OWNER_STAMP_JUDGED_COLLECTIONS].sort());
    });
});
