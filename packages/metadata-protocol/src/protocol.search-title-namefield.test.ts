// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8786] `searchAll`'s TITLE rendering reads the canonical primary-title
// pointer, not only the deprecated alias.
//
// ## The defect
//
// `renderTitle`'s candidate list opened with `obj.displayNameField` alone.
// Under ADR-0079 `nameField` is the CANONICAL pointer and `displayNameField`
// is the deprecated alias — and `provisionPrimary`, the designation seat the
// SchemaRegistry runs on every object at registration, stamps `nameField`
// ONLY (`packages/spec/src/data/display-name.ts:301,314`). So an object whose
// primary title is designated canonically, without the deprecated alias
// alongside it, produced `undefined` for that entry, the entry was filtered
// out, and the title fell through the conventional-name list to
// `String(row.id)` — the ⌘K palette showing a raw record id where the
// object's own declared, populated title existed.
//
// ## Why the fixtures look the way they do
//
// The impact is bounded to objects whose primary title is OUTSIDE
// `name` / `full_name` / `title` / `subject` / `label` / `company`: anything
// in that list resolves through the conventional entries and titles
// identically before and after the fix. Every pin here that must discriminate
// therefore uses a NON-conventional title field (`company_name`, `ref_no`,
// `ref_code` — note `company_name` is not `company`).
//
// ## Recall is NOT what this file pins
//
// #7643 fixed which rows come back and delegated recall to the engine; that
// contract is pinned in `protocol.search-case-fold.test.ts`. This file is
// PRESENTATION — what the returned row is called. Same function, different
// contract. The double below is deliberately a boundary stand-in with no
// filtering: it returns its rows verbatim so the assertions are about
// titling and nothing else.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

type ObjectMeta = Record<string, unknown> & { name: string };

/**
 * A protocol over a fixed object set. `rowsByObject` is served verbatim —
 * no filtering, no `$search` expansion — so a hit's `title` is the only
 * thing under test.
 */
function makeProtocol(objects: ObjectMeta[], rowsByObject: Record<string, unknown[]>) {
    const find = vi.fn(async (object: string) => rowsByObject[object] ?? []);
    const engine = {
        registry: {
            getObject: (n: string) => objects.find(o => o.name === n),
            getAllObjects: () => objects,
        },
        find,
    };
    return new ObjectStackProtocolImplementation(engine as never);
}

const text = (name: string) => ({ name, type: 'text' });

