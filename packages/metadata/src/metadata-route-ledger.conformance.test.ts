// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * metadata route-ledger conformance (#11882) — the guard that keeps this
 * package's `getRawApp()`-mounted HTTP surface and its reviewed dispositions
 * from drifting apart, in the #3636 / #11863 pattern.
 *
 * WHY A SOURCE SCAN AND NOT A LIFECYCLE DRIVE. `MetadataPlugin.start()` reaches
 * this mount only after resolving a metadata artifact, a loader and an HTTP
 * server, each behind a `try`/`catch` that continues quietly when the service
 * is absent. A lifecycle drive over that fails OPEN — it observes no mount and
 * every accounting assertion passes vacuously — precisely when one of those
 * resolutions changes. That is the "completed census" defect these ledgers
 * exist to remove, so this guard reads SOURCE TEXT, the shape
 * `check-auth-mount-ledger.mjs` (#10534) established for `rawApp` mounts.
 *
 * FOUR LIMBS: the census is real; accounting is exact in both directions; the
 * POPULATION is an identity (a second registrar cannot hide behind a two-row
 * ledger that reads as a completed census); and hygiene is backed by the
 * anti-vacuity measurement.
 *
 * THE SEAM LIMB, which is specific to this package. `registerMetadataHmrRoutes`
 * takes an `options.path` that would move both wire paths. The ledger's rows are
 * only exact because that seam is unreachable: the function is not re-exported
 * from `index.ts` / `node.ts`, and its sole in-repo caller passes no options.
 * Both halves are asserted, so the rows stop being the whole truth LOUDLY the
 * day either changes.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// The repo's ONE answer to "is this span a comment, or code?" — see its header
// for the two private-stripper families that drifted apart and why neither was
// safe. `stripComments` (not `maskComments`) is the projection this file wants:
// every finding here reports a `file:line` or a bare file name, never an
// offset, and the module's own guidance is to pick by what the caller reports.
// The `.mjs` specifier is deliberate; `scripts/js-comment-mask.d.mts` beside it
// is a hand-written declaration, so this import needs no `allowJs`.
import { stripComments } from '../../../scripts/js-comment-mask.mjs';
import { METADATA_ROUTE_LEDGER } from './metadata-route-ledger.js';

/**
 * Seeded from `import.meta.url`, the spelling `check:cross-package-test-inputs`
 * resolves STATICALLY (this package is `"type": "module"`). The read does not
 * escape the package — it is this package's own `src/`.
 */
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** The registrar module whose mount calls this census reads. */
const MOUNT_SOURCES = ['routes/hmr-routes.ts'] as const;

/** The one module that takes the host app handle and hands it on. */
const HOST_APP_REACH_FILE = 'plugin.ts';

/** The ledger module is excluded from the scan: it is the DECLARATION. */
const SCAN_EXCLUDED = new Set(['metadata-route-ledger.ts']);

/** Members that MOUNT a route. */
const ROUTING_MEMBERS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);

/** Members that are lanes, not routes — recorded, then ignored. */
const NON_ROUTE_MEMBERS = new Set(['use', 'notFound', 'onError', 'fire', 'fetch', 'request', 'route']);

// ---------------------------------------------------------------------------
// Scanning machinery
// ---------------------------------------------------------------------------

/**
 * WHY COMMENTS ARE REMOVED BEFORE ANY SCAN HERE. Prose cannot mount a route and
 * cannot reach for a host app, and this package's headers quote the wire paths
 * and the handles they serve — a raw-text scan reports a documented path as an
 * unledgered mount, and a documented `getRawApp()` as a second reacher.
 *
 * This file used to answer that question with its own character scanner. It was
 * converted to `scripts/js-comment-mask.mjs` (#12398), which is the tree's one
 * answer to it, and the swap was MEASURED rather than assumed: over this
 * package's 29 scanned source files the two differ on exactly one, `plugin.ts`,
 * where the private scanner read the `//` inside the regex literal
 * `/^https?:\/\//i` as a line-comment opener and deleted the 40 characters of
 * REAL CODE that followed it to end of line. That is the naive-`//` family the
 * shared module's header measures, live in the very file this guard's identity
 * limb pins.
 *
 * `stripComments` keeps line numbers (block-comment newlines survive) and keeps
 * string, template and regex literals INTACT — both properties are load-bearing
 * below: `hmr-routes.ts` opens with a 27-line header, and the host-app reach
 * this file detects is partly a SERVICE KEY, which is a string literal.
 */

