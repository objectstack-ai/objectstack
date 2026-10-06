// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 D1] A denied field is removed WHOLE — its references elsewhere in
 * the served object document go with its `fields` entry. These pins drive the
 * real projection (`applyObjectSchemaMask`) over synthetic documents, one
 * position kind at a time, each with its control: the reference to a READABLE
 * field in the same position survives.
 */

import { describe, it, expect } from 'vitest';
import { FieldSchema, InlineGridColumnSchema, ObjectSchema } from '@objectstack/spec/data';
import { ColumnPrefixSchema, ColumnSummaryConfigSchema, ListColumnSchema } from '@objectstack/spec/ui';
import {
    applyObjectSchemaMask,
    relateObjectSchemaMaskPosture,
    resolveObjectSchemaMaskPosture,
    type ObjectSchemaMaskPosture,
} from './object-schema-fls.js';
import {
    COLUMN_PREFIX_POSITIONS,
    COLUMN_SUMMARY_POSITIONS,
    FIELD_REFERENCE_POSITIONS,
    INLINE_COLUMN_POSITIONS,
    LIST_COLUMN_POSITIONS,
    OBJECT_REFERENCE_POSITIONS,
    mentionsDenied,
} from './object-schema-fls-references.js';
import {
    FLS_CONTRACT_OBJECT,
    OBJECT_SCHEMA_MASK_CASES,
    assertObjectSchemaMaskCase,
} from './object-schema-fls-contract.js';

const project = (readable: string[]): ObjectSchemaMaskPosture => ({ kind: 'project', readable: new Set(readable) });

/** Three fields; `secret_score` is the one a restricted caller cannot read. */
const fieldsWith = (extra: Record<string, unknown> = {}) => ({
    id: { type: 'text' },
    title: { type: 'text', ...extra },
    secret_score: { type: 'number' },
});

const mask = (document: Record<string, unknown>) =>
    applyObjectSchemaMask(document, project(['id', 'title'])).document as Record<string, any>;

