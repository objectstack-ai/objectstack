#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Filter-slot wire-alias parity guard (#8002).
 *
 * ## The seam
 *
 * The ONE filter slot has four wire spellings, and they are declared in two
 * packages with different ownership:
 *
 *   - `where` / `filter` come from the spec's own table
 *     (`RPC_QUERY_ALIAS_SLOTS`, `packages/spec/src/data/data-engine.zod.ts`) —
 *     "the ONE place the alias to canonical mapping is declared".
 *   - `filters` / `$filter` are **wire-only**: no schema declares them.
 *     `packages/metadata-protocol` extends the spec table with them locally
 *     (`WIRE_QUERY_ALIAS_SLOTS`), which is what makes them fold into `where`.
 *
 * #7390 added a third reader: `packages/rest` gates the filter slot's ARITY at
 * the querystring ingress (`FILTER_SLOT_QUERY_PARAMS`,
 * `packages/rest/src/query-multiplicity.ts`) and needs the same four spellings
 * to do it. It derives `where` / `filter` from the spec table; it cannot derive
 * `filters` / `$filter`, so it names them literally.
 *
 * ## What goes wrong without this gate, and in which direction
 *
 * A **fifth** wire-only spelling added to `metadata-protocol`'s table folds
 * correctly in the normalizer and is silently UNGATED at the ingress:
 * repetition on that spelling falls back to the misdiagnosis #7390 exists to
 * remove — a 400 telling the caller their filter is malformed when every filter
 * they sent was fine and the mistake was sending two. Nothing fails. The
 * spelling works; the gate simply does not see it.
 *
 * The opposite direction is already covered: `#7390 §5
 * filterSlotSpellingsAreComplete` in `rest-server-repeated-filter-param.test.ts`
 * pins `FILTER_SLOT_QUERY_PARAMS` to exactly the four, so a spelling added on
 * the REST side alone goes red there. This gate deliberately does not duplicate
 * that pin — it covers the half that test cannot reach, and it is symmetric
 * only because a one-directional set comparison is harder to read than an
 * equality.
 *
 * ## Why a source scan, and why the AST rather than grep
 *
 * A runtime import of the normalizer's table is impossible twice over, and both
 * reasons were measured before this script was written:
 *
 *   1. `WIRE_QUERY_ALIAS_SLOTS` is a module-private `const`. It is not
 *      exported, so there is nothing to import even from inside the package.
 *   2. `@objectstack/metadata-protocol` is a **devDependency** of
 *      `@objectstack/rest` (`workspace:*`), so no runtime edge exists between
 *      the two packages that could carry the table.
 *
 * That leaves reading the source, and the repo already has a house answer for
 * reading cross-package source truth: the TypeScript compiler API, used by a
 * dozen sibling gates (`check:route-envelope`, `check:meta-type-normalized`,
 * `check:kernel-hook-pairs`, ...). Regexes were rejected for the reason that
 * would have rotted this gate first: all three declarations are documented in
 * prose that quotes the spellings, and two of the three are IIFEs whose shape a
 * pattern would have to re-learn on every refactor.
 *
 * ## The rot rule: an unreadable shape is RED, never green
 *
 * The failure mode of any source-reading gate is the silent one — a refactor
 * moves the declaration, the reader matches nothing, two empty sets compare
 * equal, and the gate reports a pass over a corpus of zero. Every reader below
 * therefore ASSERTS its anchor: a missing declaration, an initializer whose
 * shape is not the one this script knows how to read, an array element that is
 * neither a string literal nor the recognized spec-derived spread — each is a
 * loud failure naming the file and what it expected. "A scan that reads nothing
 * cannot report a pass" (#4690).
 *
 * ## What it does NOT do
 *
 * It does not decide whether the wire vocabulary belongs in `@objectstack/spec`
 * at all — hoisting these spellings onto the spec's export surface is the other
 * option on #8002 and is deliberately left open for the spec seat. This gate is
 * the reversible move: it adds no public API and no dependency-graph edge, and
 * it pays the drift risk down either way. If the hoist ever lands, both sides
 * become derived, the sets stay equal by construction, and this script can be
 * deleted rather than migrated.
 *
 * Run `--self-test` to prove the readers and the comparison against planted
 * fixtures before trusting a green run.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The three files that declare a filter-slot spelling, by repo-relative path. */
