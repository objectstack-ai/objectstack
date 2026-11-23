// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D4] Load-time diagnostics judge a `managedBy: 'synced'` object as
 * its author wrote it, never with the `_sync_` provenance columns the registry
 * injected onto it.
 *
 * `ObjectSchema` reserves the `_sync_` prefix for author fields, and every read
 * of a synced object serves the five injected columns. Judging the served copy
 * would flag every synced object. Only a field that is exactly the platform's
 * definition is left out; an author field with a `_sync_` name, or one that
 * differs from the platform's in any key, is still judged and refused.
 */
import { describe, expect, it } from 'vitest';
import { SYNC_PROVENANCE_COLUMNS, SYNC_PROVENANCE_FIELD_DEFS } from '@objectstack/spec/data';
import { computeMetadataDiagnostics } from './metadata-diagnostics.js';

const authored = () => ({
    name: 'erp_customer',
    label: 'ERP customer',
    managedBy: 'synced',
    fields: { code: { name: 'code', type: 'text', label: 'Code' } },
});

const served = () => {
    const doc = authored() as Record<string, any>;
    for (const name of SYNC_PROVENANCE_COLUMNS) doc.fields[name] = { ...SYNC_PROVENANCE_FIELD_DEFS[name] };
    doc.indexes = [{ fields: ['organization_id', '_sync_source', '_sync_external_id'] }];
    return doc;
};

const syncPaths = (d: ReturnType<typeof computeMetadataDiagnostics>) =>
    (d?.errors ?? []).map((e) => e.path).filter((p) => p.includes('_sync_'));

describe('[ADR-0153 D4] diagnostics — the injected sync provenance columns', () => {
    it('CONTROL: the authored synced object is clean', () => {
        expect(computeMetadataDiagnostics('object', authored())).toEqual({ valid: true });
    });

    it('the served copy, carrying the five injected columns, is judged clean too', () => {
        expect(syncPaths(computeMetadataDiagnostics('object', served()))).toEqual([]);
        expect(computeMetadataDiagnostics('object', served())?.valid).toBe(true);
    });

    it('an author field under a _sync_ name is still refused', () => {
        const doc = authored() as Record<string, any>;
        doc.fields._sync_note = { name: '_sync_note', type: 'text', label: 'Note' };
        const d = computeMetadataDiagnostics('object', doc);
        expect(d?.valid).toBe(false);
        expect(syncPaths(d).length).toBeGreaterThan(0);
    });

    it('a _sync_ column that differs from the platform definition is judged as written', () => {
        const doc = served();
        doc.fields._sync_source = { ...doc.fields._sync_source, readonly: false };
        expect(syncPaths(computeMetadataDiagnostics('object', doc)).length).toBeGreaterThan(0);
    });
});
