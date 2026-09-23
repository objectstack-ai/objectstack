// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19417] The protocol install primitive parses `manifest.id` through the
 * declaration that owns it.
 *
 * ---------------------------------------------------------------------------
 * The gap these pins close
 * ---------------------------------------------------------------------------
 * `MANIFEST_ID_PATTERN` (`packages/spec/src/kernel/manifest.zod.ts`) is the
 * reverse-domain rule declared ONCE and referenced by both faces of the package
 * identity — `ManifestSchema.id` (what an author writes) and
 * `PackageSchema.manifestId` (what the registry stores and publishes by).
 * `ObjectStackProtocolImplementation.installPackage` never parsed it: the
 * request was spread into `any` and handed to the registry with a second
 * `as any`, so `pkg-a` and `com.example.my_erp` installed and persisted while
 * `defineStack()`, `os build`, `os validate` and the publish face all refused
 * the same id.
 *
 * #19473 landed the same parse at the HTTP door (`POST /packages`,
 * `packages/runtime/src/domains/packages.ts`). That door is ONE caller of this
 * primitive; `duplicatePackage` is a second and an embedder holding the
 * protocol object is a third — which is why the gate belongs here.
 *
 * ---------------------------------------------------------------------------
 * Both directions are pinned, deliberately
 * ---------------------------------------------------------------------------
 * A refusal pin alone cannot tell "the rule is enforced" from "this door stopped
 * installing anything": every refusal case is answered by a lit control on a
 * conforming id that still installs, and by the assertion that the registry was
 * never reached on the refused ones.
 *
 * The refusal text is compared against `manifestIdRefusal` itself rather than
 * retyped here: the sentence is the declaration's, SURFACED, and a pin that
 * restated it would go green on a reworded fourth sentence for one rule.
 */
import { describe, it, expect, vi } from 'vitest';
import { manifestIdRefusal } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** Ids `MANIFEST_ID_PATTERN` refuses, one per reason it refuses them. */
const REFUSED = [
    ['a bare word — no reverse-domain prefix at all', 'pkg-a'],
    ['an underscore inside a segment', 'com.example.my_erp'],
    ['the empty string', ''],
    ['a segment opening with a digit', 'com.4example.crm'],
] as const;

/** Ids the declaration admits — the lit controls. */
const ADMITTED = ['com.example.crm', 'com.example.my-erp', 'org.apache.superset'] as const;

function makeImpl() {
    const registryCalls: Array<{ manifest: any }> = [];
    const engine = {
        registry: {
            installPackage: (manifest: any) => {
                registryCalls.push({ manifest });
                return { manifest, status: 'installed', enabled: true };
            },
        },
        find: async () => [],
    };
    const publish = vi.fn(async () => ({ success: true }));
    const services = new Map<string, any>([['package', { publish }]]);
    const impl = new ObjectStackProtocolImplementation(engine as never, () => services);
    return { impl, registryCalls, publish };
}

/** The thrown refusal, or a failure naming what happened instead. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
    try {
        await run();
    } catch (e) {
        return e;
    }
    throw new Error('expected the call to be refused, but it resolved');
}

describe('[#19417] installPackage parses `manifest.id` through its declaration', () => {
    for (const [why, id] of REFUSED) {
        it(`refuses ${why} (${JSON.stringify(id)}) before any write`, async () => {
            const { impl, registryCalls, publish } = makeImpl();
            const err = await refusalOf(() => (impl as any).installPackage({
                manifest: { id, name: 'X', version: '1.0.0' },
            }));
            // The envelope: an HTTP boundary answers 400, not the 500 an
            // unannotated throw earns (`resolveThrownHttpError`).
            expect(err.statusCode).toBe(400);
            // The sentence is the DECLARATION's, surfaced — not this door's.
            expect(err.message).toBe(manifestIdRefusal('manifest.id', id));
            // Neither writer ran: not the in-memory registry, not the durable row.
            expect(registryCalls).toHaveLength(0);
            expect(publish).not.toHaveBeenCalled();
        });
    }

    it('refuses a manifest carrying no `id` at all, and still never writes', async () => {
        const { impl, registryCalls, publish } = makeImpl();
        const err = await refusalOf(() => (impl as any).installPackage({
            manifest: { name: 'X', version: '1.0.0' },
        }));
        expect(err.statusCode).toBe(400);
        expect(registryCalls).toHaveLength(0);
        expect(publish).not.toHaveBeenCalled();
    });

    it('carries the declaration\'s mechanical repair, not just its rule', async () => {
        const { impl } = makeImpl();
        const err = await refusalOf(() => (impl as any).installPackage({
            manifest: { id: 'com.example.my_erp', version: '1.0.0' },
        }));
        // The repair arm is the whole difference between a rule restated and a
        // fix; `manifestIdRefusal` verifies its candidate before offering it.
        expect(err.message).toContain('com.example.my-erp');
    });

    for (const id of ADMITTED) {
        it(`lit control — '${id}' still installs`, async () => {
            const { impl, registryCalls } = makeImpl();
            const res: any = await (impl as any).installPackage({
                manifest: { id, name: 'X', version: '1.0.0' },
            });
            expect(registryCalls).toHaveLength(1);
            expect(registryCalls[0].manifest.id).toBe(id);
            expect(res.package.status).toBe('installed');
        });
    }

    it('the raw value is parsed — a padded id is refused, not laundered by a trim', async () => {
        const { impl, registryCalls } = makeImpl();
        const err = await refusalOf(() => (impl as any).installPackage({
            manifest: { id: '  com.example.crm  ', version: '1.0.0' },
        }));
        expect(err.statusCode).toBe(400);
        expect(registryCalls).toHaveLength(0);
    });
});

/** A duplicate-door harness: one source package holding one object row. */
function makeDuplicateImpl(sourceId = 'com.example.leave') {
    const rows = [{
        id: 'r_1',
        type: 'object',
        name: 'leave_ticket',
        organization_id: null,
        package_id: sourceId,
        state: 'active',
        metadata: JSON.stringify({ name: 'leave_ticket', label: 'Ticket' }),
    }];
    const installed: any[] = [];
    const engine: any = {
        find: vi.fn(async () => rows),
        registry: {
            getPackage: vi.fn(() => ({
                manifest: { id: sourceId, name: 'Leave', namespace: 'leave', version: '1.0.0' },
            })),
            installPackage: vi.fn((manifest: any) => {
                installed.push(manifest);
                return { manifest, status: 'installed', enabled: true };
            }),
        },
    };
    const impl = new ObjectStackProtocolImplementation(engine as never, () => new Map());
    const saveMetaItem = vi.spyOn(impl, 'saveMetaItem' as never);
    (saveMetaItem as any).mockResolvedValue({ success: true } as never);
    return { impl, engine, installed, saveMetaItem };
}