const SPEC_FILE = 'packages/spec/src/data/data-engine.zod.ts';
const PROTOCOL_FILE = 'packages/metadata-protocol/src/protocol.ts';
const REST_FILE = 'packages/rest/src/query-multiplicity.ts';

/** The declarations read out of them. */
const SPEC_TABLE = 'RPC_QUERY_ALIAS_SLOTS';
const WIRE_TABLE = 'WIRE_QUERY_ALIAS_SLOTS';
const DOLLAR_TABLE = 'WIRE_DOLLAR_ALIASES';
const REST_SET = 'FILTER_SLOT_QUERY_PARAMS';

/** The canonical key of the filter slot. Everything here is about this one slot. */
const FILTER_SLOT = 'where';

/** An anchor this script could not read — always a failure, never an empty result. */
class UnreadableShape extends Error {}

function parse(path, text) {
    return parseSourceFile(path, text);
}

/** Every node in a subtree, depth-first. */
function* walk(node) {
    yield node;
    for (const child of node.getChildren()) yield* walk(child);
}

/**
 * The variable declaration named `name`, anywhere in the file — module scope or
 * nested inside an initializer (the `extra` table lives inside an IIFE).
 */
function findDeclaration(source, name, path) {
    for (const node of walk(source)) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
            return node;
        }
    }
    throw new UnreadableShape(
        `${path}: no \`${name}\` declaration found. This gate reads that declaration to learn the `
        + `filter slot's wire spellings; if it moved or was renamed, re-point the reader in `
        + `scripts/check-filter-alias-parity.mjs rather than leaving the gate scanning nothing.`,
    );
}

/** The elements of an array literal, each of which must be a plain string literal. */
function stringLiterals(node, what, path) {
    if (!node || !ts.isArrayLiteralExpression(node)) {
        throw new UnreadableShape(`${path}: ${what} is not an array literal, so its spellings cannot be read.`);
    }
    return node.elements.map((el) => {
        if (!ts.isStringLiteralLike(el)) {
            throw new UnreadableShape(
                `${path}: ${what} contains a non-literal element (\`${el.getText(el.getSourceFile())}\`), `
                + `so the spelling set it declares cannot be read statically.`,
            );
        }
        return el.text;
    });
}

/** A property's name, whether written bare or quoted. */
function propertyName(prop) {
    if (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)) return prop.name.text;
    return null;
}

/**
 * The spec's alias table as `canonical -> every spelling of that slot`.
 *
 * Shape read: `export const RPC_QUERY_ALIAS_SLOTS = [{ canonical: 'where', aliases: ['filter'] }, ...]`.
 */
export function readSpecSlots(text, path = SPEC_FILE) {
    const source = parse(path, text);
    const decl = findDeclaration(source, SPEC_TABLE, path);
    if (!decl.initializer || !ts.isArrayLiteralExpression(decl.initializer)) {
        throw new UnreadableShape(`${path}: \`${SPEC_TABLE}\` is no longer a literal array of slots.`);
    }
    const slots = new Map();
    for (const element of decl.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) {
            throw new UnreadableShape(`${path}: a \`${SPEC_TABLE}\` entry is not an object literal.`);
        }
        let canonical = null;
        let aliases = null;
        for (const prop of element.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const key = propertyName(prop);
            if (key === 'canonical' && ts.isStringLiteralLike(prop.initializer)) canonical = prop.initializer.text;
            if (key === 'aliases') aliases = stringLiterals(prop.initializer, `\`${SPEC_TABLE}\` aliases`, path);
        }
        if (canonical === null || aliases === null) {
            throw new UnreadableShape(
                `${path}: a \`${SPEC_TABLE}\` entry has no readable \`canonical\`/\`aliases\` pair.`,
            );
        }
        slots.set(canonical, [canonical, ...aliases]);
    }
    if (slots.size === 0) throw new UnreadableShape(`${path}: \`${SPEC_TABLE}\` declares no slots.`);
    return slots;
}

