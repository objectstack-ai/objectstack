// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D1 — request-side conformance for `POST /packages/:id/publish-drafts`:
 * what the door does with each member of the body
 * `PublishPackageDraftsRequestSchema` (`@objectstack/spec/api`) declares, and
 * with the members it does not declare.
 *
 * This is the coverage the ledger's `requestSchema` field is forbidden to be
 * written without (`route-ledger.ts`, the field's JSDoc), and the reason the
 * `POST /packages/:id/publish-drafts` row may carry
 * `requestSchema: 'PublishPackageDraftsRequestSchema'`. The request schema
 * declares the body; it does not claim the door parses the body with it. So
 * each member's behaviour at the door is pinned here as measured:
 *
 * - `message` — a string reaches `publishPackageDrafts` as sent; a non-string
 *   is dropped (the publish goes ahead with no note), not refused;
 * - `backfill` — reaches the protocol as sent, and a body the schema refuses
 *   is refused by the protocol's shape judgement `400 VALIDATION_ERROR`
 *   before anything is published (the real protocol, below);
 * - `actor` — never reaches `publishPackageDrafts`: the publisher is the
 *   authenticated caller. That is why the schema strips unknown keys instead
 *   of refusing them: the SDK's deprecated `opts.actor` keeps working.
 *
 * The protocol is a double for the forwarding cases (what it receives is the
 * assertion) and the real `ObjectStackProtocolImplementation` for the
 * refusal cases, whose shape judgement runs before any server state is read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublishPackageDraftsRequestSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from '../http-dispatcher.js';
import { ROUTE_LEDGER } from '../route-ledger.js';

const PKG = 'com.workspace';
const USER = 'u_pkg_admin';

/** `/packages` demands `manage_metadata` on every state-changing route. */
const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: USER,
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

const HAPPY = {
    success: true, outcome: 'published', publishedCount: 1, failedCount: 0,
    published: [{ type: 'view', name: 'notes_open', version: 'sha256:aa11' }], failed: [],
    commitId: 'cmt_01',
};

/**
 * A door over `protocol`. `apps` are the apps the ADR-0045 flip loop reads
 * back after the publish; none by default, so the only producer call a body
 * member can reach is `publishPackageDrafts` itself.
 */
function makeDoor(protocol: Record<string, unknown>, apps: Array<Record<string, unknown>> = []) {
    const getMetaItems = vi.fn().mockImplementation(async () => ({ items: apps.map((a) => ({ ...a })) }));
    const saveMetaItem = vi.fn().mockImplementation(async () => ({ ok: true }));
    const service = Object.assign(protocol, { getMetaItems, saveMetaItem });
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') return Promise.resolve(service);
            if (name === 'objectql') {
                return Promise.resolve({
                    insert: vi.fn(), find: vi.fn(), update: vi.fn(),
                    registry: { getAllPackages: vi.fn().mockReturnValue([]) },
                });
            }
            if (name === 'metadata') return Promise.resolve({ getObject: vi.fn() });
            return null;
        },
        context: { getService: () => null, trigger: vi.fn() },
    };
    return { dispatcher: new HttpDispatcher(kernel), saveMetaItem };
}

/** Publish `body` through the door over a protocol double; answer the wire response and what the protocol received. */
async function publishWith(body: unknown, apps?: Array<Record<string, unknown>>) {
    const publishPackageDrafts = vi.fn().mockImplementation(async () => JSON.parse(JSON.stringify(HAPPY)));
    const door = makeDoor({ publishPackageDrafts }, apps);
    const result = await door.dispatcher.handlePackages(`/${PKG}/publish-drafts`, 'POST', body, {}, PKG_ADMIN());
    expect(publishPackageDrafts).toHaveBeenCalledTimes(1);
    const sent = publishPackageDrafts.mock.calls[0]![0] as Record<string, unknown>;
    return { response: result.response as any, sent, saveMetaItem: door.saveMetaItem };
}

/** The request members of what the protocol received: everything but the path id and the caller's context. */
function bodyMembersSent(sent: Record<string, unknown>) {
    const { packageId, context, actor, ...rest } = sent;
    expect(packageId).toBe(PKG);
    expect(actor).toBe(USER);
    expect(context).toMatchObject({ userId: USER });
    return rest;
}

afterEach(() => vi.restoreAllMocks());

