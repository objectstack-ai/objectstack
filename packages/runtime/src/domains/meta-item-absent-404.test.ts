// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18401] `GET /meta/:type/:name` on the dispatcher's `/meta` domain, for a
 * name with NOTHING behind it — on the GENERIC `:type/:name` branch.
 *
 * The generic branch returned `protocol.getMetaItem`'s answer straight through
 * with `deps.success(data)`. That producer answers a miss with the protection
 * envelope wrapped around an absent item — `{ type, name, item: undefined,
 * lock, editable, deletable, resettable }`, because `resolveLockState(undefined,
 * false)` is unconditional — never with `undefined`. So the miss arrived at the
 * caller as a `200`, and `JSON.stringify` at the transport dropped the `item`
 * member on the way out: the declared envelope MINUS its required member,
 * announced as a hit.
 *
 * ── Why this is execution and not a design question ─────────────────────────
 *
 * Three declarations already agreed with each other and against this one
 * branch; only the branch was wrong.
 *
 *  1. The `object` branch of the SAME function refuses the identical shape
 *     ("only treat the lookup as a hit when `item` is really there") and 404s.
 *     §3 below pins the two branches answering one question one way.
 *  2. `GetMetaItemResponseSchema` declares `item` a required member while every
 *     genuinely-optional key beside it is spelled `.optional()`. §2 asserts that
 *     against the wire body rather than restating it.
 *  3. The REST twin of this door refuses the same shape (#18066).
 *
 * ── What this file deliberately does NOT do ─────────────────────────────────
 *
 * It adds no refusal DIALECT. The fall-through ends at the branch's own
 * `deps.error('Not found', 404)` — the ADR-0112 nested `{ success:false,
 * error:{ code, message, httpStatus } }` this file already speaks everywhere —
 * so the three-dialect question #18402 raises about this route is neither
 * answered nor pre-empted here.
 */

import { describe, it, expect, vi } from 'vitest';
import { GetMetaItemResponseSchema } from '@objectstack/spec/api';
import { HttpDispatcher } from '../http-dispatcher.js';

const AGENT = { name: 'triage_bot', label: 'Triage Bot', model: 'claude' };
const CUSTOMER = { name: 'customer', label: 'Customer', fields: { id: { type: 'text' } } };

/**
 * ⭐ THE FIXTURE THAT MATTERS: what `metadata-protocol`'s `getMetaItem` really
 * resolves for a miss, key for key — the envelope with `item` present and
 * holding `undefined`, NOT `undefined` itself. A double that answers
 * `undefined` never reproduces this defect, because it never had an envelope to
 * lose a member from.
 */
function absentItemEnvelope(type: string, name: string) {
    return {
        type, name,
        item: undefined,
        lock: 'none', editable: true, deletable: true, resettable: false,
    };
}

/** Build a dispatcher whose kernel resolves exactly the named services. */
function make(services: Record<string, any>) {
    const kernel = {
        getServiceAsync: async (name: string) => services[name] ?? null,
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    } as any;
    return new HttpDispatcher(kernel);
}

const ctx = (): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u1', systemPermissions: [] },
});

/**
 * A protocol double whose `getMetaItem` knows `corpus` and answers
 * {@link absentItemEnvelope} — the live producer's miss — for anything else.
 */
function protocolDouble(corpus: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    return {
        getMetaItem: vi.fn(async ({ type, name }: any) => {
            const hit = corpus[`${type}/${name}`];
            return hit === undefined
                ? absentItemEnvelope(type, name)
                : { type, name, item: hit, lock: 'none', editable: true, deletable: true, resettable: false };
        }),
        ...extra,
    };
}

/** The wire body, after the serialization that drops an `undefined` member. */
const onWire = (body: any) => JSON.parse(JSON.stringify(body));

type Answered = NonNullable<Awaited<ReturnType<HttpDispatcher['handleMetadata']>>['response']>;

/**
 * The dispatcher's answer, or a loud failure. The optional-chained
 * `res.response?.` spelling is what the siblings in this directory use, but
 * every NEGATIVE assertion below
 * (`toBeUndefined()`, `not.toBe(200)`) passes vacuously against an unhandled
 * result, which is the one outcome that must not read as a pass here. So this
 * file refuses the optional rather than reaching through it.
 */
function answered(res: { response?: Answered }): Answered {
    if (!res.response) throw new Error('the dispatcher did not handle the request - there is no answer to assert on');
    return res.response;
}