/**
 * The wire-only spellings `metadata-protocol` adds on top of the spec table,
 * as `canonical -> extra spellings`, plus the `$`-alias table.
 *
 * Shape read: an IIFE declaring `const extra: Record<string, readonly string[]> = { where: [...] }`
 * and mapping over `RPC_QUERY_ALIAS_SLOTS`. The mapping is ASSERTED, not
 * assumed: if `WIRE_QUERY_ALIAS_SLOTS` stops reading the spec table, the two
 * sides no longer share a derived half and this gate's model of them is wrong.
 */
export function readProtocolExtras(text, path = PROTOCOL_FILE) {
    const source = parse(path, text);
    const decl = findDeclaration(source, WIRE_TABLE, path);
    if (!decl.initializer) throw new UnreadableShape(`${path}: \`${WIRE_TABLE}\` has no initializer.`);

    const readsSpecTable = [...walk(decl.initializer)]
        .some((n) => ts.isIdentifier(n) && n.text === SPEC_TABLE);
    if (!readsSpecTable) {
        throw new UnreadableShape(
            `${path}: \`${WIRE_TABLE}\` no longer derives from \`${SPEC_TABLE}\`. The spec-derived half of the `
            + `filter slot is what makes the two sides comparable; a table that stops reading it needs this `
            + `gate re-designed, not re-pointed.`,
        );
    }

    let extraObject = null;
    for (const node of walk(decl.initializer)) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'extra') {
            extraObject = node.initializer;
        }
    }
    if (!extraObject || !ts.isObjectLiteralExpression(extraObject)) {
        throw new UnreadableShape(
            `${path}: \`${WIRE_TABLE}\` no longer declares its wire-only spellings as an \`extra\` object literal.`,
        );
    }

    const extras = new Map();
    for (const prop of extraObject.properties) {
        if (!ts.isPropertyAssignment(prop)) {
            throw new UnreadableShape(`${path}: the \`extra\` table has a property this gate cannot read statically.`);
        }
        const key = propertyName(prop);
        if (key === null) throw new UnreadableShape(`${path}: the \`extra\` table has a computed key.`);
        extras.set(key, stringLiterals(prop.initializer, `the \`extra\` table's \`${key}\` entry`, path));
    }
    return { extras, dollarAliases: readDollarAliases(source, path) };
}

/**
 * `WIRE_DOLLAR_ALIASES` as `[dollarSpelling, bareSpelling]` pairs.
 *
 * These fold BEFORE the slot table does (`options[bare] = options[dollar]`), so
 * a `$`-alias whose bare spelling is a filter spelling is itself a filter
 * spelling — one the ingress gate would have to know about. Reading the pair
 * table is what keeps that door closed.
 */
function readDollarAliases(source, path) {
    const decl = findDeclaration(source, DOLLAR_TABLE, path);
    if (!decl.initializer || !ts.isArrayLiteralExpression(decl.initializer)) {
        throw new UnreadableShape(`${path}: \`${DOLLAR_TABLE}\` is no longer a literal array of pairs.`);
    }
    return decl.initializer.elements.map((pair) => {
        const parts = stringLiterals(pair, `a \`${DOLLAR_TABLE}\` pair`, path);
        if (parts.length !== 2) {
            throw new UnreadableShape(`${path}: a \`${DOLLAR_TABLE}\` entry is not a [dollar, bare] pair.`);
        }
        return parts;
    });
}

/**
 * The spellings `packages/rest` gates at the querystring ingress.
 *
 * Shape read: an IIFE returning an array whose elements are either the
 * spec-derived spread (`...(slot ? [slot.canonical, ...slot.aliases] : [])`,
 * where `slot` comes from `RPC_QUERY_ALIAS_SLOTS.find(s => s.canonical === 'where')`)
 * or a literal wire-only spelling. A plain array literal is accepted too, so
 * simplifying the derivation away does not make the gate unreadable — only
 * un-derived, which the comparison then judges on its merits.
 */
