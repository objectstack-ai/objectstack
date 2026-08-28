// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cli console route-ledger conformance (#11882) — the guard that keeps this
 * package's `getRawApp()`-mounted HTTP surface and its reviewed dispositions
 * from drifting apart, in the #3636 / #11863 pattern.
 *
 * WHY A SOURCE SCAN AND NOT A LIFECYCLE DRIVE. Both factories in
 * `utils/console.ts` return early — before mounting anything — unless a
 * resolvable HTTP server AND a built `dist/` exist on disk. A lifecycle drive
 * would therefore fail OPEN in CI, observing zero mounts while every accounting
 * assertion passed vacuously. That is the "completed census" defect these
 * ledgers exist to remove, so this guard reads SOURCE TEXT, the shape
 * `check-auth-mount-ledger.mjs` (#10534) established for `rawApp` mounts.
 *
 * FIVE LIMBS: the census is real; accounting is exact in both directions; the
 * POPULATION is an identity across all 109 of this package's sources; hygiene is
 * backed by the anti-vacuity measurement; and — specific to this package — the
 * `static-asset` extension is CONTAINED, so the sixth word cannot become a
 * parking space for a route somebody did not want to think about.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// The repo's ONE answer to "is this span a comment, or code?" — its header
// carries the two private-stripper families that drifted apart and the
// parser-differential sweep that measured which way each fails. The private
// scanner this replaces was string-aware but REGEX-BLIND: the doubled slash
// closing `/^https?:\/\//i` read as a line-comment opener and took the rest of
// the line with it, which is the same defect #12398 found live in two sibling
// guards. `stripComments` (not `maskComments`) is the projection this file
// wants: it deletes comment characters but keeps every newline, so the
// `file:line` every finding here reports still points at the real line, and
// nothing in this file reports an offset. The `.mjs` specifier is deliberate;
// `scripts/js-comment-mask.d.mts` beside it is a hand-written declaration, so
// this import needs no `allowJs`.
import { stripComments } from '../../../../scripts/js-comment-mask.mjs';
import { CONSOLE_ROUTE_LEDGER } from './console-route-ledger.js';

/**
 * Seeded from `import.meta.url`, the spelling `check:cross-package-test-inputs`
 * resolves STATICALLY (this package is `"type": "module"`). `SRC_DIR` is this
 * package's own `src/`, one level up from `src/utils/` — the read does not
 * escape the package.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..');

/** The registrar module whose mount calls this census reads. */
const MOUNT_SOURCES = ['utils/console.ts'] as const;

/**
 * The other file in this package that reaches for the host app. It installs a
 * middleware LANE (`rawApp.use('*', …)`, the unknown-hostname guard) and mounts
 * no route. Declared rather than ignored, and asserted below to still mount
 * nothing — so the day it grows a route, this guard says so.
 */
const LANE_ONLY_REACH = 'commands/serve.ts';

/** The ledger module is excluded from the scan: it is the DECLARATION. */
const SCAN_EXCLUDED = new Set(['console-route-ledger.ts']);

/** Members that MOUNT a route. */
const ROUTING_MEMBERS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);

/** Members that are lanes, not routes — recorded, then ignored. */
const NON_ROUTE_MEMBERS = new Set(['use', 'notFound', 'onError', 'fire', 'fetch', 'request', 'route']);

// ---------------------------------------------------------------------------
// Scanning machinery
// ---------------------------------------------------------------------------

/** Module-scope `const NAME = '<literal>';` bindings, exported or not. */
export function constantBindings(code: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of code.matchAll(/\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]*)\2\s*;/g)) {
        out.set(m[1], m[3]);
    }
    return out;
}

/** Resolve a mount call's first argument to a wire path, or null (a FINDING). */
export function resolveFirstArg(rest: string, bindings: Map<string, string>): string | null {
    let i = 0;
    while (i < rest.length && /\s/.test(rest[i])) i++;
    const quote = rest[i];
    if (quote !== '`' && quote !== '\'' && quote !== '"') {
        const ident = /^([A-Za-z_$][\w$]*)\s*[,)]/.exec(rest.slice(i));
        if (ident && bindings.has(ident[1])) return bindings.get(ident[1])!;
        return null;
    }
    let raw = '';
    for (let j = i + 1; j < rest.length; j++) {
        const ch = rest[j];
        if (ch === '\\') { raw += ch + (rest[j + 1] ?? ''); j += 1; continue; }
        if (ch === quote) {
            if (quote !== '`') return raw.includes('${') ? null : raw;
            const resolved = raw.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (whole, name: string) =>
                bindings.has(name) ? bindings.get(name)! : whole,
            );
            return resolved.includes('${') ? null : resolved;
        }
        if (ch === '\n' && quote !== '`') return null;
        raw += ch;
    }
    return null;
}

