// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16066] The query transport dialect is DECLARED, and this package folds by
 * the declaration rather than by a table of its own.
 *
 * ## What this pins
 *
 * `FindDataRequestSchema.query` declared the canonical QueryAST while the
 * shipped `findData` door also accepted a transport dialect no schema named:
 * `$filter` / `$top` / `$skip` / `$orderby` / `$select` / `$expand` and the
 * plural `filters`. Two dialects, one slot, one of them declared — so every
 * caller speaking the second was unverifiable at build time and unrejected at
 * runtime.
 *
 * The ruling declared the transport form as the FLATTENED SPELLING of the same
 * AST with a 1:1 alias table, exported once from `@objectstack/spec/data`, and
 * replaced this package's module-private `WIRE_QUERY_ALIAS_SLOTS` /
 * `WIRE_DOLLAR_ALIASES` with that export.
 *
 * ## §1 is the byte-equality receipt the ruling asks for
 *
 * A hoist that changes what the door folds is not a hoist. §1 holds the two
 * exported tables against the values the module-private ones RESOLVED TO before
 * the swap, transcribed verbatim from `origin/main` at `6dfa3ea772`. ⛔ These
 * literals are not a restatement of the spec table to be "kept in sync" — they
 * are a frozen BEFORE reading, and the only legitimate way to change one is a
 * deliberate change to what the door accepts, with its own changeset.
 *
 * ⚠️ A table comparison alone would be a pin that cannot fail in the way that
 * matters: equal tables prove nothing if the fold stopped reading them. §2
 * therefore drives every alias through the REAL normalizer and asserts the
 * option bag `engine.find` receives is the one the canonical spelling produces
 * — spelling-equivalence measured against the canonical, never against a
 * hand-written expectation that would have to be re-derived on every change.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    QUERY_TRANSPORT_ALIAS_SLOTS,
    QUERY_TRANSPORT_DOLLAR_ALIASES,
    QUERY_TRANSPORT_DOLLAR_PARAMS,
} from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from './protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// §1 The BEFORE reading — what the module-private tables resolved to on
//    `origin/main` @ 6dfa3ea772, immediately before the swap.
// ---------------------------------------------------------------------------

/** `WIRE_QUERY_ALIAS_SLOTS` as it resolved before #16066. */
const BEFORE_WIRE_QUERY_ALIAS_SLOTS = [
    { canonical: 'where', aliases: ['filter', 'filters', '$filter'] },
    { canonical: 'fields', aliases: ['select'] },
    { canonical: 'orderBy', aliases: ['sort'] },
    { canonical: 'offset', aliases: ['skip'] },
    { canonical: 'expand', aliases: ['populate', '$expand'] },
    { canonical: 'limit', aliases: ['top'] },
];

/** `WIRE_DOLLAR_ALIASES` as it read before #16066. */
const BEFORE_WIRE_DOLLAR_ALIASES = [
    ['$top', 'top'],
    ['$skip', 'skip'],
    ['$orderby', 'orderBy'],
    ['$select', 'select'],
    ['$count', 'count'],
    ['$search', 'search'],
    ['$searchFields', 'searchFields'],
];

/**
 * The `$`-parameter list the refusal sentence carried before #16066 — then a
 * string literal typed out beside the table, now derived from it.
 */
const BEFORE_SUPPORTED_DOLLAR_SENTENCE =
    '$top, $skip, $orderby, $select, $count, $search, $searchFields, $filter, $expand';

describe('[#16066] §1 the fold is byte-equal before and after the single-source swap', () => {
    it('the exported slot table resolves to exactly what the private one did', () => {
        expect(QUERY_TRANSPORT_ALIAS_SLOTS.map((s) => ({ canonical: s.canonical, aliases: [...s.aliases] })))
            .toEqual(BEFORE_WIRE_QUERY_ALIAS_SLOTS);
    });

    it('the exported `$`-alias table reads exactly what the private one did', () => {
        expect(QUERY_TRANSPORT_DOLLAR_ALIASES.map((p) => [...p])).toEqual(BEFORE_WIRE_DOLLAR_ALIASES);
    });

    it('the refusal sentence quotes the same set, in the same order', () => {
        expect(QUERY_TRANSPORT_DOLLAR_PARAMS.join(', ')).toBe(BEFORE_SUPPORTED_DOLLAR_SENTENCE);
    });
});

// ---------------------------------------------------------------------------
// §2 The fold reads THOSE tables — every alias, through the real normalizer
// ---------------------------------------------------------------------------

const SCHEMA = {
    name: 'invoice',
    nameField: 'name',
    fields: {
        name: { name: 'name', type: 'text' },
        status: { name: 'status', type: 'text' },
        owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
    },
};

const USER_SCHEMA = { name: 'sys_user', nameField: 'name', fields: { name: { name: 'name', type: 'text' } } };

function makeProtocol() {
    // Typed with the parameters the engine is really called with, so the
    // option-bag read below is `calls[0][1]` rather than an out-of-range index
    // on a zero-arity tuple.
    const find = vi.fn(async (_object?: string, _options?: unknown) => [] as unknown[]);
    const count = vi.fn(async () => 0);
    const engine = {
        registry: {
            getObject: (n: string) => (n === 'invoice' ? SCHEMA : n === 'sys_user' ? USER_SCHEMA : undefined),
        },
        find,
        count,
        aggregate: vi.fn(async () => [] as unknown[]),
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find, count };
}