describe('[ADR-0106 D1] references to a denied field — object level', () => {
    it('drops a validation rule whose condition reads the denied field, and keeps the one that does not', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            validations: [
                { type: 'script', name: 'score_cap', condition: { dialect: 'cel', source: 'record.secret_score > 10' }, message: 'Too high.' },
                { type: 'script', name: 'title_set', condition: 'record.title == ""', message: 'Title required.' },
            ],
        });
        expect(served.validations.map((r: any) => r.name)).toEqual(['title_set']);
    });

    it('drops a rule that names the denied field only through a pointer (`field` / `fields[]`)', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            validations: [
                { type: 'state_machine', name: 'score_flow', field: 'secret_score', transitions: {}, message: 'x' },
                { type: 'cross_field', name: 'pair', fields: ['secret_score', 'title'], condition: 'true', message: 'x' },
            ],
        });
        expect(served).not.toHaveProperty('validations');
    });

    it('deletes role pointers naming the denied field, keeps pointers naming readable ones', () => {
        const served = mask({ name: 'thing', fields: fieldsWith(), nameField: 'title', stageField: 'secret_score', imageField: 'secret_score' });
        expect(served.nameField).toBe('title');
        expect(served).not.toHaveProperty('stageField');
        expect(served).not.toHaveProperty('imageField');
    });

    it('filters name lists, and deletes a list left empty', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            highlightFields: ['secret_score', 'title'],
            searchableFields: ['secret_score'],
        });
        expect(served.highlightFields).toEqual(['title']);
        expect(served).not.toHaveProperty('searchableFields');
    });

    it('deletes an expression that reads the denied field (template, field-group predicate)', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            titleFormat: '{title} / {secret_score}',
            fieldGroups: [
                { key: 'scores', label: 'Scores', visibleWhen: 'record.secret_score != null' },
                { key: 'main', label: 'Main', visibleWhen: 'record.title != null' },
            ],
        });
        expect(served).not.toHaveProperty('titleFormat');
        expect(served.fieldGroups).toEqual([
            { key: 'scores', label: 'Scores' },
            { key: 'main', label: 'Main', visibleWhen: 'record.title != null' },
        ]);
    });

    it('drops indexes and milestones over the denied field', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            indexes: [{ fields: ['secret_score'] }, { fields: ['title'] }],
            activityMilestones: [{ field: 'secret_score', value: 1, summary: 'Scored' }],
        });
        expect(served.indexes).toEqual([{ fields: ['title'] }]);
        expect(served).not.toHaveProperty('activityMilestones');
    });

    it('scrubs the nested policy blocks: tenancy, lifecycle, publicSharing, external, userActions', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            tenancy: { enabled: true, tenantField: 'secret_score' },
            lifecycle: { class: 'record', ttl: { field: 'secret_score', expireAfter: '30d' } },
            publicSharing: { enabled: true, redactFields: ['secret_score', 'title'], eligibility: 'record.secret_score > 0' },
            external: { remoteName: 't', columnMap: { SCORE: 'secret_score', TITLE: 'title' } },
            userActions: { edit: { enabled: true, disabledWhen: 'record.secret_score > 5' }, delete: false },
        });
        expect(served.tenancy).toEqual({ enabled: true });
        expect(served.lifecycle).toEqual({ class: 'record' });
        expect(served.publicSharing).toEqual({ enabled: true, redactFields: ['title'] });
        expect(served.external).toEqual({ remoteName: 't', columnMap: { TITLE: 'title' } });
        expect(served.userActions).toEqual({ edit: { enabled: true }, delete: false });
    });

    it('filters a list view\'s columns, and drops a view whose filter reads the denied field', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            listViews: {
                all: { label: 'All', columns: ['title', 'secret_score'] },
                high: { label: 'High', columns: ['title'], filter: [['secret_score', '>', 5]] },
            },
        });
        expect(served.listViews).toEqual({ all: { label: 'All', columns: ['title'] } });
    });

    it('drops an object-form column whose nested `prefix.field` / `summary.field` names the denied field', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            listViews: {
                all: {
                    label: 'All',
                    columns: [
                        { field: 'title', prefix: { field: 'secret_score', type: 'badge' } },
                        { field: 'title', summary: { type: 'sum', field: 'secret_score' } },
                        { field: 'id', prefix: { field: 'title', type: 'badge' }, summary: { type: 'count', field: 'title' } },
                        { field: 'title', summary: 'sum', type: 'currency', action: 'secret_score' },
                    ],
                },
                only: { label: 'Only', columns: [{ field: 'title', prefix: { field: 'secret_score', type: 'text' } }] },
            },
        });
        // Control: nested pointers to a readable field, the bare summary
        // vocabulary, a renderer type and an action id all stay.
        expect(served.listViews).toEqual({
            all: {
                label: 'All',
                columns: [
                    { field: 'id', prefix: { field: 'title', type: 'badge' }, summary: { type: 'count', field: 'title' } },
                    { field: 'title', summary: 'sum', type: 'currency', action: 'secret_score' },
                ],
            },
            only: { label: 'Only' },
        });
    });

    it('drops an object-form column carrying a key the column table does not classify, when it mentions the denied field', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            listViews: { all: { label: 'All', columns: [{ field: 'title', futureFacet: { field: 'secret_score' } }, { field: 'id', futureFacet: 'title' }] } },
        });
        expect(served.listViews.all.columns).toEqual([{ field: 'id', futureFacet: 'title' }]);
    });

    it('drops an action whose predicate reads the denied field — but not for a word in its prose', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            actions: [
                { name: 'rescore', label: 'Rescore', visible: 'record.secret_score > 0' },
                { name: 'retitle', label: 'Retitle', description: 'Ignores secret_score entirely.' },
            ],
        });
        expect(served.actions.map((a: any) => a.name)).toEqual(['retitle']);
    });

    it('drops a list view KEYED by the denied field\'s name; the others stay', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            listViews: {
                secret_score: { label: 'By score', columns: ['title'] },
                all: { label: 'All', columns: ['title'] },
            },
        });
        expect(served.listViews).toEqual({ all: { label: 'All', columns: ['title'] } });
    });

    it('drops an action whose `patch` writes the denied field (a field-keyed block)', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith(),
            actions: [
                { name: 'zero', label: 'Zero', type: 'script', operation: 'update', patch: { secret_score: 0 } },
                { name: 'clear', label: 'Clear', type: 'script', operation: 'update', patch: { title: '' } },
            ],
        });
        expect(served.actions.map((a: any) => a.name)).toEqual(['clear']);
    });

    it('serves a field group keyed like the denied field — a group name is not a field reference', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith({ group: 'secret_score' }),
            fieldGroups: [{ key: 'secret_score', label: 'Scores' }],
        });
        expect(served.fieldGroups).toEqual([{ key: 'secret_score', label: 'Scores' }]);
        expect(served.fields.title.group).toBe('secret_score');
    });

    it('deletes an UNCLASSIFIED key that mentions the denied field — fail-safe, never a leak', () => {
        const served = mask({ name: 'thing', fields: fieldsWith(), futureKey: { pick: 'record.secret_score' }, otherKey: 'title' });
        expect(served).not.toHaveProperty('futureKey');
        expect(served.otherKey).toBe('title');
    });
});