interface Census {
    routes: { route: string; file: string; line: number }[];
    lanes: { member: string; file: string; line: number }[];
    unreadable: string[];
}

/** Every mount call on a host-app handle named `app` or `rawApp`, classified. */
export function censusOf(files: readonly string[], read: (f: string) => string): Census {
    const routes: Census['routes'] = [];
    const lanes: Census['lanes'] = [];
    const unreadable: string[] = [];

    for (const file of files) {
        const code = stripComments(read(file));
        const bindings = constantBindings(code);
        const lineOf = (index: number) => code.slice(0, index).split('\n').length;

        for (const m of code.matchAll(/\b(?:raw)?[Aa]pp\s*\[/g)) {
            unreadable.push(
                `${file}:${lineOf(m.index)} mounts through a COMPUTED member, whose verb this scan cannot `
                + 'resolve. Express it with a verb method, or teach this scan to read it.',
            );
        }

        for (const m of code.matchAll(/\b(?:raw)?[Aa]pp\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
            const member = m[1];
            const line = lineOf(m.index);
            if (NON_ROUTE_MEMBERS.has(member)) { lanes.push({ member, file, line }); continue; }
            if (!ROUTING_MEMBERS.has(member)) {
                unreadable.push(
                    `${file}:${line} calls \`app.${member}(…)\`, which is not a member this scan can read `
                    + 'per-route. An unrecognised mount spelling is a FINDING, never a silent skip.',
                );
                continue;
            }
            const path = resolveFirstArg(code.slice(m.index + m[0].length), bindings);
            if (path === null) {
                unreadable.push(
                    `${file}:${line} calls \`app.${member}(…)\` with a first argument this scan cannot resolve `
                    + 'to a wire path, so the route it mounts cannot be enumerated.',
                );
                continue;
            }
            routes.push({ route: `${member.toUpperCase()} ${path}`, file, line });
        }
    }

    routes.sort((a, b) => a.route.localeCompare(b.route));
    return { routes, lanes, unreadable };
}

const readSource = (file: string): string => readFileSync(join(SRC_DIR, file), 'utf8');

/** Every non-test `.ts` under this package's `src/`, POSIX-spelled, recursively. */
function packageSourceFiles(dir = SRC_DIR): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        if (statSync(abs).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            out.push(...packageSourceFiles(abs));
            continue;
        }
        if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
        if (SCAN_EXCLUDED.has(entry)) continue;
        out.push(relative(SRC_DIR, abs).split(sep).join('/'));
    }
    return out.sort();
}