export function readRestSpellings(text, specSlots, path = REST_FILE) {
    const source = parse(path, text);
    const decl = findDeclaration(source, REST_SET, path);
    if (!decl.initializer) throw new UnreadableShape(`${path}: \`${REST_SET}\` has no initializer.`);

    let array = null;
    if (ts.isArrayLiteralExpression(decl.initializer)) {
        array = decl.initializer;
    } else {
        const returned = [...walk(decl.initializer)]
            .filter((n) => ts.isReturnStatement(n) && n.expression && ts.isArrayLiteralExpression(n.expression));
        if (returned.length !== 1) {
            throw new UnreadableShape(
                `${path}: \`${REST_SET}\` does not resolve to exactly one returned array literal `
                + `(found ${returned.length}), so the set it gates cannot be read statically.`,
            );
        }
        array = returned[0].expression;
    }

    // Which slot the derivation selects out of the spec table.
    let derivedCanonical = null;
    for (const node of walk(decl.initializer)) {
        if (!ts.isCallExpression(node)) continue;
        const callee = node.expression;
        if (!ts.isPropertyAccessExpression(callee)) continue;
        if (!ts.isIdentifier(callee.expression) || callee.expression.text !== SPEC_TABLE) continue;
        for (const inner of walk(node)) {
            if (!ts.isBinaryExpression(inner)) continue;
            if (inner.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) continue;
            const sides = [inner.left, inner.right];
            const named = sides.some((s) => ts.isPropertyAccessExpression(s) && s.name.text === 'canonical');
            const literal = sides.find((s) => ts.isStringLiteralLike(s));
            if (named && literal) derivedCanonical = literal.text;
        }
    }

    const literals = [];
    const spellings = new Set();
    for (const element of array.elements) {
        if (ts.isStringLiteralLike(element)) {
            literals.push(element.text);
            spellings.add(element.text);
            continue;
        }
        if (ts.isSpreadElement(element)) {
            const reads = [...walk(element)]
                .filter((n) => ts.isPropertyAccessExpression(n))
                .map((n) => n.name.text);
            if (!reads.includes('canonical') || !reads.includes('aliases')) {
                throw new UnreadableShape(
                    `${path}: \`${REST_SET}\` spreads something this gate does not recognize `
                    + `(\`${element.getText(source)}\`) — it knows only the spec-derived `
                    + `\`slot.canonical\` + \`slot.aliases\` spread.`,
                );
            }
            if (derivedCanonical === null) {
                throw new UnreadableShape(
                    `${path}: \`${REST_SET}\` spreads a slot's spellings, but this gate could not see which slot `
                    + `it selects out of \`${SPEC_TABLE}\`.`,
                );
            }
            const derived = specSlots.get(derivedCanonical);
            if (!derived) {
                throw new UnreadableShape(
                    `${path}: \`${REST_SET}\` derives the \`${derivedCanonical}\` slot, which `
                    + `\`${SPEC_TABLE}\` does not declare.`,
                );
            }
            for (const s of derived) spellings.add(s);
            continue;
        }
        throw new UnreadableShape(
            `${path}: \`${REST_SET}\` contains an element that is neither a literal spelling nor the `
            + `spec-derived spread (\`${element.getText(source)}\`).`,
        );
    }
    if (spellings.size === 0) throw new UnreadableShape(`${path}: \`${REST_SET}\` resolves to no spellings at all.`);
    return { spellings, literals, derivedCanonical };
}

/**
 * Compare the two sides. Returns the problems (empty = parity holds) alongside
 * the sets, so the self-test can assert on both the verdict and what was read.
 */
