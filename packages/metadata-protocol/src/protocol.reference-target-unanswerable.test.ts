// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9327] The `field` metadata type can never match as a reference TARGET, and
 * is now refused instead of cleared.
 *
 * ## What was wrong, stated as the operator experienced it
 *
 * A `field` item is addressed by the COMPOSITE key `<object>.<field>` —
 * `GET /api/v1/meta/field/account.owner/references`. Every metadata property
 * that names a field holds the BARE name (`owner`): `view.list.columns[].field`,
 * `dataset.dimensions[].field`, `object.validations[].field`, `object.fields{}`
 * and 150 further non-recursive paths across nine source types. The two sides
 * are drawn from disjoint vocabularies, so the scan answered `{ references: [] }`
 * for every field, on every deployment, regardless of real usage.
 *
 * `objectui`'s metadata-admin renders that empty case verbatim as *"Nothing in
 * the metadata graph points at this item. Safe to delete."* — a question that
 * was never answerable, rendered as a positive clearance, on the screen where
 * someone decides to delete (ADR-0110 D3, the #8896 harm shape).
 *
 * ## What these pins assert, and what they deliberately do not
 *
 * ⭐ The load-bearing property of this file is that **a test asserting
 * `references: []` comes back would have passed against the defect itself**.
 * So every pin here asserts the REFUSAL — its `code` and `status` per the
 * ADR-0112 envelope — and the second `describe` seeds a field that is genuinely
 * referenced from four real sites, which is the case the old behaviour cleared
 * for deletion.
 *
 * ⛔ These do NOT pin fix shape (1) (qualifying bare names against the owning
 * object) — that is a capability upgrade with its own card, and it needs object
 * context this walker does not have. Nor shape (2) (matching a bare `owner`
 * against the key `account.owner`), which is rejected on-card: it swaps false
 * negatives for FALSE POSITIVES on delete confirmations, the worse direction on
 * this screen.
 */

import { describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { REFERENCE_SITES } from './reference-sites.js';

/** Same registry-backed stub the sibling derivation suite uses. */
function protocolWith(items: Record<string, Array<Record<string, unknown>>>) {
    const engine: any = {
        async find() { return []; },
        async findOne() { return null; },
        async count() { return 0; },
        registry: {
            listItems: (type: string) => items[type] ?? [],
            getItem: () => undefined,
            getObject: () => undefined,
            isPackageDisabled: () => false,
            getPackage: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            applyNavContributions: (app: unknown) => app,
        },
    };
    return new ObjectStackProtocolImplementation(engine as never);
}

/**
 * Assert the ADR-0112 refusal envelope, not merely that something threw.
 *
 * ⚠️ A bare `.rejects.toThrow()` is blind in both directions here: it passes on
 * any stray `Error` the walk might raise, and it says nothing about the status
 * the route will serve — which is the whole wire-visible point of the fix.
 */
async function expectUnanswerableRefusal(run: () => Promise<unknown>): Promise<Error> {
    let caught: unknown;
    try {
        await run();
    } catch (err) {
        caught = err;
    }
    expect(caught, 'expected a refusal, got a resolved answer').toBeInstanceOf(Error);
    const err = caught as Error & { code?: string; status?: number };
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.status).toBe(501);
    return err;
}

describe('[#9327] a `field` TARGET is refused, not cleared', () => {
    it('THE PIN: the composite key that always answered `[]` now refuses with 501 NOT_IMPLEMENTED', async () => {
        // Nothing is seeded on purpose: the pre-fix behaviour returned
        // `{ references: [] }` here too, so a test that accepted an empty list
        // would have been green against the defect. Only the refusal separates
        // the two.
        const protocol = protocolWith({});

        const err = await expectUnanswerableRefusal(
            () => protocol.findReferencesToMeta({ type: 'field', name: 'account.owner' }),
        );

        // The message is the operator's whole diagnosis at the moment they were
        // about to delete, so its first sentence is contract too.
        expect(err.message).toContain('cannot be computed');
        expect(err.message).toContain('account.owner');
    });

    it('the refusal is PRESCRIPTIVE — it names the answerable question (ADR-0110 D3)', async () => {
        // A refusal that only says "no" moves the operator from a false
        // clearance to a dead end. A field's dependents ARE reachable, through
        // the object that owns it, and the owning object is recoverable from
        // the key the caller already typed.
        const protocol = protocolWith({});

        const err = await expectUnanswerableRefusal(
            () => protocol.findReferencesToMeta({ type: 'field', name: 'account.owner' }),
        );

        expect(err.message).toContain('GET /api/v1/meta/object/account/references');
    });

    it('a bare field name is refused too — the key form is the fault, not the spelling', async () => {
        // `GET /meta/field/owner/references` is the same unanswerable question
        // wearing a shorter key: `owner` is not an addressable field item
        // either. Refusing only the DOTTED form would answer "nothing depends
        // on it" for the exact spelling an operator reaches for first.
        const protocol = protocolWith({});

        const err = await expectUnanswerableRefusal(
            () => protocol.findReferencesToMeta({ type: 'field', name: 'owner' }),
        );

        expect(err.message).toContain('<object>.<field>');
    });

    it('the plural spelling folds to the same refusal, not to a 200', async () => {
        // #9157's canonical fold runs first, so `fields` reaches the refusal as
        // `field`. Worth pinning: a fold that ran AFTER the refusal check would
        // leave the plural URL answering `{ references: [] }` — the defect
        // surviving behind an alias.
        const protocol = protocolWith({});

        await expectUnanswerableRefusal(
            () => protocol.findReferencesToMeta({ type: 'fields', name: 'account.owner' }),
        );
    });
});

describe('[#9327] the refusal replaces a clearance that was measurably false', () => {
    it('a field with four real dependents was cleared as "safe to delete" — that answer is gone', async () => {
        // Every item below genuinely names `owner`. Pre-fix, this exact fixture
        // answered `{ references: [] }`, which the "Used by" panel renders as
        // "Nothing in the metadata graph points at this item. Safe to delete."
        const protocol = protocolWith({
            view: [{
                name: 'account_list',
                label: 'Accounts',
                object: 'account',
                list: { columns: [{ field: 'owner' }], sort: [{ field: 'owner' }] },
            }],
            dataset: [{ name: 'by_owner', dimensions: [{ field: 'owner' }] }],
            object: [{
                name: 'account',
                label: 'Account',
                fields: { owner: { name: 'owner', type: 'lookup', reference: 'user' } },
                validations: [{ field: 'owner', message: 'required' }],
            }],
        });

        await expectUnanswerableRefusal(
            () => protocol.findReferencesToMeta({ type: 'field', name: 'account.owner' }),
        );
    });

    it('sibling target types are untouched — the refusal is scoped to the key-form fault', async () => {
        // The failure mode of a refusal is over-refusing. `object` is addressed
        // by its own `name`, so its question stays answerable and its answer
        // stays exact.
        const protocol = protocolWith({
            object: [{
                name: 'task',
                label: 'Task',
                fields: { account_id: { name: 'account_id', type: 'lookup', reference: 'account' } },
            }],
        });

        const result = await protocol.findReferencesToMeta({ type: 'object', name: 'account' });

        expect(result.references).toEqual([
            {
                type: 'object',
                name: 'task',
                label: 'Task',
                path: 'fields.account_id.reference',
                kind: 'object reference',
            },
        ]);
    });

    it('an ordinary target with no dependents still answers `[]` — a MISS is still a miss', async () => {
        // ADR-0110 D3 cuts both ways: turning genuine "nothing points at this"
        // into a fault would be this card's harm inverted, and would make the
        // panel useless for the types it serves correctly.
        const protocol = protocolWith({ view: [{ name: 'lead_list', object: 'lead' }] });

        const result = await protocol.findReferencesToMeta({ type: 'object', name: 'orphan' });

        expect(result.references).toEqual([]);
    });
});

describe('[#9327] the refused set is derived, and stays honest on its own', () => {
    it('THE PIN: exactly one declared type is unanswerable as a target, and it is named', () => {
        // ⚠️ If this set GROWS, some other type became unaddressable-by-name
        // and its "Used by" panel is now refusing where it used to answer. If
        // it SHRINKS to empty, the refusal silently stopped firing and every
        // field is being cleared for deletion again. Both directions are the
        // failure; do not "fix" a red here by widening the expectation.
        expect(REFERENCE_SITES.unanswerableTargetTypes).toEqual(['field']);
    });

    it('`field` is refused as a TARGET while remaining walkable as a SOURCE', () => {
        // The distinction that made this a sibling rather than a widening of
        // `unwalkableSourceTypes`: that set is about a shape that could not be
        // READ. `field`'s shape reads fine — it contributes sites of its own —
        // so it never was and never will be a member there.
        expect(REFERENCE_SITES.unwalkableSourceTypes).not.toContain('field');
        expect(REFERENCE_SITES.unanswerableTargetTypes).not.toContain('external_catalog');
    });

    it('the sites that can never match still EXIST — refusing is not the same as having no sites', () => {
        // This is why a "no sites → empty answer" shortcut would have been the
        // wrong fix: the index is full of properties naming `field`. They are
        // real declarations; what is impossible is matching them against the
        // key this endpoint is addressed by.
        const sites = REFERENCE_SITES.byTarget.get('field') ?? [];
        expect(sites.length).toBeGreaterThan(0);
        expect(sites.map((s) => `${s.fromType}.${s.property}`)).toContain('view.field');
        expect(sites.map((s) => `${s.fromType}.${s.property}`)).toContain('object.fields');
    });
});
