// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28594] `storedOverlayEntries` serves a stored row's `_packageId` from the
// row's `package_id` COLUMN, never from its body: a body stamp is replaced by
// the column's package, or dropped when the row is bound to no package. Every
// reader of the list (the connector materializer judging whose root a file ref
// reads among them) asks an item's owner of `_packageId`.

import { describe, it, expect } from 'vitest';
import { storedOverlayEntries } from './protocol-stored-overlay-reads.js';

const host = { convertStoredItem: (_type: string, body: unknown) => body };
const parse = (records: any[]) => storedOverlayEntries.call(host, { type: 'connector' }, records);
const row = (body: Record<string, unknown>, packageId: string | null) => ({
    type: 'connector', name: String(body.name), metadata: JSON.stringify(body), package_id: packageId,
});

describe('#28594 — a stored row\'s package is its column\'s', () => {
    it('a body stamp on a row bound to no package is dropped', () => {
        const [entry] = parse([row({ name: 'a', _packageId: 'com.acme.host' }, null)]);
        expect(entry!.packageId).toBeUndefined();
        expect(entry!.data).not.toHaveProperty('_packageId');
    });

    it('a body stamp naming another package is replaced by the column\'s', () => {
        const [entry] = parse([row({ name: 'a', _packageId: 'com.acme.host' }, 'com.acme.authored')]);
        expect(entry!.packageId).toBe('com.acme.authored');
        expect(entry!.data._packageId).toBe('com.acme.authored');
    });

    it('control: a body with no stamp is stamped from its column, and an agreeing stamp is kept', () => {
        const [bound, agreeing, unbound] = parse([
            row({ name: 'a' }, 'com.acme.authored'),
            row({ name: 'b', _packageId: 'com.acme.authored' }, 'com.acme.authored'),
            row({ name: 'c' }, null),
        ]);
        expect(bound!.data._packageId).toBe('com.acme.authored');
        expect(agreeing!.data._packageId).toBe('com.acme.authored');
        expect(unbound!.data).not.toHaveProperty('_packageId');
    });

    it('a row whose metadata is an object is not written: the served body is a copy', () => {
        const body = { name: 'a', _packageId: 'com.acme.host' };
        const [entry] = parse([{ type: 'connector', name: 'a', metadata: body, package_id: null }]);
        expect(entry!.data).not.toHaveProperty('_packageId');
        expect(body._packageId).toBe('com.acme.host');
    });
});
