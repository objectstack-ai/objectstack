// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cloud-connection route-ledger conformance (#11882) — the guard that keeps
 * this package's `getRawApp()`-mounted HTTP surface and its reviewed
 * dispositions from drifting apart, in the #3636 / #11863 pattern.
 *
 * WHY A SOURCE SCAN AND NOT A LIFECYCLE DRIVE. #11863's trigger-api guard
 * drives `ApiTriggerPlugin` through its real lifecycle, which works because
 * that plugin resolves three services and mounts one route. All four registrars
 * here mount from inside a `kernel:ready` hook behind resolutions of
 * `http.server`/`http-server`, `env-registry`, `kernel-manager`, `manifest`,
 * `metadata` and `objectql`, each guarded by a `try`/`catch` that RETURNS
 * QUIETLY when the service is absent. A lifecycle drive over that would fail
 * OPEN — it would observe zero mounts and every accounting assertion would pass
 * vacuously — precisely when one of those resolutions changed. That is the
 * "completed census" defect these ledgers exist to remove, so this guard reads
 * SOURCE TEXT instead, the shape `check-auth-mount-ledger.mjs` (#10534)
 * established for `rawApp` mounts. No import, no module resolution, no `dist/`
 * between the edit and the reading.
 *
 * FOUR LIMBS.
 *
 * LIMB 1 — THE CENSUS IS REAL. The scan must find mounts at all. Zero is a
 * broken recogniser, never a clean package.
 *
 * LIMB 2 — ACCOUNTING, EXACT. Every mount found in source has a ledger row and
 * every row is really mounted, matched by EXACT `METHOD /wire/path` equality so
 * a prefix route can never be credited to a longer sibling (#10534's own census
 * read 5 when the truth was 6 for exactly that reason).
 *
 * LIMB 3 — THE POPULATION. Limb 2 only reads the four files it is told to read.
 * A FIFTH registrar added to this package later would be invisible to it, and a
 * sixteen-row ledger that misses a seventeenth mount is worse than no ledger,
 * because it reads as a completed census. So the set of files reaching for the
 * host app is asserted as an IDENTITY, not a count.
 *
 * LIMB 4 — HYGIENE AND ANTI-VACUITY. Every `sdk` row names its client method
 * and every non-`sdk` row carries a substantive rationale. Because today's
 * ledger contains no `sdk` row at all, the client half is asserted as the
 * #11882 audit's actual FINDING (no row reaches a client method) rather than
 * left to hold vacuously — the `service-datasource` precedent's rule: a guard
 * that can only ever pass is the "declared but unverified" shape being removed.
 *
 * A PARTIAL READ MUST NOT REPORT AS A COMPLETE ONE (#10534 constraint 4). Every
 * mount spelling this scan cannot read per-route is a FINDING, never a silent
 * skip — except the one computed-member mount declared in
 * `DECLARED_COMPUTED_MOUNTS` below, which is reconciled in both directions so
 * the exemption cannot rot into a blind spot.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// The repo's ONE answer to "is this span a comment, or code?" — its header
// carries the two private-stripper families that drifted apart and the
// parser-differential sweep that measured which way each fails. This package
// already imports the module next door in `canonical-expression-envelopes.test.ts`.
// `stripComments` (not `maskComments`) is the projection this file wants: every
// finding here reports a `file:line` or a bare file name, never an offset.
import { stripComments } from '../../../scripts/js-comment-mask.mjs';
import { CLOUD_CONNECTION_ROUTE_LEDGER } from './cloud-connection-route-ledger.js';

/**
 * Seeded from `import.meta.url`, the spelling `check:cross-package-test-inputs`
 * resolves STATICALLY (this package is `"type": "module"`). The read does not
 * escape the package — it is this package's own `src/` — and the seed keeps
 * that fact checkable rather than merely true.
 */
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** The four registrars whose mount calls this census reads. */
const MOUNT_SOURCES = [
    'cloud-connection-plugin.ts',
    'marketplace-install-local-plugin.ts',
    'marketplace-proxy-plugin.ts',
    'runtime-config-plugin.ts',
] as const;

/**
 * The ledger module is excluded from the population scan for the obvious
 * reason: it is the DECLARATION, and its prose quotes `getRawApp` and
 * `http-server`. Scanning it would let the ledger satisfy itself.
 */
const SCAN_EXCLUDED = new Set(['cloud-connection-route-ledger.ts']);

/** Hono members that MOUNT a route, keyed by the verb the ledger spells. */
const ROUTING_MEMBERS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);

/**
 * Members that are lanes, not routes — recorded, then ignored. `use` is a
 * middleware lane (the same exclusion `check-auth-mount-ledger.mjs` makes);
 * `all` is NOT here, because an `.all()` that answers requests is a route
 * (#11863). The marketplace proxy's `.all()` answers; it is ledgered.
 */
const NON_ROUTE_MEMBERS = new Set(['use', 'notFound', 'onError', 'fire', 'fetch', 'request', 'route']);

/**
 * The ONE mount this scan cannot read per-route, declared rather than skipped.
 *
 * `marketplace-proxy-plugin.ts` mounts its handler through a computed member in
 * the `rawApp.all` fallback arm:
 *
 *     for (const m of ['get', 'head'] as const) {
 *         try { rawApp[m]?.(`${MARKETPLACE_PREFIX}/*`, handler); } catch {}
 *     }
 *
 * A textual scan cannot resolve `rawApp[m]`. It is exempt ONLY because the
 * pattern it mounts is the SAME wire path the `ALL` row already covers, so no
 * route escapes the ledger through it. Both halves of that claim are asserted
 * below — the source still contains the computed spelling (so a rewrite cannot
 * silently strip the declaration's subject) and the covering row still exists.
 */
const DECLARED_COMPUTED_MOUNTS = [
    {
        file: 'marketplace-proxy-plugin.ts',
        marker: 'rawApp[m]?.(`${MARKETPLACE_PREFIX}/*`, handler)',
        coveredBy: 'ALL /api/v1/marketplace/*',
        why:
            'the `rawApp.all` fallback arm mounts get/head on the SAME pattern the ALL row ledgers, '
            + 'so the computed spelling adds no unledgered wire path.',
    },
] as const;

// ---------------------------------------------------------------------------
// Scanning machinery
// ---------------------------------------------------------------------------

/**
 * WHY COMMENTS ARE REMOVED BEFORE ANY SCAN HERE. Prose cannot mount a route and
 * cannot reach for a host app, and this package's headers quote every wire path
 * they serve — a raw-text scan reports a documented path as an unledgered mount
 * and a documented `getRawApp()` as a second reacher: a false red on an
 * accurate package.
 *
 * This file used to answer that question with its own character scanner. It was
 * converted to `scripts/js-comment-mask.mjs` (#12398), the tree's one answer to
 * it, and the swap was MEASURED rather than assumed: over this package's 13
 * scanned source files the two differ on exactly one,
 * `marketplace-proxy-plugin.ts`, where the private scanner read the `//` inside
 * the regex literal `/\/packages\/[^/]+\/versions\//` as a line-comment opener
 * and deleted the 38 characters of REAL CODE that followed it to end of line —
 * inside a declared MOUNT SOURCE, which is source this census reads. That is
 * the naive-`//` family the shared module's header measures, live here.
 *
 * `stripComments` keeps line numbers (block-comment newlines survive — this
 * package's headers run to eighty lines and every finding quotes `file:line`)
 * and keeps string, template and regex literals INTACT, which is what lets the
 * census resolve wire paths out of them at all. `scan machinery` at the foot of
 * this file pins both directions.
 */

/** Module-scope `const NAME = '<literal>';` bindings, for resolving mount paths. */
export function constantBindings(code: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of code.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(['"])([^'"]*)\2\s*;/g)) {
        out.set(m[1], m[3]);
    }
    return out;
}

/**
 * Read the first argument of a mount call and resolve it to a wire path.
 * Returns `null` when the argument is not something this scan can resolve —
 * which is a FINDING at the call site, never a skip.
 */
export function resolveFirstArg(rest: string, constants: Map<string, string>): string | null {
    let i = 0;
    while (i < rest.length && /\s/.test(rest[i])) i++;
    const quote = rest[i];

    // A bare identifier: `rawApp.post(ROUTE_BASE, handler)`.
    if (quote !== '`' && quote !== '\'' && quote !== '"') {
        const ident = /^([A-Z][A-Z0-9_]*)\s*[,)]/.exec(rest.slice(i));
        if (ident && constants.has(ident[1])) return constants.get(ident[1])!;
        return null;
    }

    let raw = '';
    for (let j = i + 1; j < rest.length; j++) {
        const ch = rest[j];
        if (ch === '\\') { raw += ch + (rest[j + 1] ?? ''); j += 1; continue; }
        if (ch === quote) {
            // A plain string literal is already the wire path.
            if (quote !== '`') return raw.includes('${') ? null : raw;
            // A template: substitute `${CONST}` from module scope; anything
            // else left interpolated is unresolvable and must be reported.
            const resolved = raw.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (whole, name: string) =>
                constants.has(name) ? constants.get(name)! : whole,
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

/** Every `rawApp.<member>(…)` call across the declared mount sources, classified. */
export function censusOf(files: readonly string[], read: (f: string) => string): Census {
    const routes: Census['routes'] = [];
    const lanes: Census['lanes'] = [];
    const unreadable: string[] = [];

    for (const file of files) {
        const code = stripComments(read(file));
        const constants = constantBindings(code);
        const lineOf = (index: number) => code.slice(0, index).split('\n').length;

        // Computed-member access: `rawApp[m]?.(...)`. Reported unless declared.
        for (const m of code.matchAll(/\brawApp\s*\[/g)) {
            const declared = DECLARED_COMPUTED_MOUNTS.some((d) => d.file === file);
            if (declared) continue;
            unreadable.push(
                `${file}:${lineOf(m.index)} mounts through a COMPUTED member (\`rawApp[…]\`), whose verb this `
                + 'scan cannot resolve. Declare it in DECLARED_COMPUTED_MOUNTS with the row that covers it, or '
                + 'express it with a verb method.',
            );
        }

        for (const m of code.matchAll(/\brawApp\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
            const member = m[1];
            const line = lineOf(m.index);
            if (NON_ROUTE_MEMBERS.has(member)) { lanes.push({ member, file, line }); continue; }
            if (!ROUTING_MEMBERS.has(member)) {
                unreadable.push(
                    `${file}:${line} calls \`rawApp.${member}(…)\`, which is not a member this scan can read `
                    + 'per-route. An unrecognised mount spelling is a FINDING, never a silent skip — teach '
                    + 'ROUTING_MEMBERS about it and ledger what it mounts.',
                );
                continue;
            }
            const path = resolveFirstArg(code.slice(m.index + m[0].length), constants);
            if (path === null) {
                unreadable.push(
                    `${file}:${line} calls \`rawApp.${member}(…)\` with a first argument this scan cannot `
                    + 'resolve to a wire path, so the route it mounts cannot be enumerated.',
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

/** `.ts` files in this package's `src/`, minus tests and the ledger itself. */
function packageSourceFiles(): string[] {
    return readdirSync(SRC_DIR)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !SCAN_EXCLUDED.has(f))
        .sort();
}

/** The spellings by which a module in this package reaches the HOST app. */
const HOST_APP_REACH = /getRawApp|['"`]http-server['"`]|['"`]http\.server['"`]/;

/**
 * Does `source` reach for the host app IN CODE?
 *
 * COMMENTS ARE REMOVED FIRST, and that half is the whole of #12398. A docblock
 * explaining why a mount sits where it does — "the mount takes the
 * framework-native handle through `IHttpServer.getRawApp()`" — is prose, and
 * prose reaches for nothing. Scanned raw it scored as an extra reacher and
 * failed an IDENTITY assertion by naming a file that reaches for nothing, whose
 * own failure text then invites the wrong repair: widening the expected list,
 * which retires the only property the assertion has.
 *
 * STRING, TEMPLATE AND REGEX LITERALS ARE LEFT INTACT, and that half is what
 * keeps the fix from being a silent disarm. Two of the three spellings above
 * ARE string literals — `ctx.getService('http.server')` reaches for the host
 * app entirely inside quotes — so a probe that masked literals as well as
 * comments would detect nothing and this identity would pass vacuously. Both
 * directions are pinned in `scan machinery` at the foot of this file.
 */
const reachesHostApp = (source: string): boolean => HOST_APP_REACH.test(stripComments(source));

/** Which of `files` reach for the host app in code. Driveable for the pins. */
const filesReachingHostApp = (files: readonly string[], read: (f: string) => string): string[] =>
    files.filter((f) => reachesHostApp(read(f)));

const ledgerRoutes = (): Set<string> => new Set(CLOUD_CONNECTION_ROUTE_LEDGER.map((e) => e.route));
const liveCensus = (): Census => censusOf(MOUNT_SOURCES, readSource);

// ---------------------------------------------------------------------------

describe('cloud-connection route ledger ↔ source census', () => {
    it('the census is real — the scan observed mounts in this package', () => {
        // ZERO IS NOT A CLEAN PACKAGE, IT IS A BROKEN SCAN. Every assertion
        // below passes vacuously if the recogniser stops matching, and a ledger
        // backed by a guard that sees nothing is the completed-census defect.
        const { routes } = liveCensus();
        expect(
            routes.length,
            'the source scan observed NO mount at all — the scan is broken, not the package',
        ).toBeGreaterThan(0);
    });

    it('every mount lands through a member this scan can read', () => {
        const { unreadable } = liveCensus();
        expect(
            unreadable,
            `mounts this guard cannot account for per-route:\n${unreadable.join('\n')}`,
        ).toEqual([]);
    });

    it('every route mounted in source has a ledger entry', () => {
        const ledger = ledgerRoutes();
        const { routes } = liveCensus();
        // EXACT equality on `METHOD /wire/path`: a prefix is never credited to
        // a longer sibling (#10534).
        const missing = routes.filter((r) => !ledger.has(r.route));
        expect(
            missing.map((r) => `${r.route}  (${r.file}:${r.line})`),
            'routes with no CLOUD_CONNECTION_ROUTE_LEDGER row. A new route needs a reviewed '
                + 'disposition in cloud-connection-route-ledger.ts (#11882) — a row is not enough, it must '
                + 'carry the evidence its disposition claims.',
        ).toEqual([]);
    });

    it('every ledger entry is really mounted in source', () => {
        const live = new Set(liveCensus().routes.map((r) => r.route));
        const stale = [...ledgerRoutes()].filter((r) => !live.has(r));
        expect(
            stale,
            'CLOUD_CONNECTION_ROUTE_LEDGER rows this package no longer mounts. Remove or reclassify '
                + 'them so the ledger stays truthful.',
        ).toEqual([]);
    });

    it('every row names the file it is mounted in, and that file is a declared mount source', () => {
        const declared = new Set<string>(MOUNT_SOURCES);
        const census = liveCensus();
        const byRoute = new Map(census.routes.map((r) => [r.route, r.file]));
        const wrong: string[] = [];
        for (const e of CLOUD_CONNECTION_ROUTE_LEDGER) {
            if (!declared.has(e.mountedIn)) { wrong.push(`${e.route}: '${e.mountedIn}' is not a declared mount source`); continue; }
            const actual = byRoute.get(e.route);
            if (actual && actual !== e.mountedIn) {
                wrong.push(`${e.route}: ledgered as '${e.mountedIn}' but mounted in '${actual}'`);
            }
        }
        expect(wrong, 'mountedIn values that do not match the census').toEqual([]);
    });

    it('no route is ledgered twice', () => {
        const seen = new Set<string>();
        const dupes = CLOUD_CONNECTION_ROUTE_LEDGER.map((e) => e.route).filter((r) => !seen.add(r));
        expect(dupes, `duplicate CLOUD_CONNECTION_ROUTE_LEDGER rows: ${dupes.join(', ')}`).toEqual([]);
    });
});

describe('cloud-connection mount population', () => {
    it('the four declared mount sources are exactly the files that reach the host app', () => {
        // An IDENTITY, not a count: the day a FIFTH module in this package
        // resolves `http-server` or calls `getRawApp()`, this names it — and
        // the census above, which only reads MOUNT_SOURCES, would not have.
        const reaching = filesReachingHostApp(packageSourceFiles(), readSource);
        expect(
            reaching,
            'files reaching for the host HTTP app. A registrar not listed in MOUNT_SOURCES is invisible '
                + 'to the census above — add it there and ledger its routes before adding it here.',
        ).toEqual([...MOUNT_SOURCES].sort());
    });

    it('every declared computed mount is still present, and still covered by a ledger row', () => {
        // Reconciled in BOTH directions so the exemption cannot rot into a
        // blind spot: the spelling it excuses must still exist (otherwise the
        // declaration is stale and should be deleted), and the row it leans on
        // must still be in the ledger (otherwise the mount is unaccounted).
        const ledger = ledgerRoutes();
        const stale: string[] = [];
        const uncovered: string[] = [];
        for (const d of DECLARED_COMPUTED_MOUNTS) {
            if (!readSource(d.file).includes(d.marker)) {
                stale.push(`${d.file}: the declared computed mount \`${d.marker}\` is no longer in source — delete the declaration`);
            }
            if (!ledger.has(d.coveredBy)) {
                uncovered.push(`${d.file}: declared as covered by '${d.coveredBy}', which is not a ledger row`);
            }
        }
        expect(stale, 'stale DECLARED_COMPUTED_MOUNTS entries').toEqual([]);
        expect(uncovered, 'DECLARED_COMPUTED_MOUNTS entries whose covering row is gone').toEqual([]);
    });
});

describe('cloud-connection route ledger hygiene', () => {
    it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
        const sdkWithout = CLOUD_CONNECTION_ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
        expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

        // A FLOOR, not a proof — it exists so that pasting three words is not
        // the cheapest path (`check-auth-mount-ledger.mjs`'s rationale half).
        const thin = CLOUD_CONNECTION_ROUTE_LEDGER
            .filter((e) => e.disposition !== 'sdk' && (e.note ?? '').length < 60)
            .map((e) => e.route);
        expect(
            thin,
            'non-sdk entries must say WHY they are not SDK surface: who builds this URL instead, and why '
                + 'the SDK deliberately does not.',
        ).toEqual([]);
    });

    it('the whole surface is audited as reaching NO client method', () => {
        // Said as a MEASUREMENT rather than left implicit, because the
        // assertion above holds vacuously while no row is `sdk` (the
        // `service-datasource` rule). What is measured is the #11882 audit's
        // finding: `@objectstack/client` was grepped for `cloud-connection`,
        // `marketplace`, `runtime/config` and `install-local`, and the only hit
        // in the package is a doc comment (`index.ts:1526`). No client method
        // builds any of these URLs.
        const claimed = CLOUD_CONNECTION_ROUTE_LEDGER.filter((e) => e.client != null).map((e) => e.route);
        expect(
            claimed,
            `rows claiming a client method: ${claimed.join(', ')}. Promoting a row to SDK surface is a `
                + 'public-surface widening and belongs in the PR that adds the method, with the disposition '
                + 're-reviewed there.',
        ).toEqual([]);
    });

    it('gap and mismatch counts only shrink', () => {
        // Ratchet, not aspiration. This surface audited at ZERO of each
        // (#11882): every route is either a same-origin console/CLI door or an
        // anonymous boot/browse surface, so there is nothing the SDK is
        // silently missing.
        expect(CLOUD_CONNECTION_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length).toBeLessThanOrEqual(0);
        expect(CLOUD_CONNECTION_ROUTE_LEDGER.filter((e) => e.disposition === 'mismatch').length).toBeLessThanOrEqual(0);
    });
});

describe('scan machinery, pinned in both directions', () => {
    it('the comment stripper drops prose paths and keeps every path in code', () => {
        const fixture = [
            "// mounts '/api/v1/commented-out'",
            "/* block quoting '/api/v1/in-block' */",
            'rawApp.post(\'/api/v1/real/:id\', h);',
            'const glob = \'/api/v1/wild/*\';',
            'const url = "https://host/api/v1/double";',
            'rawApp.get(`/api/v1/tpl`, h);',
        ].join('\n');
        const stripped = stripComments(fixture);
        expect(stripped).not.toContain('commented-out');
        expect(stripped).not.toContain('in-block');
        // The ORDER is the second half of the pin: the wildcard and the URL sit
        // BEFORE the last code path, so a stripper that read either string's
        // punctuation as a comment opener would eat everything after it and
        // `/api/v1/tpl` would be missing. That is the direction that matters —
        // a stripper which swallows live code makes the census read clean while
        // measuring nothing.
        expect(stripped).toContain('/api/v1/tpl');
        expect(stripped).toContain('/api/v1/wild/*');
    });

    it('the stripper preserves line numbers, so a finding points at the real line', () => {
        // Every finding above quotes `file:line`. This package's headers run to
        // eighty lines, so a stripper that swallowed block-comment newlines
        // would report a mount eighty lines short of where it is — an accurate
        // finding that reads as a wrong one.
        const src = '/* a\nb\nc */\nrawApp.get(`/api/v1/x`, h);\n';
        const census = censusOf(['fake.ts'], () => src);
        expect(census.routes[0].line).toBe(4);
    });

    it('the host-app reach probe does not count PROSE — the #12398 false positive', () => {
        // The exact docblock shape that fired it: a module explaining that the
        // mount takes the framework-native handle, in a comment.
        expect(reachesHostApp('// the mount takes the handle through `IHttpServer.getRawApp()`\n')).toBe(false);
        expect(reachesHostApp("/*\n * resolves 'http-server' before mounting\n */\n")).toBe(false);
        expect(reachesHostApp("/* the ctx.getService('http.server') seam, explained */\n")).toBe(false);
    });

    it('the host-app reach probe still counts a REACH THAT LIVES IN A STRING', () => {
        // The direction that makes the fix a fix rather than a disarm: two of
        // the three spellings are service keys, which are string literals.
        expect(reachesHostApp("const s = ctx.getService('http.server');\n")).toBe(true);
        expect(reachesHostApp('const s = ctx.getService("http-server");\n')).toBe(true);
        expect(reachesHostApp('const s = ctx.getService(`http-server`);\n')).toBe(true);
        expect(reachesHostApp('const app = server.getRawApp();\n')).toBe(true);
    });

    it('a genuine FIFTH reacher is still named — anti-vacuity on the identity limb', () => {
        // LOAD-BEARING POSITIVE for #12398's fix, driven through the same
        // function the live limb calls with source injected. Without it, a
        // strip that quietly stopped matching anything would leave the identity
        // green forever — the failure direction the whole family distrusts.
        const fake: Record<string, string> = {
            'cloud-connection-plugin.ts': 'const app = http.getRawApp();\n',
            'prose-only.ts': '// getRawApp() is reached in the four mount sources, never here\n',
            'zzz-fifth-reacher.ts': "const s = ctx.getService('http.server');\n",
        };
        expect(
            filesReachingHostApp(Object.keys(fake).sort(), (f) => fake[f]),
        ).toEqual(['cloud-connection-plugin.ts', 'zzz-fifth-reacher.ts']);
    });

    it('resolves the three argument spellings this package actually uses', () => {
        const constants = new Map([['ROUTE_BASE', '/api/v1/marketplace/install-local'], ['P', '/api/v1/cloud-connection']]);
        // bare identifier   — marketplace-install-local-plugin.ts
        expect(resolveFirstArg('ROUTE_BASE, handler)', constants)).toBe('/api/v1/marketplace/install-local');
        // template + const  — cloud-connection-plugin.ts
        expect(resolveFirstArg('`${P}/status`, handler)', constants)).toBe('/api/v1/cloud-connection/status');
        // plain literal     — runtime-config-plugin.ts
        expect(resolveFirstArg("'/api/v1/runtime/config', handler)", constants)).toBe('/api/v1/runtime/config');
    });

    it('refuses what it cannot resolve instead of inventing a path', () => {
        const constants = new Map([['P', '/api/v1/x']]);
        // An unresolved interpolation must REFUSE, not emit a path containing `${…}`.
        expect(resolveFirstArg('`${P}/${dynamic}`, h)', constants)).toBeNull();
        expect(resolveFirstArg('`${UNKNOWN}/x`, h)', constants)).toBeNull();
        expect(resolveFirstArg('someLowerCaseVar, h)', constants)).toBeNull();
    });

    it('an unledgered mount added to a mount source is REDDENED, naming the route', () => {
        // LOAD-BEARING POSITIVE. Without this the accounting assertions could
        // pass because the recogniser matches nothing at all. Driven through
        // the same `censusOf` the live limbs use, with source injected.
        const fake = "const P = '/api/v1/cloud-connection';\nrawApp.get(`${P}/zzz-new`, h);\n";
        const census = censusOf(['fake.ts'], () => fake);
        expect(census.routes.map((r) => r.route)).toEqual(['GET /api/v1/cloud-connection/zzz-new']);
        expect(new Set(CLOUD_CONNECTION_ROUTE_LEDGER.map((e) => e.route)).has('GET /api/v1/cloud-connection/zzz-new')).toBe(false);
    });

    it('a lane is not a route, and an unreadable member is a finding', () => {
        const laneOnly = censusOf(['fake.ts'], () => "rawApp.use('*', mw);\n");
        expect(laneOnly.routes).toEqual([]);
        expect(laneOnly.lanes.map((l) => l.member)).toEqual(['use']);
        expect(laneOnly.unreadable).toEqual([]);

        const odd = censusOf(['fake.ts'], () => "rawApp.on('POST', '/api/v1/x', h);\n");
        expect(odd.unreadable.length).toBe(1);
        expect(odd.unreadable[0]).toContain('rawApp.on');
    });

    it('a commented-out mount is not a mount', () => {
        const census = censusOf(['fake.ts'], () => "// rawApp.get('/api/v1/ghost', h);\n/* rawApp.post('/api/v1/ghost2', h); */\n");
        expect(census.routes).toEqual([]);
        expect(census.unreadable).toEqual([]);
    });
});