describe('[ADR-0106 D1] references to a denied field — inside a READABLE field', () => {
    it('filters `relatedListColumns` and `dependsOn` (both entry shapes)', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith({
                relatedListColumns: ['title', 'secret_score'],
                dependsOn: ['id', { field: 'secret_score', param: 's' }],
            }),
        });
        expect(served.fields.title.relatedListColumns).toEqual(['title']);
        expect(served.fields.title.dependsOn).toEqual(['id']);
    });

    it('reads a dotted path rooted at the denied field as a reference to it — keys, names and pointers alike', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith({ relatedListFilter: { 'secret_score.city': 'x' }, relatedListColumns: ['title', 'secret_score.city'] }),
            nameField: 'secret_score.city',
            displayNameField: 'title.city',
            lifecycle: { class: 'record', retention: { maxAge: '30d', onlyWhen: { 'secret_score.city': 'x' } } },
            listViews: { all: { label: 'All', columns: ['title.city', 'secret_score.city'] } },
        });
        expect(served.fields.title).not.toHaveProperty('relatedListFilter');
        expect(served.fields.title.relatedListColumns).toEqual(['title']);
        expect(served).not.toHaveProperty('nameField');
        expect(served.displayNameField).toBe('title.city');
        expect(served.lifecycle).toEqual({ class: 'record', retention: { maxAge: '30d' } });
        expect(served.listViews.all.columns).toEqual(['title.city']);
    });

    it('reads a `dependsOn` entry\'s `param` as the lookup target\'s key, not a field of this object', () => {
        const served = mask({ name: 'thing', fields: fieldsWith({ dependsOn: [{ field: 'id', param: 'secret_score' }] }) });
        expect(served.fields.title.dependsOn).toEqual([{ field: 'id', param: 'secret_score' }]);
    });

    it('deletes the formula and predicates that read the denied field; the field and its other facets stay', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith({
                label: 'Title',
                expression: { dialect: 'cel', source: 'record.secret_score * 2' },
                visibleWhen: 'record.secret_score > 0',
                requiredWhen: 'record.id != null',
                relatedListFilter: { secret_score: { $gt: 0 } },
                options: [{ value: 'a', label: 'A', visibleWhen: 'record.secret_score > 1' }],
            }),
        });
        expect(served.fields.title).toEqual({
            type: 'text',
            label: 'Title',
            requiredWhen: 'record.id != null',
            options: [{ value: 'a', label: 'A' }],
        });
    });

    it('scrubs the inline master-detail grid — its columns are THIS (child) object\'s own fields', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith({
                type: 'master_detail',
                reference: 'parent_thing',
                inlineColumns: [
                    { name: 'id' },
                    { name: 'secret_score', label: 'Score' },
                    { name: 'title', label: 'Title', type: 'lookup', reference: 'other', displayField: 'secret_score', readonlyWhen: 'record.secret_score > 0' },
                    { name: 'id', computed: true, expr: 'secret_score * 2' },
                    { name: 'title', computed: true, expr: 'id + 1' },
                ],
                inlineAmountField: 'secret_score',
            }),
        });
        expect(served.fields.title.inlineColumns).toEqual([
            { name: 'id' },
            // `displayField` names a field of the lookup's own target — kept.
            { name: 'title', label: 'Title', type: 'lookup', reference: 'other', displayField: 'secret_score' },
            { name: 'title', computed: true, expr: 'id + 1' },
        ]);
        expect(served.fields.title).not.toHaveProperty('inlineAmountField');
    });

    it('keeps a readable inline amount field, and deletes a grid left with no column', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith({ type: 'master_detail', inlineColumns: [{ name: 'secret_score' }], inlineAmountField: 'id' }),
        });
        expect(served.fields.title).not.toHaveProperty('inlineColumns');
        expect(served.fields.title.inlineAmountField).toBe('id');
    });

    it('leaves names of ANOTHER object\'s fields alone — they are that object\'s projection', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith({ type: 'lookup', reference: 'other', lookupColumns: ['secret_score'], displayField: 'secret_score' }),
        });
        expect(served.fields.title.lookupColumns).toEqual(['secret_score']);
        expect(served.fields.title.displayField).toBe('secret_score');
    });
});