export function judge({ specText, protocolText, restText }) {
    const problems = [];
    let protocolSet = null;
    let restSet = null;
    let specSlots = null;

    try {
        specSlots = readSpecSlots(specText);
        const filterSlot = specSlots.get(FILTER_SLOT);
        if (!filterSlot) {
            problems.push(
                `${SPEC_FILE}: \`${SPEC_TABLE}\` no longer declares the \`${FILTER_SLOT}\` slot, so neither side's `
                + `derived half exists. That is a spec change this gate cannot judge — re-read #8002 before `
                + `silencing it.`,
            );
        } else {
            const { extras, dollarAliases } = readProtocolExtras(protocolText);
            protocolSet = new Set([...filterSlot, ...(extras.get(FILTER_SLOT) ?? [])]);
            for (const [dollar, bare] of dollarAliases) {
                if (protocolSet.has(bare)) protocolSet.add(dollar);
            }

            const rest = readRestSpellings(restText, specSlots);
            restSet = rest.spellings;
            if (rest.derivedCanonical !== null && rest.derivedCanonical !== FILTER_SLOT) {
                problems.push(
                    `${REST_FILE}: \`${REST_SET}\` derives the \`${rest.derivedCanonical}\` slot, but the filter `
                    + `slot is \`${FILTER_SLOT}\`.`,
                );
            }
        }
    } catch (error) {
        if (!(error instanceof UnreadableShape)) throw error;
        problems.push(error.message);
        return { problems, protocolSet, restSet };
    }

    if (protocolSet && restSet) {
        const onlyProtocol = [...protocolSet].filter((s) => !restSet.has(s)).sort();
        const onlyRest = [...restSet].filter((s) => !protocolSet.has(s)).sort();
        if (onlyProtocol.length || onlyRest.length) {
            problems.push(formatDrift({ onlyProtocol, onlyRest, protocolSet, restSet }));
        }
    }
    return { problems, protocolSet, restSet };
}

/** The failure a reader gets: both sides, the symmetric difference, and the fix. */
function formatDrift({ onlyProtocol, onlyRest, protocolSet, restSet }) {
    const lines = [];
    lines.push('The filter slot is spelled differently on its two sides:\n');
    lines.push(`  normalizer  ${PROTOCOL_FILE}`);
    lines.push(`              ${WIRE_TABLE} -> ${[...protocolSet].sort().map((s) => `\`${s}\``).join(', ')}`);
    lines.push(`  ingress     ${REST_FILE}`);
    lines.push(`              ${REST_SET} -> ${[...restSet].sort().map((s) => `\`${s}\``).join(', ')}\n`);
    if (onlyProtocol.length) {
        const it = onlyProtocol.length === 1 ? 'it' : 'them';
        const quoted = onlyProtocol.map((s) => `'${s}'`).join(', ');
        lines.push(`  FOLDED BUT UNGATED: ${onlyProtocol.map((s) => `\`${s}\``).join(', ')}`);
        lines.push(`    The normalizer folds ${it} into \`${FILTER_SLOT}\`, but the ingress arity gate does not`);
        lines.push(`    see ${it}. A repeated \`?${onlyProtocol[0]}=A&${onlyProtocol[0]}=B\` then falls back to the`);
        lines.push('    misdiagnosis #7390 removed: a 400 naming a MALFORMED filter, when every filter sent');
        lines.push('    was fine and the mistake was sending two.');
        lines.push(`    Fix: add ${quoted} to \`${REST_SET}\``);
        lines.push(`    in ${REST_FILE}, and extend the §5 pin in`);
        lines.push('    packages/rest/src/rest-server-repeated-filter-param.test.ts.');
    }
    if (onlyRest.length) {
        const it = onlyRest.length === 1 ? 'it' : 'them';
        const quoted = onlyRest.map((s) => `'${s}'`).join(', ');
        lines.push(`  GATED BUT NOT FOLDED: ${onlyRest.map((s) => `\`${s}\``).join(', ')}`);
        lines.push(`    The ingress refuses ${it} as a repeated filter parameter, but the normalizer does not`);
        lines.push(`    fold ${it} into \`${FILTER_SLOT}\` at all — so a SINGLE occurrence is not a filter, and`);
        lines.push('    the arity refusal describes a parameter that does nothing.');
        lines.push(`    Fix: add ${quoted} to the \`extra\` table in \`${WIRE_TABLE}\``);
        lines.push(`    (${PROTOCOL_FILE}), or drop ${it} from \`${REST_SET}\`.`);
    }
    lines.push('');
    lines.push('Both sides must name the same set: one slot, one spelling set, two readers (#8002).');
    return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-test
// ─────────────────────────────────────────────────────────────────────────────

