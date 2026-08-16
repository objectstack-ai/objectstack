// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9157 — the three READ verbs on the `/meta/:type/:name` URL family reach the
 * #7894 request boundary. Step ① of the maintainer ruling in #9180
 * (2026-08-16): *the `/meta` type segment is singular, always*.
 *
 * `auditMetaItem`, `historyMetaItem` and `findReferencesToMeta` each opened by
 * deriving their type key from `PLURAL_TO_SINGULAR` — the MANIFEST-COLLECTION
 * map #7894 moved this boundary off — instead of calling
 * `canonicalizeMetaRequestType`, which nine sibling verbs already call. That one
 * call carries BOTH the URL map and `metaUrlSpellingRefusal`, and the refusal is
 * the half those three could never reach: it lives INSIDE the function they
 * skipped.
 *
 * ## ⚠️ What this file pins that the filing card got wrong
 *
 * The card asserted that `PUT /meta/views/all_leads` is "refused 400 by the same
 * deployment for the same spelling". **Measured false**, and pinned false below
 * (`theRecognisedPluralsAreNotRefused`): `metaUrlSpellingRefusal('views')` is
 * `null`, because `views` is IN `META_URL_TO_SINGULAR` and therefore FOLDS. The
 * refusal class is *misspellings* of a declared type (`viewes`), never
 * recognised plurals. So the wire-visible flip this card delivers is:
 *
 *  | caller spelling | before | after |
 *  | --- | --- | --- |
 *  | `viewes` (misspelling of a declared type) | 200 `{events: []}` | **400**, naming `view` / `views` |
 *  | `translations` (manifest-ABSENT plural) | 200 `{events: []}` | 200 with the REAL events |
 *  | `views` (manifest-PRESENT plural) | 200, real body | unchanged |
 *  | `fieldz` (reaches for no declared type) | 200 | unchanged — the refusal stays narrow |
 *
 * Retiring the recognised plural spellings themselves is #9180 step ③, which
 * the ruling states must stay independently revertible. `theRecognisedPluralsAreNotRefused`
 * is therefore a pin AGAINST bundling, not an endorsement of the plural.
 *
 * ## ⛔ Why the fixtures are what they are (the anti-vacuity property)
 *
 * A fold pin whose folded and unfolded spellings AGREE is structurally
 * incapable of failing. `views` IS in the manifest map, so it folded before this
 * change and after it — it is the CONTROL here and proves nothing about the
 * fold. The subjects are the MANIFEST-ABSENT types, and the two of them behave
 * differently enough that both are needed:
 *
 *  - `translation` (`allowOrgOverride: true`) — the singular passes
 *    `historyMetaItem`'s gate and reads real rows. The plural did not fold, so
 *    it asked the repository for `type='translations'`, matched nothing, and
 *    answered `{ events: [] }` about an item with a full change log.
 *  - `field` (neither flag) — the singular is REFUSED by that same gate (early
 *    return, zero engine calls) while the unfolded plural sailed PAST it via
 *    `isRuntimeCreateAllowed`'s no-static-registry-entry arm — the plugin path —
 *    and issued a real history read keyed `'fields'`. Same empty body, opposite
 *    path, which is why the pins assert the KEY the store was asked for and not
 *    only the body.
 *
 * `manifestMapStillDoesNotFoldTheFixtures` asserts that asymmetry directly: if
 * `fields`/`translations` ever enter `PLURAL_TO_SINGULAR`, every fold assertion
 * here silently stops discriminating while staying green. That test going red is
 * the signal to re-pick the fixtures, not to delete the assertion.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { META_URL_TO_SINGULAR, PLURAL_TO_SINGULAR, metaUrlSpellingRefusal } from '@objectstack/spec/shared';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** Manifest-ABSENT and `allowOrgOverride: true` — history reads REAL rows for it. */