describe('[ADR-0106 D1] a denied field named like a schema word costs only its own references', () => {
    /** `type` and `source` are both denied; `title` is the readable control. */
    const maskWords = (document: Record<string, unknown>) =>
        applyObjectSchemaMask(document, project(['id', 'title'])).document as Record<string, any>;
    const wordFields = (extra: Record<string, unknown> = {}) => ({
        id: { type: 'text' },
        title: { type: 'text', ...extra },
        type: { type: 'text' },
        source: { type: 'text' },
    });

    it('keeps every rule that does not read `type` / `source`, though each carries a `type` key and a `{ dialect, source }` envelope', () => {
        const served = maskWords({
            name: 'thing',
            fields: wordFields(),
            validations: [
                { type: 'script', name: 'title_set', condition: { dialect: 'cel', source: 'record.title == ""' }, message: 'x' },
                { type: 'format', name: 'title_url', field: 'title', format: 'url', message: 'x' },
                { type: 'script', name: 'typed', condition: { dialect: 'cel', source: 'record.type == "a"' }, message: 'x' },
                { type: 'cross_field', name: 'pair', fields: ['source', 'title'], condition: 'true', message: 'x' },
            ],
            indexes: [{ name: 'by_title', fields: ['title'], unique: 'global' }, { fields: ['source'] }],
        });
        expect(served.validations.map((r: any) => r.name)).toEqual(['title_set', 'title_url']);
        expect(served.indexes).toEqual([{ name: 'by_title', fields: ['title'], unique: 'global' }]);
    });

    it('keeps every list view and action that does not read them, though each carries a `type` key', () => {
        const served = maskWords({
            name: 'thing',
            fields: wordFields(),
            listViews: {
                all: { label: 'All', type: 'grid', columns: ['title', 'type'], filter: [{ field: 'title', operator: 'is_not_null' }] },
                typed: { label: 'Typed', type: 'grid', columns: ['title'], filter: [{ field: 'type', operator: 'equals', value: 'a' }] },
            },
            actions: [
                { name: 'retitle', label: 'Retitle', type: 'script', visible: { dialect: 'cel', source: 'record.title != null' } },
                { name: 'resource', label: 'Re-source', type: 'script', visible: 'record.source != null' },
            ],
        });
        expect(served.listViews).toEqual({
            all: { label: 'All', type: 'grid', columns: ['title'], filter: [{ field: 'title', operator: 'is_not_null' }] },
        });
        expect(served.actions.map((a: any) => a.name)).toEqual(['retitle']);
    });

    it('keeps a readable field\'s CEL envelopes; a field-keyed filter still keys on the field name', () => {
        const served = maskWords({
            name: 'thing',
            fields: wordFields({
                visibleWhen: { dialect: 'cel', source: 'record.id != null' },
                expression: { dialect: 'cel', source: 'record.id * 2' },
                relatedListFilter: { type: { $eq: 'a' } },
            }),
            lifecycle: { class: 'record', retention: { maxAge: '30d', onlyWhen: { source: 'import' } } },
        });
        expect(served.fields.title.visibleWhen).toEqual({ dialect: 'cel', source: 'record.id != null' });
        expect(served.fields.title.expression).toEqual({ dialect: 'cel', source: 'record.id * 2' });
        expect(served.fields.title).not.toHaveProperty('relatedListFilter');
        expect(served.lifecycle).toEqual({ class: 'record', retention: { maxAge: '30d' } });
    });

    it('a field-keyed filter does not read a `$`-operator as a field: denied `and` keeps `$and` over readable fields', () => {
        const served = applyObjectSchemaMask({
            name: 'thing',
            fields: { id: { type: 'text' }, title: { type: 'text', relatedListFilter: { $and: [{ id: { $ne: null } }] } }, and: { type: 'text' } },
        }, project(['id', 'title'])).document as Record<string, any>;
        expect(served.fields.title.relatedListFilter).toEqual({ $and: [{ id: { $ne: null } }] });
    });
});

