// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#13259] `hidden` is a floor on BOTH passes of `getUiView`'s list branch.
//
// `FieldSchema` declares `hidden` as "Hidden from default UI"
// (`packages/spec/src/data/field.zod.ts`). `getUiView` IS the default UI — it
// is the producer behind `GET /api/v1/ui/view/:object/:type` — so that
// sentence is a floor here or it is a floor nowhere.
//
// It was not one. The list branch picks columns in two passes:
//
//     let columns = fieldKeys.filter(k => priorityFields.includes(k));
//     if (columns.length < 5) { /* fill pass, WITH !fields[k].hidden */ }
//
// and `!fields[k].hidden` sat on the fill pass alone. A field declared
// `hidden: true` was therefore dropped for eight of nine spellings and served
// — with its label — for the ninth: whenever the author happened to name it
// one of `name`, `title`, `label`, `subject`, `email`, `status`, `type`,
// `category`, `created_at`. Those are the ordinary names, not exotic ones.
// Meanwhile the `form` branch of the same function filtered every hidden field
// uniformly, so two branches of one producer disagreed about what `hidden`
// means.
//
// ## Why this file drives more than one field
//
// ⛔ An earlier measurement (PR #13244) drove ONE hidden field, which happened
// not to be a priority name, saw it dropped, and reported *"hidden is dropped
// by declaration"*. That reading was true of the field it drove and false of
// the class — a **false clearance**: a result that reads as general because
// its single case fell on the safe side.
//
// So every case here carries an arm that would have come out the other way:
//
//   1. a hidden field that IS a priority name        (`status`)  — the defect;
//   2. a hidden field that is NOT a priority name    (`beta_secret`)
//      — already correct before the fix, so it guards the fill pass against a
//      repair that over-reaches in the other direction;
//   3. a NON-hidden priority field                   (`name`)
//      — without it, "nothing is emitted" would satisfy arms 1 and 2
//        vacuously. This is the control.
//
// ⚠️ The nine-name sweep below then closes the gap between "true of `status`"
// and "true of the class": it drives EVERY priority name hidden at once.
//
// ⚠️ The sibling harness `packages/rest/src/ui-view-route-tenancy.measurement.test.ts`
// (#13214 / PR #13258) drives the same defect through the REST route and pins
// the pre-fix answer as a measurement. It belongs to that card and is
// deliberately not edited here; this file is the pin next to the code.

import { describe, it, expect } from 'vitest';
import { GetUiViewResponseSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The producer's own priority list, restated. It is a local `const` inside
 * `getUiView` and cannot be imported, so this copy is a duplicate by
 * necessity — which is why the assertions below never rely on it alone: each
 * case also asserts the name-agnostic invariant *no emitted column is declared
 * hidden*, computed from the fixture. A tenth priority name added without the
 * filter fails that invariant even though this list would not know about it.
 */
const PRIORITY_NAMES = [
    'name', 'title', 'label', 'subject', 'email', 'status', 'type', 'category', 'created_at',
] as const;

/**
 * Three arms in one object, per the header:
 *   - `status`      — hidden AND a priority name   (arm 1, the defect)
 *   - `beta_secret` — hidden, NOT a priority name  (arm 2, already correct)
 *   - `name`        — a priority name, NOT hidden  (arm 3, the control)
 * `plain_note` keeps the fill pass exercised, and `created_at` keeps the
 * `sort` branch on the same path it takes in production.
 */
const MIXED = {
    name: 'account',
    label: 'Account',
    fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', type: 'text', label: 'Account Name', required: true },
        status: { name: 'status', type: 'text', label: 'Beta Status', hidden: true },
        beta_secret: { name: 'beta_secret', type: 'text', label: 'Beta Secret', hidden: true },
        plain_note: { name: 'plain_note', type: 'text', label: 'Plain Note' },
        created_at: { name: 'created_at', type: 'datetime', label: 'Created' },
    },
} as const;

function protocolFor(schema: unknown) {
    const engine = { registry: { getObject: () => schema } };
    return new ObjectStackProtocolImplementation(engine as any);
}

const columnsOf = (body: any): string[] => (body.list.columns as any[]).map((c) => c.field);
const labelsOf = (body: any): string[] => (body.list.columns as any[]).map((c) => c.label);
const formFieldsOf = (body: any): string[] =>
    (body.form.sections[0].fields as any[]).map((f) => f.field);

/** Every key the fixture declares `hidden: true` on — the fixture's own answer. */
const hiddenKeysOf = (schema: any): string[] =>
    Object.keys(schema.fields).filter((k) => schema.fields[k].hidden === true);