/** A spec table fixture in the real declaration's shape. */
const FIXTURE_SPEC = `
export const RPC_QUERY_ALIAS_SLOTS: readonly QueryAliasSlot[] = [
  { canonical: 'where', aliases: ['filter'] },
  { canonical: 'fields', aliases: ['select'] },
  { canonical: 'expand', aliases: ['populate'] },
];
`;

/** A normalizer fixture. `extraWhere` / `dollars` are what the cases vary. */
function fixtureProtocol(extraWhere = ['filters', '$filter'], dollars = [['$top', 'top'], ['$select', 'select']]) {
    return `
const WIRE_QUERY_ALIAS_SLOTS: readonly QueryAliasSlot[] = (() => {
    const extra: Record<string, readonly string[]> = {
        where: [${extraWhere.map((s) => `'${s}'`).join(', ')}],
        expand: ['$expand'],
    };
    return RPC_QUERY_ALIAS_SLOTS.map((slot) => ({
        canonical: slot.canonical,
        aliases: [...slot.aliases, ...(extra[slot.canonical] ?? [])],
    }));
})();

const WIRE_DOLLAR_ALIASES: readonly (readonly [string, string])[] = [
${dollars.map(([d, b]) => `    ['${d}', '${b}'],`).join('\n')}
];
`;
}

/** An ingress fixture. `literals` is the wire-only half it names. */
function fixtureRest(literals = ['filters', '$filter']) {
    return `
export const FILTER_SLOT_QUERY_PARAMS: readonly string[] = (() => {
  const slot = RPC_QUERY_ALIAS_SLOTS.find((s) => s.canonical === 'where');
  return [...(slot ? [slot.canonical, ...slot.aliases] : [])${literals.map((s) => `, '${s}'`).join('')}];
})();
`;
}

