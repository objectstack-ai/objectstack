// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28717] The bare-slot order between two stored rows of one shipped flow
 * name (`stored-flow-slot.ts`): the declared `.custom` override keeps the slot
 * in either read order, the row that loses is carried on it once, the same row
 * read again replaces itself, and every other pair keeps "last read wins".
 * The composition over a real boot is
 * `flow-declared-override-first-boot-pull.integration.test.ts`
 * (service-automation).
 */
import { describe, expect, it } from 'vitest';
import { bindStoredRow } from './stored-row-binding.js';
import { incomingTakesStoredFlowSlot, shadowedStoredRowsOf } from './stored-flow-slot.js';
import { installedManifestsOf } from '@objectstack/metadata-core';

/** Nothing installed: the pair lookup reads no manifest while `appOf` is the identity. */
const NOTHING_INSTALLED = installedManifestsOf(undefined);

const BASE = 'com.acme.crm';
const PAIR = `${BASE}.custom`;
const NAME = 'crm_flow';

const body = (label: string, extra: Record<string, unknown> = {}) => ({ name: NAME, label, ...extra });
const override = () => bindStoredRow(body('OVERRIDE', { overrides: { package: BASE, basedOn: '1.0.0' } }), PAIR);
const legacy = () => bindStoredRow(body('LEGACY'), null);
const labels = (rows: readonly object[]) => rows.map((r) => (r as { label?: string }).label);

describe('[#28717] the declared override keeps the bare slot of its shipped flow name', () => {
    it('held override, incoming legacy row: the override keeps the slot and carries the legacy row', () => {
        const held = override();
        const incoming = legacy();
        expect(incomingTakesStoredFlowSlot(held, incoming, BASE, NOTHING_INSTALLED)).toBe(false);
        expect(labels(shadowedStoredRowsOf(held))).toEqual(['LEGACY']);
    });

    it('held legacy row, incoming override: the override takes the slot and carries the legacy row', () => {
        const held = legacy();
        const incoming = override();
        expect(incomingTakesStoredFlowSlot(held, incoming, BASE, NOTHING_INSTALLED)).toBe(true);
        expect(labels(shadowedStoredRowsOf(incoming))).toEqual(['LEGACY']);
    });

    it('the legacy row read again is carried once, as its latest body', () => {
        const held = override();
        incomingTakesStoredFlowSlot(held, legacy(), BASE, NOTHING_INSTALLED);
        const again = bindStoredRow(body('LEGACY 2'), null);
        expect(incomingTakesStoredFlowSlot(held, again, BASE, NOTHING_INSTALLED)).toBe(false);
        expect(labels(shadowedStoredRowsOf(held))).toEqual(['LEGACY 2']);
    });

    it('the override read again replaces itself and keeps what it shadowed, declared or not', () => {
        const held = override();
        incomingTakesStoredFlowSlot(held, legacy(), BASE, NOTHING_INSTALLED);
        const resaved = bindStoredRow(body('OVERRIDE, UNDECLARED'), PAIR);
        expect(incomingTakesStoredFlowSlot(held, resaved, BASE, NOTHING_INSTALLED)).toBe(true);
        expect(labels(shadowedStoredRowsOf(resaved))).toEqual(['LEGACY']);
    });

    it('the binding decides, never a body stamp: a package-less row stamping the pair is not the override', () => {
        const held = override();
        const stamped = bindStoredRow(body('STAMPED', { _packageId: PAIR, overrides: { package: BASE, basedOn: '1.0.0' } }), null);
        expect(incomingTakesStoredFlowSlot(held, stamped, BASE, NOTHING_INSTALLED)).toBe(false);
        const heldStamped = bindStoredRow(body('STAMPED', { _packageId: PAIR, overrides: { package: BASE, basedOn: '1.0.0' } }), null);
        expect(incomingTakesStoredFlowSlot(heldStamped, legacy(), BASE, NOTHING_INSTALLED)).toBe(true);
    });

    it('control: with no declared override among them, the last row read takes the slot and nothing is carried', () => {
        const held = legacy();
        const undeclaredPair = bindStoredRow(body('PAIR, UNDECLARED'), PAIR);
        expect(incomingTakesStoredFlowSlot(held, undeclaredPair, BASE, NOTHING_INSTALLED)).toBe(true);
        expect(shadowedStoredRowsOf(undeclaredPair)).toEqual([]);
        expect(incomingTakesStoredFlowSlot(undeclaredPair, legacy(), BASE, NOTHING_INSTALLED)).toBe(true);
    });

    it('control: an empty slot, a slot holding no stored row, or a name no package ships, settles nothing', () => {
        expect(incomingTakesStoredFlowSlot(undefined, legacy(), BASE, NOTHING_INSTALLED)).toBe(true);
        expect(incomingTakesStoredFlowSlot(body('LOADER', { _packageId: BASE }), legacy(), BASE, NOTHING_INSTALLED)).toBe(true);
        expect(incomingTakesStoredFlowSlot(override(), legacy(), undefined, NOTHING_INSTALLED)).toBe(true);
    });

    it('the carried rows never leave the process', () => {
        const held = override();
        incomingTakesStoredFlowSlot(held, legacy(), BASE, NOTHING_INSTALLED);
        expect(Object.keys(held)).not.toContain('shadowedStoredRows');
        expect(JSON.parse(JSON.stringify(held))).toEqual(body('OVERRIDE', { overrides: { package: BASE, basedOn: '1.0.0' } }));
        expect(shadowedStoredRowsOf({ ...held })).toEqual([]);
    });
});