describe('[#13259] getUiView list branch honours `hidden` on the priority pass', () => {
    it('drops a hidden PRIORITY-named field, drops a hidden non-priority field, and still serves a visible priority field', async () => {
        const body: any = await protocolFor(MIXED).getUiView({ object: 'account', type: 'list' });
        const columns = columnsOf(body);

        // Arm 1 — the defect. `status` is hidden AND a priority name. Before
        // the fix this came back as `{ field: 'status', label: 'Beta Status',
        // sortable: true }`.
        expect(columns).not.toContain('status');

        // Arm 2 — hidden, not a priority name. Correct before the fix too; it
        // is here so a repair that broke the fill pass would not read as green.
        expect(columns).not.toContain('beta_secret');

        // Arm 3 — the control. Without this the two assertions above are
        // satisfied by a producer that emits nothing at all.
        expect(columns).toContain('name');
        expect(columns).toContain('plain_note');
        expect(columns.length).toBeGreaterThan(0);

        // The name-agnostic form of the same statement: whatever the priority
        // list happens to contain, no emitted column may be declared hidden.
        expect(columns.filter((c) => (MIXED.fields as any)[c]?.hidden === true)).toEqual([]);
    });

    it('does not leak the LABEL of a hidden field either', async () => {
        // The card's finding was not "a field name appears" — the emitted
        // column carried `label: 'Beta Status'`, an authored human string.
        const body: any = await protocolFor(MIXED).getUiView({ object: 'account', type: 'list' });
        expect(labelsOf(body)).not.toContain('Beta Status');
        expect(labelsOf(body)).not.toContain('Beta Secret');
        // Control: the visible field's label is still served.
        expect(labelsOf(body)).toContain('Account Name');
    });

    it('does not offer a hidden field as searchable', async () => {
        // `searchableFields` is `columns.slice(0, 3)`, so a hidden priority
        // name reaching `columns` also reached the search affordance. Derived,
        // but worth pinning: it is a second user-visible consequence of the
        // same line, and a future rewrite could re-derive it independently.
        const body: any = await protocolFor(MIXED).getUiView({ object: 'account', type: 'list' });
        const searchable: string[] = body.list.searchableFields;
        expect(searchable).not.toContain('status');
        expect(searchable).not.toContain('beta_secret');
        expect(searchable.length).toBeGreaterThan(0);
    });

    // ⚠️ The class, not the field. Every one of the nine priority names is
    // declared hidden at once, plus a single visible non-priority field so the
    // expected answer is a specific non-empty set rather than "empty".
    it('holds for ALL NINE priority names, not just the one the card drove', async () => {
        const allHidden: any = {
            name: 'sweep',
            label: 'Sweep',
            fields: {
                id: { name: 'id', type: 'text' },
                visible_note: { name: 'visible_note', type: 'text', label: 'Visible Note' },
                ...Object.fromEntries(
                    PRIORITY_NAMES.map((n) => [n, { name: n, type: 'text', label: `L ${n}`, hidden: true }]),
                ),
            },
        };

        const body: any = await protocolFor(allHidden).getUiView({ object: 'sweep', type: 'list' });
        const columns = columnsOf(body);

        // Exactly the one visible field — every priority name is withheld, and
        // the answer is not vacuously empty.
        expect(columns).toEqual(['visible_note']);
        for (const n of PRIORITY_NAMES) expect(columns).not.toContain(n);
        expect(columns.filter((c) => allHidden.fields[c]?.hidden === true)).toEqual([]);
    });

    // The other half of the finding: two branches of ONE producer disagreed.
    // Asserting they now agree is not the same as asserting the list branch
    // changed, so both are driven from the same fixture and compared.
    it('the list and form branches now agree about what `hidden` withholds', async () => {
        const p = protocolFor(MIXED);
        const list: any = await p.getUiView({ object: 'account', type: 'list' });
        const form: any = await p.getUiView({ object: 'account', type: 'form' });

        const hidden = hiddenKeysOf(MIXED);
        expect(hidden).toEqual(['status', 'beta_secret']); // the fixture says what it says

        for (const k of hidden) {
            expect(columnsOf(list)).not.toContain(k);
            expect(formFieldsOf(form)).not.toContain(k);
        }
    });

    // ⛔ The form branch is NOT what this card changes, so its exact output is
    // pinned rather than merely asserted to be "still filtering". If the repair
    // had over-reached into the form branch, this is what would say so.
    it('the form branch is unchanged — exact field list pinned', async () => {
        const form: any = await protocolFor(MIXED).getUiView({ object: 'account', type: 'form' });
        // `id`, `created_at` and `updated_at` are excluded by the form branch's
        // own rule; `status` and `beta_secret` by `hidden`. Order is the
        // schema's declaration order.
        expect(formFieldsOf(form)).toEqual(['name', 'plain_note']);
    });

    // The narrowed body must still satisfy the response contract it declares —
    // a fix that emitted a well-shaped-but-invalid payload would otherwise go
    // out unchecked (`rest-server.ts` does a bare `res.json(view)`).
    it('the narrowed list body still parses GREEN against GetUiViewResponseSchema', async () => {
        const body = await protocolFor(MIXED).getUiView({ object: 'account', type: 'list' });
        const parsed = GetUiViewResponseSchema.safeParse(body);
        const explain = parsed.success
            ? 'GREEN'
            : parsed.error.issues.map((i: any) => `[${i.code}] path=${JSON.stringify(i.path)} ${i.message}`).join('\n');
        expect(explain).toBe('GREEN');
    });
});
