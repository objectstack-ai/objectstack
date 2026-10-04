// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 D1] A denied field is removed WHOLE — its references elsewhere in
 * the served object document go with its `fields` entry. These pins drive the
 * real projection (`applyObjectSchemaMask`) over synthetic documents, one
 * position kind at a time, each with its control: the reference to a READABLE
 * field in the same position survives.
 */

import { describe, it, expect } from 'vitest';
import { FieldSchema, ObjectSchema } from '@objectstack/spec/data';
import { applyObjectSchemaMask, type ObjectSchemaMaskPosture } from './object-schema-fls.js';
import {
    FIELD_REFERENCE_POSITIONS,
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

    it('leaves names of ANOTHER object\'s fields alone — they are that object\'s projection', () => {
        const served = mask({
            name: 'thing',
            fields: fieldsWith({ type: 'lookup', reference: 'other', lookupColumns: ['secret_score'], displayField: 'secret_score' }),
        });
        expect(served.fields.title.lookupColumns).toEqual(['secret_score']);
        expect(served.fields.title.displayField).toBe('secret_score');
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
    it('does not match a longer identifier or a capitalised word', () => {
        expect(mentionsDenied('record.score_band', denied)).toBe(false);
        expect(mentionsDenied('Score', denied)).toBe(false);
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

    it('classifies nothing the spec no longer declares', () => {
        const objectKeys = new Set(declaredKeys(ObjectSchema));
        const fieldKeys = new Set(declaredKeys(FieldSchema));
        expect(Object.keys(OBJECT_REFERENCE_POSITIONS).filter((key) => !objectKeys.has(key))).toEqual([]);
        expect(Object.keys(FIELD_REFERENCE_POSITIONS).filter((key) => !fieldKeys.has(key))).toEqual([]);
    });
});

describe('[ADR-0106] the shared contract table, driven through the bare projection', () => {
    for (const testCase of OBJECT_SCHEMA_MASK_CASES.filter((c) => c.expect.kind === 'fields')) {
        it(testCase.id, () => {
            const readable = testCase.readable as readonly string[];
            const { document } = applyObjectSchemaMask(FLS_CONTRACT_OBJECT, project([...readable]));
            assertObjectSchemaMaskCase('applyObjectSchemaMask', testCase, { kind: 'document', document });
        });
    }
});
