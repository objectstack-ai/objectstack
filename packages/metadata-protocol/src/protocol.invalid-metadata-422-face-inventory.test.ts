// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10888 — the face inventory for `saveMetaItem`'s spec-validation
 * `422 INVALID_METADATA`, and the pins that hold its conclusion.
 *
 * ## The duplication that raised the card
 *
 * The refusal rendered its own findings into the message
 * (`issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')` plus a
 * `(+N more)` tail) AND attached the same array as `err.issues`. On the HTTP
 * 422 both channels ride one response, so every console rendering both showed
 * each finding twice — the #10524 shape, on the save door.
 *
 * ## The conclusion: trim PER FACE, and let silence mean "keep the prose"
 *
 * A blanket trim was tried during #10524 and reverted: some faces put this
 * sentence on a **200 response body** or in a **log**, where no structured
 * channel exists and the sentence is the SOLE carrier of the author's
 * prescription. #10886 reached the same verdict for the sibling 409.
 *
 * The maintainer ruling on #11017 (2026-08-22, option D) resolved it by
 * reusing #11015/#11099's per-face rendering rather than by declaring a
 * response contract for `duplicatePackage`: faces that already carry a
 * structured `issues[]` drop the prose restatement; the duplicate face keeps
 * it in full.
 *
 * ## The inventory, re-derived for THIS gate
 *
 * ⚠️ It is NOT the 409's inventory with a different verb name, and reusing that
 * table would have been wrong in three rows. The 409 fires only when
 * `!request.force` AND the folded type is `object`/`field` AND a row already
 * exists AND the diff is non-empty. **This gate has none of those conditions**:
 * it fires whenever `getMetadataTypeSchema(<singular type>)` resolves and the
 * body fails `safeParse`. So `force: true` does not exempt a caller here, and
 * neither does a literal `type` — `app` and `permission` both have registered
 * schemas.
 *
 * | # | caller | type | reaches THIS gate | face | structured `issues[]` |
 * |:--|:--|:--|:--|:--|:--|
 * | 1 | `@objectstack/rest` `PUT /meta/:type/:name` | any | yes | `sendError` 422 body | **yes** — top-level `issues` |
 * | 2 | `@objectstack/rest` `PUT /meta/:type/:a/:b` | any | yes | the same body | **yes** |
 * | 3 | `@objectstack/runtime` dispatcher `PUT /meta` | any | yes | `errorFromThrown` → `details.issues` | **yes** |
 * | 4 | `@objectstack/runtime` ADR-0045 visibility flip | `'app'` | **yes** — `app: AppSchema` | `unhideError` + log | ⛔ **no** |
 * | 5 | `migrateStoredMetadata` | any | **yes** — `force` does not gate this check | `rows[].reason` on a report | ⛔ **no** |
 * | 6 | `duplicatePackage` | `row.type` | yes | `failed[].error` on a **200** | ⛔ **no — sole carrier** |
 * | 7 | `plugin-security` permission-set projection ×4 | `'permission'` | **yes** — `permission: PermissionSetSchema` | `logger.error` text | ⛔ **no** |
 *
 * Rows 4, 5 and 7 are the ones the 409's table eliminated and this one cannot.
 * Row 7 matters most: its log sentence prescribes "make the record body
 * spec-valid (**the error names the offending key**)" — a remedy written on the
 * assumption that this clause names it.
 *
 * ## Why the polarity is "declare to trim", not "declare to keep"
 *
 * Rows 4 and 7 live in OTHER packages, reached through `(protocol as any)`.
 * Neither can state a face without making `writeFace` a field an arbitrary
 * caller sets. Under the opposite polarity — trim by default, message-only
 * faces opt out — both would lose their prescription **silently**, and so would
 * every write door added later by an author who never read this file. So
 * silence renders the full prose, and only rows 1-3 declare
 * `writeFace: 'meta-envelope'`.
 *
 * That the declaration is not client-settable is structural, not conventional:
 * each door builds the `saveMetaItem` request object field by field from named
 * `req` values and never spreads the body.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Predicted: with `specValidationFindings`' `'meta-envelope'` case deleted (so
 * every face falls to the prose branch), the `'meta-envelope'` pins below go
 * RED and **nothing else in the package moves** — the three #8333 GUARD pins
 * that hold the prescription (`protocol.batch-verb-driver-text.test.ts` P10 and
 * the two in `protocol.save-union-issues.test.ts`) are asserting the DEFAULT
 * face, which that ablation does not touch. Measured: exactly that. See the PR
 * body for the run.
 *
 * Harness: the real repository write path over a stub engine — a change INSIDE
 * `saveMetaItem` cannot use a harness that mocks `saveMetaItem`. The subject is
 * imported as `./protocol.js`, a RELATIVE source specifier, so vitest resolves
 * it to `src/protocol.ts` and no `dist/` is on the path; the ablation therefore
 * needs no rebuild, and its RED result rules out a stale-artifact false green.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
}

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;

