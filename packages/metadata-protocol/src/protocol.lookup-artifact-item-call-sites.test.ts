// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22024 — every `lookupArtifactItem(` in `protocol.ts` carries a recorded
 * disposition, so the closing card's classification cannot go stale when a
 * call is added, removed or re-scoped.
 *
 * `lookupArtifactItem(type, name, currentPackageId?)` answers the registry's
 * artifact for a name, prefer-local to `currentPackageId` and else the first
 * composite: the first-registered package's. A call that passes no package,
 * or one that can be `undefined`, therefore answers the first-registered
 * package's artifact for a name two packages ship. The question each row
 * below answers is the card's: does that artifact's `_packageId` (its
 * envelope) reach an answer whose body came from a different package?
 *
 * One row did: the by-name read's envelope merge in `getMetaItem` (since
 * #24097 its body `readMetaItem`, which the rows below key on), which
 * served one package's stored copy under the first-registered package's
 * `_packageId`. It now looks its envelope up at the served item's own package
 * (`envelopePackageId`, the list's rule); the behaviour is pinned in
 * `protocol.org-scoped-write-refused.test.ts`, block (i).
 *
 * The population is the card's own enumeration command,
 * `git grep -n 'lookupArtifactItem(' -- packages/metadata-protocol/src`
 * (tests excluded), which is two files: every match is a call or a
 * definition. Each is keyed by the file, the class member or module function
 * it sits in, and its argument text, which survive line moves and fail on any
 * change of scope. A new call, a removed one or a re-scoped one turns this red
 * until its row is recorded here with its disposition (and the card's table in
 * the PR that adds it).
 *
 * [#25467 cut 15] The second file is `protocol-artifact-lookup.ts`. The
 * lookup's body moved there with `shippedArtifactsOf`'s, so it holds the
 * function the class member delegates to and that member's two calls; the
 * class member keeps its signature in `protocol.ts`, and `shippedArtifactsOf`'s
 * stub there hands the moved body the lookup as a closure, one more site.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('./protocol.ts', import.meta.url)), 'utf8');
/** [#25467 cut 15] The seam module the lookup's body moved to; scanned with its own header shape. */
const SEAM_FILE = 'protocol-artifact-lookup.ts';
const SEAM = readFileSync(fileURLToPath(new URL(`./${SEAM_FILE}`, import.meta.url)), 'utf8');
const CALLEE = 'lookupArtifactItem(';