describe('[#8786] searchAll titles a hit from the canonical nameField', () => {
    it('titles from a canonically-designated nameField with no displayNameField', async () => {
        // THE PIN. `account` declares its primary title the way
        // `provisionPrimary` designates it — `nameField` only, no deprecated
        // alias — and `company_name` is outside the conventional list, so
        // before the fix this hit came back titled `acc_1`.
        const account: ObjectMeta = {
            name: 'account',
            nameField: 'company_name',
            fields: { company_name: text('company_name') },
        };
        const p = makeProtocol([account], {
            account: [{ id: 'acc_1', company_name: 'Acme Industrial' }],
        });

        const { hits } = await p.searchAll({ q: 'acme', perObject: 5 });

        expect(hits).toHaveLength(1);
        expect(hits[0].title).toBe('Acme Industrial');
        // Stated separately: the regression's signature is the raw id, and an
        // assertion naming it survives a future refactor of the value above.
        expect(hits[0].title).not.toBe('acc_1');
    });

    it('CONTROL — an object using a conventional `name` still titles correctly', async () => {
        // The discriminating control. Without it the pin above cannot tell
        // "the candidate list now reads the canonical pointer" from "the
        // candidate list was bypassed": a short-circuit on the pointer would
        // pass the pin and break this, since `contact` declares no pointer at
        // all and depends entirely on the conventional entries.
        const contact: ObjectMeta = {
            name: 'contact',
            fields: { name: text('name') },
        };
        const p = makeProtocol([contact], {
            contact: [{ id: 'con_1', name: 'Ada Lovelace' }],
        });

        const { hits } = await p.searchAll({ q: 'ada', perObject: 5 });

        expect(hits).toHaveLength(1);
        expect(hits[0].title).toBe('Ada Lovelace');
    });

    it('CONTROL — the pointer is a CANDIDATE, not a short-circuit: an empty value falls through', async () => {
        // The second half of the same discrimination. `nameField` names a
        // field that exists but is blank on this row; the ordered list must
        // continue to the conventional `name` rather than returning empty or
        // dropping to the id. A `return row[pointer]` rewrite passes both
        // tests above and fails here.
        const account: ObjectMeta = {
            name: 'account',
            nameField: 'company_name',
            fields: { company_name: text('company_name'), name: text('name') },
        };
        const p = makeProtocol([account], {
            account: [{ id: 'acc_2', company_name: '   ', name: 'Fallback Co' }],
        });

        const { hits } = await p.searchAll({ q: 'fallback', perObject: 5 });

        expect(hits).toHaveLength(1);
        expect(hits[0].title).toBe('Fallback Co');
    });

    it('still honors the deprecated displayNameField alias on its own', async () => {
        // Back-compat: the alias is DEPRECATED, not withdrawn. An object
        // carrying only the alias titled correctly before this change and
        // must keep doing so — the fix adds a canonical read in front of the
        // alias, it does not replace it.
        const legacy: ObjectMeta = {
            name: 'legacy_doc',
            displayNameField: 'ref_code',
            fields: { ref_code: text('ref_code') },
        };
        const p = makeProtocol([legacy], {
            legacy_doc: [{ id: 'leg_1', ref_code: 'DOC-2291' }],
        });

        const { hits } = await p.searchAll({ q: 'doc', perObject: 5 });

        expect(hits).toHaveLength(1);
        expect(hits[0].title).toBe('DOC-2291');
    });

    it('prefers nameField when an object carries BOTH pointers naming different fields', async () => {
        // The precedence this change lands on, pinned rather than assumed.
        // It is the platform's existing answer, not a new one:
        // `resolveDisplayField` spells `nameField ?? displayNameField`
        // (`spec/src/data/display-name.ts`) and is pinned to prefer
        // `nameField` in `display-name.test.ts`; `searchAll`'s own
        // search-field resolution and the #4254 ingress gate spell it the same
        // way. A fifth answer here would re-split what those merged.
        //
        // No object in the repo is actually in this state — every real object
        // carrying both spells them identically (measured across the repo for
        // #8786) — so this pins the rule for the first object that isn't,
        // rather than changing any object's behaviour today.
        const ticket: ObjectMeta = {
            name: 'ticket',
            nameField: 'ref_no',
            displayNameField: 'legacy_ref',
            fields: { ref_no: text('ref_no'), legacy_ref: text('legacy_ref') },
        };
        const p = makeProtocol([ticket], {
            ticket: [{ id: 'tk_1', ref_no: 'TK-77', legacy_ref: 'OLD-11' }],
        });

        const { hits } = await p.searchAll({ q: 'tk', perObject: 5 });

        expect(hits).toHaveLength(1);
        expect(hits[0].title).toBe('TK-77');
    });

    it('titleFormat still outranks the pointer', async () => {
        // Ordering above the changed line is untouched: `titleFormat` is
        // resolved before the candidate list is built, so a canonical
        // `nameField` does not overtake an explicit format.
        const account: ObjectMeta = {
            name: 'account',
            titleFormat: '{company_name} ({region})',
            nameField: 'company_name',
            fields: { company_name: text('company_name'), region: text('region') },
        };
        const p = makeProtocol([account], {
            account: [{ id: 'acc_3', company_name: 'Acme Industrial', region: 'EMEA' }],
        });

        const { hits } = await p.searchAll({ q: 'acme', perObject: 5 });

        expect(hits).toHaveLength(1);
        expect(hits[0].title).toBe('Acme Industrial (EMEA)');
    });
});