/**
 * Blank out string CONTENTS, preserving quotes, length and newlines.
 *
 * Needed because `stripComments` deliberately keeps string contents — the
 * census resolves wire paths out of them. But a STRUCTURAL question ("how many
 * times is `getRawApp()` actually called?") must not count an occurrence inside
 * a log message, and `plugin.ts` carries exactly that: a warning that reads
 * `'HTTP server with getRawApp() not available — skipping HMR endpoint'`.
 * Measured, not hypothetical — this masking step exists because the assertion
 * below read 2 call sites when the truth is 1.
 */
export function maskStrings(code: string): string {
    let out = '';
    let i = 0;
    while (i < code.length) {
        const c = code[i];
        if (c === '\'' || c === '"' || c === '`') {
            const quote = c;
            out += c;
            i++;
            while (i < code.length) {
                if (code[i] === '\\') { out += '  '; i += 2; continue; }
                if (code[i] === quote) { out += quote; i++; break; }
                out += code[i] === '\n' ? '\n' : ' ';
                i++;
            }
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/**
 * Path bindings this module's mounts use. Two spellings are resolved:
 *
 *   const ROUTE = '/literal';                     // module-scope constant
 *   const routePath = options.path ?? '/default'; // the configurable seam
 *
 * The second is resolved to its DEFAULT, which is what the ledger rows carry —
 * and the seam limb below is what makes that exact rather than a guess.
 */
export function pathBindings(code: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]*)\2\s*;/g)) {
        out.set(m[1], m[3]);
    }
    for (const m of code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*[\w.?]+\s*\?\?\s*(['"])([^'"]*)\2\s*;/g)) {
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

/**
 * Every mount call on a host-app handle, classified. The handle here is the
 * `app` PARAMETER of `registerMetadataHmrRoutes`, not a `rawApp` local — this
 * package receives the handle rather than resolving it at the mount site.
 */
export function censusOf(files: readonly string[], read: (f: string) => string): Census {
    const routes: Census['routes'] = [];
    const lanes: Census['lanes'] = [];
    const unreadable: string[] = [];

    for (const file of files) {
        const code = stripComments(read(file));
        const bindings = pathBindings(code);
        const lineOf = (index: number) => code.slice(0, index).split('\n').length;

        for (const m of code.matchAll(/\bapp\s*\[/g)) {
            unreadable.push(
                `${file}:${lineOf(m.index)} mounts through a COMPUTED member (\`app[…]\`), whose verb this scan `
                + 'cannot resolve. Express it with a verb method, or teach this scan to read it.',
            );
        }

        for (const m of code.matchAll(/\bapp\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
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
        if (statSync(abs).isDirectory()) { out.push(...packageSourceFiles(abs)); continue; }
        if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
        if (SCAN_EXCLUDED.has(entry)) continue;
        out.push(relative(SRC_DIR, abs).split(sep).join('/'));
    }
    return out.sort();
}

/** The spellings by which a module reaches the HOST app. */
const HOST_APP_REACH = /getRawApp|['"`]http-server['"`]|['"`]http\.server['"`]/;

/**
 * Does `source` reach for the host app IN CODE?
 *
 * COMMENTS ARE REMOVED FIRST, and that half is the whole of #12398. A docblock
 * explaining why a mount sits outside the auth seam — "the mount takes the
 * framework-native handle through `IHttpServer.getRawApp()`" — is prose, and
 * prose reaches for nothing. Scanned raw it scored as a second reacher and
 * failed an IDENTITY assertion by naming a file that reaches for nothing, whose
 * own failure text then invites the wrong repair: widening the expected list,
 * which retires the only property the assertion has.
 *
 * STRING, TEMPLATE AND REGEX LITERALS ARE LEFT INTACT, and that half is what
 * keeps the fix from being a silent disarm. Two of the three spellings above
 * ARE string literals — `ctx.getService('http.server')` reaches for the host
 * app entirely inside quotes — so the sibling `maskStrings` below must never be
 * applied here. Both directions are pinned in `scan machinery` at the foot of
 * this file, including a genuine second reacher that lives in a string.
 */
const reachesHostApp = (source: string): boolean => HOST_APP_REACH.test(stripComments(source));

/** Which of `files` reach for the host app in code. Driveable for the pins. */
const filesReachingHostApp = (files: readonly string[], read: (f: string) => string): string[] =>
    files.filter((f) => reachesHostApp(read(f)));

/** A mount-shaped call on a handle named `app` — how a SECOND registrar would look. */
const MOUNT_SHAPED = /\bapp\s*\.\s*(?:get|post|put|patch|delete|options|head|all)\s*\(/;

const ledgerRoutes = (): Set<string> => new Set(METADATA_ROUTE_LEDGER.map((e) => e.route));
const liveCensus = (): Census => censusOf(MOUNT_SOURCES, readSource);

// ---------------------------------------------------------------------------

describe('metadata route ledger ↔ source census', () => {
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
        // EXACT equality on `METHOD /wire/path` — a prefix is never credited to
        // a longer sibling (#10534).
        const missing = liveCensus().routes.filter((r) => !ledger.has(r.route));
        expect(
            missing.map((r) => `${r.route}  (${r.file}:${r.line})`),
            'routes with no METADATA_ROUTE_LEDGER row. A new route needs a reviewed disposition in '
                + 'metadata-route-ledger.ts (#11882) — a row is not enough, it must carry its evidence.',
        ).toEqual([]);
    });

    it('every ledger entry is really mounted in source', () => {
        const live = new Set(liveCensus().routes.map((r) => r.route));
        const stale = [...ledgerRoutes()].filter((r) => !live.has(r));
        expect(stale, 'METADATA_ROUTE_LEDGER rows this package no longer mounts').toEqual([]);
    });

    it('every row names the file it is mounted in', () => {
        const byRoute = new Map(liveCensus().routes.map((r) => [r.route, r.file]));
        const wrong = METADATA_ROUTE_LEDGER
            .filter((e) => byRoute.has(e.route) && byRoute.get(e.route) !== e.mountedIn)
            .map((e) => `${e.route}: ledgered as '${e.mountedIn}' but mounted in '${byRoute.get(e.route)}'`);
        expect(wrong, 'mountedIn values that do not match the census').toEqual([]);
    });

    it('no route is ledgered twice', () => {
        const seen = new Set<string>();
        const dupes = METADATA_ROUTE_LEDGER.map((e) => e.route).filter((r) => !seen.add(r));
        expect(dupes, `duplicate METADATA_ROUTE_LEDGER rows: ${dupes.join(', ')}`).toEqual([]);
    });
});

describe('metadata mount population', () => {
    it('plugin.ts is the only file that reaches for the host app', () => {
        // An IDENTITY, not a count: the day a second module resolves
        // `http-server` or calls `getRawApp()`, this names it.
        const reaching = filesReachingHostApp(packageSourceFiles(), readSource);
        expect(
            reaching,
            'files reaching for the host HTTP app. A second registrar is invisible to the census above — '
                + 'ledger its routes and add its module to MOUNT_SOURCES before adding it here.',
        ).toEqual([HOST_APP_REACH_FILE]);
    });

    it('routes/hmr-routes.ts is the only file that mounts on a passed-in app handle', () => {
        // The reach check above cannot see a registrar that RECEIVES the handle
        // as a parameter — which is exactly how this package's own mount is
        // written. So the mount SHAPE is swept package-wide too; without this,
        // a second `register*Routes(app)` module would be invisible to both.
        const mounting = packageSourceFiles().filter((f) => MOUNT_SHAPED.test(stripComments(readSource(f))));
        expect(
            mounting,
            'files mounting on a passed-in app handle. A new one must be added to MOUNT_SOURCES and its '
                + 'routes ledgered.',
        ).toEqual([...MOUNT_SOURCES]);
    });

    it('the host app handle is passed to exactly one registrar', () => {
        // Strings are masked as well as comments: `plugin.ts` names
        // `getRawApp()` inside a warning message, and a structural count that
        // included it would report two call sites where there is one.
        const code = maskStrings(stripComments(readSource(HOST_APP_REACH_FILE)));
        const calls = [...code.matchAll(/getRawApp\s*\(\s*\)/g)];
        expect(calls.length, 'getRawApp() invocation sites in plugin.ts').toBe(1);
        expect(
            /registerMetadataHmrRoutes\s*\(\s*[\w.]*getRawApp\s*\(\s*\)/.test(code),
            'the one getRawApp() result is no longer handed straight to registerMetadataHmrRoutes — the '
                + 'handle now reaches somewhere this census does not read.',
        ).toBe(true);
    });
});

describe('the options.path seam — why the rows are exact', () => {
    it('the seam still defaults to the ledgered wire path', () => {
        const code = stripComments(readSource('routes/hmr-routes.ts'));
        expect(
            /options\.path\s*\?\?\s*'\/api\/v1\/dev\/metadata-events'/.test(code),
            'the HMR default path changed. Both ledger rows carry the DEFAULT, so they are now wrong.',
        ).toBe(true);
    });

    it('the seam is unreachable from outside this package', () => {
        // The rows are exact ONLY because nothing can pass a custom path. If
        // `registerMetadataHmrRoutes` is exported, a consumer can move both wire
        // paths and this ledger silently stops describing the surface.
        for (const entry of ['index.ts', 'node.ts']) {
            const code = stripComments(readSource(entry));
            expect(
                code.includes('registerMetadataHmrRoutes') || code.includes('hmr-routes'),
                `${entry} now re-exports the HMR registrar. Its `
                    + '`options.path` seam becomes reachable by consumers, so the ledger rows stop being the '
                    + 'whole truth — re-review the rows and this assertion together.',
            ).toBe(false);
        }
    });

    it('the sole in-repo caller passes no options', () => {
        const code = stripComments(readSource(HOST_APP_REACH_FILE));
        const call = /registerMetadataHmrRoutes\s*\(([^;]*)\)\s*;/.exec(code);
        expect(call, 'the registrar call in plugin.ts could not be read').not.toBeNull();
        expect(
            call![1].includes('path'),
            'plugin.ts now passes a `path` option, so the mounted wire path is no longer the default the '
                + 'ledger rows carry.',
        ).toBe(false);
    });
});

describe('metadata route ledger hygiene', () => {
    it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
        const sdkWithout = METADATA_ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
        expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

        // A FLOOR, not a proof — so that pasting three words is not the
        // cheapest path (`check-auth-mount-ledger.mjs`'s rationale half).
        const thin = METADATA_ROUTE_LEDGER
            .filter((e) => e.disposition !== 'sdk' && (e.note ?? '').length < 60)
            .map((e) => e.route);
        expect(thin, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
    });

    it('the whole surface is audited as reaching NO client method', () => {
        // Said as a MEASUREMENT rather than left implicit, because the
        // assertion above holds vacuously while no row is `sdk` (the
        // `service-datasource` rule). Measured for #11882:
        // `@objectstack/client` grepped for `metadata-events` — zero hits.
        const claimed = METADATA_ROUTE_LEDGER.filter((e) => e.client != null).map((e) => e.route);
        expect(
            claimed,
            `rows claiming a client method: ${claimed.join(', ')}. Promoting a row to SDK surface is a `
                + 'public-surface widening and belongs in the PR that adds the method.',
        ).toEqual([]);
    });

    it('gap and mismatch counts only shrink', () => {
        // Ratchet, not aspiration. This surface audited at ZERO of each
        // (#11882): one SSE stream the SDK's transport does not model, one
        // build-tool loopback.
        expect(METADATA_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length).toBeLessThanOrEqual(0);
        expect(METADATA_ROUTE_LEDGER.filter((e) => e.disposition === 'mismatch').length).toBeLessThanOrEqual(0);
    });
});

describe('scan machinery, pinned in both directions', () => {
    it('the comment stripper drops prose paths, keeps code paths, and preserves line numbers', () => {
        const stripped = stripComments("// app.get('/api/v1/ghost', h)\n/* a\nb */\napp.get(`/api/v1/real`, h);\n");
        expect(stripped).not.toContain('ghost');
        expect(stripped).toContain('/api/v1/real');
        expect(censusOf(['f.ts'], () => "/* a\nb\nc */\napp.get('/api/v1/x', h);\n").routes[0].line).toBe(4);
    });

    it('the string masker hides a call spelled inside a log message, and keeps real code', () => {
        // The real case, from plugin.ts: a warning naming `getRawApp()`. Before
        // this masking step the structural count above read 2 where the truth
        // is 1 — an accurate-looking number that was measuring prose.
        const src = "log('HTTP server with getRawApp() not available');\nconst a = http.getRawApp();\n";
        const masked = maskStrings(src);
        expect([...masked.matchAll(/getRawApp\s*\(\s*\)/g)].length).toBe(1);
        // Structure survives: quotes, line count and the live call are intact.
        expect(masked.split('\n').length).toBe(src.split('\n').length);
        expect(masked).toContain('http.getRawApp()');
    });

    it('the host-app reach probe does not count PROSE — the #12398 false positive', () => {
        // The exact docblock that fired it: a module explaining that the mount
        // takes the framework-native handle, in a comment.
        expect(reachesHostApp('// the mount takes the handle through `IHttpServer.getRawApp()`\n')).toBe(false);
        expect(reachesHostApp("/*\n * resolves 'http-server' before mounting\n */\n")).toBe(false);
        expect(reachesHostApp("/* the ctx.getService('http.server') seam, explained */\n")).toBe(false);
    });

    it('the host-app reach probe still counts a REACH THAT LIVES IN A STRING', () => {
        // The direction that makes the fix a fix rather than a disarm. Two of
        // the three spellings are service keys — string literals — so a probe
        // that masked literals as well as comments would detect nothing here
        // and the identity limb would pass vacuously forever.
        expect(reachesHostApp("const s = ctx.getService('http.server');\n")).toBe(true);
        expect(reachesHostApp('const s = ctx.getService("http-server");\n')).toBe(true);
        expect(reachesHostApp('const s = ctx.getService(`http-server`);\n')).toBe(true);
        expect(reachesHostApp('const app = server.getRawApp();\n')).toBe(true);
    });

    it('a genuine SECOND reacher is still named — anti-vacuity on the identity limb', () => {
        // LOAD-BEARING POSITIVE for #12398's fix: driven through the same
        // function the live limb calls, with source injected. Without it, a
        // strip that quietly stopped matching anything would leave the identity
        // green forever — the failure direction the whole family distrusts.
        const fake: Record<string, string> = {
            'plugin.ts': 'const app = http.getRawApp();\n',
            'routes/prose-only.ts': '// getRawApp() is reached in plugin.ts, never here\n',
            'routes/second-reacher.ts': "const s = ctx.getService('http.server');\n",
        };
        expect(
            filesReachingHostApp(Object.keys(fake).sort(), (f) => fake[f]),
        ).toEqual(['plugin.ts', 'routes/second-reacher.ts']);
    });

    it('resolves both binding spellings this package uses, and refuses the rest', () => {
        const b = pathBindings("const routePath = options.path ?? '/api/v1/dev/metadata-events';\nconst FIXED = '/api/v1/fixed';\n");
        expect(b.get('routePath')).toBe('/api/v1/dev/metadata-events');
        expect(b.get('FIXED')).toBe('/api/v1/fixed');
        expect(resolveFirstArg('routePath, h)', b)).toBe('/api/v1/dev/metadata-events');
        expect(resolveFirstArg('unknownVar, h)', b)).toBeNull();
        expect(resolveFirstArg('`${dynamic}/x`, h)', b)).toBeNull();
    });

    it('an unledgered mount is REDDENED, and a lane is not a route', () => {
        // LOAD-BEARING POSITIVE: without it the accounting assertions could
        // pass because the recogniser matches nothing at all.
        const added = censusOf(['f.ts'], () => "app.post('/api/v1/dev/zzz-new', h);\n");
        expect(added.routes.map((r) => r.route)).toEqual(['POST /api/v1/dev/zzz-new']);
        expect(ledgerRoutes().has('POST /api/v1/dev/zzz-new')).toBe(false);

        const lane = censusOf(['f.ts'], () => "app.use('*', mw);\n");
        expect(lane.routes).toEqual([]);
        expect(lane.lanes.map((l) => l.member)).toEqual(['use']);

        const odd = censusOf(['f.ts'], () => "app.on('POST', '/api/v1/x', h);\n");
        expect(odd.unreadable.length).toBe(1);
    });
});