/** A mount-shaped call on a handle named `app` or `rawApp`. */
const MOUNT_SHAPED = /\b(?:raw)?[Aa]pp\s*\.\s*(?:get|post|put|patch|delete|options|head|all)\s*\(/;

const ledgerRoutes = (): Set<string> => new Set(CONSOLE_ROUTE_LEDGER.map((e) => e.route));
const liveCensus = (): Census => censusOf(MOUNT_SOURCES, readSource);

// ---------------------------------------------------------------------------

describe('cli console route ledger ↔ source census', () => {
    it('the census is real — the scan observed mounts in this package', () => {
        // ZERO IS NOT A CLEAN PACKAGE, IT IS A BROKEN SCAN.
        const { routes } = liveCensus();
        expect(routes.length, 'the source scan observed NO mount at all — the scan is broken').toBeGreaterThan(0);
    });

    it('every mount lands through a member this scan can read', () => {
        const { unreadable } = liveCensus();
        expect(unreadable, `mounts this guard cannot account for:\n${unreadable.join('\n')}`).toEqual([]);
    });

    it('every route mounted in source has a ledger entry', () => {
        const ledger = ledgerRoutes();
        // EXACT equality on `METHOD /wire/path`: `GET /_console` is a strict
        // PREFIX of `GET /_console/*`, so this package contains the very
        // relation #10534's census got wrong. Matching without a right boundary
        // would score the bare path accounted-for on the strength of its
        // wildcard sibling's row.
        const missing = liveCensus().routes.filter((r) => !ledger.has(r.route));
        expect(
            missing.map((r) => `${r.route}  (${r.file}:${r.line})`),
            'routes with no CONSOLE_ROUTE_LEDGER row. A new route needs a reviewed disposition in '
                + 'console-route-ledger.ts (#11882).',
        ).toEqual([]);
    });

    it('every ledger entry is really mounted in source', () => {
        const live = new Set(liveCensus().routes.map((r) => r.route));
        const stale = [...ledgerRoutes()].filter((r) => !live.has(r));
        expect(stale, 'CONSOLE_ROUTE_LEDGER rows this package no longer mounts').toEqual([]);
    });

    it('the prefix pair is ledgered as two distinct rows', () => {
        // Said out loud rather than left implicit in the comparison operator:
        // the bare path and the wildcard are DIFFERENT routes with different
        // handlers, and a census that folded one into the other would report a
        // complete surface while missing a real mount (#10534).
        const routes = ledgerRoutes();
        expect(routes.has('GET /_console')).toBe(true);
        expect(routes.has('GET /_console/*')).toBe(true);
    });

    it('no route is ledgered twice', () => {
        const seen = new Set<string>();
        const dupes = CONSOLE_ROUTE_LEDGER.map((e) => e.route).filter((r) => !seen.add(r));
        expect(dupes, `duplicate CONSOLE_ROUTE_LEDGER rows: ${dupes.join(', ')}`).toEqual([]);
    });

    it('every row names the file it is mounted in', () => {
        const byRoute = new Map(liveCensus().routes.map((r) => [r.route, r.file]));
        const wrong = CONSOLE_ROUTE_LEDGER
            .filter((e) => byRoute.has(e.route) && byRoute.get(e.route) !== e.mountedIn)
            .map((e) => `${e.route}: ledgered as '${e.mountedIn}' but mounted in '${byRoute.get(e.route)}'`);
        expect(wrong, 'mountedIn values that do not match the census').toEqual([]);
    });
});

describe('cli mount population', () => {
    it('utils/console.ts is the only file in this package that mounts a route', () => {
        // An IDENTITY across all of this package's sources, not a count. The
        // census above reads ONE file; without this sweep a route mounted from
        // any of the other hundred-odd modules would be invisible to it, and a
        // four-row ledger that misses a fifth mount is worse than no ledger,
        // because it reads as a completed census.
        const mounting = packageSourceFiles().filter((f) => MOUNT_SHAPED.test(stripComments(readSource(f))));
        expect(
            mounting,
            'files mounting a route on a host app handle. A new one must be added to MOUNT_SOURCES and its '
                + 'routes ledgered before it lands.',
        ).toEqual([...MOUNT_SOURCES]);
    });

    it('the declared lane-only reach still mounts no route', () => {
        // `commands/serve.ts` takes the raw app to install the unknown-hostname
        // guard as `rawApp.use('*', …)`. A middleware lane is not a route (the
        // exclusion `check-auth-mount-ledger.mjs` makes), but the file is
        // pinned here so that the day it mounts one, this fails rather than the
        // route going unledgered.
        const census = censusOf([LANE_ONLY_REACH], readSource);
        expect(
            census.routes,
            `${LANE_ONLY_REACH} now mounts a route. Add it to MOUNT_SOURCES and ledger what it mounts.`,
        ).toEqual([]);
        expect(census.lanes.length, `${LANE_ONLY_REACH} no longer installs its middleware lane`).toBeGreaterThan(0);
    });
});

describe('cli console route ledger hygiene', () => {
    it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
        const sdkWithout = CONSOLE_ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
        expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

        // A FLOOR, not a proof — so that pasting three words is not the
        // cheapest path (`check-auth-mount-ledger.mjs`'s rationale half).
        const thin = CONSOLE_ROUTE_LEDGER
            .filter((e) => e.disposition !== 'sdk' && (e.note ?? '').length < 60)
            .map((e) => e.route);
        expect(thin, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
    });

    it('the whole surface is audited as reaching NO client method', () => {
        // Said as a MEASUREMENT rather than left implicit, because the
        // assertion above holds vacuously while no row is `sdk` (the
        // `service-datasource` rule). For this family the measurement is also
        // the point of the disposition: static assets are not SDK surface by
        // category, not by omission.
        const claimed = CONSOLE_ROUTE_LEDGER.filter((e) => e.client != null).map((e) => e.route);
        expect(claimed, `rows claiming a client method: ${claimed.join(', ')}`).toEqual([]);
    });

    it('`static-asset` is CONTAINED — it cannot become a parking space', () => {
        // The sixth word earns its place only while it means what the header
        // says. Two directions:
        //
        //  (a) every `static-asset` row must actually serve bytes off disk or
        //      redirect to something that does — asserted through the note,
        //      which must name the mechanism rather than merely claim the word;
        //  (b) the whole ledger must still be static-asset-only, so the day an
        //      API route lands in this package it CANNOT inherit the word by
        //      sitting in the same file. It will fail here and force a real
        //      disposition.
        const staticRows = CONSOLE_ROUTE_LEDGER.filter((e) => e.disposition === 'static-asset');
        const unjustified = staticRows
            .filter((e) => !/redirect|serves|file|asset|dist|disk|bundle/i.test(e.note ?? ''))
            .map((e) => e.route);
        expect(
            unjustified,
            'static-asset rows whose note does not name the byte-serving or redirect mechanism. The word is '
                + 'a reviewed NON-question, and the note is where that review lives.',
        ).toEqual([]);

        const nonStatic = CONSOLE_ROUTE_LEDGER.filter((e) => e.disposition !== 'static-asset').map((e) => e.route);
        expect(
            nonStatic,
            'this package mounted a route that is NOT static-asset serving. That is a real disposition '
                + 'question (#11882 deliberately left the vocabulary extension contained to this family) — give '
                + 'it one of the five standard words with its evidence, and re-review this assertion.',
        ).toEqual([]);
    });

    it('gap and mismatch counts only shrink', () => {
        // Ratchet, not aspiration. This surface audited at ZERO of each
        // (#11882) — and `gap` in particular is structurally unreachable here:
        // it would assert the SDK ought to grow a method for fetching
        // `index.html`.
        expect(CONSOLE_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length).toBeLessThanOrEqual(0);
        expect(CONSOLE_ROUTE_LEDGER.filter((e) => e.disposition === 'mismatch').length).toBeLessThanOrEqual(0);
    });

    it('the conditional mount is recorded as conditional', () => {
        // The census reads the mount CALL and cannot see the branch around it.
        // `GET /` is mounted only when `options.rootRedirect !== false`, so a
        // row that implied "always mounted" would overstate the surface.
        const root = CONSOLE_ROUTE_LEDGER.find((e) => e.route === 'GET /');
        expect(root?.conditional, '`GET /` is a guarded mount and the row must say so').toBeTruthy();
        expect(
            stripComments(readSource('utils/console.ts')).includes('options?.rootRedirect !== false'),
            'the `GET /` mount guard changed shape — re-read it and update the row\'s `conditional`.',
        ).toBe(true);
    });
});