function makeProtocol() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const engine: any = {
        async findOne() { return null; },
        async find() { return []; },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        registry: { registerItem: () => {}, registerObject: () => {} },
    };
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map());
    return { protocol, rows };
}

/**
 * The issue's own repro body: a list view whose `summary` carries a typo'd key.
 * `ViewMetadataSchema` is a top-level union, so this is also the root-level
 * union case the card flagged as the headline's worst input.
 */
const typoView = () => ({
    name: 'task_list',
    object: 'task',
    type: 'list',
    label: 'Tasks',
    columns: [{ field: 'title', summary: { type: 'sum', fieldd: 'amount' } }],
});

async function refusal(protocol: any, writeFace?: string): Promise<any> {
    try {
        await protocol.saveMetaItem({
            type: 'view',
            name: 'task_list',
            item: typoView(),
            ...(writeFace ? { writeFace } : {}),
        });
    } catch (e: any) {
        return e;
    }
    throw new Error('expected saveMetaItem to refuse the invalid body');
}

/** The #4001 curated prescription the three #8333 GUARD pins hold. */
const PRESCRIPTION = 'Unrecognized key(s) on this view container';

// ═══════════════════════════════════════════════════════════════════════════
// 1. The structured channel is unconditional — the face decides only the prose
// ═══════════════════════════════════════════════════════════════════════════

