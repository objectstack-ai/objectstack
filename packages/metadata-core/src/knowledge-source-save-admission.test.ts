// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0161 K4, guard two] `authoredKnowledgeSourceRefusal` — what every save
 * door asks before a `knowledge_source` is written: the knowledge service's
 * verdict for the AUTHOR. Pinned here: which saves are judged, that the
 * service is asked with the item and the author's context, and that the gate
 * fails closed.
 */

import { describe, it, expect, vi } from 'vitest';
import { authoredKnowledgeSourceRefusal, KNOWLEDGE_SOURCE_ADMISSION_SERVICE } from './knowledge-source-save-admission.js';

const ITEM = { name: 'faq', label: 'FAQ', adapter: 'memory', source: { kind: 'object', object: 'article', content: ['body'] } };
const AUTHOR = { userId: 'u_author', systemPermissions: ['manage_metadata', 'manage_knowledge_sources'] };
const REFUSED = { admitted: false as const, status: 403, code: 'PERMISSION_DENIED', message: "you may not query field 'salary' of object 'article'" };

const serviceAnswering = (verdict: unknown) => ({ admitAuthoredSource: vi.fn(async () => verdict) });

describe('authoredKnowledgeSourceRefusal — source admission at save', () => {
    it('the service name is the knowledge service\'s', () => {
        expect(KNOWLEDGE_SOURCE_ADMISSION_SERVICE).toBe('knowledge');
    });

    it('asks the knowledge service with the item and the author\'s context, and answers its refusal coded', async () => {
        const service = serviceAnswering(REFUSED);
        for (const type of ['knowledge_source', 'knowledge_sources']) {
            const refusal = await authoredKnowledgeSourceRefusal({ type, item: ITEM, executionContext: AUTHOR, resolveKnowledgeService: () => service });
            expect(refusal, type).toEqual({ status: 403, code: 'PERMISSION_DENIED', message: REFUSED.message });
        }
        expect(service.admitAuthoredSource).toHaveBeenCalledWith(ITEM, AUTHOR);
    });

    it('an admitted source saves: no refusal', async () => {
        const service = serviceAnswering({ admitted: true });
        expect(await authoredKnowledgeSourceRefusal({ type: 'knowledge_source', item: ITEM, executionContext: AUTHOR, resolveKnowledgeService: async () => service })).toBeUndefined();
        expect(service.admitAuthoredSource).toHaveBeenCalledTimes(1);
    });

    it('another type, and the engine\'s own write, are not judged: the service is never resolved', async () => {
        const resolve = vi.fn(() => serviceAnswering(REFUSED));
        expect(await authoredKnowledgeSourceRefusal({ type: 'object', item: ITEM, executionContext: AUTHOR, resolveKnowledgeService: resolve })).toBeUndefined();
        expect(await authoredKnowledgeSourceRefusal({ type: 'knowledge_source', item: ITEM, executionContext: { isSystem: true }, resolveKnowledgeService: resolve })).toBeUndefined();
        expect(resolve).not.toHaveBeenCalled();
    });

    it('no knowledge service, or one without the member, judges nothing: nothing loads the item there', async () => {
        for (const service of [undefined, null, {}, { search: async () => [] }]) {
            expect(await authoredKnowledgeSourceRefusal({ type: 'knowledge_source', item: ITEM, executionContext: AUTHOR, resolveKnowledgeService: () => service })).toBeUndefined();
        }
    });

    it('fails closed, SERVICE_UNAVAILABLE / 503: a service that cannot be resolved, and a verdict that throws', async () => {
        const unresolved = await authoredKnowledgeSourceRefusal({
            type: 'knowledge_source', item: ITEM, executionContext: AUTHOR,
            resolveKnowledgeService: async () => { throw new Error('factory failed'); },
        });
        expect(unresolved).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(unresolved?.message).toContain('factory failed');
        expect(unresolved?.message).toContain('Nothing was written');

        const thrown = await authoredKnowledgeSourceRefusal({
            type: 'knowledge_source', item: ITEM, executionContext: AUTHOR,
            resolveKnowledgeService: () => ({ admitAuthoredSource: async () => { throw new Error('registry unavailable'); } }),
        });
        expect(thrown).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(thrown?.message).toContain('registry unavailable');
    });

    it('`isSystem: false` is not a bypass', async () => {
        const service = serviceAnswering(REFUSED);
        const refusal = await authoredKnowledgeSourceRefusal({ type: 'knowledge_source', item: ITEM, executionContext: { ...AUTHOR, isSystem: false }, resolveKnowledgeService: () => service });
        expect(refusal?.status).toBe(403);
    });
});
