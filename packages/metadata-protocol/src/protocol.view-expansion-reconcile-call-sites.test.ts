// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23198] The registry-heal family's closing check: every write that changes a
 * stored row in `protocol.ts` reaches the registry through the write-through or
 * the delete's heal, both of which end in the one reconcile of a view
 * container's expansions (`reconcileViewExpansions`), and nothing else
 * registers an expansion or touches the record that reconcile keeps.
 *
 * The family is a registry entry that a stored row put there and that outlives
 * the change to that row (a reset that healed the container's key alone, a
 * republish that retired nothing). A per-path fix closes only the path someone
 * noticed, so this reads the whole population from the source:
 *
 *  1. THE STORED-ROW WRITES: every call of a repository write verb (`put`,
 *     `delete`, `promoteDraft`, `restoreVersion`) and every raw engine write to
 *     `sys_metadata`. Each is keyed by its member and its verb, and records the
 *     route by which the registry follows it. A write with no recorded route
 *     turns this red and names itself. The data door cannot write
 *     `sys_metadata` (its `apiMethods` are `get` and `list`), so these are all
 *     the writes this process makes to it.
 *  2. THE CHAIN: the write-through reaches the hydrator, every path of the
 *     hydrator that registers the row reaches the expansion hydration, that
 *     reaches the reconcile, and the heal runs the reconcile ahead of its walk.
 *     Every call into the chain is awaited, so a write answers after it.
 *  3. THE RECORD AND THE VERBS: only the reconcile reads or writes the record;
 *     the heal verbs are called by the heal walk alone. Every `registerItem(`
 *     call is pinned with its member in `protocol.register-item-call-sites.test.ts`,
 *     where the expansion's registration sits in the reconcile.
 *
 * Every write is routed; the census has no exception kind. The last one, the
 * orphan adoption's rebinding (`reassignOrphanedMetadata`,
 * `POST /packages/:id/adopt-orphans`), now writes each rebound view row
 * through, with the binding it left, so the reconcile moves the row's record
 * to its new binding at once. A new write with no route turns this red, and
 * the only way to green it is to route that write.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('./protocol.ts', import.meta.url)), 'utf8');
const LINES = SOURCE.split('\n');

