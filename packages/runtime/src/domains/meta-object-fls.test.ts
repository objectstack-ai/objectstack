// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 / #3682] The dispatcher's `/metadata` catch-all serves object
 * schemas through five resolvers, and every one of them is driven through the
 * SAME case table the REST suite uses
 * (`@objectstack/metadata-core/testing`).
 *
 * D5(3) names two of them ("protocol 与 registry 两条查找路径"); the sweep found
 * three more that answer an object schema by a different door — the last-ditch
 * protocol read for unscoped kernels, the `/metadata/objects` list, and the
 * legacy one-segment `/metadata/:objectName` spelling. All five are here, so a
 * caller cannot pick a door that forgot the mask. That is not hypothetical for
 * this particular fan-out: #6562 already records the registry-backed and
 * overlay-backed reads answering *different field sets* for the same object.
 *
 * The invariant is the same sentence the REST suite pins: for a restricted
 * caller an unreadable field is COMPLETELY ABSENT — no third, quieter answer.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    OBJECT_SCHEMA_MASK_CASES,
    FLS_CONTRACT_OBJECT,
    assertObjectSchemaMaskCase,
    securityDoubleFor,
    type ObjectSchemaMaskCase,
    type ObjectSchemaMaskExit,
    type ObjectSchemaMaskOutcome,
} from '@objectstack/metadata-core/testing';
import { OBJECT_SCHEMA_MASK_DISABLE_ENV, isObjectSchemaMaskExempt } from '@objectstack/metadata-core';
import { HttpDispatcher } from '../http-dispatcher.js';

const account = () => JSON.parse(JSON.stringify(FLS_CONTRACT_OBJECT));

function make(services: Record<string, any>) {
    const kernel = {
        getServiceAsync: async (name: string) => services[name] ?? null,
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    } as any;
    return new HttpDispatcher(kernel);
}

const ctxFor = (testCase: ObjectSchemaMaskCase): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { ...testCase.context },
});

/**
 * Run one dispatcher request under a case's deployment, translating the answer
 * into the contract's `document | fault` outcome.
 *
 * `maskingDisabled` is the D8 escape hatch: the dispatcher has no per-server
 * REST config to read, so its knob is the environment variable — which is also
 * the knob a deployment uses to turn BOTH surfaces off at once.
 */
async function runExit(
    testCase: ObjectSchemaMaskCase,
    services: Record<string, any>,
    path: string,
    pick: (data: any) => unknown,
): Promise<ObjectSchemaMaskOutcome> {
    const security = securityDoubleFor(testCase);
    const previous = process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
    if (testCase.maskingDisabled) process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = '1';
    else delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
    try {
        const dispatcher = make({ ...services, ...(security ? { security } : {}) });
        const res = await dispatcher.handleMetadata(path, ctxFor(testCase), 'GET');
        const status = res.response.status;
        if (status >= 400) return { kind: 'fault', status };
        return { kind: 'document', document: pick(res.response.body.data) };
    } finally {
        if (previous === undefined) delete process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV];
        else process.env[OBJECT_SCHEMA_MASK_DISABLE_ENV] = previous;
    }
}

const EXITS: ObjectSchemaMaskExit[] = [
    {
        name: '/metadata/object/:name — protocol-backed (scoped kernel)',
        run: (testCase) => runExit(
            testCase,
            {
                protocol: {
                    getProjectId: () => 'env_1',
                    getMetaItem: vi.fn(async ({ type, name }: any) => ({ type, name, item: account(), lock: 'none' })),
                },
            },
            '/object/account',
            (data) => data?.item,
        ),
    },
    {
        name: '/metadata/object/:name — registry-backed fallback',
        run: (testCase) => runExit(
            testCase,
            { objectql: { registry: { getObject: vi.fn(() => account()) } } },
            '/object/account',
            (data) => data?.item,
        ),
    },
    {
        name: '/metadata/object/:name — last-ditch protocol read (unscoped kernel, registry miss)',
        run: (testCase) => runExit(
            testCase,
            {
                protocol: {
                    getMetaItem: vi.fn(async ({ type, name }: any) => ({ type, name, item: account(), lock: 'none' })),
                },
                objectql: { registry: { getObject: vi.fn(() => undefined) } },
            },
            '/object/account',
            (data) => data?.item,
        ),
    },
    {
        name: '/metadata/objects — protocol-backed list read',
        run: (testCase) => runExit(
            testCase,
            { protocol: { getMetaItems: vi.fn(async () => ({ type: 'object', items: [account()] })) } },
            '/objects',
            (data) => data?.items?.[0],
        ),
    },
    {
        name: '/metadata/objects — registry-backed list read',
        run: (testCase) => runExit(
            testCase,
            { objectql: { registry: { getAllObjects: vi.fn(() => [account()]) } } },
            '/objects',
            (data) => data?.items?.[0],
        ),
    },
    {
        name: '/metadata/:objectName — legacy one-segment object read',
        run: (testCase) => runExit(
            testCase,
            {
                objectql: {
                    registry: {
                        getAllObjects: vi.fn(() => []),
                        listItems: vi.fn(() => []),
                        getObject: vi.fn((name: string) => (name === 'account' ? account() : undefined)),
                    },
                },
            },
            '/account',
            (data) => data,
        ),
    },
];