describe('publish-drafts request body conforms to PublishPackageDraftsRequestSchema (ADR-0146 D1)', () => {
    it('the ledger row names the schema this suite pins', () => {
        const row = ROUTE_LEDGER.find((e) => e.route === 'POST /packages/:id/publish-drafts');
        expect(row, 'the publish-drafts row must exist in ROUTE_LEDGER').toBeDefined();
        expect(row!.requestSchema).toBe('PublishPackageDraftsRequestSchema');
    });

    it('each body the schema accepts reaches the protocol as the schema parses it', async () => {
        const bodies: unknown[] = [
            {},
            { message: 'Split notes into open and closed lists' },
            { backfill: [{ object: 'crm_account', field: 'is_key' }] },
            { message: 'Add the key-account flag', backfill: [{ object: 'crm_account', field: 'is_key' }] },
            { message: '', backfill: [] },
        ];
        for (const body of bodies) {
            const parsed = PublishPackageDraftsRequestSchema.parse(body);
            const { response, sent } = await publishWith(body);
            expect(response.status, JSON.stringify(body)).toBe(200);
            expect(bodyMembersSent(sent), JSON.stringify(body)).toEqual(parsed);
        }
    });

    it('an absent body reads as `{}`: no note and no backfill', async () => {
        for (const body of [undefined, null]) {
            const { response, sent } = await publishWith(body);
            expect(response.status).toBe(200);
            expect(bodyMembersSent(sent)).toEqual({});
        }
    });

    it('a body `actor` is stripped by the schema and never reaches the publish: the caller is recorded (the SDK still sends it)', async () => {
        const body = { actor: 'someone_else', message: 'note' };
        expect(PublishPackageDraftsRequestSchema.parse(body)).toEqual({ message: 'note' });
        const { response, sent } = await publishWith(body);
        // Not refused: an existing `packages.publishDrafts({ actor })` call keeps working.
        expect(response.status).toBe(200);
        expect(sent.actor).toBe(USER);
        expect(bodyMembersSent(sent)).toEqual({ message: 'note' });
    });

    it('members the protocol method takes but the schema does not declare are not read from the body', async () => {
        const { sent } = await publishWith({ aiModel: 'some-model', context: { userId: 'u_other' }, packageId: 'com.other' });
        expect(sent.aiModel).toBeUndefined();
        expect(bodyMembersSent(sent)).toEqual({});
    });

    it('a note the schema refuses is dropped by the door, not refused: the publish goes ahead with no note', async () => {
        // Measured divergence: the schema declares `message` a string and the
        // door forwards only a string, but answers 200 for anything else. A
        // door that parses the body with the schema flips this pin to a 400.
        expect(PublishPackageDraftsRequestSchema.safeParse({ message: 42 }).success).toBe(false);
        const { response, sent } = await publishWith({ message: 42 });
        expect(response.status).toBe(200);
        expect(bodyMembersSent(sent)).toEqual({});
    });

    it('the ADR-0045 app re-save after the publish records the caller too: a body `actor` reaches no write', async () => {
        // [#28414] The visibility flip that re-saves each unpublished app
        // afterwards used to pass a body `actor` to `saveMetaItem`, the one
        // undeclared read left on this door. It now records the publisher, as
        // the publish itself does (`resolvePackageWriteActor`).
        const { saveMetaItem } = await publishWith(
            { actor: 'someone_else' },
            [{ name: 'crm', label: 'CRM', _unpublished: true }],
        );
        expect(saveMetaItem).toHaveBeenCalledTimes(1);
        expect((saveMetaItem.mock.calls[0]![0] as Record<string, unknown>).actor).toBe(USER);
    });
});

describe('a backfill the schema refuses is refused at the door before anything is published (real protocol)', () => {
    /** The real protocol over an engine nothing may touch: the shape judgement runs before any read. */
    function realProtocol() {
        const untouchable = new Proxy({}, {
            get(_t, key) { throw new Error(`the engine was touched (${String(key)}) before the shape judgement`); },
        });
        return new ObjectStackProtocolImplementation(untouchable as any, undefined, undefined, 'package-author');
    }

    it('answers 400 VALIDATION_ERROR naming the entry, for each malformed shape', async () => {
        const bodies: Array<{ body: Record<string, unknown>; path: string }> = [
            { body: { backfill: { object: 'crm_account', field: 'is_key' } }, path: 'backfill' },
            { body: { backfill: ['crm_account.is_key'] }, path: 'backfill.0' },
            { body: { backfill: [{ object: 'crm_account' }] }, path: 'backfill.0' },
            { body: { backfill: [{ object: '', field: 'is_key' }] }, path: 'backfill.0' },
            { body: { backfill: [{ object: 'crm_account', field: 'is_key', value: true }] }, path: 'backfill.0' },
        ];
        for (const { body, path } of bodies) {
            expect(PublishPackageDraftsRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
            const protocol = realProtocol();
            const publish = vi.spyOn(protocol, 'publishPackageDrafts');
            const { dispatcher } = makeDoor(protocol as unknown as Record<string, unknown>);
            const result = await dispatcher.handlePackages(`/${PKG}/publish-drafts`, 'POST', body, {}, PKG_ADMIN());
            const response = result.response as any;
            expect(response.status, JSON.stringify(body)).toBe(400);
            expect(response.body?.error?.code, JSON.stringify(body)).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(response.body), JSON.stringify(body)).toContain(path);
            expect(publish).toHaveBeenCalledTimes(1);
        }
    });
});