/**
 * Everything one query DID: the option bag `engine.find` received, whether the
 * COUNT query was issued, and the response envelope.
 *
 * ⚠️ The bag alone is not enough. `count` is a protocol-layer flag stripped
 * before the engine sees it, so `{$count: true}` and `{count: true}` both hand
 * `engine.find` an empty bag — a comparison of bags would have declared that
 * pair equal without folding anything. Widening the observation to the COUNT
 * call and the envelope is what makes every pair below capable of failing.
 */
async function outcomeOf(query: Record<string, unknown>): Promise<unknown> {
    const { p, find, count } = makeProtocol();
    let response: unknown;
    try {
        response = await (p as unknown as { findData: (r: unknown) => Promise<unknown> })
            .findData({ object: 'invoice', query });
    } catch (error) {
        return { threw: (error as Error).message };
    }
    return {
        bag: find.mock.calls[0]?.[1] ?? { neverCalled: true },
        counted: count.mock.calls.length,
        response,
    };
}

/**
 * Every alias in the declared table, paired with the spelling it must agree
 * with. Derived from the exported tables rather than typed out, so a spelling
 * added to the declaration without a case here cannot slip through: the
 * completeness assertion below counts the pairs the tables produce.
 */
const SLOT_VALUES: Record<string, unknown> = {
    where: { status: 'queued' },
    fields: ['name', 'status'],
    orderBy: 'name',
    offset: 5,
    expand: ['owner_id'],
    limit: 7,
    count: true,
    search: 'acme',
    searchFields: ['name'],
};

describe('[#16066] §2 every alias the table declares folds onto its canonical slot', () => {
    const slotPairs = QUERY_TRANSPORT_ALIAS_SLOTS.flatMap((slot) =>
        slot.aliases.map((alias) => [alias, slot.canonical] as const));
    const dollarPairs = QUERY_TRANSPORT_DOLLAR_ALIASES.map(([dollar, bare]) => [dollar, bare] as const);

    it('the declared table produces the pairs this suite drives (no silent shrink)', () => {
        // 9 slot aliases (`where` carries three, `expand` two, the other four
        // one each) and 7 `$` aliases. A spelling dropped from the declaration
        // takes its case with it, so the count is pinned rather than inferred.
        expect(slotPairs.length).toBe(9);
        expect(dollarPairs.length).toBe(7);
        expect(new Set([...slotPairs, ...dollarPairs].map(([a]) => a)).size).toBe(16);
    });

    for (const [alias, canonical] of [...slotPairs, ...dollarPairs]) {
        it(`\`${alias}\` reaches the engine exactly as \`${canonical}\` does`, async () => {
            const value = SLOT_VALUES[canonical] ?? SLOT_VALUES[resolveCanonical(canonical)];
            expect(value, `no probe value for the \`${canonical}\` slot`).toBeDefined();
            const viaAlias = await outcomeOf({ [alias]: value });
            const viaCanonical = await outcomeOf({ [canonical]: value });
            // ⛔ Not a pair that agrees by both failing: the canonical spelling
            // has to have SERVED, or this case proves nothing about the fold.
            expect(viaCanonical, JSON.stringify(viaCanonical)).not.toHaveProperty('threw');
            expect(viaAlias).toEqual(viaCanonical);
        });
    }
});

/** A `$` alias' bare target may itself be a slot alias (`$top` -> `top` -> `limit`). */
function resolveCanonical(name: string): string {
    const slot = QUERY_TRANSPORT_ALIAS_SLOTS.find((s) => s.aliases.includes(name));
    return slot ? slot.canonical : name;
}

// ---------------------------------------------------------------------------
// §3 This package declares no transport table of its own
// ---------------------------------------------------------------------------

describe('[#16066] §3 the single source is the spec export', () => {
    const source = readFileSync(resolve(HERE, 'protocol.ts'), 'utf8');

    it('no local `WIRE_QUERY_ALIAS_SLOTS` / `WIRE_DOLLAR_ALIASES` declaration survives', () => {
        expect(source).not.toMatch(/(?:const|let|var)\s+WIRE_QUERY_ALIAS_SLOTS\b/);
        expect(source).not.toMatch(/(?:const|let|var)\s+WIRE_DOLLAR_ALIASES\b/);
    });

    it('the fold names the spec export at the call site', () => {
        expect(source).toMatch(/foldQueryAliasSlots\(options,\s*QUERY_TRANSPORT_ALIAS_SLOTS\b/);
        expect(source).toMatch(/for \(const \[dollar, bare\] of QUERY_TRANSPORT_DOLLAR_ALIASES\)/);
    });
});

// ---------------------------------------------------------------------------
// §4 A `$` spelling the table does NOT name is refused, loudly
// ---------------------------------------------------------------------------

describe('[#16066] §4 an undeclared `$` spelling is refused, not folded', () => {
    it('answers 400 UNSUPPORTED_QUERY_PARAM and names the parameter', async () => {
        const { p, find } = makeProtocol();
        await expect(
            (p as unknown as { findData: (r: unknown) => Promise<unknown> })
                .findData({ object: 'invoice', query: { $sort: 'name' } }),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_QUERY_PARAM', status: 400 });
        expect(find).not.toHaveBeenCalled();
    });

    it('quotes the DECLARED set rather than a hand-copied sentence', async () => {
        const { p } = makeProtocol();
        const error = await (p as unknown as { findData: (r: unknown) => Promise<unknown> })
            .findData({ object: 'invoice', query: { $sort: 'name' } })
            .then(() => null, (e: Error) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error!.message).toContain('$sort');
        // The whole declared set, in declaration order — the assertion that goes
        // red the day a spelling is added to the table and the sentence is not.
        expect(error!.message).toContain(
            `Supported $-prefixed parameters: ${QUERY_TRANSPORT_DOLLAR_PARAMS.join(', ')}.`,
        );
    });
});