describe('[ADR-0106] dispatcher /metadata object-schema masking — one contract, every resolver', () => {
    for (const exit of EXITS) {
        describe(exit.name, () => {
            for (const testCase of OBJECT_SCHEMA_MASK_CASES) {
                it(testCase.id, async () => {
                    const outcome = await exit.run(testCase);
                    assertObjectSchemaMaskCase(exit.name, testCase, outcome);
                });
            }
        });
    }
});

describe('[ADR-0106 D6 tier 3] a masking fault is not a lookup miss', () => {
    it('a throwing security service does NOT fall through to the registry`s unmasked copy', async () => {
        // The scoped-protocol branch swallows its own errors and falls through
        // to the registry. If the fault took that path, the caller would get
        // the full schema back through the very fallback the refusal exists to
        // prevent — so the fault returns from INSIDE the try.
        const getObject = vi.fn(() => account());
        const testCase: ObjectSchemaMaskCase = {
            id: 'runtime/throws', why: 'D6 tier 3', context: { userId: 'u' },
            readable: 'throw', expect: { kind: 'fault' },
        };
        const dispatcher = make({
            protocol: {
                getProjectId: () => 'env_1',
                getMetaItem: vi.fn(async ({ type, name }: any) => ({ type, name, item: account() })),
            },
            objectql: { registry: { getObject } },
            security: securityDoubleFor(testCase),
        });

        const res = await dispatcher.handleMetadata('/object/account', ctxFor(testCase), 'GET');

        expect(res.response.status).toBe(503);
        expect(getObject).not.toHaveBeenCalled();
        expect(JSON.stringify(res.response.body)).not.toContain('salary_grade');
    });
});

/**
 * [ADR-0106 D5(4) / #6599] `GET /metadata/_drafts` — the dispatcher face of the
 * same authoring gate the REST `/meta/_drafts` route carries
 * (`packages/rest/src/meta-object-fls.test.ts`). Not masked like the five
 * resolvers above: a pending-drafts list is an AUTHORING surface, so it GATES
 * per caller on the SAME D4 exemption predicate the mask uses
 * (`isObjectSchemaMaskExempt`) and 403s a non-author.
 *
 * Driven through the SAME `OBJECT_SCHEMA_MASK_CASES` table as its REST twin —
 * the point the card makes about a two-face contract: one shared case list, so
 * the two transports cannot drift on "who is an author" without a red test.
 * Separate block, not one more `EXITS` row, for the same reason the REST twin
 * is: the gate's contract (403 for a restricted caller) is not the mask's
 * (a masked document), so `assertObjectSchemaMaskCase` does not apply.
 *
 * The runtime transport derives its ADR-0112 code from the 403 status
 * (`PERMISSION_DENIED`), matching `_migrate-stored`'s next-door precedent — the
 * deliberate spelling difference from the REST twin's `FORBIDDEN`, not a drift.
 */
async function runDraftsExit(testCase: ObjectSchemaMaskCase) {
    const dispatcher = make({
        protocol: {
            // Serves the pending object draft verbatim — full `fields`, sensitive
            // one included — so an author reads it and a non-author must be
            // refused BEFORE it is reached.
            listDrafts: vi.fn(async () => [{ type: 'object', name: 'account', item: account() }]),
        },
    });
    return dispatcher.handleMetadata('/_drafts', ctxFor(testCase), 'GET');
}

describe('[ADR-0106 D5(4)] GET /metadata/_drafts — per-caller authoring gate', () => {
    for (const testCase of OBJECT_SCHEMA_MASK_CASES) {
        it(testCase.id, async () => {
            const res = await runDraftsExit(testCase);
            const wire = JSON.stringify(res.response.body);

            if (isObjectSchemaMaskExempt(testCase.context)) {
                // An author reads the drafts unfiltered — the gate masks nothing.
                expect(res.response.status).toBe(200);
                expect(wire).toContain('salary_grade');
            } else {
                // ADR-0112 envelope: code AND status, not just "it 403s".
                expect(res.response.status).toBe(403);
                expect(res.response.body?.error?.code).toBe('PERMISSION_DENIED');
                // The refusal discloses nothing — no hidden field leaks out.
                expect(wire).not.toContain('salary_grade');
            }
        });
    }
});
