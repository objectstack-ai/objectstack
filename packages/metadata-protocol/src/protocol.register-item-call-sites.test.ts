// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22057 — every `registerItem(` call in `protocol.ts` carries a recorded
 * disposition, so the closing card's classification cannot go stale when a
 * registration is added, removed or re-scoped.
 *
 * `SchemaRegistry.registerItem(type, item, keyField)` with no package id
 * writes the registry's bare slot for the name, and `SchemaRegistry.getItem`
 * answers that slot ahead of every package's own entry, whichever package the
 * read names. The question each row below answers is the card's: can this
 * registration put a body bound to one package under a bare name that
 * another package ships? Where it can for a VIEW, the registration first asks
 * `anotherPackageShips` and skips the name (#21980's shape for an expansion),
 * and the reads answer the body from its stored row. The behaviour is pinned
 * in `protocol.org-scoped-write-refused.test.ts`, block (j).
 *
 * ⛔ View only. For every other type a row bound to one package, of a name two
 * packages ship, holds the bare entry with its own body and envelope, as
 * #4624 rules (`objectql`'s `protocol-boot-hydration-scoped.test.ts`,
 * ADR-0048); block (j)'s control (e) pins that here.
 *
 * The population is the card's enumeration command,
 * `git grep -n "registerItem(" -- packages/metadata-protocol/src/protocol.ts`:
 * its matches are the calls below, mentions inside comments, and one
 * `unregisterItem(`. Each call is keyed by the class member it sits in and its
 * argument text, which survive line moves and fail on any change of scope. A
 * new call, a removed one or a re-scoped one turns this red until its row is
 * recorded here with its disposition (and the card's table in the PR that
 * adds it).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('./protocol.ts', import.meta.url)), 'utf8');
const LINES = SOURCE.split('\n');
const CALLEE = 'registerItem(';

