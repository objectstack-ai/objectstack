// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The published prose that teaches the ADR-0020 D3.3 legal-next-state
 * introspection route spells it the way the REST ledger does (#10178, #14561).
 *
 * WHY THIS EXISTS (measured, not argued). #9180 step ② retired the plural
 * `/api/v1/meta/objects/:name/state/:field` registration and moved the SDK to
 * the singular `object` segment. Nothing connected that change to the prose
 * that teaches the route, so two published sites kept teaching a retired
 * spelling for as long as nobody swept for it by hand — and the sweep that did
 * find them found a THIRD spelling (`/metadata/objects/...`) that a grep for
 * the plural `meta/objects` does not match at all. This asserts the link the
 * ledger row and the prose never had.
 *
 * THE ASSERTION IS DERIVED, NEVER SPELLED OUT HERE. The expected path is read
 * off the `REST_ROUTE_LEDGER` row that owns the route, so this file cannot
 * become a second, hand-copied statement of the canonical spelling — exactly
 * the disease the two-site drift is an instance of. Change the ledger row and
 * this test asks the docs to follow; change a doc line to a non-canonical
 * spelling and it reddens naming the file. #14561 extended that derivation from
 * the SPELLING to the POPULATION: both regexes below are built out of the
 * ledger row's own segments, so neither the expected path nor the net that
 * finds candidates is written down a second time.
 *
 * PRESENCE, NOT ABSENCE. The two named sites below are asserted to CONTAIN the
 * canonical path. "no doc contains the plural" would pass on a page that
 * stopped mentioning the route at all, which is the same silence this guard
 * exists to break — the doc-authoring gate under `scripts/` carries the repo's
 * standing statement of why an evaporated corpus must not read as a clean one.
 *
 * ── CONDITIONAL PRESENCE over a DISCOVERED population (#14561) ──────────────
 *
 * A two-file `TEACHING_SITES` list is the same shape as the drift it catches:
 * a hand-maintained stand-in for a fact already on disk, going stale in
 * silence as the corpus grows. It had already gone stale. Measured on
 * `origin/main` 4d0d9445: SIX files under the authored-prose roots mention this
 * route's shape, two of them are the list below, and one more — the QA
 * platform-checklist area file for the API/backend surface — carries the wire
 * path three times over, with concrete values rather than placeholders. It
 * spells it canonically. That was LUCK, not enforcement: nothing here would
 * have reddened had it been written with the retired plural.
 *
 * So the population is discovered rather than declared. Every authored-prose
 * file that mentions this route AT ALL is judged, and a page that stops
 * mentioning it drops out of the population instead of passing vacuously —
 * which is why the silence objection above does not apply to this half, while
 * the two positive assertions keep doing their own job of proving the canonical
 * spelling is taught SOMEWHERE. Both properties are needed and neither implies
 * the other.
 *
 * ⛔ NOT a discovered-corpus NEGATIVE scan ("no page contains the plural"),
 * which is the shape this deliberately is not; see the next block for why that
 * one would gate against a spelling the platform still answers on purpose.
 *
 * ⛔ WHAT THIS DOES NOT SAY. The plural is NOT universally dead and this test
 * must never be read as saying it is: the legacy if-chain branch in the
 * runtime's `/meta` dispatcher domain still matches BOTH literals, so
 * `/meta/objects/:name/state/:field` is refused by a REST-fronted deployment
 * and still ANSWERED wherever `dispatch()` is the front door. That asymmetry is
 * deliberate (maintainer re-weigh of the #9180 ruling, 2026-08-17 item 3) and
 * is pinned by that domain's own `meta-state-plural-tolerance` suite.
 *
 * That is not prose here, it is the POPULATION BOUNDARY, and it is the reason
 * the discovery net is anchored on the WHOLE ledger route including its
 * versioned API prefix rather than on the `/meta/...` tail. A mention carrying
 * the prefix is a claim about the REST wire path, which is the door this
 * package's ledger row governs and the door where the plural really is
 * refused. A mention without it is the dispatcher spelling, which this file has
 * no opinion about and must not acquire one about — so it is not discovered at
 * all. `PREDICATE_CASES` pins both directions, because a boundary that lives
 * only in a comment is a boundary the next regex tweak can move by accident.
 *
 * WHAT HOLDS THE DERIVATION HONEST. Deriving the population from the same
 * regex that judges it costs the pin the independence a hand-written list gave
 * it for free: a detector that matched nothing would empty the population and
 * leave every assertion below green. Two answers, both mechanical.
 * `PREDICATE_CASES` is a set of whole tiny inputs whose verdict is known by
 * construction — one per spelling this net must catch, one per shape it must
 * NOT claim. And the discovered population is required to contain every named
 * site below, so a net that goes blind reddens on the two files this guard has
 * always known about.
 *
 * ── The corpus, and the input radius it declares (#14561) ───────────────────
 *
 * The corpus is git's answer, not a filesystem crawl: tracked plus authored-
 * but-untracked files under the authored-prose roots, with ignored paths
 * excluded. A `readdirSync` crawl over these roots would be both slower and
 * NONDETERMINISTIC inside merge-queue builds, where generated artifacts land
 * under the same trees mid-run — the reasoning `packages/core`'s
 * operation-private-key pin records in full, reached there by the same route.
 *
 * That is a real widening of this package's cross-package input radius and it
 * is declared deliberately rather than inherited by accident: `content/**`,
 * `docs/**` and `skills/**` are the roots the scan reads, so all three are
 * declared in `CROSS_PACKAGE_TEST_INPUTS` and hashed by `turbo.json`. The two
 * per-file globs stay alongside them: the named sites below are read BY NAME
 * and the gate's roster holds those two paths, while the discovered corpus is
 * a `git ls-files` result whose members this package's detector cannot name —
 * so the `docs/**` root is declared with a `heldBy` witness naming this test,
 * which is the mechanism that table publishes for exactly this case. Price,
 * stated because it is charged to every docs PR: a diff under any of those
 * roots now schedules and re-runs this package's suite.
 *
 * Those two runtime modules are CITED, never read — spelling them as repo
 * paths here would make `check-cross-package-test-inputs` demand a declared
 * radius over the runtime package, claiming an input dependency this test does
 * not have and invalidating this package's test cache on every runtime change.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `.js` on the relative import: without it `moduleResolution: nodenext` does
// not resolve it and every imported symbol degrades to `any`.
import { REST_ROUTE_LEDGER } from './rest-route-ledger.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The published prose that teaches this route. Both spell the REST wire path,
 * so both are judged against the REST ledger row.
 *
 * Each path is a plain `const` bound to ONE relative literal, which is a
 * spelling `check-cross-package-test-inputs` recognises. That gate reads these
 * by scanning source text, so a path it cannot NAME — one composed in a loop,
 * or nested in an object literal — would hold a real input radius while naming
 * nothing its roster can check. Both files are declared for `@objectstack/rest`
 * in `CROSS_PACKAGE_TEST_INPUTS` and hashed by `turbo.json`.
 *
 * ⛔ This list is no longer the population — it is the floor. Adding a file
 * here is NOT how a new teaching site gets covered (the discovered population
 * covers it the moment it is written); a name belongs here only when the site
 * must be asserted to keep teaching the route even if its text is rewritten.
 */
const STATE_MACHINE_DOC = resolve(HERE, '../../../content/docs/protocol/objectql/state-machine.mdx');
const AUTOMATION_SKILL = resolve(HERE, '../../../skills/objectstack-automation/SKILL.md');

const TEACHING_SITES = [
    { label: 'content/docs/protocol/objectql/state-machine.mdx', path: STATE_MACHINE_DOC },
    { label: 'skills/objectstack-automation/SKILL.md', path: AUTOMATION_SKILL },
] as const;

/**
 * The authored-prose roots the discovery scan reads. Bare directory names, and
 * pathspecs for `git ls-files` rather than paths this file resolves — the
 * radius they hold is declared in `CROSS_PACKAGE_TEST_INPUTS`, which is where a
 * reader can check it against the code.
 */
const CORPUS_ROOTS = ['content', 'docs', 'skills'] as const;

/**
 * What a single path SEGMENT's value looks like where prose writes it: a
 * placeholder (`:name`), a real id (`showcase_task`), or one carrying a query
 * (`status?from=in_review`). Everything that ends a URL in running prose,
 * markdown, or a JSON string is excluded, and BOTH regexes below share it — so
 * a mention and its canonical judgement can never disagree about where the
 * route stops.
 */
const SEGMENT_VALUE = '[^/\\s`\'"),;\\]]+';

const escapeForRegExp = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every mention this file reports, with the line it sits on, so a failure names
 * a place a reader can open rather than a file to go searching in.
 */
interface Mention {
    readonly text: string;
    readonly line: number;
}

function mentionsIn(text: string, pattern: RegExp): Mention[] {
    const found: Mention[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i]!.matchAll(pattern)) found.push({ text: m[0], line: i + 1 });
    }
    return found;
}

/**
 * Inputs whose verdict is known by construction — the independence a derived
 * population costs (#14561). Each is a whole tiny "page": the first three are
 * spellings the net MUST catch, the last four are shapes it must NOT claim,
 * and the dispatcher case is the 2026-08-17 asymmetry made checkable.
 */
const PREDICATE_CASES: readonly {
    readonly label: string;
    readonly text: string;
    readonly mentioned: boolean;
    readonly canonical: boolean;
}[] = [
    {
        label: 'the canonical wire path, placeholders, as the protocol page writes it',
        text: 'Over HTTP, `GET /api/v1/meta/object/:name/state/:field?from=:state` returns the legal next list.',
        mentioned: true,
        canonical: true,
    },
    {
        label: 'the canonical wire path with concrete values, as a checklist step writes it',
        text: '"fire the meta state route: GET /api/v1/meta/object/showcase_task/state/status?from=in_review",',
        mentioned: true,
        canonical: true,
    },
    {
        label: 'the retired PLURAL object segment on the REST wire path',
        text: 'Call `GET /api/v1/meta/objects/showcase_task/state/status` to read the legal next states.',
        mentioned: true,
        canonical: false,
    },
    {
        label: 'the third spelling the original sweep found — `metadata` plus the plural',
        text: 'Call `GET /api/v1/metadata/objects/:name/state/:field` to read the legal next states.',
        mentioned: true,
        canonical: false,
    },
    {
        label: 'the DISPATCHER spelling, no versioned prefix — deliberately out of the population',
        text: 'Embedded, `dispatch()` answers `/meta/objects/:name/state/:field` as well as the singular form.',
        mentioned: false,
        canonical: false,
    },
    {
        label: 'a different meta route that shares the object segment but has no state tail',
        text: '"server reject: PUT /api/v1/meta/object/qa_owd_probe with sharingModel private — capture the 4xx"',
        mentioned: false,
        canonical: false,
    },
    {
        label: 'prose about state machines that names no route at all',
        text: 'A `state_machine` rule declares the legal transitions out of each state of a picklist field.',
        mentioned: false,
        canonical: false,
    },
];

describe('meta state-introspection route — docs spell it the way the ledger does', () => {
    const rows = REST_ROUTE_LEDGER.filter((r) => r.client === 'meta.getLegalNextStates');

    it('the ledger names exactly one route for `meta.getLegalNextStates`', () => {
        // If this ever fails the derivation below has no single answer to give,
        // and the doc assertion would be judging against an arbitrary row.
        expect(rows.map((r) => r.route)).toHaveLength(1);
    });

    const canonicalPath = rows[0]!.route.replace(/^[A-Z]+\s+/, '');

    it('the derived path is the singular `/meta/object/…` spelling', () => {
        // Not a second statement of the canonical spelling — a sanity clamp on
        // the DERIVATION, so a ledger row that lost its method prefix or its
        // path shape cannot silently turn the assertion below into a tautology.
        expect(canonicalPath).toMatch(/^\/api\/v1\/meta\/object\/:name\/state\/:field$/);
    });

    // Both nets, one derivation. A literal segment of the ledger row is exact in
    // the canonical net and TOLERANT of a longer word in the discovery net —
    // which is what turns `object` into `objects` and `meta` into `metadata`
    // without either retired spelling being written down here. A placeholder
    // segment is a free value in both.
    const segments = canonicalPath.split('/').filter(Boolean);
    const canonicalSource = `/${segments
        .map((seg) => (seg.startsWith(':') ? SEGMENT_VALUE : escapeForRegExp(seg)))
        .join('/')}`;
    const mentionSource = `/${segments
        .map((seg) => (seg.startsWith(':') ? SEGMENT_VALUE : `${escapeForRegExp(seg)}[A-Za-z0-9_]*`))
        .join('/')}`;
    const MENTION = new RegExp(mentionSource, 'g');
    const CANONICAL = new RegExp(`^${canonicalSource}$`);

    it('the discovery net is derived from the ledger row and is wider than the canonical one', () => {
        // A net narrower than the thing it is meant to contain would drop the
        // canonical spelling itself out of the population, and every file would
        // then pass by never being looked at.
        expect(mentionsIn(canonicalPath, MENTION).map((m) => m.text)).toEqual([canonicalPath]);
        expect(CANONICAL.test(canonicalPath)).toBe(true);
        // One tolerance group per LITERAL segment: a derivation that stopped
        // deriving would show up here as a count that no longer tracks the row.
        const literals = segments.filter((seg) => !seg.startsWith(':'));
        expect(mentionSource.split('[A-Za-z0-9_]*').length - 1).toBe(literals.length);
    });

    for (const site of TEACHING_SITES) {
        it(`${site.label} teaches the canonical path`, () => {
            // readFileSync throws on a moved/renamed file rather than passing
            // quietly: a site that evaporated is a finding, not a green.
            const text = readFileSync(site.path, 'utf8');
            expect(
                text.includes(canonicalPath),
                `${site.label} does not teach \`${canonicalPath}\`, the path the REST ledger row for `
                + '`meta.getLegalNextStates` declares. Update the prose to the ledger spelling '
                + '(or, if the route itself moved, update the ledger first and let this follow). '
                + '⛔ Do not "fix" this by asserting the plural is dead everywhere — it is still '
                + 'answered on the dispatch path by deliberate decision.',
            ).toBe(true);
        });
    }

    it('the detector classifies each known spelling the way its construction says', () => {
        const verdicts = PREDICATE_CASES.map((c) => {
            const found = mentionsIn(c.text, MENTION);
            return {
                label: c.label,
                mentioned: found.length > 0,
                canonical: found.length > 0 && found.every((m) => CANONICAL.test(m.text)),
            };
        });
        expect(verdicts).toEqual(
            PREDICATE_CASES.map((c) => ({ label: c.label, mentioned: c.mentioned, canonical: c.canonical })),
        );
    });

    // The corpus, read once. git's answer rather than a crawl — see the header.
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: HERE,
        encoding: 'utf8',
    }).trim();
    const corpus = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...CORPUS_ROOTS],
        { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
        .split('\0')
        .filter(Boolean);
    const population = corpus
        .map((relPath) => ({ relPath, found: mentionsIn(readFileSync(join(repoRoot, relPath), 'utf8'), MENTION) }))
        .filter((entry) => entry.found.length > 0);

    it('the corpus and the population it yields are both real', () => {
        // Two ways this whole half can evaporate into a vacuous green: git
        // hands back nothing, or the net matches nothing. Neither is silent.
        expect(corpus.length, 'the authored-prose roots yielded no files at all').toBeGreaterThan(100);
        expect(
            population.map((p) => p.relPath),
            'the discovered population no longer contains the sites this guard has always known about, '
            + 'so the detector — not the corpus — is what changed',
        ).toEqual(expect.arrayContaining(TEACHING_SITES.map((s) => s.label)));
    });

    it('every authored page that mentions this route spells it the way the ledger row does', () => {
        const offenders = population.flatMap(({ relPath, found }) =>
            found.filter((m) => !CANONICAL.test(m.text)).map((m) => `${relPath}:${m.line}  ${m.text}`),
        );
        expect(
            offenders,
            `these pages mention the \`meta.getLegalNextStates\` route on the REST wire path and do not `
            + `spell it \`${canonicalPath}\`, the path this package's ledger row declares:\n`
            + `${offenders.join('\n')}\n`
            + 'Update the prose to the ledger spelling (or, if the route itself moved, update the ledger '
            + 'first and let this follow). ⛔ Do not "fix" this by narrowing the net: the plural is still '
            + 'answered wherever `dispatch()` is the front door, which is why only mentions carrying the '
            + 'versioned REST prefix are judged here at all.',
        ).toEqual([]);
    });
});