describe('[ADR-0106 D1/D3] the projection stays pure', () => {
    const SOURCE = {
        name: 'thing',
        fields: fieldsWith({ visibleWhen: 'record.secret_score > 0' }),
        validations: [{ type: 'script', name: 'cap', condition: 'record.secret_score > 1', message: 'x' }],
    };

    it('never mutates the shared cache entry', () => {
        const source = JSON.parse(JSON.stringify(SOURCE));
        const before = JSON.stringify(source);
        mask(source);
        expect(JSON.stringify(source)).toBe(before);
    });

    it('serves the SAME reference to a caller who denies nothing', () => {
        expect(applyObjectSchemaMask(SOURCE, project(['id', 'title', 'secret_score'])).document).toBe(SOURCE);
    });

    it('is total on a cyclic document: it terminates, and still removes the reference', () => {
        const cyclic: Record<string, any> = { name: 'thing', fields: fieldsWith() };
        const loop: Record<string, any> = { pick: 'record.secret_score' };
        loop.self = loop;
        cyclic.futureKey = loop;
        cyclic.otherKey = { back: cyclic };
        cyclic.validations = [{ type: 'script', name: 'cap', condition: 'record.title == ""', message: 'x' }];
        cyclic.validations[0].again = cyclic.validations;
        const served = mask(cyclic);
        expect(served).not.toHaveProperty('futureKey');
        expect(served.validations.map((r: any) => r.name)).toEqual(['cap']);
    });

    it('keeps the document\'s key order', () => {
        expect(Object.keys(mask({ ...SOURCE, label: 'Thing' }))).toEqual(['name', 'fields', 'label']);
    });
});

describe('mentionsDenied is an identifier-token test', () => {
    const denied = new Set(['score']);
    it('matches a name embedded in an expression, a template and a filter key', () => {
        expect(mentionsDenied('record.score > 1', denied)).toBe(true);
        expect(mentionsDenied('{score}', denied)).toBe(true);
        expect(mentionsDenied({ score: { $gt: 1 } }, denied)).toBe(true);
    });
    it('reads keys only where the caller says they are field names', () => {
        expect(mentionsDenied({ score: 1 }, denied, 'include', 'classified')).toBe(false);
        expect(mentionsDenied({ filter: { score: 1 } }, denied, 'include', 'classified')).toBe(true);
        expect(mentionsDenied({ score: 1 }, denied, 'include', 'field-keyed')).toBe(true);
        expect(mentionsDenied({ type: 'score' }, denied, 'include', 'classified')).toBe(false);
        expect(mentionsDenied({ type: 'score' }, denied, 'include', 'all')).toBe(true);
    });
    it('does not match a longer identifier or a capitalised word', () => {
        expect(mentionsDenied('record.score_band', denied)).toBe(false);
        expect(mentionsDenied('Score', denied)).toBe(false);
    });
});

