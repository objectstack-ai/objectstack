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
 *
 * [#29985] The population is read from `protocol.ts` and every `protocol-*.ts`
 * module of the split: the codemod split moved member bodies out of the class
 * (ruling E's host split), each body taking its writes and its calls with it,
 * and a moved body reads the class as `host.` where the class reads `this.`
 * (`SELF` below). A member whose body moved is judged by that body; its stub in
 * `protocol.ts` only hands it the host.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('./protocol.ts', import.meta.url)), 'utf8');

/** A class member's header in `protocol.ts`: four spaces, optional modifiers, its name, its parameter list. */
const MEMBER_HEADER = /^ {4}(?:(?:private|public|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/;
/** [#29985] A module function's header in a split module: optional `export` and `async`, `function`, its name, its parameter list. */
// [#29985 facade] ...or, in a codemod module, a facet's static method at the class's depth.
const FUNCTION_HEADER = /^(?:(?:export )?(?:async )?function | {4}static (?:async )?)([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/;
/** A line of a comment: a block comment's body or opener, or a line comment. */
const COMMENT_LINE = /^\s*(?:\*|\/\*|\/\/)/;
/** [#29985] The class as a body reads it: `this` in `protocol.ts`, `host` in a moved body (ruling E's rewrite set). */
const SELF = '(?:this|host)';

/** One scanned file, its member headers in source order with the offset of each one's line. */
interface Scanned {
    readonly file: string;
    readonly text: string;
    readonly lines: readonly string[];
    readonly members: ReadonlyArray<{ name: string; offset: number }>;
}
function scan(file: string, header: RegExp): Scanned {
    const text = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
    const lines = text.split('\n');
    const members: Array<{ name: string; offset: number }> = [];
    let offset = 0;
    for (const line of lines) {
        const found = header.exec(line);
        if (found) members.push({ name: found[1], offset });
        offset += line.length + 1;
    }
    return { file, text, lines, members };
}
/**
 * [#29985] `protocol.ts`, then every module the codemod split moved a body to:
 * `protocol-*.ts` beside it (the census's own module pattern, `HOST_SPLIT.module`
 * in `scripts/check-durability-degradation-log-level.mjs`), tests excluded,
 * whose header names the codemod. The population is the one this census always
 * counted, wherever its bodies now sit; the modules of the earlier hand series
 * stay outside it as they were.
 */
const CODEMOD_HEADER = '\n * [#29985 codemod] ';
const HOST = scan('protocol.ts', MEMBER_HEADER);
const MODULES = readdirSync(fileURLToPath(new URL('.', import.meta.url)))
    .filter((file) => /^protocol-[a-z0-9-]+\.ts$/.test(file))
    .sort()
    .map((file) => scan(file, FUNCTION_HEADER))
    .filter((scanned) => scanned.text.slice(0, 400).includes(CODEMOD_HEADER));
const SCANNED: readonly Scanned[] = [HOST, ...MODULES];

const lineOf = (scanned: Scanned, offset: number) => scanned.text.slice(0, offset).split('\n').length - 1;
const isCode = (scanned: Scanned, offset: number) => !COMMENT_LINE.test(scanned.lines[lineOf(scanned, offset)]);

/** The member a source offset sits in, and that member's extent. */
function memberAt(scanned: Scanned, offset: number): { name: string; start: number; end: number } {
    const { members } = scanned;
    let at = -1;
    for (let i = 0; i < members.length && members[i].offset <= offset; i++) at = i;
    if (at === -1) return { name: '(no member)', start: 0, end: 0 };
    return { name: members[at].name, start: members[at].offset, end: members[at + 1]?.offset ?? scanned.text.length };
}

interface Match { readonly scanned: Scanned; readonly offset: number; readonly text: string; readonly member: string }

/** Every match of `pattern` on a code line, in every scanned file, with its member. */
function codeMatches(pattern: RegExp): Match[] {
    const out: Match[] = [];
    for (const scanned of SCANNED) {
        for (const m of scanned.text.matchAll(new RegExp(pattern.source, 'g'))) {
            if (!isCode(scanned, m.index!)) continue;
            out.push({ scanned, offset: m.index!, text: m[0].replace(/\s+/g, ' '), member: memberAt(scanned, m.index!).name });
        }
    }
    return out;
}

/**
 * The code lines of one member's body, by name: declared exactly once, as a
 * class member or [#29985] as the split-module function its body moved to.
 */
function bodyOf(name: string): string {
    const moved = MODULES.flatMap((scanned) => scanned.members.filter((m) => m.name === name).map((m) => ({ scanned, m })));
    const found = moved.length > 0 ? moved : HOST.members.filter((m) => m.name === name).map((m) => ({ scanned: HOST, m }));
    expect(found.map(({ m }) => m.name), `the member ${name}`).toEqual([name]);
    const { scanned, m } = found[0];
    const { start, end } = memberAt(scanned, m.offset);
    return scanned.text.slice(start, end).split('\n').filter((l) => !COMMENT_LINE.test(l)).join('\n');
}

// ── 1. The stored-row writes ─────────────────────────────────────────────

/** A repository write verb on the one spelling a repository is bound under, or a raw `sys_metadata` write. */
const STORED_ROW_WRITE = new RegExp(`\\brepo\\.(?:put|delete|promoteDraft|restoreVersion)\\(|\\b${SELF}\\.engine\\.(?:insert|update|delete)\\(\\s*'sys_metadata'`);

type Route =
    /** The write-through or the heal is called after the write, in the same member, before its next write. */
    | { readonly sameMember: 'applyRegistryWriteThrough' | 'restoreArtifactRegistryView' }
    /** The member hands the row to its callers, and each of them calls `then`, which calls the write-through. */
    | { readonly handedTo: 'callers'; readonly then: 'runPublishSideEffects' };

// [#28355] A door's write lives in its `…Unaudited` body; the public door of the same name
// only wraps it with the refusal audit, so the member is the body's name.
const WRITES: ReadonlyArray<{ readonly member: string; readonly verb: string; readonly route: Route }> = [
    { member: 'saveMetaItemUnaudited', verb: 'repo.put(', route: { sameMember: 'applyRegistryWriteThrough' } },
    { member: 'promoteDraftForPublish', verb: 'repo.promoteDraft(', route: { handedTo: 'callers', then: 'runPublishSideEffects' } },
    { member: 'revertCommit', verb: 'repo.delete(', route: { sameMember: 'restoreArtifactRegistryView' } },
    { member: 'revertCommit', verb: 'repo.restoreVersion(', route: { sameMember: 'applyRegistryWriteThrough' } },
    { member: 'rollbackMetaItemUnaudited', verb: 'repo.restoreVersion(', route: { sameMember: 'applyRegistryWriteThrough' } },
    { member: 'deleteMetaItemUnaudited', verb: 'repo.delete(', route: { sameMember: 'restoreArtifactRegistryView' } },
    { member: 'deleteMetaItemUnaudited', verb: 'this.engine.delete(\'sys_metadata\'', route: { sameMember: 'restoreArtifactRegistryView' } },
    { member: 'reassignOrphanedMetadata', verb: 'this.engine.update(\'sys_metadata\'', route: { sameMember: 'applyRegistryWriteThrough' } },
];

/** The verb as `WRITES` spells it: no whitespace after its open paren, [#29985] the class as `this`. */
const verbOf = (text: string) => text.replace(/\(\s*/, '(').replace(/^host\./, 'this.');

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
            const { end } = memberAt(write.scanned, write.offset);
            const nextWrite = writes.find((w) => w.scanned === write.scanned && w.member === row.member && w.offset > write.offset)?.offset ?? end;
            const routes = codeMatches(new RegExp(`\\b${SELF}\\.${row.route.sameMember}\\(`))
                .filter(({ scanned, offset }) => scanned === write.scanned && offset > write.offset && offset < nextWrite);
            expect(routes.length, `${row.member}: ${row.verb} → ${row.route.sameMember}`).toBeGreaterThan(0);
        }
    });

    it('a write handed to its callers reaches the write-through in each of them', () => {
        for (const row of WRITES) {
            if (!('handedTo' in row.route)) continue;
            const callers = codeMatches(new RegExp(`\\b${SELF}\\.${row.member}\\(`));
            expect(callers.length, `${row.member}: its callers`).toBeGreaterThan(0);
            for (const call of callers) {
                const { end } = memberAt(call.scanned, call.offset);
                const then = codeMatches(new RegExp(`\\b${SELF}\\.${row.route.then}\\(`))
                    .filter(({ scanned, offset }) => scanned === call.scanned && offset > call.offset && offset < end);
                expect(then.length, `${call.member}: ${row.member} → ${row.route.then}`).toBeGreaterThan(0);
            }
            expect(bodyOf(row.route.then)).toMatch(new RegExp(`\\b${SELF}\\.applyRegistryWriteThrough\\(`));
        }
    });

    it('a repository is bound under the one spelling the census reads', () => {
        // A repository bound under any other name would write past the census.
        const ACQUIRE = new RegExp(`\\b${SELF}\\.getOverlayRepo\\(\\)|new SysMetadataRepository\\(`);
        const OWN = ['getOverlayRepo'];
        const lineAt = ({ scanned, offset }: Match) => scanned.lines[lineOf(scanned, offset)].trim();
        const stray = codeMatches(ACQUIRE).filter((match) => {
            if (OWN.includes(match.member)) return false;
            const line = lineAt(match);
            return !new RegExp(`^const repo = ${SELF}\\.getOverlayRepo\\(\\);$`).test(line)
                && !new RegExp(`\\b${SELF}\\.getOverlayRepo\\(\\)\\.listDrafts\\(`).test(line);
        });
        expect(stray.map((match) => `${match.member}: ${lineAt(match)}`)).toEqual([]);
        expect(codeMatches(/new SysMetadataRepository\(/).map((m) => m.member)).toEqual(['getOverlayRepo']);
    });
});

// ── 2. The chain ─────────────────────────────────────────────────────────

describe('[#29985] the census reads the modules the split moved bodies to', () => {
    it('reads every codemod module, and the stored-row writes it records sit in them or in protocol.ts', () => {
        // Non-vacuity: a header filter that matched nothing would quietly shrink the census to protocol.ts.
        expect(MODULES.length).toBeGreaterThan(0);
        expect(codeMatches(STORED_ROW_WRITE).some(({ scanned }) => scanned !== HOST)).toBe(true);
    });
});

describe('[#23198] the write-through and the heal both end in the one reconcile', () => {
    it('the write-through hydrates every type but `object` through the hydrator', () => {
        expect(bodyOf('applyRegistryWriteThrough')).toMatch(new RegExp(`await ${SELF}\\.hydrateOverlayIntoRegistry\\(request\\.type, request\\.item, \\{`));
    });

    it('every path of the hydrator that registers the row hydrates its expansions first', () => {
        const body = bodyOf('hydrateOverlayIntoRegistry');
        const lines = body.split('\n').filter((l) => !COMMENT_LINE.test(l) && l.trim() !== '');
        const registers = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim().startsWith('return true;'));
        expect(registers.length, 'the registering paths').toBe(2);
        for (const { i } of registers) {
            expect(lines[i - 1].trim()).toMatch(new RegExp(`^await ${SELF}\\.hydrateExpandedViewItems\\(type, data, options\\);$`));
        }
    });

    it('the reconcile has exactly two callers: the registration and the heal', () => {
        expect(codeMatches(new RegExp(`\\b${SELF}\\.reconcileViewExpansions\\(`)).map((m) => m.member).sort())
            .toEqual(['hydrateExpandedViewItems', 'restoreArtifactRegistryView']);
        expect(codeMatches(new RegExp(`\\b${SELF}\\.hydrateExpandedViewItems\\(`)).map((m) => m.member))
            .toEqual(['hydrateOverlayIntoRegistry', 'hydrateOverlayIntoRegistry']);
    });

    it('every call into the chain is awaited, so a write answers after its reconcile', () => {
        const CHAIN = new RegExp(`\\b${SELF}\\.(?:applyRegistryWriteThrough|hydrateOverlayIntoRegistry|hydrateExpandedViewItems|reconcileViewExpansions|restoreArtifactRegistryView)\\(`);
        const calls = codeMatches(CHAIN);
        expect(calls.length).toBeGreaterThan(0);
        expect(
            calls.filter(({ scanned, offset }) => !/\bawait\s+$/.test(scanned.text.slice(offset - 12, offset)))
                .map(({ member, text }) => `${member}: ${text}`),
        ).toEqual([]);
    });

    it('the heal reconciles to the empty set ahead of its tier walk, past the organization gate', () => {
        const body = bodyOf('restoreArtifactRegistryView');
        const gate = body.indexOf('if (organizationId !== null && organizationId !== undefined) return;');
        const reconcile = body.search(new RegExp(`await ${SELF}\\.reconcileViewExpansions\\(type, \\{ container: name, removed: 'every-row' \\}, organizationId\\);`));
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
            .filter(({ scanned, offset }) => !scanned.lines[lineOf(scanned, offset)].startsWith(DECLARATION));
        expect(uses.map((u) => u.member)).toEqual(['reconcileViewExpansions']);
        expect(SOURCE.split(DECLARATION).length - 1, 'one declaration').toBe(1);
    });

    it('the heal verbs are called by the heal walk alone', () => {
        const verbs = codeMatches(/\.(?:removeRuntimeShadow|removeOverlayEntry)\(/);
        expect(verbs.length).toBeGreaterThan(0);
        expect([...new Set(verbs.map((v) => v.member))]).toEqual(['restoreArtifactRegistryView']);
    });
});