const OVERLAY_ABSENT_TYPE = 'translation';
const OVERLAY_ABSENT_PLURAL = 'translations';
/** Manifest-ABSENT and gated shut — the "plural is a door around the gate" case. */
const GATED_ABSENT_TYPE = 'field';
const GATED_ABSENT_PLURAL = 'fields';
/** Manifest-PRESENT: folded through the old map too. The control. */
const PRESENT_TYPE = 'view';
const PRESENT_PLURAL = 'views';
/**
 * An unrecognised spelling whose singular IS a declared type — the one class
 * `metaUrlSpellingRefusal` refuses. Measured, not guessed:
 * `metaUrlSpellingRefusal('viewes')` is `{ declared: 'view', hint: 'views' }`.
 */
const REFUSED_SPELLING = 'viewes';
/**
 * NOT a plural of anything declared, so it is indistinguishable from a
 * plugin-registered runtime kind and MUST NOT be refused. The positive control
 * that keeps the refusal narrow instead of blanket.
 */
const PLUGIN_SHAPED_SPELLING = 'fieldz';

const AUDIT_TABLE = 'sys_metadata_audit';
const HISTORY_TABLE = 'sys_metadata_history';

/**
 * A stub engine that RECORDS the `(table, where)` of every read, because the
 * fold is a claim about the KEY a query used and a body-only assertion cannot
 * see it. Rows are matched on scalar equality only, and a combinator is REFUSED
 * rather than read as a column name (`check:where-matcher` shape (b)).
 */
function makeStubEngine() {
    const tables: Record<string, Array<Record<string, unknown>>> = {
        [AUDIT_TABLE]: [],
        [HISTORY_TABLE]: [],
        sys_metadata: [],
    };
    const reads: Array<{ table: string; where: Record<string, unknown> }> = [];
    const items: Record<string, Array<Record<string, unknown>>> = {};
    const engine: any = {
        async find(table: string, o: { where?: Record<string, unknown> } = {}) {
            const where = o.where ?? {};
            reads.push({ table, where });
            return (tables[table] ?? []).filter((r) => matches(r, where));
        },
        async findOne(table: string, o: { where?: Record<string, unknown> } = {}) {
            reads.push({ table, where: o.where ?? {} });
            return (tables[table] ?? []).find((r) => matches(r, o.where ?? {})) ?? null;
        },
        async insert() { return { id: 'stub' }; },
        async count() { return 0; },
        registry: {
            listItems: (type: string) => items[type] ?? [],
            getItem: () => undefined,
            getObject: () => undefined,
            isPackageDisabled: () => false,
            getPackage: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
        },
    };
    return { engine, tables, reads, items };
}

function matches(r: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k.startsWith('$')) {
            throw new Error(
                `stub engine: WHERE combinator '${k}' is not implemented by this double — it matches `
                + 'scalar equality only. Implement it here rather than letting it be read as a field name.',
            );
        }
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

/** One audit row for `(type, name)`, env-wide. An EMPTY answer is the defect's signature. */
function seedAuditRow(tables: Record<string, Array<Record<string, unknown>>>, type: string, name: string) {
    tables[AUDIT_TABLE]!.push({
        id: 'a_1',
        organization_id: null,
        type,
        name,
        occurred_at: '2026-08-16T00:00:00.000Z',
        actor: 'alice',
        source: 'rest',
        operation: 'save',
        outcome: 'allowed',
        code: 'OK',
        lock_state: null,
        lock_overridden: false,
        request_id: 'req_1',
        note: null,
    });
}

/** One history row for `(type, name)`, env-wide. */
function seedHistoryRow(tables: Record<string, Array<Record<string, unknown>>>, type: string, name: string) {
    tables[HISTORY_TABLE]!.push({
        id: 'h_1',
        organization_id: null,
        type,
        name,
        version: 1,
        event_seq: 1,
        operation_type: 'create',
        metadata: JSON.stringify({ name }),
        checksum: 'sha-stub',
        recorded_by: 'alice',
        recorded_at: '2026-08-16T00:00:00.000Z',
    });
}

/** Every read this stub saw against `table`, in order, reported as its `type` key. */
const typeKeysFor = (reads: Array<{ table: string; where: any }>, table: string) =>
    reads.filter((r) => r.table === table).map((r) => r.where.type);

/**
 * The ADR-0112 refusal envelope, asserted as a whole: `code` AND `status`, plus
 * the ruling's extra condition that the message NAMES the canonical spelling.
 * `.rejects.toThrow()` alone would stay green on a bare `Error` thrown from
 * anywhere below — i.e. on the very shape this card is about.
 */
