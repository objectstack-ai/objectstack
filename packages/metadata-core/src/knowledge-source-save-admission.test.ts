// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0161 K4, guard two] `authoredKnowledgeSourceRefusal` — what every save
 * door asks before a `knowledge_source` is written: the knowledge service's
 * verdict for the AUTHOR. Pinned here: which saves are judged, that the
 * service is asked with the item and the author's context, that a deployment
 * with no knowledge service refuses an author's save, and that the gate fails
 * closed.
 */

import { describe, it, expect, vi } from 'vitest';
import { authoredKnowledgeSourceRefusal, knowledgeServiceNotInScope, KNOWLEDGE_SOURCE_ADMISSION_SERVICE } from './knowledge-source-save-admission.js';

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

    it('no knowledge service registered: an author\'s save is refused SERVICE_UNAVAILABLE / 503, naming the reason and the remedy', async () => {
        for (const service of [undefined, null]) {
            for (const type of ['knowledge_source', 'knowledge_sources']) {
                const refusal = await authoredKnowledgeSourceRefusal({ type, item: ITEM, executionContext: AUTHOR, resolveKnowledgeService: async () => service });
                expect(refusal, `${type} / ${String(service)}`).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
                // The reason, the item, and the remedy in its order: the token, a restart, then the save.
                expect(refusal?.message).toMatch(/^The knowledge source 'faq' was not saved: this deployment runs no knowledge service/);
                expect(refusal?.message).toMatch(/requires: \['knowledge'\].*restart the server.*then save the source again/);
            }
        }
        // An item with no name is still refused, without a name to quote.
        const unnamed = await authoredKnowledgeSourceRefusal({ type: 'knowledge_source', item: {}, executionContext: AUTHOR, resolveKnowledgeService: () => undefined });
        expect(unnamed?.message).toMatch(/^The knowledge source was not saved: /);
    });

    it('no knowledge service registered: the engine\'s own write is not refused (a package install, a seed, a migration)', async () => {
        const resolve = vi.fn(() => undefined);
        expect(await authoredKnowledgeSourceRefusal({ type: 'knowledge_source', item: ITEM, executionContext: { isSystem: true }, resolveKnowledgeService: resolve })).toBeUndefined();
        expect(resolve).not.toHaveBeenCalled();
    });

    it('a registered knowledge service without the member (not the platform\'s) judges nothing: the save goes on', async () => {
        for (const service of [{}, { search: async () => [] }]) {
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

    /**
     * A registration that serves no instance in the request's scope (a host's
     * scoped factory): the deployment does run a knowledge service, so it is
     * not told it runs none, nor sent to the stack's `requires`.
     */
    it('a knowledge service registered with no instance in this scope: refused SERVICE_UNAVAILABLE / 503 with its own sentence, not the no-service one', async () => {
        const refusal = await authoredKnowledgeSourceRefusal({
            type: 'knowledge_source', item: ITEM, executionContext: AUTHOR,
            resolveKnowledgeService: async () => knowledgeServiceNotInScope('northwind'),
        });
        expect(refusal).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(refusal?.message).toMatch(
            /^The knowledge source 'faq' was not saved: the knowledge service registered on this deployment serves no instance for environment 'northwind', so nothing would load, index or search it there\./,
        );
        expect(refusal?.message).not.toContain('runs no knowledge service');
        expect(refusal?.message).not.toContain("requires: ['knowledge']");
        expect(refusal?.message).toMatch(/save the source again\. Nothing was written\.$/);
        // The engine's own write is not asked, scope miss or not.
        const resolve = vi.fn(() => knowledgeServiceNotInScope('northwind'));
        expect(await authoredKnowledgeSourceRefusal({ type: 'knowledge_source', item: ITEM, executionContext: { isSystem: true }, resolveKnowledgeService: resolve })).toBeUndefined();
        expect(resolve).not.toHaveBeenCalled();
    });

    /**
     * The package duplicate copies a package's sources: its caller is told to
     * duplicate the package again, and the door's prefix says once that
     * nothing was copied, so the sentence carries no "Nothing was written".
     */
    it('door: duplicate words each refusal the predicate composes for the duplicate\'s caller', async () => {
        const ask = (resolveKnowledgeService: () => unknown, item: unknown = ITEM) =>
            authoredKnowledgeSourceRefusal({ type: 'knowledge_source', item, executionContext: AUTHOR, resolveKnowledgeService, door: 'duplicate' });

        const none = await ask(() => undefined);
        expect(none).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(none?.message).toMatch(/^The knowledge source 'faq' cannot be copied: this deployment runs no knowledge service/);
        expect(none?.message).toMatch(/requires: \['knowledge'\].*restart the server, then duplicate the package again: /);

        const scoped = await ask(() => knowledgeServiceNotInScope('northwind'));
        expect(scoped).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(scoped?.message).toMatch(/^The knowledge source 'faq' cannot be copied: the knowledge service registered on this deployment serves no instance for environment 'northwind'/);
        expect(scoped?.message).toMatch(/duplicate the package again\.$/);

        const unresolved = await ask(async () => { throw new Error('factory failed'); });
        expect(unresolved).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(unresolved?.message).toMatch(/^The knowledge source cannot be copied: /);
        expect(unresolved?.message).toMatch(/Duplicate the package again\.$/);

        for (const refusal of [none, scoped, unresolved]) {
            expect(refusal?.message).not.toMatch(/save the source|Nothing was written/);
        }
        // A verdict of the knowledge service is its own sentence, passed through as before.
        expect(await ask(() => serviceAnswering(REFUSED))).toEqual({ status: 403, code: 'PERMISSION_DENIED', message: REFUSED.message });
    });

    it('`isSystem: false` is not a bypass', async () => {
        const service = serviceAnswering(REFUSED);
        const refusal = await authoredKnowledgeSourceRefusal({ type: 'knowledge_source', item: ITEM, executionContext: { ...AUTHOR, isSystem: false }, resolveKnowledgeService: () => service });
        expect(refusal?.status).toBe(403);
    });
});
