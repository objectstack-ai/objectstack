// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Object-less" has ONE answer inside `action-execution.ts` (#14864).
 *
 * `isObjectLessActionKey` (`@objectstack/objectql`) is the canonical predicate:
 * the routed object is object-less when it is the canonical
 * `GLOBAL_ACTION_OBJECT_KEY`, the legacy `'*'`, or nothing at all.
 * `dispatchFlowAction` asks it directly when it decides whether to hand the
 * automation service an `object` at all — and then, on the very next line,
 * hands the same `objectName` to `seedFlowActionParams`, which used to answer
 * the same question with a second, narrower comparison of its own.
 *
 * The two parted on exactly one input, `'*'`: the automation envelope treated a
 * `'*'` route as object-less and omitted `object`, while the params bag treated
 * it as a real object and seeded a nonsense `'*Id'` alias key beside
 * `recordId`. One dispatch, two answers, three lines apart.
 *
 * ## Why the pin sits HERE and not only on the route
 *
 * `seedFlowActionParams` was NOT unpinned — `http-dispatcher.actions-type-
 * dispatch.test.ts` covers its whole seeding ladder, indirectly, through the
 * REST route, without ever naming it. What that file never does is route at an
 * object-LESS key: every case there is `/crm_lead/...`. So the ladder was
 * pinned and the object-less leg of it was not, which is why the divergence
 * survived. This file pins the leg, at the level the two predicates actually
 * meet: one function, the whole `isObjectLessActionKey` domain, one bag.
 *
 * ## The arms, and which one is the control
 *
 * The `OBJECT_FUL` case is an ANTI-VACUITY CONTROL, not a pin: it asserts the
 * alias key IS seeded for a real object. If a future edit makes
 * `seedFlowActionParams` seed nothing at all, the negative assertions below
 * would all pass for the wrong reason, and this control is what fails instead.
 * ⛔ A red here is not this file's finding — read the object-less arm first.
 */

import { describe, it, expect } from 'vitest';
import { GLOBAL_ACTION_OBJECT_KEY, isObjectLessActionKey } from '@objectstack/objectql';
import { seedFlowActionParams, type ActionExecutionDeps } from './action-execution.js';

/** `seedFlowActionParams` ignores its first parameter — see its signature. */
const NO_DEPS = undefined as unknown as ActionExecutionDeps;

const ROW_ID = 'row_1';

/**
 * The `<objectName>Id` camelCase alias `seedFlowActionParams` seeds for an
 * object-bound route, derived the way the function derives it rather than
 * hard-coded — a hard-coded copy would go stale in silence the day the
 * spelling changes, which is the same failure this whole card is about.
 */
const aliasKeyFor = (objectName: string): string =>
    `${objectName.replace(/_([a-z])/g, (_m: string, c: string) => c.toUpperCase())}Id`;

const seedFor = (objectName: string): Record<string, unknown> =>
    seedFlowActionParams(NO_DEPS, { name: 'convert_lead', type: 'flow' }, {
        objectName,
        record: {},
        params: {},
        recordId: ROW_ID,
    });

/**
 * Every string spelling `isObjectLessActionKey` accepts. The table is asserted
 * against the predicate itself below, so narrowing the predicate (retiring
 * `'*'`, say) fails HERE with a readable message instead of quietly leaving a
 * row that no longer describes anything.
 */
const OBJECT_LESS_KEYS: readonly string[] = [GLOBAL_ACTION_OBJECT_KEY, '*', ''];

/** A real object — the control's route, and the one the REST pin already uses. */
const OBJECT_FUL = 'crm_lead';

describe('object-less action key — one predicate, one answer (#14864)', () => {
    it('anti-vacuity control: an object-BOUND route still seeds its alias key', () => {
        // Positive control. Every negative below is a claim that a key is
        // absent; without this, deleting the seeding branch outright would
        // turn them all green.
        expect(isObjectLessActionKey(OBJECT_FUL)).toBe(false);
        const bag = seedFor(OBJECT_FUL);
        expect(bag[aliasKeyFor(OBJECT_FUL)]).toBe(ROW_ID);
        expect(bag.recordId).toBe(ROW_ID);
    });

    it('the table below describes exactly what the predicate accepts', () => {
        // Guards the table, not the code: a narrowed predicate must come here
        // and say so rather than leaving an inert row behind.
        for (const key of OBJECT_LESS_KEYS) {
            expect(isObjectLessActionKey(key), `${JSON.stringify(key)} is no longer object-less`).toBe(true);
        }
    });

    it.each(OBJECT_LESS_KEYS.map((key) => ({ key, label: JSON.stringify(key) })))(
        'seeds no object alias for the object-less key $label',
        ({ key }) => {
            const bag = seedFor(key);
            // The row id still reaches the flow — this is about the ALIAS only.
            expect(bag.recordId).toBe(ROW_ID);
            expect(
                Object.keys(bag),
                `seedFlowActionParams seeded the alias key ${JSON.stringify(aliasKeyFor(key))} for the `
                + `object-less route ${JSON.stringify(key)}. isObjectLessActionKey() calls that route `
                + `object-less and dispatchFlowAction omits \`object\` from the automation envelope for `
                + `it, so the params bag must not invent an object alias either (#14864).`,
            ).not.toContain(aliasKeyFor(key));
        },
    );

    it('every object-less spelling lands the SAME bag as the canonical key', () => {
        // The agreement stated as one assertion: which object-less spelling a
        // caller routed at must not be observable in the flow's params.
        const canonical = seedFor(GLOBAL_ACTION_OBJECT_KEY);
        for (const key of OBJECT_LESS_KEYS) {
            expect(seedFor(key), `routing at ${JSON.stringify(key)} produced a different params bag`)
                .toEqual(canonical);
        }
    });
});