/** A class member's header in `protocol.ts`: four spaces, optional modifiers, its name, its parameter list. */
const MEMBER_HEADER = /^ {4}(?:(?:private|public|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/;
/** A line of a comment: a block comment's body or opener, or a line comment. */
const COMMENT_LINE = /^\s*(?:\*|\/\*|\/\/)/;

/** Every member header, in source order, with the offset of its line. */
const MEMBERS: ReadonlyArray<{ name: string; offset: number }> = (() => {
    const out: Array<{ name: string; offset: number }> = [];
    let offset = 0;
    for (const text of LINES) {
        const header = MEMBER_HEADER.exec(text);
        if (header) out.push({ name: header[1], offset });
        offset += text.length + 1;
    }
    return out;
})();

const lineOf = (offset: number) => SOURCE.slice(0, offset).split('\n').length - 1;
const isCode = (offset: number) => !COMMENT_LINE.test(LINES[lineOf(offset)]);

/** The member a source offset sits in, and that member's extent. */
function memberAt(offset: number): { name: string; start: number; end: number } {
    let at = -1;
    for (let i = 0; i < MEMBERS.length && MEMBERS[i].offset <= offset; i++) at = i;
    if (at === -1) return { name: '(no member)', start: 0, end: 0 };
    return { name: MEMBERS[at].name, start: MEMBERS[at].offset, end: MEMBERS[at + 1]?.offset ?? SOURCE.length };
}

/** Every match of `pattern` on a code line, with its member. */
function codeMatches(pattern: RegExp): Array<{ offset: number; text: string; member: string }> {
    const out: Array<{ offset: number; text: string; member: string }> = [];
    for (const m of SOURCE.matchAll(new RegExp(pattern.source, 'g'))) {
        if (!isCode(m.index!)) continue;
        out.push({ offset: m.index!, text: m[0].replace(/\s+/g, ' '), member: memberAt(m.index!).name });
    }
    return out;
}

/** The code lines of one member, by name: it must be declared exactly once. */
function bodyOf(name: string): string {
    const found = MEMBERS.filter((m) => m.name === name);
    expect(found.map((m) => m.name), `the member ${name}`).toEqual([name]);
    const { start, end } = memberAt(found[0].offset);
    return SOURCE.slice(start, end).split('\n').filter((l) => !COMMENT_LINE.test(l)).join('\n');
}

// ── 1. The stored-row writes ─────────────────────────────────────────────

/** A repository write verb on the one spelling a repository is bound under, or a raw `sys_metadata` write. */
const STORED_ROW_WRITE = /\brepo\.(?:put|delete|promoteDraft|restoreVersion)\(|this\.engine\.(?:insert|update|delete)\(\s*'sys_metadata'/;

type Route =
    /** The write-through or the heal is called after the write, in the same member, before its next write. */
    | { readonly sameMember: 'applyRegistryWriteThrough' | 'restoreArtifactRegistryView' }
    /** The member hands the row to its callers, and each of them calls `then`, which calls the write-through. */
    | { readonly handedTo: 'callers'; readonly then: 'runPublishSideEffects' };

const WRITES: ReadonlyArray<{ readonly member: string; readonly verb: string; readonly route: Route }> = [
    { member: 'saveMetaItem', verb: 'repo.put(', route: { sameMember: 'applyRegistryWriteThrough' } },
    { member: 'promoteDraftForPublish', verb: 'repo.promoteDraft(', route: { handedTo: 'callers', then: 'runPublishSideEffects' } },
    { member: 'revertCommit', verb: 'repo.delete(', route: { sameMember: 'restoreArtifactRegistryView' } },
    { member: 'revertCommit', verb: 'repo.restoreVersion(', route: { sameMember: 'applyRegistryWriteThrough' } },
    { member: 'rollbackMetaItem', verb: 'repo.restoreVersion(', route: { sameMember: 'applyRegistryWriteThrough' } },
    { member: 'deleteMetaItem', verb: 'repo.delete(', route: { sameMember: 'restoreArtifactRegistryView' } },
    { member: 'deleteMetaItem', verb: 'this.engine.delete(\'sys_metadata\'', route: { sameMember: 'restoreArtifactRegistryView' } },
    { member: 'reassignOrphanedMetadata', verb: 'this.engine.update(\'sys_metadata\'', route: { sameMember: 'applyRegistryWriteThrough' } },
];

/** The verb as `WRITES` spells it: no whitespace after its open paren. */
const verbOf = (text: string) => text.replace(/\(\s*/, '(');

describe('[#23198] every stored-row write in protocol.ts reaches the reconcile', () => {
    const writes = codeMatches(STORED_ROW_WRITE).map((w) => ({ ...w, verb: verbOf(w.text) }));

    it('the writes in the source are exactly the recorded ones', () => {
        const key = (w: { member: string; verb: string }) => `${w.member}: ${w.verb}`;
        expect(
            writes.map(key).filter((k) => !WRITES.map(key).includes(k)),
            'a stored-row write with no recorded route to the registry: route it through applyRegistryWriteThrough '
            + '(a live row) or restoreArtifactRegistryView (a removed row), and record it in WRITES',
        ).toEqual([]);
        expect(writes.map(key).sort(), 'each recorded write once').toEqual(WRITES.map(key).sort());
    });

    it('a same-member route is called after its write and before the member\'s next write', () => {
        for (const row of WRITES) {
            if (!('sameMember' in row.route)) continue;
            const write = writes.find((w) => w.member === row.member && w.verb === row.verb)!;
            const { end } = memberAt(write.offset);
            const nextWrite = writes.find((w) => w.member === row.member && w.offset > write.offset)?.offset ?? end;
            const routes = codeMatches(new RegExp(`this\\.${row.route.sameMember}\\(`))
                .filter(({ offset }) => offset > write.offset && offset < nextWrite);
            expect(routes.length, `${row.member}: ${row.verb} → ${row.route.sameMember}`).toBeGreaterThan(0);
        }
    });

    it('a write handed to its callers reaches the write-through in each of them', () => {
        for (const row of WRITES) {
            if (!('handedTo' in row.route)) continue;
            const callers = codeMatches(new RegExp(`this\\.${row.member}\\(`));
            expect(callers.length, `${row.member}: its callers`).toBeGreaterThan(0);
            for (const call of callers) {
                const { end } = memberAt(call.offset);
                const then = codeMatches(new RegExp(`this\\.${row.route.then}\\(`))
                    .filter(({ offset }) => offset > call.offset && offset < end);
                expect(then.length, `${call.member}: ${row.member} → ${row.route.then}`).toBeGreaterThan(0);
            }
            expect(bodyOf(row.route.then)).toContain('this.applyRegistryWriteThrough(');
        }
    });

    it('a repository is bound under the one spelling the census reads', () => {
        // A repository bound under any other name would write past the census.
        const ACQUIRE = /this\.getOverlayRepo\(\)|new SysMetadataRepository\(/;
        const OWN = ['getOverlayRepo'];
        const stray = codeMatches(ACQUIRE).filter(({ offset, member }) => {
            if (OWN.includes(member)) return false;
            const line = LINES[lineOf(offset)].trim();
            return !/^const repo = this\.getOverlayRepo\(\);$/.test(line)
                && !/this\.getOverlayRepo\(\)\.listDrafts\(/.test(line);
        });
        expect(stray.map(({ member, offset }) => `${member}: ${LINES[lineOf(offset)].trim()}`)).toEqual([]);
        expect(codeMatches(/new SysMetadataRepository\(/).map((m) => m.member)).toEqual(['getOverlayRepo']);
    });
});

// ── 2. The chain ─────────────────────────────────────────────────────────

describe('[#23198] the write-through and the heal both end in the one reconcile', () => {
    it('the write-through hydrates every type but `object` through the hydrator', () => {
        expect(bodyOf('applyRegistryWriteThrough')).toContain('await this.hydrateOverlayIntoRegistry(request.type, request.item, {');
    });

    it('every path of the hydrator that registers the row hydrates its expansions first', () => {
        const body = bodyOf('hydrateOverlayIntoRegistry');
        const lines = body.split('\n').filter((l) => !COMMENT_LINE.test(l) && l.trim() !== '');
        const registers = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim().startsWith('return true;'));
        expect(registers.length, 'the registering paths').toBe(2);
        for (const { i } of registers) {
            expect(lines[i - 1].trim()).toBe('await this.hydrateExpandedViewItems(type, data, options);');
        }
    });

    it('the reconcile has exactly two callers: the registration and the heal', () => {
        expect(codeMatches(/this\.reconcileViewExpansions\(/).map((m) => m.member).sort())
            .toEqual(['hydrateExpandedViewItems', 'restoreArtifactRegistryView']);
        expect(codeMatches(/this\.hydrateExpandedViewItems\(/).map((m) => m.member))
            .toEqual(['hydrateOverlayIntoRegistry', 'hydrateOverlayIntoRegistry']);
    });

    it('every call into the chain is awaited, so a write answers after its reconcile', () => {
        const CHAIN = /this\.(?:applyRegistryWriteThrough|hydrateOverlayIntoRegistry|hydrateExpandedViewItems|reconcileViewExpansions|restoreArtifactRegistryView)\(/;
        const calls = codeMatches(CHAIN);
        expect(calls.length).toBeGreaterThan(0);
        expect(
            calls.filter(({ offset }) => !/\bawait\s+$/.test(SOURCE.slice(offset - 12, offset)))
                .map(({ member, text }) => `${member}: ${text}`),
        ).toEqual([]);
    });

    it('the heal reconciles to the empty set ahead of its tier walk, past the organization gate', () => {
        const body = bodyOf('restoreArtifactRegistryView');
        const gate = body.indexOf('if (organizationId !== null && organizationId !== undefined) return;');
        const reconcile = body.indexOf("await this.reconcileViewExpansions(type, { container: name, removed: 'every-row' }, organizationId);");
        const walk = body.indexOf('registry.removeRuntimeShadow(');
        expect(gate).toBeGreaterThan(-1);
        expect(reconcile).toBeGreaterThan(gate);
        expect(walk).toBeGreaterThan(reconcile);
    });
});

// ── 3. The record and the verbs ─────────────────────────────────────────

describe('[#23198] nothing reaches the record or the heal verbs around the reconcile', () => {
    it('only the reconcile reads or writes the record', () => {
        const DECLARATION = '    private static readonly registeredViewExpansions =';
        const uses = codeMatches(/\bregisteredViewExpansions\b/)
            .filter(({ offset }) => !LINES[lineOf(offset)].startsWith(DECLARATION));
        expect(uses.map((u) => u.member)).toEqual(['reconcileViewExpansions']);
        expect(SOURCE.split(DECLARATION).length - 1, 'one declaration').toBe(1);
    });

    it('the heal verbs are called by the heal walk alone', () => {
        const verbs = codeMatches(/\.(?:removeRuntimeShadow|removeOverlayEntry)\(/);
        expect(verbs.length).toBeGreaterThan(0);
        expect([...new Set(verbs.map((v) => v.member))]).toEqual(['restoreArtifactRegistryView']);
    });
});