function selfTest() {
    const failures = [];
    const check = (name, condition, detail) => {
        if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    };
    const run = (protocolText, restText, specText = FIXTURE_SPEC) =>
        judge({ specText, protocolText, restText });

    // 1. The tree as it stands: both sides name the same four spellings.
    {
        const { problems, protocolSet, restSet } = run(fixtureProtocol(), fixtureRest());
        check('agreeing sides are green', problems.length === 0, problems[0]);
        check(
            'both sides read as the four wire spellings',
            [...protocolSet].sort().join(',') === '$filter,filter,filters,where'
            && [...restSet].sort().join(',') === '$filter,filter,filters,where',
            `protocol=${[...(protocolSet ?? [])].sort()} rest=${[...(restSet ?? [])].sort()}`,
        );
    }

    // 2. A fifth spelling on the NORMALIZER side only — the direction #8002 is
    //    about, and the one nothing else in the repo refuses.
    {
        const { problems } = run(fixtureProtocol(['filters', '$filter', 'where_clause']), fixtureRest());
        check('a normalizer-only fifth spelling is red', problems.length === 1, `saw ${problems.length}`);
        check(
            'the failure names the drifted spelling and its direction',
            problems[0]?.includes('where_clause') && problems[0]?.includes('FOLDED BUT UNGATED'),
            problems[0],
        );
        check(
            'the failure names both files',
            problems[0]?.includes(PROTOCOL_FILE) && problems[0]?.includes(REST_FILE),
            problems[0],
        );
    }

    // 3. The same fifth spelling on BOTH sides is green again — the gate judges
    //    parity, not the size of the set.
    {
        const { problems } = run(
            fixtureProtocol(['filters', '$filter', 'where_clause']),
            fixtureRest(['filters', '$filter', 'where_clause']),
        );
        check('agreement at five spellings is green', problems.length === 0, problems[0]);
    }

    // 4. A fifth spelling on the INGRESS side only.
    {
        const { problems } = run(fixtureProtocol(), fixtureRest(['filters', '$filter', 'where_clause']));
        check('an ingress-only fifth spelling is red', problems.length === 1, `saw ${problems.length}`);
        check(
            'the failure names the opposite direction',
            problems[0]?.includes('GATED BUT NOT FOLDED') && problems[0]?.includes('where_clause'),
            problems[0],
        );
    }

    // 5. A `$` alias folding INTO a filter spelling is a filter spelling. It
    //    reaches `where` through two hops, which is exactly the shape a reader
    //    comparing only the slot tables would miss.
    {
        const { problems } = run(
            fixtureProtocol(['filters', '$filter'], [['$top', 'top'], ['$filters', 'filters']]),
            fixtureRest(),
        );
        check('a dollar alias onto a filter spelling is red', problems.length === 1, `saw ${problems.length}`);
        check('the dollar alias is named', problems[0]?.includes('$filters'), problems[0]);
    }

    // 6. Rot: an unreadable shape must fail LOUDLY. A reader that matches
    //    nothing would otherwise compare two empty sets and report a pass.
    {
        const { problems } = run(fixtureProtocol(), '\nexport const SOMETHING_ELSE = [];\n');
        check('a missing ingress declaration is red', problems.length === 1, `saw ${problems.length}`);
        check('the rot failure names what it looked for', problems[0]?.includes(REST_SET), problems[0]);
    }
    {
        const detached = fixtureProtocol().replace('RPC_QUERY_ALIAS_SLOTS.map', 'SOME_OTHER_TABLE.map');
        const { problems } = run(detached, fixtureRest());
        check(
            'a normalizer that stops deriving from the spec table is red',
            problems.length === 1 && problems[0].includes(SPEC_TABLE),
            problems[0],
        );
    }
    {
        const opaque = fixtureRest().replace("'filters'", 'SOME_CONSTANT');
        const { problems } = run(fixtureProtocol(), opaque);
        check(
            'a non-literal ingress element is red rather than skipped',
            problems.length === 1 && problems[0].includes('neither a literal spelling'),
            problems[0],
        );
    }
    {
        const { problems } = run(fixtureProtocol(), fixtureRest(), '\nexport const RPC_QUERY_ALIAS_SLOTS = [];\n');
        check(
            'an empty spec table is red, not vacuously green',
            problems.length === 1 && problems[0].includes(SPEC_TABLE),
            problems[0],
        );
    }

    // 7. The wiring this gate depends on to run at all.
    {
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
        const entry = pkg.scripts?.['check:filter-alias-parity'];
        check('root package.json declares check:filter-alias-parity', typeof entry === 'string', 'missing');
        check(
            'the script entry runs the self-test before the gate',
            entry?.includes('--self-test') && entry.includes('check-filter-alias-parity.mjs'),
            entry,
        );
        const lint = readFileSync(join(ROOT, '.github/workflows/lint.yml'), 'utf8');
        const wired = lint.split('\n').filter((l) => /run: pnpm check:filter-alias-parity\s*$/.test(l));
        check('lint.yml runs the gate exactly once', wired.length === 1, `found ${wired.length}`);
    }

    if (failures.length) {
        console.error('check:filter-alias-parity --self-test FAILED');
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
    }
    console.log(
        'check:filter-alias-parity --self-test passed (parity at four and at five spellings, both drift '
        + 'directions, the two-hop `$` alias, four rot shapes, and the CI wiring)',
    );
}

// ─────────────────────────────────────────────────────────────────────────────

function main() {
    if (process.argv.includes('--self-test')) {
        selfTest();
        return;
    }
    selfTest();

    const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
    const { problems, protocolSet, restSet } = judge({
        specText: read(SPEC_FILE),
        protocolText: read(PROTOCOL_FILE),
        restText: read(REST_FILE),
    });

    if (problems.length === 0) {
        console.log(
            `check:filter-alias-parity: OK (${restSet.size} wire spelling(s) of the \`${FILTER_SLOT}\` slot, `
            + `identical on both sides: ${[...restSet].sort().join(', ')})`,
        );
        return;
    }

    console.error('check:filter-alias-parity: the filter slot\'s wire spellings have drifted\n');
    for (const problem of problems) console.error(`${problem}\n`);
    if (protocolSet && restSet) {
        console.error(
            'Half of this seam is pinned by `#7390 §5 filterSlotSpellingsAreComplete`; this gate covers the '
            + 'half that pin cannot reach, because the table holding the truth lives in a package that is only '
            + 'a devDependency of the one that gates the ingress.',
        );
    }
    process.exit(1);
}

main();