describe('#18401 dispatcher /meta generic branch — an item-less envelope is a MISS, not a success', () => {
    it('§1 refuses an absent name with 404 RESOURCE_NOT_FOUND instead of the item-less 200', async () => {
        const protocol = protocolDouble();
        const res = await make({ protocol }).handleMetadata('/agent/no_such_agent_xyz', ctx(), 'GET');

        // The refusal comes from the item-less guard, not from an absent
        // protocol handle: the producer really was consulted.
        expect(protocol.getMetaItem).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'agent', name: 'no_such_agent_xyz' }),
        );
        const answer = answered(res);
        expect(answer.status).toBe(404);
        // ADR-0112 nested envelope: `code` and `status` are the minimal pin.
        expect(answer.body.error.code).toBe('RESOURCE_NOT_FOUND');
        expect(answer.body.error.httpStatus).toBe(404);
        expect(answer.body.success).toBe(false);
    });

    it('§2 the item-less envelope never reaches the wire as a 200 — it does not satisfy the response contract', async () => {
        const res = await make({ protocol: protocolDouble() })
            .handleMetadata('/agent/no_such_agent_xyz', ctx(), 'GET');

        // The shape the branch used to serve, measured against the schema the
        // route declares. Asserted here so the pin states WHY 200 was wrong,
        // not merely that the number changed.
        const wouldHaveShipped = onWire(absentItemEnvelope('agent', 'no_such_agent_xyz'));
        expect('item' in wouldHaveShipped).toBe(false);
        expect(GetMetaItemResponseSchema.safeParse(wouldHaveShipped).success).toBe(false);

        // And it is not what the caller gets.
        const answer = answered(res);
        expect(answer.status).not.toBe(200);
        expect(answer.body.data).toBeUndefined();
    });

    it('§3 the `object` branch and the generic branch answer absence THE SAME WAY (the finding)', async () => {
        // Same function, same question, entered through two different types.
        // `getProjectId` puts the object branch on its scoped path — the one
        // that consults the protocol first, exactly as the generic branch does.
        const generic = await make({ protocol: protocolDouble() })
            .handleMetadata('/agent/nobody_home', ctx(), 'GET');
        const object = await make({ protocol: protocolDouble({}, { getProjectId: () => 'env_1' }) })
            .handleMetadata('/object/nobody_home', ctx(), 'GET');

        const g = answered(generic);
        const o = answered(object);
        expect(g.status).toBe(o.status);
        expect(g.body.error.code).toBe(o.body.error.code);
        expect(g.status).toBe(404);
    });

    it('§4 an item-less protocol answer FALLS THROUGH to the MetadataService rather than terminating the read', async () => {
        // The guard is a miss test, not a hard refusal: the later resolvers in
        // the chain must still get their turn, the way the object branch's
        // registry fallback does.
        const protocol = protocolDouble();
        const getItem = vi.fn(async () => AGENT);
        const res = await make({ protocol, metadata: { getItem } })
            .handleMetadata('/agents/triage_bot', ctx(), 'GET');

        expect(protocol.getMetaItem).toHaveBeenCalled();
        expect(getItem).toHaveBeenCalled();
        const answer = answered(res);
        expect(answer.status).toBe(200);
        // The plural URL segment still resolves to the canonical singular.
        expect(answer.body.data).toMatchObject({ type: 'agent', name: 'triage_bot' });
        expect(answer.body.data.item).toMatchObject({ label: 'Triage Bot', model: 'claude' });
    });

    it('§5 a real hit is untouched — the whole protection envelope still passes through', async () => {
        // The control: if the guard were reading the wrong member, or reading it
        // too strictly, this is the assertion that fails. Every value read comes
        // from INSIDE the answer, so a vacuous pass is not available.
        const protocol = protocolDouble({ 'agent/triage_bot': AGENT });
        const res = await make({ protocol }).handleMetadata('/agent/triage_bot', ctx(), 'GET');

        const answer = answered(res);
        expect(answer.status).toBe(200);
        expect(answer.body.data).toMatchObject({
            type: 'agent', name: 'triage_bot', lock: 'none', editable: true, deletable: true,
        });
        expect(answer.body.data.item).toMatchObject({ label: 'Triage Bot', model: 'claude' });
        // And the answer this branch DOES serve satisfies the route's declared
        // response contract on the wire, `item` member included.
        expect(GetMetaItemResponseSchema.safeParse(onWire(answer.body.data)).success).toBe(true);
    });

    it('§6 the object branch still serves its own hit — the sibling is not collateral', async () => {
        const protocol = protocolDouble({ 'object/customer': CUSTOMER }, { getProjectId: () => 'env_1' });
        const res = await make({ protocol }).handleMetadata('/object/customer', ctx(), 'GET');

        const answer = answered(res);
        expect(answer.status).toBe(200);
        expect(answer.body.data.item).toMatchObject({ label: 'Customer' });
    });
});
