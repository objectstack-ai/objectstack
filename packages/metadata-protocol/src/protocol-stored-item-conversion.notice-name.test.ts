// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29596] The stored-row conversion notice names the item by the identity
 * its type uses, and the warn-once key separates rows by it.
 *
 * An `object_extension` body carries `extend` and no `name`
 * (`ObjectExtensionSchema` refuses one; its row is stored under the target's
 * name). Since #29589 a stored extension row replays the `objectExtensions[]`
 * conversions, so `convertStoredItem` warns for it. Reading `data.name`, it
 * warned every stale extension as `object_extension/<unnamed>`, and the key
 * `conversionId|object_extension|` collapsed every row to ONE notice per
 * conversion. Measured on a real store (SQLite + ObjectQL + the protocol's
 * save door, two published extensions made stale): six reads, `data.name`
 * absent on every one, and a single `<unnamed>` line for the two rows.
 *
 * Driven through the module's own `convertStoredItem` over the real
 * conversion chain (`convertStoredItemDetailed`), with the warn-once set the
 * class hands it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertStoredItem, convertStoredItemDetailed } from './protocol-stored-item-conversion.js';

/** A host shaped like the one the class builds: the real chain, a fresh warn-once set. */
const host = () => ({ convertStoredItemDetailed, storedConversionWarned: new Set<string>() });

/** A stale extension: the `Z`-suffixed `time` default `time-default-utc-suffix-dropped` converts. */
const staleExtension = (target: string) => ({
    extend: target,
    fields: { opens_at__c: { type: 'time', label: 'Opens', defaultValue: '12:00Z' } },
});

let warn: { mock: { calls: unknown[][] }; mockRestore(): void };
beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    warn.mockRestore();
});

/** The `stored TYPE/NAME` subject of each conversion notice, in order. */
const subjects = () => warn.mock.calls
    .map((c) => String(c[0]))
    .filter((line) => line.includes('carries a pre-protocol shape'))
    .map((line) => /stored (\S+) carries/.exec(line)?.[1]);

describe('[#29596] a stored conversion notice names the item by its identity', () => {
    it('two stale extension rows give two notices, each naming its target', () => {
        const h = host();
        const account = convertStoredItem.call(h, 'object_extension', staleExtension('crm_account'));
        const contact = convertStoredItem.call(h, 'object_extension', staleExtension('crm_contact'));

        expect(subjects()).toEqual(['object_extension/crm_account', 'object_extension/crm_contact']);
        // The rows still convert, and the body is not given a `name`.
        expect(account).toEqual({ extend: 'crm_account', fields: { opens_at__c: { type: 'time', label: 'Opens', defaultValue: '12:00' } } });
        expect(contact).not.toHaveProperty('name');
    });

    it('the same extension row read again warns once — the dedupe still holds per row', () => {
        const h = host();
        convertStoredItem.call(h, 'object_extension', staleExtension('crm_account'));
        convertStoredItem.call(h, 'object_extension', staleExtension('crm_account'));
        convertStoredItem.call(h, 'object_extension', staleExtension('crm_contact'));

        expect(subjects()).toEqual(['object_extension/crm_account', 'object_extension/crm_contact']);
    });

    it('CONTROL — a non-extension type is still named by its `name`, and a nameless body is still `<unnamed>`', () => {
        const h = host();
        const object = (name?: string) => ({
            ...(name === undefined ? {} : { name }),
            fields: { opens_at: { type: 'time', defaultValue: '12:00Z' } },
        });
        convertStoredItem.call(h, 'object', object('shift'));
        convertStoredItem.call(h, 'object', object('rota'));
        convertStoredItem.call(h, 'object', object());

        expect(subjects()).toEqual(['object/shift', 'object/rota', 'object/<unnamed>']);
    });

    it('CONTROL — an `extend` key on another type does not name it', () => {
        const h = host();
        convertStoredItem.call(h, 'object', { extend: 'crm_account', fields: { opens_at: { type: 'time', defaultValue: '12:00Z' } } });

        expect(subjects()).toEqual(['object/<unnamed>']);
    });
});