/** A class member's header in `protocol.ts`: four spaces, optional modifiers, its name, its parameter list. */
const MEMBER_HEADER = /^ {4}(?:(?:private|public|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/;
/** A line of a comment: a block comment's body or opener, or a line comment. */
const COMMENT_LINE = /^\s*(?:\*|\/\*|\/\/)/;

interface Site { readonly member: string; readonly args: string }
interface Located extends Site { readonly line: number; readonly headerLine: number }

/** The member a source offset sits in: the nearest member header above it. */
function memberAt(offset: number): { name: string; line: number } {
    for (let line = SOURCE.slice(0, offset).split('\n').length - 1; line >= 0; line--) {
        const header = MEMBER_HEADER.exec(LINES[line]);
        if (header) return { name: header[1], line };
    }
    return { name: '(no member)', line: -1 };
}

/** Every `registerItem(` call on a code line: not `unregisterItem(`, not inside a comment. */
function callsOf(): Located[] {
    const calls: Located[] = [];
    for (let at = SOURCE.indexOf(CALLEE); at !== -1; at = SOURCE.indexOf(CALLEE, at + 1)) {
        if (/[A-Za-z_$]/.test(SOURCE[at - 1] ?? '')) continue;
        const line = SOURCE.slice(0, at).split('\n').length - 1;
        if (COMMENT_LINE.test(LINES[line])) continue;
        let end = at + CALLEE.length;
        for (let depth = 1; depth > 0 && end < SOURCE.length; end++) {
            if (SOURCE[end] === '(') depth++;
            else if (SOURCE[end] === ')') depth--;
        }
        const args = SOURCE.slice(at + CALLEE.length, end - 1).replace(/\s+/g, ' ').trim().replace(/,$/, '');
        const member = memberAt(at);
        calls.push({ member: member.name, args, line, headerLine: member.line });
    }
    return calls;
}

type Disposition = 'no' | 'yes, view only: skips a name another package ships';

/**
 * The recorded disposition of every call. `path`: the callers that reach it
 * and the kernels it registers on. `why`: why it cannot put a body bound to
 * one package under a name another package ships, or how it skips that name.
 */
const SITES: ReadonlyArray<Site & {
    readonly disposition: Disposition;
    readonly path: string;
    readonly why: string;
    /** For a `yes`: the source text that keeps the skip to `view`. */
    readonly viewOnlyBy?: string;
}> = [
    {
        member: 'applyObjectRegistryMutation', args: 'request.type, request.item, \'name\'', disposition: 'no',
        path: 'applyRegistryWriteThrough for `object` (a save, a publish, a rollback, a revert, a replica\'s mutation), on every kernel',
        why: 'an object: the entry lands in the generic map, which no read serves an object from (getItem, listItems and '
            + 'getArtifactItem read the object contributors for `object`); an object has one code owner (ADR-0029 D3), '
            + 'and a row bound to another package is refused (D9.9, OBJECT_OVERLAY_PACKAGE_MISMATCH)',
    },
    {
        member: 'hydrateOverlayIntoRegistry', args: 'type, mergeArtifactProtection(stateTenantAuthorship(data), envelope), \'name\' as any',
        disposition: 'yes, view only: skips a name another package ships',
        path: 'the list\'s hydration and the write-through on an unscoped kernel; the boot\'s loadMetaFromDb on every kernel',
        why: 'a stored row: a view row bound to a package is not registered where another package ships its name, and the '
            + 'reads answer it from its row; a package-less row, and every other type, register as before (#4624)',
        viewOnlyBy: 'const bound = canonicalType === \'view\' ? boundPackageOf(options.packageId) : undefined;',
    },
    {
        member: 'hydrateExpandedViewItems', args: 'type, item, \'name\' as any',
        disposition: 'yes, view only: skips a name another package ships',
        path: 'hydrateOverlayIntoRegistry, for each expansion of a stored view container',
        why: 'an expansion: not registered where another package ships its name (#21980), and the by-name read answers it '
            + 'from its stored container row',
        viewOnlyBy: 'if ((PLURAL_TO_SINGULAR[type] ?? type) !== \'view\') return [];',
    },
    {
        member: 'restoreArtifactRegistryView', args: 'type, baseline.data, \'name\'',
        disposition: 'yes, view only: skips a name another package ships',
        path: 'the delete\'s heal, tier 2 (deleteMetaItem, revertCommit\'s removal, a replica\'s removal), on an unscoped kernel',
        why: 'the metadata service\'s baseline: a view baseline bound to a package is not re-registered where another '
            + 'package ships the name; tier 1 finds no bare entry to drop for a row the hydration skipped',
        viewOnlyBy: 'const bound = canonicalMetaType(type) === \'view\'',
    },
];

const keyOf = (site: Site) => `${site.member}: ${CALLEE}${site.args})`;

describe('[#22057] every registerItem( in protocol.ts has a recorded disposition', () => {
    const found = callsOf();

    it('the calls in the source are exactly the recorded ones', () => {
        const recorded = SITES.map(keyOf).sort();
        const inSource = found.map(keyOf).sort();
        expect(
            inSource.filter((key) => !recorded.includes(key)),
            'a registration with no recorded disposition: classify it (can it put a body bound to one package under a '
            + 'bare name that another package ships?) and record it in SITES',
        ).toEqual([]);
        expect(recorded.filter((key) => !inSource.includes(key)), 'a recorded registration that is no longer in the source').toEqual([]);
        expect(inSource, 'each call once').toEqual(recorded);
    });

    it('the population is the card\'s enumeration command: the calls, plus mentions in comments and unregisterItem(', () => {
        // Non-vacuity: a scan that found nothing, or lost the members, cannot pass the test above by accident.
        expect(found).toHaveLength(SITES.length);
        expect(found.filter((site) => site.member === '(no member)')).toEqual([]);
        const callLines = new Set(found.map((site) => site.line));
        const others = LINES.map((text, line) => ({ text, line }))
            .filter(({ text, line }) => text.includes(CALLEE) && !callLines.has(line));
        expect(
            others.filter(({ text }) => !COMMENT_LINE.test(text) && !text.includes(`un${CALLEE}`)).map(({ text }) => text.trim()),
            'a line the command prints that is neither a recorded call, a comment, nor unregisterItem(',
        ).toEqual([]);
        // Every other spelling of the method on a code line is the hydrator's capability probe.
        const spelled = LINES.filter((text) => !COMMENT_LINE.test(text) && /(?<![A-Za-z_$])registerItem\b/.test(text))
            .filter((text) => !text.includes(CALLEE));
        expect(spelled.map((text) => text.trim())).toEqual(['if (!registry || typeof registry.registerItem !== \'function\') return false;']);
    });

    it('each registration that skips a name another package ships asks anotherPackageShips before it registers', () => {
        for (const site of SITES.filter((s) => s.disposition !== 'no')) {
            const call = found.find((f) => keyOf(f) === keyOf(site));
            expect(call, keyOf(site)).toBeDefined();
            const body = LINES.slice(call!.headerLine, call!.line).join('\n');
            expect(body, `${site.member}: the question asked ahead of its registration`).toContain('this.anotherPackageShips(');
        }
    });

    it('each skip is kept to view, so every other type registers as #4624 rules', () => {
        for (const site of SITES.filter((s) => s.disposition !== 'no')) {
            expect(site.viewOnlyBy, `${site.member}: the text that keeps it to view`).toBeDefined();
            expect(SOURCE.split(site.viewOnlyBy!).length - 1, `${site.member}: ${site.viewOnlyBy}`).toBe(1);
        }
    });

    it('the question is the one predicate, over every package that can ship the name', () => {
        expect(SOURCE).toMatch(
            /\n {4}private anotherPackageShips\(type: string, name: string, own: unknown, shipping\?: ShippingPackages\): boolean \{\n {8}return this\.shippedArtifactsOf\(type, name, shipping\)\n/,
        );
    });
});