describe('[#19417] duplicatePackage refuses a target id the declaration refuses', () => {
    for (const [why, id] of REFUSED) {
        it(`refuses ${why} (${JSON.stringify(id)}) before anything is minted`, async () => {
            const { impl, engine, installed, saveMetaItem } = makeDuplicateImpl();
            const err = await refusalOf(() => (impl as any).duplicatePackage({
                sourcePackageId: 'com.example.leave',
                targetPackageId: id,
            }));
            expect(err.statusCode).toBe(400);
            // The key named is the one the caller actually wrote.
            expect(err.message).toBe(manifestIdRefusal('targetPackageId', id));
            // ⭐ Nothing was minted and nothing was scanned: the refusal
            // precedes the manifest write AND the copy loop, so no empty shell
            // is left behind. The manifest write below sits inside a
            // best-effort `catch {}` — a refusal raised only there would be
            // swallowed and reported as `success: true`.
            expect(installed).toHaveLength(0);
            expect(engine.registry.installPackage).not.toHaveBeenCalled();
            expect(engine.find).not.toHaveBeenCalled();
            expect(saveMetaItem).not.toHaveBeenCalled();
        });
    }

    it('lit control — a conforming target still duplicates, rows and all', async () => {
        const { impl, installed, saveMetaItem } = makeDuplicateImpl();
        const res: any = await (impl as any).duplicatePackage({
            sourcePackageId: 'com.example.leave',
            targetPackageId: 'com.example.leave-copy',
        });
        expect(res.success).toBe(true);
        expect(res.copiedCount).toBe(1);
        expect(installed).toHaveLength(1);
        expect(installed[0].id).toBe('com.example.leave-copy');
        expect(saveMetaItem).toHaveBeenCalledTimes(1);
    });
});

describe('[#19417] duplicatePackage derives its namespace with the spec helper', () => {
    it('the Studio default `<sourceId>-copy` yields a LEGAL object-name prefix', async () => {
        const { impl, installed, saveMetaItem } = makeDuplicateImpl();
        await (impl as any).duplicatePackage({
            sourcePackageId: 'com.example.leave',
            targetPackageId: 'com.example.leave-copy',
        });
        // `deriveNamespaceFromPackageId` sanitises the hyphen; the raw
        // `split('.').pop()` this replaced answered 'leave-copy', and an object
        // name is /^[a-z_][a-z0-9_]*$/ — so the copy used to be minted under
        // names the object declaration refuses.
        expect(installed[0].namespace).toBe('leave_copy');
        const written = (saveMetaItem as any).mock.calls.map((c: any[]) => c[0].name);
        expect(written).toEqual(['leave_copy_ticket']);
    });

    it('an explicit `targetNamespace` still wins', async () => {
        const { impl, installed } = makeDuplicateImpl();
        await (impl as any).duplicatePackage({
            sourcePackageId: 'com.example.leave',
            targetPackageId: 'com.example.leave-copy',
            targetNamespace: 'leave2',
        });
        expect(installed[0].namespace).toBe('leave2');
    });

    it('refuses loudly when no namespace can be derived, naming the remedy', async () => {
        const { impl, installed } = makeDuplicateImpl();
        const err = await refusalOf(() => (impl as any).duplicatePackage({
            sourcePackageId: 'com.example.leave',
            // Admitted by the id pattern, but a single-letter final segment
            // cannot carry the namespace charset's 2–20 char rule.
            targetPackageId: 'com.example.a',
        }));
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('targetNamespace');
        expect(installed).toHaveLength(0);
    });
});
