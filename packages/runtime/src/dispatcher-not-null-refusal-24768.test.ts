// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24768] The runtime dispatcher's doors answer a database NOT NULL refusal on
 * a declared field as the record validator answers `required`:
 * `400 VALIDATION_FAILED`, the field named by its label.
 *
 * ## What was wrong
 *
 * `unit_price` (label "Sales Price") is ADR-0113's engine-populated column:
 * `storage: { notNull: true }`, no `required`, so a write with no value for it
 * reaches the driver and the DATABASE refuses it. The engine let the driver's
 * error out, and each door classified it from the text its own way. Measured on
 * `origin/main` `0c37228826`, on the rig below:
 *
 *  - `POST /data/OBJECT` without the field and `PATCH /data/OBJECT/ID` with
 *    `{ "unit_price": null }`: the raw `SqliteError`
 *    (`SQLITE_CONSTRAINT_NOTNULL`) left `dispatch()`, and the Hono exit
 *    (`declaredEnvelopeForThrow`) declined it, so the door answered
 *    `500 INTERNAL_ERROR`; `dispatcher-plugin`'s exit reads the same
 *    declaration (`validationFailureDetails`) and answered `500` too;
 *  - `POST /actions/OBJECT/clear_price/ID` (a declarative update writing null):
 *    `400 VALIDATION_ERROR`, the driver's text as the message and
 *    `declaredCode: 'SQLITE_CONSTRAINT_NOTNULL'`.
 *
 * The engine now refuses that write as its own `ValidationError`
 * (`@objectstack/objectql`, `not-null-refusal-error.ts`), the class every door
 * already answers alike, so no door here changed.
 *
 * ## The rig
 *
 * A REAL store: better-sqlite3 `:memory:` under `driver-sql`, the real
 * `ObjectQL` engine and protocol. The dispatcher is reached the way
 * `@objectstack/hono`'s catch-all reaches it, `dispatch()` over a real Fetch
 * `Request`, with the identity step the one stubbed seam; a throw out of
 * `dispatch()` is rendered by the exits' own recognisers.
 *
 * Codes, the field envelope and the label are asserted; the sentence is asked
 * of the validator's renderer, never spelled here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { declaredEnvelopeForThrow } from '@objectstack/plugin-hono-server';
import { validationFailureDetails } from '@objectstack/types';
import { renderValidationMessage } from '@objectstack/spec/system';
import { HttpDispatcher } from './http-dispatcher.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const PREFIX = '/api/v1';
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const OBJECT = 'line_item_24768';

const LINE = {
    name: OBJECT,
    label: 'Line item',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
        // ADR-0113's engine-populated column: NOT NULL on purpose, not `required`.
        unit_price: { name: 'unit_price', type: 'number' as const, label: 'Sales Price', storage: { notNull: true } },
    },
    actions: [
        { name: 'clear_price', label: 'Clear price', type: 'script', operation: 'update', patch: { unit_price: null } },
    ],
};

const MEMBER = { userId: 'u_member', isSystem: false };

let engine: ObjectQL;
let dispatcher: HttpDispatcher;

afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
});

beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(LINE as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    // A real `single` install's Default Organization (ADR-0131 D9).
    await installDefaultOrganization(engine);
    await engine.insert(OBJECT, { id: 'e1', name: 'existing', unit_price: 5 } as any);
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const services: Record<string, unknown> = { objectql: engine, data: engine, protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...MEMBER });
}, 60_000);

/**
 * A request as `@objectstack/hono`'s catch-all hands it to `dispatch()`: the
 * answer `dispatch()` returned, or — for a throw — what each exit makes of it.
 */
async function door(method: string, path: string, body: unknown) {
    const request = new Request(`http://localhost${PREFIX}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    try {
        const res: any = await dispatcher.dispatch(method, path, body, {}, { request } as any, PREFIX);
        return { returned: res?.response as { status: number; body: any } | undefined };
    } catch (thrown) {
        return {
            thrown,
            // `@objectstack/hono`'s catch-all and `plugin-hono-server`'s exit.
            hono: declaredEnvelopeForThrow(thrown),
            // `dispatcher-plugin`'s `errorResponseBase` reads this declaration.
            validation: validationFailureDetails(thrown),
        };
    }
}

const sentence = (messageKey: 'required' | 'required_cleared') =>
    renderValidationMessage({ messageKey, label: 'Sales Price', field: 'unit_price', params: {} }, {});

/** The validator's field envelope for `unit_price`, by its label. */
function expectFieldEnvelope(fields: unknown, messageKey: 'required' | 'required_cleared') {
    expect(fields).toEqual([
        { field: 'unit_price', code: 'required', message: sentence(messageKey), label: 'Sales Price' },
    ]);
}

/** A throw out of `dispatch()` that both exits answer `400 VALIDATION_FAILED` with the field's label. */
function expectThrownRefusal(answer: Awaited<ReturnType<typeof door>>, messageKey: 'required' | 'required_cleared') {
    expect('thrown' in answer, JSON.stringify(answer)).toBe(true);
    const { hono, validation } = answer as { hono: any; validation: any };
    expect(hono?.status, JSON.stringify(hono)).toBe(400);
    expect(hono.body.error.code).toBe('VALIDATION_FAILED');
    expect(hono.body.error.message).toBe(sentence(messageKey));
    expectFieldEnvelope(hono.body.error.details?.fields, messageKey);
    expect(validation?.code).toBe('VALIDATION_FAILED');
    expectFieldEnvelope(validation.fields, messageKey);
    // Neither the driver's text nor its code crosses.
    const wire = JSON.stringify(hono.body);
    expect(wire).not.toMatch(/constraint failed|SQLITE_/);
}

const storedPrice = async () => ((await engine.findOne(OBJECT, { where: { id: 'e1' } })) as any)?.unit_price;

describe('[#24768] the dispatcher `/data` doors answer a NOT NULL refusal as `400 VALIDATION_FAILED`, by label', () => {
    it('`POST /data/:object` without the field', async () => {
        const answer = await door('POST', `/data/${OBJECT}`, { id: 'n1', name: 'new' });
        expectThrownRefusal(answer, 'required');
        expect(await engine.find(OBJECT, { where: { id: 'n1' } })).toHaveLength(0);
    });

    it('`PATCH /data/:object/:id` writing null', async () => {
        const answer = await door('PATCH', `/data/${OBJECT}/e1`, { unit_price: null });
        expectThrownRefusal(answer, 'required_cleared');
        expect(await storedPrice()).toBe(5);
    });
});

describe('[#24768] the actions door answers the same refusal the same way', () => {
    it('a declarative `operation: \'update\'` action writing null', async () => {
        const answer = await door('POST', `/actions/${OBJECT}/clear_price/e1`, {});
        const response = (answer as { returned?: { status: number; body: any } }).returned;
        expect(response?.status, JSON.stringify(answer)).toBe(400);
        expect(response!.body.error.code).toBe('VALIDATION_FAILED');
        expect(response!.body.error.message).toBe(sentence('required_cleared'));
        expectFieldEnvelope(response!.body.error.details?.fields, 'required_cleared');
        expect(response!.body.error).not.toHaveProperty('declaredCode');
        expect(JSON.stringify(response!.body)).not.toMatch(/constraint failed|SQLITE_/);
        expect(await storedPrice()).toBe(5);
    });
});