async function expectSpellingRefusal(run: () => Promise<unknown>) {
    const err: any = await run().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.status).toBe(400);
    expect(err.message).toContain(REFUSED_SPELLING);
    // ⛔ #9180: "a bare 400 is a wall; a refusal that says use `/meta/view/...`
    // is a guided migration. This condition is part of the ruling."
    expect(err.message).toContain(PRESENT_TYPE);
    expect(err.message).toContain(PRESENT_PLURAL);
    return err;
}

describe('#9157 — the population, re-derived from the code rather than from the card', () => {
    it('every `/meta` request-boundary verb with a required `type` calls the fold — all twelve', () => {
        // ⭐ The card hand-listed "nine fold, three do not". Hand-listed sets of
        // this shape have shipped short before, so the set is DERIVED here and
        // the derivation is the pin: a tenth verb arriving unfolded turns this
        // red instead of being noticed a card later.
        //
        // Same-package read, spelled so `check:cross-package-test-inputs` sees
        // it (it does not escape the package, but the spelling is the one the
        // gate recognises either way).
        const src = readFileSync(fileURLToPath(new URL('./protocol.ts', import.meta.url)), 'utf8');
        const lines = src.split('\n');
        // A class method at one indent level taking a `request` parameter. The
        // negative lookahead is load-bearing: without it `if (…)` / `for (…)`
        // blocks match the same shape and the population fills with keywords.
        const METHOD = /^ {4}(?:async )?(?!if\b|for\b|while\b|switch\b|catch\b|do\b|return\b)([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*request\??\s*:/;
        const starts: Array<{ name: string; line: number }> = [];
        for (let i = 0; i < lines.length; i++) {
            const m = METHOD.exec(lines[i]!);
            if (m) starts.push({ name: m[1]!, line: i });
        }
        // Sanity: the scan must find the family at all. A regex that silently
        // matched nothing would make every assertion below vacuously green —
        // the failure mode this whole describe block exists to prevent.
        expect(starts.length).toBeGreaterThan(20);

        const unfolded: string[] = [];
        const folded: string[] = [];
        for (let k = 0; k < starts.length; k++) {
            const body = lines.slice(starts[k]!.line, starts[k + 1]?.line ?? lines.length).join('\n');
            // The PARAMETER LIST exactly — walked by paren balance rather than
            // guessed at with a character budget, so a long request type cannot
            // push `type: string` outside the window and drop a verb silently.
            const open = body.indexOf('(');
            let depth = 0;
            let close = open;
            for (let i = open; i < body.length; i++) {
                if (body[i] === '(') depth++;
                else if (body[i] === ')' && --depth === 0) { close = i; break; }
            }
            const sig = body.slice(open, close + 1);
            // A REQUIRED `type: string` in the request object — the shape a
            // `/meta/:type` path segment arrives as. `type?:` is a query-string
            // FILTER (`/meta/diagnostics?type=`, `/meta/_drafts?type=`), a
            // different contract and deliberately out of this population.
            if (!/\btype\s*:\s*string\s*[;,]/.test(sig) || /\btype\?\s*:/.test(sig)) continue;
            (/canonicalizeMetaRequestType\(request\)/.test(body) ? folded : unfolded).push(starts[k]!.name);
        }

        expect(
            unfolded,
            'A `/meta` verb takes a required `type` without folding it at the request boundary. '
            + 'Route it through `canonicalizeMetaRequestType(request)` (#7894 / #9180) — do not add a '
            + 'spelling-tolerant lookup one layer down.',
        ).toEqual([]);
        // The count is asserted so that DELETING a verb is as visible as adding
        // one: a shrinking population would otherwise satisfy the emptiness
        // assertion above forever.
        expect(folded.sort()).toEqual([
            'auditMetaItem',
            'deleteMetaItem',
            'diffMetaItem',
            'findReferencesToMeta',
            'getMetaItem',
            'getMetaItemCached',
            'getMetaItemLayered',
            'getMetaItems',
            'historyMetaItem',
            'publishMetaItem',
            'rollbackMetaItem',
            'saveMetaItem',
        ]);
    });

    it('manifestMapStillDoesNotFoldTheFixtures: the anti-vacuity arm', () => {
        // ⛔ Not decoration. This is the property that makes every fold
        // assertion below capable of failing.
        expect(PLURAL_TO_SINGULAR[OVERLAY_ABSENT_PLURAL]).toBeUndefined();
        expect(PLURAL_TO_SINGULAR[GATED_ABSENT_PLURAL]).toBeUndefined();
        // …while the URL map DOES fold them. That gap is the whole defect.
        expect(META_URL_TO_SINGULAR[OVERLAY_ABSENT_PLURAL]).toBe(OVERLAY_ABSENT_TYPE);
        expect(META_URL_TO_SINGULAR[GATED_ABSENT_PLURAL]).toBe(GATED_ABSENT_TYPE);
        // The contrast that proves the manifest map is real and populated here
        // rather than empty in this environment.
        expect(PLURAL_TO_SINGULAR[PRESENT_PLURAL]).toBe(PRESENT_TYPE);
    });

    it('theRecognisedPluralsAreNotRefused: step ① folds them, it does not retire them', () => {
        // ⛔ A pin AGAINST bundling #9180 step ③ into step ①, and against the
        // filing card's measured-false claim that `views` is already refused on
        // the write verbs. `canonicalizeMetaRequestType` refuses MISSPELLINGS.
        expect(metaUrlSpellingRefusal(PRESENT_PLURAL)).toBeNull();
        expect(metaUrlSpellingRefusal(OVERLAY_ABSENT_PLURAL)).toBeNull();
        expect(metaUrlSpellingRefusal(GATED_ABSENT_PLURAL)).toBeNull();
        expect(metaUrlSpellingRefusal(REFUSED_SPELLING))
            .toEqual({ declared: PRESENT_TYPE, hint: PRESENT_PLURAL });
    });
});

describe('#9157 — auditMetaItem', () => {
    it('THE PIN: a manifest-ABSENT plural reads the REAL audit trail instead of `{ events: [] }`', async () => {
        // Before the fold the plural reached `sys_metadata_audit` unfolded,
        // matched no row, and this answered "no protection events" — read by an
        // operator immediately before a rename or a delete.
        const { engine, tables, reads } = makeStubEngine();
        seedAuditRow(tables, GATED_ABSENT_TYPE, 'showcase_task.title');
        const p = new ObjectStackProtocolImplementation(engine);

        const res = await p.auditMetaItem({ type: GATED_ABSENT_PLURAL, name: 'showcase_task.title' });

        // Stated positively: a regression to `[]` cannot pass by both sides
        // being equally empty.
        expect(res.events).toHaveLength(1);
        expect(res.events[0]!.actor).toBe('alice');
        // The KEY the read actually used — the fold's real subject.
        expect(typeKeysFor(reads, AUDIT_TABLE)).toEqual([GATED_ABSENT_TYPE]);
    });

    it('refuses an unrecognised spelling of a DECLARED type with the 400 envelope', async () => {
        const { engine, reads } = makeStubEngine();
        const p = new ObjectStackProtocolImplementation(engine);

        await expectSpellingRefusal(() => p.auditMetaItem({ type: REFUSED_SPELLING, name: 'grid' }));

        // The refusal happens BEFORE the `try` whose catch answers
        // `{ events: [] }` for an unprovisioned table — a caller error absorbed
        // into that shape is exactly the 200-empty this card closes.
        expect(reads).toEqual([]);
    });

    it('CONTROL: a manifest-PRESENT plural was already folded — green before AND after', async () => {
        const { engine, tables, reads } = makeStubEngine();
        seedAuditRow(tables, PRESENT_TYPE, 'all_leads');
        const p = new ObjectStackProtocolImplementation(engine);

        const res = await p.auditMetaItem({ type: PRESENT_PLURAL, name: 'all_leads' });

        expect(res.events).toHaveLength(1);
        expect(typeKeysFor(reads, AUDIT_TABLE)).toEqual([PRESENT_TYPE]);
    });

    it('CONTROL: a spelling that reaches for no declared type is served, not refused', async () => {
        const { engine, reads } = makeStubEngine();
        const p = new ObjectStackProtocolImplementation(engine);

        const res = await p.auditMetaItem({ type: PLUGIN_SHAPED_SPELLING, name: 'x' });

        expect(res.events).toEqual([]);
        // Truthfully empty, and keyed on the caller's own spelling: a plugin
        // kind is none of this boundary's business.
        expect(typeKeysFor(reads, AUDIT_TABLE)).toEqual([PLUGIN_SHAPED_SPELLING]);
    });
});

describe('#9157 — historyMetaItem', () => {
    it('THE PIN: a manifest-ABSENT overlay type answers its REAL change log through the plural', async () => {
        const { engine, tables, reads } = makeStubEngine();
        seedHistoryRow(tables, OVERLAY_ABSENT_TYPE, 'greeting');
        const p = new ObjectStackProtocolImplementation(engine);

        const res = await p.historyMetaItem({ type: OVERLAY_ABSENT_PLURAL, name: 'greeting' });

        expect(res.events).toHaveLength(1);
        expect(res.events[0]!.ref.type).toBe(OVERLAY_ABSENT_TYPE);
        expect(typeKeysFor(reads, HISTORY_TABLE)).toEqual([OVERLAY_ABSENT_TYPE]);
    });

    it('THE OTHER PIN: the plural stops being a door AROUND the overlay gate', async () => {
        // `field` declares neither `allowOrgOverride` nor `allowRuntimeCreate`,
        // so the canonical spelling is refused by the gate and never touches the
        // store. The unfolded plural took `isRuntimeCreateAllowed`'s
        // no-static-registry-entry arm — the PLUGIN path, permissive by
        // construction — and issued a real read keyed `'fields'`.
        //
        // Both spellings answer `{ events: [] }`, before and after. The BODY
        // therefore cannot see this defect at all; only the dispatch can, which
        // is why this asserts zero history reads rather than an empty array.
        const { engine, tables, reads } = makeStubEngine();
        seedHistoryRow(tables, GATED_ABSENT_TYPE, 'showcase_task.title');
        const p = new ObjectStackProtocolImplementation(engine);

        const viaPlural = await p.historyMetaItem({ type: GATED_ABSENT_PLURAL, name: 'showcase_task.title' });
        const viaCanonical = await p.historyMetaItem({ type: GATED_ABSENT_TYPE, name: 'showcase_task.title' });

        expect(viaPlural).toEqual(viaCanonical);
        expect(typeKeysFor(reads, HISTORY_TABLE)).toEqual([]);
    });

    it('refuses an unrecognised spelling BEFORE the gate can absorb it', async () => {
        const { engine, reads } = makeStubEngine();
        const p = new ObjectStackProtocolImplementation(engine);

        await expectSpellingRefusal(() => p.historyMetaItem({ type: REFUSED_SPELLING, name: 'grid' }));

        // Placement matters: below the gate, a misspelling would have been
        // swallowed into the early `{ events: [] }` return instead of refused.
        expect(reads).toEqual([]);
    });

    it('CONTROL: a manifest-PRESENT plural was already folded — green before AND after', async () => {
        const { engine, tables, reads } = makeStubEngine();
        seedHistoryRow(tables, PRESENT_TYPE, 'all_leads');
        const p = new ObjectStackProtocolImplementation(engine);

        const res = await p.historyMetaItem({ type: PRESENT_PLURAL, name: 'all_leads' });

        expect(res.events).toHaveLength(1);
        expect(typeKeysFor(reads, HISTORY_TABLE)).toEqual([PRESENT_TYPE]);
    });

    it('CONTROL: a spelling that reaches for no declared type is served, not refused', async () => {
        const { engine, reads } = makeStubEngine();
        const p = new ObjectStackProtocolImplementation(engine);

        const res = await p.historyMetaItem({ type: PLUGIN_SHAPED_SPELLING, name: 'x' });

        expect(res.events).toEqual([]);
        expect(typeKeysFor(reads, HISTORY_TABLE)).toEqual([PLUGIN_SHAPED_SPELLING]);
    });
});

describe('#9157 — findReferencesToMeta', () => {
    it('THE PIN: an unrecognised spelling stops answering "nothing depends on this"', async () => {
        // The empty-accumulator harm (#8896) in its sharpest form: this answer
        // drives the admin UI's "Used by" panel, and 200 `{ references: [] }` is
        // read as a green light for a rename or a delete (ADR-0110 D3).
        const { engine } = makeStubEngine();
        const p = new ObjectStackProtocolImplementation(engine);

        await expectSpellingRefusal(() => p.findReferencesToMeta({ type: REFUSED_SPELLING, name: 'all_leads' }));
    });

    it('CONTROL: a manifest-PRESENT plural still resolves its real dependents', async () => {
        const { engine, items } = makeStubEngine();
        items.dashboard = [{ name: 'sales_dash', label: 'Sales', widgets: [{ id: 'w1', view: 'all_leads' }] }];
        const p = new ObjectStackProtocolImplementation(engine);

        const res = await p.findReferencesToMeta({ type: PRESENT_PLURAL, name: 'all_leads' });

        expect(res.references).toEqual([
            { type: 'dashboard', name: 'sales_dash', label: 'Sales', path: 'widgets[].view', kind: 'dashboard widget' },
        ]);
    });

    it('the manifest-ABSENT class is NOT closed here, and that is stated rather than implied', async () => {
        // ⚠️ Honest scope pin. The card's `translations` example claims this verb
        // answers `{ references: [] }` for a manifest-absent type — true, and the
        // fold does not change it: every `REFERENCE_PATHS` key (`object`, `view`,
        // `tool`, `skill`, `flow`, `dashboard`, `page`) is manifest-PRESENT, so
        // `translation` has no registry entry either. This method's own doc calls
        // an unregistered target a legitimate no-hit rather than an error.
        //
        // Closing it is a `REFERENCE_PATHS` COVERAGE question, not a spelling
        // one, and it is a different card. Asserted so a reader cannot over-read
        // this PR's claim, and so the day `translation` gains a matcher this
        // test goes red and asks to be re-read.
        const { engine } = makeStubEngine();
        const p = new ObjectStackProtocolImplementation(engine);

        const viaPlural = await p.findReferencesToMeta({ type: OVERLAY_ABSENT_PLURAL, name: 'greeting' });
        const viaCanonical = await p.findReferencesToMeta({ type: OVERLAY_ABSENT_TYPE, name: 'greeting' });

        expect(viaPlural.references).toEqual([]);
        expect(viaCanonical.references).toEqual([]);
    });

    it('CONTROL: a spelling that reaches for no declared type is served, not refused', async () => {
        const { engine } = makeStubEngine();
        const p = new ObjectStackProtocolImplementation(engine);

        const res = await p.findReferencesToMeta({ type: PLUGIN_SHAPED_SPELLING, name: 'x' });

        expect(res.references).toEqual([]);
    });
});

describe('#9157 — one contract, not three dialects (Prime Directive #12)', () => {
    it('all three read verbs refuse the same spelling with the same envelope and the same guidance', async () => {
        const { engine } = makeStubEngine();
        const p = new ObjectStackProtocolImplementation(engine);

        const errs = await Promise.all([
            expectSpellingRefusal(() => p.auditMetaItem({ type: REFUSED_SPELLING, name: 'grid' })),
            expectSpellingRefusal(() => p.historyMetaItem({ type: REFUSED_SPELLING, name: 'grid' })),
            expectSpellingRefusal(() => p.findReferencesToMeta({ type: REFUSED_SPELLING, name: 'grid' })),
        ]);

        // Byte-identical guidance across the three — the divergence this card
        // exists to end was "one contract, two dialects, decided by which verb
        // you use".
        expect(new Set(errs.map((e) => e.message)).size).toBe(1);
    });

    it('and the write verbs answer identically, which is what "same contract" means here', async () => {
        const { engine } = makeStubEngine();
        const p = new ObjectStackProtocolImplementation(engine);
        const readErr = await expectSpellingRefusal(() => p.auditMetaItem({ type: REFUSED_SPELLING, name: 'grid' }));
        const writeErr = await expectSpellingRefusal(() =>
            p.deleteMetaItem({ type: REFUSED_SPELLING, name: 'grid' }));

        expect(readErr.message).toBe(writeErr.message);
        expect(readErr.status).toBe(writeErr.status);
    });
});