describe('[ADR-0106 D1] an action param under `objectOverride` is judged against the object it names', () => {
    // The shape of `sys_user.invite_user`: `role` is a field of BOTH objects,
    // and the param names the member's — not the user's.
    const SYS_USER = {
        name: 'sys_user',
        fields: { id: { type: 'text' }, email: { type: 'email' }, role: { type: 'text' } },
        actions: [
            {
                name: 'invite_user',
                label: 'Invite User',
                type: 'api',
                params: [
                    { field: 'email', required: true },
                    { field: 'role', objectOverride: 'sys_member', required: true },
                ],
            },
            { name: 'set_role', label: 'Set Role', type: 'api', params: [{ field: 'role', required: true }] },
            { name: 'mail', label: 'Mail', type: 'api', params: [{ field: 'email' }] },
        ],
    };

    /** A security service answering per object, as plugin-security does. */
    const securityFor = (answers: Record<string, string[] | undefined | 'throw'>) => ({
        getMetadataReadableFields: async (object: string) => {
            const answer = answers[object];
            if (answer === 'throw') throw new Error(`security unhealthy for ${object} (test)`);
            return answer === undefined ? undefined : [...answer];
        },
    });

    /** The exit's sequence: resolve before the fetch, relate after it, mask. */
    const serve = async (
        answers: Record<string, string[] | undefined | 'throw'>,
        document: Record<string, unknown> = SYS_USER,
        context: Record<string, unknown> = { userId: 'u_delegate', systemPermissions: [] },
    ) => {
        const posture = await resolveObjectSchemaMaskPosture({
            objectName: String(document.name), context, security: securityFor(answers), enabled: true,
        });
        return applyObjectSchemaMask(document, await relateObjectSchemaMaskPosture(posture, document));
    };
    const actionNames = (result: { document: unknown }) => ((result.document as any).actions ?? []).map((a: any) => a.name);

    it('serves `invite_user` to a caller denied THIS object\'s `role` who may read the named object\'s `role` (the delegated_admin shape)', async () => {
        const result = await serve({ sys_user: ['id', 'email'], sys_member: ['id', 'role', 'user_id'] });
        expect(result.denied).toEqual(['role']);
        expect(actionNames(result)).toEqual(['invite_user', 'mail']);
        // Served as authored — the param still names the member's `role`.
        expect((result.document as any).actions[0].params[1]).toEqual({ field: 'role', objectOverride: 'sys_member', required: true });
    });

    it('still drops an action whose param names a denied field of THIS object', async () => {
        const result = await serve({ sys_user: ['id', 'email'], sys_member: ['id', 'role'] });
        expect(actionNames(result)).not.toContain('set_role');
        // An override naming this object IS this object: the same reading.
        const self = await serve({ sys_user: ['id', 'email'], sys_member: ['id', 'role'] }, {
            ...SYS_USER,
            actions: [{ name: 'self_role', type: 'api', params: [{ field: 'role', objectOverride: 'sys_user' }] }],
        });
        expect(actionNames(self)).toEqual([]);
    });

    it('still drops the action when the caller is denied the field on the object the override names', async () => {
        const denied = await serve({ sys_user: ['id', 'email'], sys_member: ['id', 'user_id'] });
        expect(actionNames(denied)).toEqual(['mail']);
        // Even when nothing of THIS object is denied: the read is the other object's.
        const thisWhole = await serve({ sys_user: ['id', 'email', 'role'], sys_member: ['id', 'user_id'] });
        expect(thisWhole.denied).toEqual([]);
        expect(actionNames(thisWhole)).toEqual(['set_role', 'mail']);
    });

    it('fails closed when the named object\'s readable set cannot be determined — undetermined, throwing, or unknown', async () => {
        for (const sysMember of [undefined, 'throw'] as const) {
            expect(actionNames(await serve({ sys_user: ['id', 'email', 'role'], sys_member: sysMember }))).toEqual(['set_role', 'mail']);
        }
        const unknown = await serve({ sys_user: ['id', 'email', 'role'] }, {
            ...SYS_USER,
            actions: [{ name: 'ghost', type: 'api', params: [{ field: 'role', objectOverride: 'no_such_object' }] }],
        });
        expect(actionNames(unknown)).toEqual([]);
        // A posture nobody related (an exit that skipped the step) relates nothing: closed too.
        const unrelated = applyObjectSchemaMask(SYS_USER, { kind: 'project', readable: new Set(['id', 'email', 'role']) });
        expect(actionNames(unrelated)).toEqual(['set_role', 'mail']);
    });

    it('leaves an exempt caller\'s schema whole, and never asks about the related object', async () => {
        let asked = 0;
        const posture = await resolveObjectSchemaMaskPosture({
            objectName: 'sys_user',
            context: { userId: 'u_admin', systemPermissions: ['setup.access'] },
            security: { getMetadataReadableFields: async () => { asked++; return []; } },
            enabled: true,
        });
        const related = await relateObjectSchemaMaskPosture(posture, SYS_USER);
        expect(related).toBe(posture);
        expect(applyObjectSchemaMask(SYS_USER, related).document).toBe(SYS_USER);
        expect(asked).toBe(0);
    });

    it('reads a `name` restating `field` as that field; an explicit other `name`, and a `defaultFromRow` seed, as THIS object\'s', async () => {
        const answers = { sys_user: ['id', 'email'], sys_member: ['id', 'role', 'title'] };
        const withParam = (param: Record<string, unknown>) => ({ ...SYS_USER, actions: [{ name: 'act', type: 'api', params: [param] }] });
        // The default body key, spelled out, is the same read.
        expect(actionNames(await serve(answers, withParam({ name: 'role', field: 'role', objectOverride: 'sys_member' })))).toEqual(['act']);
        // A body key that differs from the field keeps the existing reading: it
        // spells a denied field of this object, so the action goes.
        expect(actionNames(await serve(answers, withParam({ name: 'role', field: 'title', objectOverride: 'sys_member' })))).toEqual([]);
        expect(actionNames(await serve(answers, withParam({ name: 'member_role', field: 'role', objectOverride: 'sys_member' })))).toEqual(['act']);
        // `defaultFromRow` seeds the value from THIS object's row — a read here too.
        expect(actionNames(await serve(answers, withParam({ field: 'role', objectOverride: 'sys_member', defaultFromRow: true })))).toEqual([]);
        // The rest of the param is still this object's: a predicate over a denied field drops it.
        expect(actionNames(await serve(answers, withParam({ field: 'role', objectOverride: 'sys_member', visible: 'record.role != null' })))).toEqual([]);
    });

    it('folds a withheld related read into the fingerprint, so two cohorts never share a validator for different bodies', async () => {
        const reads = await serve({ sys_user: ['id', 'email'], sys_member: ['id', 'role'] });
        const cannot = await serve({ sys_user: ['id', 'email'], sys_member: ['id'] });
        expect(reads.denied).toEqual(cannot.denied);
        expect(reads.fingerprint).not.toBe(cannot.fingerprint);
        // An unrestricted caller on both objects keeps the empty fingerprint and the same reference.
        const whole = await serve({ sys_user: ['id', 'email', 'role'], sys_member: ['id', 'role'] });
        expect(whole.fingerprint).toBe('');
        expect(whole.document).toBe(SYS_USER);
    });

    it('relates each named object once, across documents, and leaves a document with no such read alone', async () => {
        const asked: string[] = [];
        const posture = await resolveObjectSchemaMaskPosture({
            objectName: 'sys_user',
            context: { userId: 'u' },
            security: { getMetadataReadableFields: async (object: string) => { asked.push(object); return ['id', 'role']; } },
            enabled: true,
        });
        expect(await relateObjectSchemaMaskPosture(posture, { name: 'sys_user', actions: [] })).toBe(posture);
        const related = await relateObjectSchemaMaskPosture(posture, SYS_USER, SYS_USER);
        expect(await relateObjectSchemaMaskPosture(related, SYS_USER)).toBe(related);
        expect(asked).toEqual(['sys_user', 'sys_member']);
    });
});