/**
 * [#32613, ADR-0150 D4] A name two packages ship, each with its declared
 * override in its own pair: an override is judged against every shipper, so
 * neither holder's override is ever read as a plain stored row.
 */
describe('[#32613] two packages ship the name: each holder\'s declared override is an override', () => {
    const OTHER = 'com.acme.other';
    const SHIPPERS = [BASE, OTHER];
    const otherOverride = () =>
        bindStoredRow(body('OTHER OVERRIDE', { overrides: { package: OTHER, basedOn: '1.0.0' } }), `${OTHER}.custom`);

    it('the second holder\'s override keeps the slot over a package-less row read after it, and carries it', () => {
        const held = otherOverride();
        expect(incomingTakesStoredFlowSlot(held, legacy(), SHIPPERS, NOTHING_INSTALLED)).toBe(false);
        expect(labels(shadowedStoredRowsOf(held))).toEqual(['LEGACY']);
    });

    it('FROM: judged against the first holder alone, the package-less row took the slot and dropped it', () => {
        const held = otherOverride();
        const incoming = legacy();
        expect(incomingTakesStoredFlowSlot(held, incoming, BASE, NOTHING_INSTALLED)).toBe(true);
        expect(shadowedStoredRowsOf(incoming)).toEqual([]);
    });

    it('two holders\' overrides: whichever is read last takes the slot and carries the other, in either order', () => {
        for (const [first, second] of [[override, otherOverride], [otherOverride, override]] as const) {
            const held = first();
            const incoming = second();
            expect(incomingTakesStoredFlowSlot(held, incoming, SHIPPERS, NOTHING_INSTALLED)).toBe(true);
            expect(labels(shadowedStoredRowsOf(incoming))).toEqual([(held as { label: string }).label]);
            // …and a package-less row read after both keeps neither from the slot's body.
            expect(incomingTakesStoredFlowSlot(incoming, legacy(), SHIPPERS, NOTHING_INSTALLED)).toBe(false);
            expect(labels([incoming, ...shadowedStoredRowsOf(incoming)]).sort())
                .toEqual([(incoming as { label: string }).label, (held as { label: string }).label, 'LEGACY'].sort());
        }
    });

    it('CONTROL: a pair row declaring a package that does not ship the name is no override', () => {
        const stranger = bindStoredRow(body('STRANGER', { overrides: { package: 'com.acme.none', basedOn: '1.0.0' } }), 'com.acme.none.custom');
        expect(incomingTakesStoredFlowSlot(stranger, legacy(), SHIPPERS, NOTHING_INSTALLED)).toBe(true);
    });
});
