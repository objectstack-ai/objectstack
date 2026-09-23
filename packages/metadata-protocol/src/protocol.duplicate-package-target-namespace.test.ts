// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19577] `duplicatePackage` parses an EXPLICIT `targetNamespace` through the
 * same declaration its derived default already had to satisfy.
 *
 * ---------------------------------------------------------------------------
 * The gap these pins close
 * ---------------------------------------------------------------------------
 * The target namespace is spliced into every copied object name
 * (`${targetNs}_${short}`) and written as the copy's `manifest.namespace`.
 * #19417 made the DERIVED default go through `deriveNamespaceFromPackageId`,
 * which sanitises toward the namespace charset and answers `null` when nothing
 * valid comes out. The explicit branch of the same `??` was left raw:
 * `targetNamespace: 'my-ns'` minted `my-ns_ticket`, a name the object
 * declaration (`/^[a-z_][a-z0-9_]*$/`) refuses, and stored `my-ns` as a
 * manifest namespace the manifest declaration refuses.
 *
 * ---------------------------------------------------------------------------
 * What is pinned, and how
 * ---------------------------------------------------------------------------
 * - The refusal is asserted as the ENVELOPE an HTTP boundary answers with —
 *   `resolveThrownHttpError` (`@objectstack/types`), the one function both
 *   package doors call — so `status` and `code` are read the way the wire reads
 *   them, and `declaredCode` absent proves no new code was minted: the explicit
 *   branch answers the same status-derived code the derived branch does.
 * - The rule sentence is read off the DECLARATION
 *   (`ManifestSchema.shape.namespace`) rather than retyped here: a pin that
 *   restated it would stay green on a reworded second sentence for one rule.
 * - Every refusal also asserts that nothing was minted or scanned, and every
 *   refusal is answered by a lit control on a conforming explicit namespace
 *   that still duplicates under the names it prefixes — a refusal pin alone
 *   cannot tell "the rule is enforced" from "this door stopped duplicating".
 */
import { describe, it, expect, vi } from 'vitest';
import { ManifestSchema } from '@objectstack/spec/kernel';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** Explicit namespaces the declaration refuses, one per reason it refuses them. */
const REFUSED = [
    ['a hyphen — the Studio-shaped value the card names', 'my-ns'],
    ['an uppercase letter', 'MyNs'],
    ['a leading digit', '1leave'],
    ['a leading underscore', '_leave'],
    ['a single character — below the 2-char floor', 'l'],
    ['21 characters — above the 20-char ceiling', 'abcdefghijklmnopqrstu'],
    ['surrounding whitespace — parsed raw, never trimmed', ' leave2 '],
    ['the empty string', ''],
] as const;

/** Explicit namespaces the declaration admits — the lit controls. */
const ADMITTED = [
    ['a plain word', 'leave2'],
    ['an inner underscore', 'leave_copy'],
    ['exactly 20 characters — the ceiling itself', 'abcdefghijklmnopqrst'],
    ['exactly 2 characters — the floor itself', 'lv'],
] as const;

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

/** The thrown refusal, or a failure naming what happened instead. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
    try {
        await run();
    } catch (e) {
        return e;
    }
    throw new Error('expected the call to be refused, but it resolved');
}

/** The declaration's own sentence for a value — read, never retyped. */
function declarationSentence(value: string): string {
    const parsed = ManifestSchema.shape.namespace.safeParse(value);
    expect(parsed.success, `the fixture '${value}' must be one the declaration refuses`).toBe(false);
    return parsed.error!.issues[0]!.message;
}

describe('[#19577] duplicatePackage refuses an explicit targetNamespace the declaration refuses', () => {
    for (const [why, ns] of REFUSED) {
        it(`refuses ${why} (${JSON.stringify(ns)}) before anything is minted`, async () => {
            const { impl, engine, installed, saveMetaItem } = makeDuplicateImpl();
            const err = await refusalOf(() => (impl as any).duplicatePackage({
                sourcePackageId: 'com.example.leave',
                targetPackageId: 'com.example.leave-copy',
                targetNamespace: ns,
            }));

            // The envelope, as the HTTP boundary resolves it: a 400 carrying
            // the status-derived code — the same answer the derived branch's
            // refusal gets — and no producer-minted code beside it.
            const envelope = resolveThrownHttpError(err);
            expect(envelope.status).toBe(400);
            expect(envelope.code).toBe('VALIDATION_ERROR');
            expect(envelope.declaredCode).toBeUndefined();

            // The first sentence names the key the caller wrote and echoes the
            // value; the rule that follows is the DECLARATION's sentence.
            expect(err.message.startsWith(`Invalid package namespace '${ns}' on \`targetNamespace\`.`)).toBe(true);
            expect(err.message).toContain(declarationSentence(ns));

            // ⭐ Nothing was minted and nothing was scanned: the refusal
            // precedes the manifest write AND the copy loop. The manifest write
            // sits inside a best-effort `catch {}`, so a refusal raised only
            // there would be swallowed and reported as `success: true`.
            expect(installed).toHaveLength(0);
            expect(engine.registry.installPackage).not.toHaveBeenCalled();
            expect(engine.find).not.toHaveBeenCalled();
            expect(saveMetaItem).not.toHaveBeenCalled();
        });
    }
});

describe('[#19577] lit control — a conforming explicit targetNamespace still duplicates under it', () => {
    for (const [why, ns] of ADMITTED) {
        it(`${why} ('${ns}') is the copy's namespace and prefixes every copied object name`, async () => {
            expect(ManifestSchema.shape.namespace.safeParse(ns).success).toBe(true);
            const { impl, installed, saveMetaItem } = makeDuplicateImpl();
            const res: any = await (impl as any).duplicatePackage({
                sourcePackageId: 'com.example.leave',
                targetPackageId: 'com.example.leave-copy',
                targetNamespace: ns,
            });
            expect(res.success).toBe(true);
            expect(res.copiedCount).toBe(1);
            expect(installed).toHaveLength(1);
            expect(installed[0].namespace).toBe(ns);
            const written = (saveMetaItem as any).mock.calls.map((c: any[]) => c[0].name);
            expect(written).toEqual([`${ns}_ticket`]);
        });
    }
});

describe('[#19577] the derived branch refuses through the same parse', () => {
    it('an id with no derivable namespace answers the same envelope, with the declaration\'s sentence', async () => {
        const { impl, installed, engine } = makeDuplicateImpl();
        const err = await refusalOf(() => (impl as any).duplicatePackage({
            sourcePackageId: 'com.example.leave',
            // Admitted by the id pattern; a single-letter final segment cannot
            // carry the namespace charset.
            targetPackageId: 'com.example.a',
        }));
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(400);
        expect(envelope.code).toBe('VALIDATION_ERROR');
        expect(envelope.declaredCode).toBeUndefined();
        expect(err.message.startsWith("Cannot derive a package namespace from 'com.example.a'.")).toBe(true);
        expect(err.message).toContain('`targetNamespace`');
        expect(err.message).toContain(declarationSentence(''));
        expect(installed).toHaveLength(0);
        expect(engine.find).not.toHaveBeenCalled();
    });
});