/** A class member's header in `protocol.ts`: four spaces, optional modifiers, its name, its parameter list. */
const MEMBER_HEADER = /^ {4}(?:(?:private|public|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/;
/** A module function's header in the seam module: `export`, optional `async`, `function`, its name, its parameter list. */
const FUNCTION_HEADER = /^export (?:async )?function ([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/;

interface Site { readonly file?: string; readonly member: string; readonly args: string }

/** Every `lookupArtifactItem(` in `protocol.ts` and the seam module: the file, the member it sits in and its argument text, whitespace-normalised. */
function sitesIn(): Site[] {
    return [
        ...sitesOf(SOURCE, MEMBER_HEADER),
        ...sitesOf(SEAM, FUNCTION_HEADER).map((site) => ({ ...site, file: SEAM_FILE })),
    ];
}

/** Every `lookupArtifactItem(` in one source: the member it sits in (by `header`) and its argument text, whitespace-normalised. */
function sitesOf(source: string, header: RegExp): Site[] {
    const lines = source.split('\n');
    const sites: Site[] = [];
    for (let at = source.indexOf(CALLEE); at !== -1; at = source.indexOf(CALLEE, at + 1)) {
        let end = at + CALLEE.length;
        for (let depth = 1; depth > 0 && end < source.length; end++) {
            if (source[end] === '(') depth++;
            else if (source[end] === ')') depth--;
        }
        const args = source.slice(at + CALLEE.length, end - 1).replace(/\s+/g, ' ').trim().replace(/,$/, '');
        let member = '(no member)';
        for (let line = source.slice(0, at).split('\n').length - 1; line >= 0; line--) {
            const found = header.exec(lines[line]);
            if (found) { member = found[1]; break; }
        }
        sites.push({ member, args });
    }
    return sites;
}

type Disposition = 'definition' | 'served-package envelope' | 'no';

/**
 * The recorded disposition of every site. `noPackage`: it passes no package,
 * or one that can be `undefined`. `why`: for a `no`, why its artifact's
 * envelope never reaches an answer whose body came from another package.
 */
const SITES: ReadonlyArray<Site & { readonly noPackage: boolean; readonly disposition: Disposition; readonly why: string }> = [
    { member: 'lookupArtifactItem', args: 'type: string, name: string, currentPackageId?: string, member?: string', noPackage: false, disposition: 'definition',
        why: 'the definition itself: the class member\'s declared signature (its body delegates to the seam function below)' },
    { file: SEAM_FILE, member: 'lookupArtifactItem', args: 'this: Pick<ArtifactLookupHost, \'engine\'>, type: string, name: string, currentPackageId?: string, member?: string', noPackage: false, disposition: 'definition',
        why: '[#25467 cut 15] the definition\'s body, the function the class member delegates to' },
    { member: 'readMetaItem', args: 'request.type, request.name, envelopePackageId(request.packageId, item), bundleMemberOf(request.type, item)', noPackage: true, disposition: 'served-package envelope',
        why: 'the by-name read\'s envelope: naming no package, the package of the item it serves (the list\'s rule); [#23074] at the served item\'s own bundle member' },
    { member: 'readFlattenedMetaItems', args: 'request.type, itemName, itemPackageId, bundleMemberOf(request.type, it)', noPackage: true, disposition: 'served-package envelope',
        why: 'the list\'s envelope: each item\'s own package, the rule the by-name read shares; [#23074] at each item\'s own bundle member' },
    { member: 'readMetaItem', args: 'request.type, request.name, request.packageId', noPackage: true, disposition: 'no',
        why: 'the shipped-flow arm: the served body IS this artifact, and the envelope is looked up at its own package' },
    { member: 'readMetaItem', args: 'request.type, request.name, request.packageId, wantedMember', noPackage: true, disposition: 'no',
        why: '[#22877] a bundled type\'s addressed member (the selector\'s, else the canonical one) when no stored row of it exists: the served body IS this artifact, and the envelope is looked up at its own package' },
    { member: 'getMetaItemLayered', args: 'request.type, request.name, request.packageId, wantedMember', noPackage: true, disposition: 'no',
        why: 'the layered read\'s code LAYER: body and envelope are one artifact, and its provenance fields are read off that layer; [#26699] at the addressed member (the selector\'s, else the canonical one)' },
    { member: 'packagedArtifactBase', args: 'type, name', noPackage: true, disposition: 'no',
        why: 'the packaged base the translators compare a served body against: nothing of it is grafted onto the body' },
    { member: 'readCodeLayerForCarryForward', args: 'type, name, pkg', noPackage: true, disposition: 'no',
        why: 'a save\'s credential carry-forward: a write, whose door strips the derived provenance keys before it persists' },
    { member: 'isArtifactBacked', args: 'type, name', noPackage: true, disposition: 'no',
        why: 'a boolean predicate' },
    { member: 'isNestedArtifactField', args: '\'object\', name.slice(0, sep)', noPackage: true, disposition: 'no',
        why: 'a boolean containment test over the one owner of an object' },
    { member: 'packagedArtifactOwner', args: 'folded.type, folded.name', noPackage: true, disposition: 'no',
        why: 'a shipped-package check by name: it returns a package id, never an envelope on a served body' },
    { file: SEAM_FILE, member: 'shippedArtifactsOf', args: 'type, name', noPackage: true, disposition: 'no',
        why: 'the lock\'s artifact layer (the one item-lock resolution), never an envelope on a served body' },
    { file: SEAM_FILE, member: 'shippedArtifactsOf', args: 'type, name, packageId', noPackage: false, disposition: 'no',
        why: 'scoped to a named package, and kept only when it is that package\'s own' },
    { member: 'shippedArtifactsOf', args: '...a', noPackage: true, disposition: 'no',
        why: '[#25467 cut 15] the class member\'s host closure: it forwards the moved body\'s two calls (the rows above) unchanged, so its disposition is theirs' },
    { member: 'hydrateOverlayIntoRegistry', args: 'type, (data as any).name, options.packageId ?? undefined, bundleMemberOf(type, data)', noPackage: true, disposition: 'no',
        why: 'scoped to the row\'s own package; undefined only for a package-less row, whose body names no package; [#23074] at the row\'s own bundle member' },
    { member: 'expandRuntimeViewContainer', args: 'type, String(item.name), ownPackageId', noPackage: false, disposition: 'no',
        why: 'not called without a package, and kept only when it is the container\'s own package\'s' },
    { member: 'shippedViewContainerOf', args: 'type, name, packageId', noPackage: false, disposition: 'no',
        why: 'returns before the lookup without a package, and keeps only that package\'s own container' },
    { member: 'runtimeViewContainerPackage', args: 'type, container.name', noPackage: true, disposition: 'no',
        why: 'the package a package-less container row overlays: it becomes the expansion\'s own package, whose own artifact lends the envelope' },
    { member: 'isShippedByAnotherPackage', args: 'type, name', noPackage: true, disposition: 'no',
        why: 'a boolean predicate' },
    { member: 'viewContainerNameCollisionRefusal', args: 'type, name', noPackage: true, disposition: 'no',
        why: 'the save door\'s collision check: the package id names a shipper in a refusal, never an envelope on a served body' },
];

const keyOf = (site: Site) => `${site.file ?? 'protocol.ts'} ${site.member}: ${CALLEE}${site.args})`;

describe('[#22024] every lookupArtifactItem( in protocol.ts has a recorded disposition', () => {
    const found = sitesIn();

    it('the sites in the source are exactly the recorded ones', () => {
        const recorded = SITES.map(keyOf).sort();
        const inSource = found.map(keyOf).sort();
        expect(
            inSource.filter((key) => !recorded.includes(key)),
            'a site with no recorded disposition: classify it (does its artifact\'s envelope reach an answer whose body '
            + 'came from another package?) and record it in SITES',
        ).toEqual([]);
        expect(recorded.filter((key) => !inSource.includes(key)), 'a recorded site that is no longer in the source').toEqual([]);
        expect(inSource, 'each site once').toEqual(recorded);
    });

    it('the population is the card\'s enumeration: one definition and every call, each in a member', () => {
        // Non-vacuity: a scan that found nothing, or lost the members, cannot pass the test above by accident.
        // [#25467 cut 15] One definition per file: the class member's signature and the seam function it delegates to.
        expect(found.filter((site) => site.member === 'lookupArtifactItem' && site.args.includes(': string')).map((site) => site.file ?? 'protocol.ts'))
            .toEqual(['protocol.ts', SEAM_FILE]);
        expect(found.filter((site) => site.member === '(no member)')).toEqual([]);
        expect(found.length).toBe(SITES.length);
    });

    it('[#25467 cut 15] the seam module is scanned: the definition\'s body and both of shippedArtifactsOf\'s calls are found there', () => {
        // Non-vacuity for the second file: a scan that read the wrong file, or none, finds no site there.
        expect(found.filter((site) => site.file === SEAM_FILE).map(keyOf).sort()).toEqual(
            SITES.filter((site) => site.file === SEAM_FILE).map(keyOf).sort(),
        );
        expect(found.filter((site) => site.file === SEAM_FILE)).toHaveLength(3);
    });

    it('a site passing fewer than three arguments is recorded as passing no package', () => {
        const topLevelArgs = (args: string) => {
            let depth = 0;
            let count = 1;
            for (const c of args) {
                if (c === '(') depth++;
                else if (c === ')') depth--;
                else if (c === ',' && depth === 0) count++;
            }
            return count;
        };
        expect(SITES.filter((site) => site.disposition !== 'definition' && topLevelArgs(site.args) < 3 && !site.noPackage).map(keyOf))
            .toEqual([]);
    });

    it('both read doors take their envelope from one rule, the served item\'s own package when none is named', () => {
        expect(SOURCE).toMatch(/\nfunction envelopePackageId\(requestedPackageId: string \| undefined, served: unknown\): string \| undefined \{/);
        expect(SOURCE).toContain('const itemPackageId = envelopePackageId(packageId, it);');
        expect(SITES.filter((site) => site.disposition === 'served-package envelope').map((site) => site.member).sort())
            .toEqual(['readFlattenedMetaItems', 'readMetaItem']);
    });
});