describe('[#10888] `issues[]` is attached identically on every face', () => {
    it('the declared face and the default face carry the SAME findings', async () => {
        const { protocol } = makeProtocol();
        const plain = await refusal(protocol);
        const envelope = await refusal(protocol, 'meta-envelope');

        expect(plain.code).toBe('INVALID_METADATA');
        expect(envelope.code).toBe('INVALID_METADATA');
        expect(plain.status).toBe(422);
        expect(envelope.status).toBe(422);

        // ⭐ The load-bearing non-effect: trimming the SENTENCE withholds
        // nothing, because this array is what the sentence was restating.
        expect(envelope.issues).toEqual(plain.issues);
        expect(envelope.issues.length).toBeGreaterThan(1);
    });

    it('an invalid body is still refused, and still persists nothing', async () => {
        const { protocol, rows } = makeProtocol();
        await refusal(protocol, 'meta-envelope');

        // The accept set is unchanged by this card — it edits wording only.
        expect(rows.size).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Rows 1-3 — the declared face drops the restatement
// ═══════════════════════════════════════════════════════════════════════════

describe('[#10888] `meta-envelope` renders the headline, not the prose', () => {
    it('no issue message is restated in the sentence', async () => {
        const { protocol } = makeProtocol();
        const err = await refusal(protocol, 'meta-envelope');

        // The duplication, gone: not one finding appears twice on this face.
        for (const i of err.issues) {
            expect(err.message).not.toContain(i.message);
        }
        expect(err.message).not.toContain(PRESCRIPTION);
    });

    it('the headline still names HOW MANY and WHERE', async () => {
        const { protocol } = makeProtocol();
        const err = await refusal(protocol, 'meta-envelope');

        expect(err.message).toContain('[invalid_metadata] view/task_list failed spec validation: ');
        expect(err.message).toContain(`${err.issues.length} issue`);
        // The same grammar `seedRequestValidationError` composes — count plus
        // `path [zod code]` locators — so one mistake reads the same whichever
        // authoring door reported it.
        expect(err.message).toMatch(/\d+ issues? — /);
        expect(err.message).toContain('[invalid_union]');
    });

    /**
     * The card asked whether the headline degrades unacceptably on a
     * root-level union failure, where every locator's path is empty and the
     * key names live only in `issues[]`. MEASURED here rather than assumed,
     * because the answer decides whether the headline grammar needs work.
     *
     * It renders `<root> [invalid_union]; <root> [unrecognized_keys]` — the
     * `path || '<root>'` fallback predates this card and survives it, so the
     * locator is never blank. Degraded but not lossy: this face is, by the
     * definition of the face, one where `issues[]` rides along carrying the key
     * names. Hoisting them into the locator is an improvement to the shared
     * headline grammar (`metadataIssueHeadline`, which the seed refusal and the
     * author-time gate also compose) and deliberately NOT done here — one
     * message's wording is not the place to change three doors' grammar.
     */
    it('a root-level union failure still locates itself as `<root>`, never blank', async () => {
        const { protocol } = makeProtocol();
        const err = await refusal(protocol, 'meta-envelope');

        expect(err.message).toContain('<root> [invalid_union]');
        expect(err.message).not.toMatch(/: {2}\[/);
        expect(err.message).not.toContain(' [invalid_union];  [');

        // …and the key names the headline does not carry are on the channel
        // that made the trim safe in the first place.
        const unknownKey = err.issues.find((i: any) => i.code === 'unrecognized_keys');
        expect(unknownKey).toBeDefined();
        expect(unknownKey.message).toContain('`type`');
        expect(unknownKey.message).toContain('`columns`');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Rows 4-7 — the message-only faces keep the prescription, in full
// ═══════════════════════════════════════════════════════════════════════════

describe('[#10888 · GUARD] a face that carries no `issues[]` keeps the whole sentence', () => {
    /**
     * ⛔ The pin that must never be made green by deleting what it protects.
     * If a future trim widens to this branch, the author on rows 4-7 is told a
     * body is invalid and never told which key — the exact regression #10524's
     * trial-trim was reverted for.
     */
    it('the DEFAULT face restates the findings, byte for byte', async () => {
        const { protocol } = makeProtocol();
        const err = await refusal(protocol);

        const expected = err.issues.slice(0, 3)
            .map((i: { path: string; message: string }) => `${i.path || '<root>'}: ${i.message}`)
            .join('; ')
            + (err.issues.length > 3 ? ` (+${err.issues.length - 3} more)` : '');

        expect(err.message).toBe(
            `[invalid_metadata] view/task_list failed spec validation: ${expected}`,
        );
        // The #4001 self-correcting prescription, whole.
        expect(err.message).toContain(PRESCRIPTION);
    });

    it('row 6 — the duplicate face is explicitly on the keep side', async () => {
        const { protocol } = makeProtocol();
        const duplicate = await refusal(protocol, 'package-duplicate');
        const plain = await refusal(protocol);

        // #10886's verdict, unchanged: `failed[].error` is the sole carrier.
        // (The end-to-end pin through `duplicatePackage` itself is P10 in
        // `protocol.batch-verb-driver-text.test.ts`, still green, untouched.)
        expect(duplicate.message).toBe(plain.message);
        expect(duplicate.message).toContain(PRESCRIPTION);
        expect(duplicate.message).toContain('defineView(');
    });

    /**
     * The polarity itself, pinned. An unrecognised face is not a configuration
     * error to be reported — it is a door whose author did not declare a
     * structured channel, and the only safe reading of that is "assume there
     * isn't one".
     */
    it('an UNKNOWN face falls to the prose branch, not to the headline', async () => {
        const { protocol } = makeProtocol();
        const unknown = await refusal(protocol, 'some-future-door');
        const plain = await refusal(protocol);

        expect(unknown.message).toBe(plain.message);
        expect(unknown.message).toContain(PRESCRIPTION);
    });
});