describe('scan machinery, pinned in both directions', () => {
    it('the shared stripper drops prose paths, keeps code paths, and preserves line numbers', () => {
        // Not a re-pin of `js-comment-mask.mjs` -- that module pins its own
        // behaviour. This pins the PROPERTY this census rests on: comment
        // characters go, every newline stays, so `lineOf()` below still counts
        // the real line.
        const stripped = stripComments("// app.get('/ghost', h)\n/* a\nb */\napp.get(`/real`, h);\n");
        expect(stripped).not.toContain('ghost');
        expect(stripped).toContain('/real');
        expect(censusOf(['f.ts'], () => "/* a\nb\nc */\napp.get('/x', h);\n").routes[0].line).toBe(4);
    });

    it('a doubled slash inside a REGEX LITERAL does not swallow the rest of its line', () => {
        // The defect the private scanner this file used to carry was measured
        // committing on 7 of this package's 110 sources: string-aware but
        // regex-blind, it read the `//` that CLOSES `/^https?:\/\//i` as a
        // line-comment opener and deleted to end of line. A mount sharing that
        // line went with it, and the census reported clean over text it never
        // read. Live in `commands/dev.ts`, `commands/serve.ts` and
        // `commands/start.ts` at conversion time.
        const stripped = stripComments("const ok = /^https?:\\/\\//i.test(u); app.get('/real', h);\n");
        expect(stripped).toContain('/real');
    });

    it('resolves the spellings this package uses, and refuses the rest', () => {
        const b = constantBindings("export const CONSOLE_PATH = '/_console';\n");
        expect(b.get('CONSOLE_PATH')).toBe('/_console');
        expect(resolveFirstArg('CONSOLE_PATH, h)', b)).toBe('/_console');
        expect(resolveFirstArg('`${CONSOLE_PATH}/*`, h)', b)).toBe('/_console/*');
        expect(resolveFirstArg("'/', h)", b)).toBe('/');
        expect(resolveFirstArg('`${unknown}/x`, h)', b)).toBeNull();
    });

    it('an unledgered mount is REDDENED, and a lane is not a route', () => {
        // LOAD-BEARING POSITIVE: without it the accounting assertions could
        // pass because the recogniser matches nothing at all.
        const added = censusOf(['f.ts'], () => "app.get('/_console/zzz-new', h);\n");
        expect(added.routes.map((r) => r.route)).toEqual(['GET /_console/zzz-new']);
        expect(ledgerRoutes().has('GET /_console/zzz-new')).toBe(false);

        const lane = censusOf(['f.ts'], () => "rawApp.use('*', mw);\n");
        expect(lane.routes).toEqual([]);
        expect(lane.lanes.map((l) => l.member)).toEqual(['use']);

        const odd = censusOf(['f.ts'], () => "app.on('GET', '/x', h);\n");
        expect(odd.unreadable.length).toBe(1);
    });
});