/** The keys a Zod object schema declares. */
function declaredKeys(schema: unknown): string[] {
    const shape = (schema as { shape?: Record<string, unknown> }).shape;
    if (!shape || typeof shape !== 'object') throw new Error('schema exposes no `.shape` — the pin cannot read it');
    return Object.keys(shape);
}

describe('[ADR-0106 D1] every position is classified — closed against the live spec', () => {
    it('classifies every top-level ObjectSchema key (`fields` is the projection itself)', () => {
        const unclassified = declaredKeys(ObjectSchema).filter((key) => key !== 'fields' && !(key in OBJECT_REFERENCE_POSITIONS));
        expect(unclassified, 'classify each new ObjectSchema key in OBJECT_REFERENCE_POSITIONS').toEqual([]);
    });

    it('classifies every FieldSchema key', () => {
        const unclassified = declaredKeys(FieldSchema).filter((key) => !(key in FIELD_REFERENCE_POSITIONS));
        expect(unclassified, 'classify each new FieldSchema key in FIELD_REFERENCE_POSITIONS').toEqual([]);
    });

    it('classifies every InlineGridColumnSchema key', () => {
        const unclassified = declaredKeys(InlineGridColumnSchema).filter((key) => !(key in INLINE_COLUMN_POSITIONS));
        expect(unclassified, 'classify each new InlineGridColumnSchema key in INLINE_COLUMN_POSITIONS').toEqual([]);
    });

    // A list column's nested pointers (`prefix.field`, `summary.field`) name
    // fields of this object: a new facet must be classified before it ships.
    for (const [label, schema, table] of [
        ['ListColumnSchema', ListColumnSchema, LIST_COLUMN_POSITIONS],
        ['ColumnPrefixSchema', ColumnPrefixSchema, COLUMN_PREFIX_POSITIONS],
        ['ColumnSummaryConfigSchema', ColumnSummaryConfigSchema, COLUMN_SUMMARY_POSITIONS],
    ] as const) {
        it(`classifies every ${label} key, and nothing it no longer declares`, () => {
            const keys = declaredKeys(schema);
            expect(keys.filter((key) => !(key in table)), `classify each new ${label} key`).toEqual([]);
            expect(Object.keys(table).filter((key) => !keys.includes(key))).toEqual([]);
        });
    }

    it('classifies nothing the spec no longer declares', () => {
        const objectKeys = new Set(declaredKeys(ObjectSchema));
        const fieldKeys = new Set(declaredKeys(FieldSchema));
        const columnKeys = new Set(declaredKeys(InlineGridColumnSchema));
        expect(Object.keys(INLINE_COLUMN_POSITIONS).filter((key) => !columnKeys.has(key))).toEqual([]);
        expect(Object.keys(OBJECT_REFERENCE_POSITIONS).filter((key) => !objectKeys.has(key))).toEqual([]);
        expect(Object.keys(FIELD_REFERENCE_POSITIONS).filter((key) => !fieldKeys.has(key))).toEqual([]);
    });
});

describe('[ADR-0106] the shared contract table, driven through the bare projection', () => {
    for (const testCase of OBJECT_SCHEMA_MASK_CASES.filter((c) => c.expect.kind === 'fields')) {
        it(testCase.id, () => {
            const readable = testCase.readable as readonly string[];
            // Related as an exit relates it: the contract's double answers the
            // same set for every object, `contact` included (#21884).
            const posture: ObjectSchemaMaskPosture = {
                kind: 'project', readable: new Set(readable), related: new Map([['contact', new Set(readable)]]),
            };
            const { document } = applyObjectSchemaMask(FLS_CONTRACT_OBJECT, posture);
            assertObjectSchemaMaskCase('applyObjectSchemaMask', testCase, { kind: 'document', document });
        });
    }
});
