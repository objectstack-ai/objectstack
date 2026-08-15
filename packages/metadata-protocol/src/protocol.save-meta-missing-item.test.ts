// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8818 — `saveMetaItem`'s opening guard was the ONE refusal in the method
 * that declared no ADR-0112 envelope, so consumers applying the rule withheld
 * its sentence and the REST boundary served it as a server fault.
 *
 * ## What was measured, end to end, before the fix
 *
 * The card was filed as an observation with an explicitly unverified premise
 * ("read from source, no victim measured"), so the premise was probed against
 * a real server (`pnpm dev:crm -- --fresh`, `PUT /api/v1/meta/view/:name`,
 * authenticated as the seeded platform admin) before a line was changed:
 *
 * | request body | reaches this guard? | answered (before) |
 * |---|---|---|
 * | *(no body at all)* | no | `422 INVALID_METADATA` |
 * | `null` | no | `422 INVALID_METADATA` |
 * | `{}` | no | `422 INVALID_METADATA` |
 * | `{"item": null}` | **YES** | **`500 INTERNAL_ERROR`** |
 * | `{"metadata": null}` | **YES** | **`500 INTERNAL_ERROR`** |
 *
 * So the honest outcomes the card itself listed — "unreachable, leave it
 * alone" and "a programming-error guard, not an authoring refusal" — are both
 * FALSE, and the reason is precise: `PUT /meta/:type/:name` unwraps the
 * `{ item }` / `{ metadata }` envelope shapes before calling, so an
 * explicitly-null envelope arrives as `item: null` and lands here, while a
 * missing/empty/`null` BODY folds to `{}` (truthy) and is refused downstream
 * by the per-type Zod parse. The reachable population is caller-authored JSON
 * only; every internal caller passes a concrete document.
 *
 * The cost was also LARGER than filed. The card predicted the sentence would
 * degrade to a consumer's generic fallback; what the wire actually did was
 * answer **500 `INTERNAL_ERROR`** — because `handleRouteError` has no status
 * to read and defaults to a server fault. A 500 does not merely tell the
 * author less, it tells them something FALSE: that the server broke and the
 * request is worth retrying, when it can never succeed unchanged.
 *
 * ## Why the `clientFacingFailureText` assertion is the point of this file
 *
 * A test asserting only `code`/`status` on the thrown error would pass without
 * demonstrating the thing the card is about. `declaresClientRefusal` is a
 * POSITIVE list keyed on a 4xx `status`, so the assertion that matters is that
 * the sentence now SURVIVES the rule rather than being replaced by the
 * caller's fallback — and that assertion is only evidence next to its control:
 * the same helper, handed the bare `Error` this guard used to throw, still
 * withholds. Both directions are asserted below; drop the control and the pin
 * would stay green against a `clientFacingFailureText` that had stopped
 * withholding anything at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation, clientFacingFailureText } from './protocol.js';

/**
 * A protocol over an engine whose every verb is a tripwire: this guard is the
 * FIRST statement of `saveMetaItem`, so a refusal that touched the engine at
 * all would mean the check had moved behind something with side effects.
 */
function makeProtocol() {
    const findOne = vi.fn(async () => null);
    const find = vi.fn(async () => [] as unknown[]);
    const engine = {
        registry: { getObject: () => undefined },
        findOne,
        find,
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), findOne, find };
}

/** The refusal a rejected request produced, plus proof the engine was untouched. */
async function refusalFor(request: Record<string, unknown>) {
    const { p, findOne, find } = makeProtocol();
    let answered: unknown;
    try {
        answered = await (p as any).saveMetaItem(request);
    } catch (e) {
        expect(findOne, 'the engine was reached before the refusal').not.toHaveBeenCalled();
        expect(find, 'the engine was reached before the refusal').not.toHaveBeenCalled();
        return e as Error & { code?: string; status?: number };
    }
    throw new Error(
        `${JSON.stringify(request)} was ACCEPTED (answered ${JSON.stringify(answered)}) instead of refused`,
    );
}

describe('#8818 — a save with no item declares the ADR-0112 envelope', () => {
    // The three spellings that reach this guard. `item: null` is the one the
    // REST route actually produces (from `{"item": null}` / `{"metadata":
    // null}`); the other two are the same condition reached through the SDK
    // and the protocol interface, where `item` is an optional parameter.
    it.each<[string, Record<string, unknown>]>([
        ['an explicitly null item (what the wire produces)', { type: 'app', name: 'a', item: null }],
        ['an absent item', { type: 'app', name: 'a' }],
        ['an explicitly undefined item', { type: 'app', name: 'a', item: undefined }],
    ])('refuses %s with 400 INVALID_REQUEST', async (_label, request) => {
        const err = await refusalFor(request);

        // The envelope, not merely the throw. A bare `toThrow()` here would be
        // permanently green: the UNFIXED guard threw too — that was the whole
        // defect — so the throw carries no information and only the
        // declaration does.
        expect(err.code).toBe('INVALID_REQUEST');
        expect(err.status).toBe(400);
    });

    it('names the remedy in the message, so the refusal is self-correcting', async () => {
        const err = await refusalFor({ type: 'view', name: 'my_view', item: null });

        expect(err.message).toContain("requires an 'item' body");
        // The address the author got wrong is echoed back to them.
        expect(err.message).toContain('view/my_view');
    });

    it('does not refuse a request that DOES carry an item', async () => {
        // What a refusal is cheapest to break. Green in both directions on its
        // own — it is a guard, not evidence — but an over-broad guard (say, one
        // testing `'item' in request`) would turn it red.
        const { p } = makeProtocol();
        await expect(
            (p as any).saveMetaItem({ type: 'app', name: 'a', item: { name: 'a' } }),
        ).rejects.not.toMatchObject({ code: 'INVALID_REQUEST' });
    });
});

describe('#8818 — the refusal now SURVIVES the ADR-0112 disclosure rule', () => {
    it('is quoted back to the author instead of degrading to the fallback', async () => {
        const err = await refusalFor({ type: 'app', name: 'test_app', item: null });

        const shown = clientFacingFailureText(err, 'save failed');

        // THE POINT OF THE CARD: a consumer applying the #8086/#8136 rule now
        // shows the producer's own sentence.
        expect(shown).not.toBe('save failed');
        expect(shown).toBe(err.message);
        expect(shown).toContain("requires an 'item' body");
    });

    it('CONTROL — the bare Error this guard used to throw is still withheld', () => {
        // Byte-for-byte what `origin/main` threw at this site. Without this
        // control the assertion above would also pass against a
        // `clientFacingFailureText` that had stopped withholding ANYTHING,
        // which is the regression that would silently re-open #8086.
        const undeclared = new Error('Item data is required');

        expect(clientFacingFailureText(undeclared, 'save failed')).toBe('save failed');
    });
});
