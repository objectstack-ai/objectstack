// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * trigger-api route-ledger conformance (#11863) — the guard that keeps this
 * package's autonomously-mounted HTTP surface and its reviewed dispositions
 * from drifting apart, in the #3636 pattern (`service-storage`,
 * `service-i18n`, `service-datasource`).
 *
 * Three limbs, because two different things can go wrong and only one of them
 * is visible from a lifecycle drive.
 *
 * LIMB 1 — ENUMERATION IS REAL. `ApiTriggerPlugin` is driven through its
 * ACTUAL lifecycle (`init` → `start` → `kernel:ready`) against a capturing
 * host app, so the registration calls ARE the route set — including the
 * `kernel:ready` deferral and the three service resolutions it is conditional
 * on, which a hand-pinned list would quietly stop exercising. Directions made
 * loud: a route mounted with no ledger entry, and a ledger entry for a route
 * the plugin no longer mounts.
 *
 * The capturing app is a `Proxy`, not a fixed set of `vi.fn()` verbs, so a
 * mount through a member this guard did not anticipate (`rawApp.on(...)`,
 * `rawApp.route(...)`) is RECORDED and reported as a finding rather than
 * silently missed. That is `check-auth-mount-ledger.mjs`'s fourth constraint
 * applied here: a partial read must not report as a complete one.
 *
 * LIMB 2 — THE POPULATION, from SOURCE. Limb 1 can only see what
 * `ApiTriggerPlugin` mounts. A SECOND registrar added to this package later —
 * another plugin class, another module reaching for `http-server` — would be
 * invisible to it, and a one-row ledger that misses a second mount is worse
 * than no ledger, because it reads as a completed census. So the package's own
 * non-test source is scanned for two things: every absolute-path literal must
 * be ledgered, and the set of files that reach for the host app must be exactly
 * `plugin.ts` — an identity, not a count.
 *
 * The literal scan is deliberately BROAD (any absolute-path-shaped literal,
 * not just `/api/...`): the closest sibling case, `/.well-known/objectstack`
 * (#7526), was a route mounted at the SITE ROOT, which an `/api/`-anchored
 * scan would have walked straight past. A non-route absolute literal added
 * here in future must therefore be ledgered or excluded in this file, on
 * purpose — a loud false positive is the correct default for a census.
 *
 * What limb 2 still cannot see, stated rather than discovered later: a path
 * composed at runtime (a template literal, a value from config) yields no
 * literal to scan. Limb 1 covers that case for anything `ApiTriggerPlugin`
 * mounts, because it reads the argument actually passed; a future registrar
 * that both composes its path AND lives outside this plugin would be caught by
 * the `getRawApp`/`http-server` identity pin instead.
 *
 * LIMB 3 — HYGIENE, and the ANTI-VACUITY assertion. Every `sdk` row must name
 * its client method and every non-`sdk` row must say why. Because today's
 * ledger is wholly `server-only`, the client half is asserted as the #11863
 * audit's actual FINDING (no row reaches a client method) rather than left to
 * hold vacuously — the `service-datasource` precedent's rule: a guard that can
 * only ever pass is the "declared but unverified" shape these ledgers exist to
 * remove.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { ApiTriggerPlugin } from './plugin.js';
import { TRIGGER_API_ROUTE_LEDGER } from './trigger-api-route-ledger.js';

// ---------------------------------------------------------------------------
// Limb 1 — enumerate what the plugin really mounts
// ---------------------------------------------------------------------------

/**
 * Members of a Hono app that MOUNT a route, keyed by the verb the ledger
 * spells. `use` is excluded on purpose — it is a middleware lane, not a route
 * (the same exclusion `check-auth-mount-ledger.mjs` makes for `.use`/`.all`
 * catch-alls). `all` IS included: a `rawApp.all('/x')` does answer requests,
 * so it must be ledgered rather than waved through.
 */
const ROUTING_MEMBERS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);

/** Members that are lanes, not routes — recorded, then ignored. */
const NON_ROUTE_MEMBERS = new Set(['use', 'notFound', 'onError', 'fire', 'fetch', 'request']);

/** Property reads that are JS/host plumbing, never a mount. */
const PLUMBING = new Set(['then', 'catch', 'finally', 'toJSON', 'constructor', 'inspect']);

interface RecordedCall {
    member: string;
    arg0: unknown;
}

/**
 * A host app that records EVERY member call made on it. A Proxy rather than a
 * fixed mock: an unanticipated mount spelling must show up as a finding, not
 * as an absent route.
 */
function createCapturingRawApp(): { app: unknown; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const app = new Proxy(
        {},
        {
            get(_target, prop) {
                if (typeof prop !== 'string' || PLUMBING.has(prop)) return undefined;
                return (...args: unknown[]) => {
                    calls.push({ member: prop, arg0: args[0] });
                };
            },
        },
    );
    return { app, calls };
}

/** PluginContext mock: the three services this plugin resolves, plus hook replay. */
function createMockContext(rawApp: unknown) {
    const hooks = new Map<string, Array<(...args: unknown[]) => Promise<void>>>();
    const services: Record<string, unknown> = {
        automation: { registerTrigger: vi.fn(), unregisterTrigger: vi.fn() },
        queue: {
            publish: vi.fn(async () => 'msg_1'),
            subscribe: vi.fn(async () => undefined),
            unsubscribe: vi.fn(async () => undefined),
        },
        'http-server': { getRawApp: () => rawApp },
    };
    return {
        registerService: vi.fn(),
        replaceService: vi.fn(),
        getService: vi.fn((name: string) => {
            if (name in services) return services[name];
            throw new Error(`Service '${name}' not found`);
        }),
        getServices: vi.fn(() => new Map()),
        getKernel: vi.fn(),
        hook: vi.fn((name: string, handler: (...args: unknown[]) => Promise<void>) => {
            if (!hooks.has(name)) hooks.set(name, []);
            hooks.get(name)!.push(handler);
        }),
        trigger: vi.fn(async (name: string, ...args: unknown[]) => {
            for (const h of hooks.get(name) ?? []) await h(...args);
        }),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
}

/** Drive the real lifecycle and read back what was mounted. */
async function enumerateMounts(): Promise<{ routes: string[]; unreadable: string[] }> {
    const { app, calls } = createCapturingRawApp();
    const ctx = createMockContext(app);
    const plugin = new ApiTriggerPlugin();
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    await ctx.trigger('kernel:ready');

    const routes: string[] = [];
    const unreadable: string[] = [];
    for (const call of calls) {
        if (NON_ROUTE_MEMBERS.has(call.member)) continue;
        if (!ROUTING_MEMBERS.has(call.member)) {
            unreadable.push(`rawApp.${call.member}(${JSON.stringify(call.arg0)})`);
            continue;
        }
        if (typeof call.arg0 !== 'string') {
            unreadable.push(`rawApp.${call.member}(<non-literal first argument>)`);
            continue;
        }
        routes.push(`${call.member.toUpperCase()} ${call.arg0}`);
    }
    return { routes, unreadable };
}

const ledgerRoutes = (): Set<string> => new Set(TRIGGER_API_ROUTE_LEDGER.map((e) => e.route));

// ---------------------------------------------------------------------------
// Limb 2 — the population, read off this package's own source
// ---------------------------------------------------------------------------

/**
 * Seeded from `__dirname`, not from `dirname(fileURLToPath(import.meta.url))`
 * and not from a `findUp` walk of `process.cwd()` — the pair
 * `plugin-auth/src/rate-limit-storage-isolation.test.ts` states, for the same
 * two reasons:
 *
 *  - `import.meta` is a TS1470 here. This package is CJS-typed (no
 *    `"type": "module"`; it publishes `dist/index.js` as CommonJS), so under
 *    `module: NodeNext` the meta-property is an error however well it runs under
 *    vitest — measured on this file before the seed was changed. `__dirname`
 *    type-checks under the package's own config and is defined at runtime by
 *    vitest's transform.
 *  - `check:cross-package-test-inputs` resolves seed expressions STATICALLY to
 *    decide whether a read escapes its package. `process.cwd()` is not a
 *    spelling it resolves, so a walk from there would make this scan invisible
 *    to it. This read does not escape — it is this package's own `src/` — and
 *    the seed keeps that fact checkable rather than merely true.
 */
const SRC_DIR = __dirname;

/**
 * The ledger module is excluded from the source scan for the obvious reason:
 * it is the DECLARATION. Scanning it would let the ledger satisfy itself.
 */
const SCAN_EXCLUDED = new Set(['trigger-api-route-ledger.ts']);

/** `.ts` files in this package's `src/`, minus tests and the ledger itself. */
function packageSourceFiles(): string[] {
    return readdirSync(SRC_DIR)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !SCAN_EXCLUDED.has(f))
        .sort();
}

/**
 * Strip comments before scanning for path literals. Prose cannot mount a route,
 * and this package's own doc comments quote wire paths — so a raw-text scan
 * would report a documented path as an unledgered mount, which is a false red
 * on an accurate package. The three string forms are tracked so that a literal
 * CONTAINING comment punctuation (`'/api/v1/x/*'`, `'http://host'`) is never
 * mistaken for a comment opener; `comment-stripper` below pins both directions,
 * because a stripper that swallowed real code would make this scan silently
 * blind, which is the failure that actually matters here.
 */
function stripComments(source: string): string {
    let out = '';
    let i = 0;
    while (i < source.length) {
        const c = source[i];
        const next = source[i + 1];
        if (c === '/' && next === '/') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && next === '*') {
            i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (c === '\'' || c === '"' || c === '`') {
            const quote = c;
            out += c;
            i++;
            while (i < source.length) {
                if (source[i] === '\\') {
                    out += source.slice(i, i + 2);
                    i += 2;
                    continue;
                }
                out += source[i];
                if (source[i] === quote) {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/** Every absolute-path literal in one source file, comments removed. */
function pathLiteralsIn(file: string): string[] {
    const code = stripComments(readFileSync(join(SRC_DIR, file), 'utf8'));
    return [...code.matchAll(ABSOLUTE_PATH_LITERAL)].map((m) => m[2]);
}

/** Absolute-path-shaped string literals, in any of the three quote styles. */
const ABSOLUTE_PATH_LITERAL = /(['"`])(\/[A-Za-z0-9._~:@-][^'"`\s]*)\1/g;

/** The two spellings by which a module in this package reaches the HOST app. */
const HOST_APP_REACH = /getRawApp|['"`]http-server['"`]/;

// ---------------------------------------------------------------------------

describe('trigger-api route ledger ↔ ApiTriggerPlugin enumeration', () => {
    it('the enumeration is real — the plugin mounted something on the host app', async () => {
        // ZERO IS NOT A CLEAN PACKAGE, IT IS A BROKEN DRIVE. Every assertion
        // below passes vacuously if the lifecycle stops reaching the mount
        // (a renamed service, a changed hook name), and a ledger backed by a
        // guard that sees nothing is the completed-census defect itself.
        const { routes } = await enumerateMounts();
        expect(
            routes.length,
            'the lifecycle drive observed NO mount at all — the drive is broken, not the package',
        ).toBeGreaterThan(0);
    });

    it('every mount lands through a member this guard can read', async () => {
        const { unreadable } = await enumerateMounts();
        expect(
            unreadable,
            `mounts this guard cannot account for per-route: ${unreadable.join(', ')}. ` +
                'An unrecognised mount spelling is a FINDING, never a silent skip — teach ' +
                'ROUTING_MEMBERS about it and ledger what it mounts.',
        ).toEqual([]);
    });

    it('every route the plugin mounts on the host app has a ledger entry', async () => {
        const ledger = ledgerRoutes();
        const { routes } = await enumerateMounts();
        const missing = routes.filter((k) => !ledger.has(k));
        expect(
            missing,
            `routes with no trigger-api-route-ledger entry: ${missing.join(', ')}. ` +
                'A new route needs a reviewed disposition in trigger-api-route-ledger.ts (#11863).',
        ).toEqual([]);
    });

    it('every ledger entry is really mounted by the plugin', async () => {
        const { routes } = await enumerateMounts();
        const live = new Set(routes);
        const stale = [...ledgerRoutes()].filter((k) => !live.has(k));
        expect(
            stale,
            `trigger-api-route-ledger entries the plugin no longer mounts: ${stale.join(', ')}. ` +
                'Remove or reclassify them so the ledger stays truthful.',
        ).toEqual([]);
    });

    it('no route is ledgered twice', () => {
        const seen = new Set<string>();
        const dupes = TRIGGER_API_ROUTE_LEDGER.map((e) => e.route).filter((r) => !seen.add(r));
        expect(dupes, `duplicate trigger-api-route-ledger rows: ${dupes.join(', ')}`).toEqual([]);
    });
});

describe('trigger-api mount population (source scan)', () => {
    it('the source scan really read this package', () => {
        // Same invariant as the drive above, one level down: an empty scan
        // would make both population assertions pass while measuring nothing.
        const files = packageSourceFiles();
        expect(files, 'the source scan selected no file — the scan is broken').not.toEqual([]);
        const literals = files.flatMap((f) => pathLiteralsIn(f));
        expect(
            literals.length,
            'the source scan found no absolute-path literal at all — this package mounts at ' +
                'least one route, so a zero here is a broken recogniser, not a clean package',
        ).toBeGreaterThan(0);
    });

    it('every absolute-path literal in the package source is ledgered', () => {
        const ledgerPaths = new Set([...ledgerRoutes()].map((r) => r.slice(r.indexOf(' ') + 1)));
        const unledgered: string[] = [];
        for (const file of packageSourceFiles()) {
            for (const literal of pathLiteralsIn(file)) {
                if (!ledgerPaths.has(literal)) unledgered.push(`src/${file}: ${literal}`);
            }
        }
        expect(
            unledgered,
            `absolute-path literals in trigger-api source with no ledger row: ${unledgered.join(', ')}. ` +
                'Either it is a wire path and needs a reviewed disposition (#11863), or it is not a ' +
                'route and belongs in this test\'s exclusions, said out loud.',
        ).toEqual([]);
    });

    it('plugin.ts is the only file that reaches for the host app', () => {
        // An IDENTITY, not a count: the day a second module resolves
        // `http-server` or calls `getRawApp()`, this names it, and limb 1 —
        // which only drives ApiTriggerPlugin — would not have.
        const reaching = packageSourceFiles().filter((f) =>
            HOST_APP_REACH.test(readFileSync(join(SRC_DIR, f), 'utf8')),
        );
        expect(
            reaching,
            `files reaching for the host HTTP app: ${reaching.join(', ')}. ` +
                'A second registrar in this package is invisible to the lifecycle drive above — ' +
                'ledger its routes and give it its own enumeration before adding it here.',
        ).toEqual(['plugin.ts']);
    });
});

describe('comment-stripper (the scan machinery, pinned in both directions)', () => {
    it('drops paths that only appear in prose, and keeps every path in code', () => {
        const fixture = [
            "// mounts '/api/v1/commented-out'",
            "/* block quoting '/api/v1/in-block' */",
            "app.post('/api/v1/real/:id', h);",
            "const glob = '/api/v1/wild/*';",
            'const url = "http://host/api/v1/double";',
            'const tpl = `/api/v1/tpl`;',
        ].join('\n');
        const found = [...stripComments(fixture).matchAll(ABSOLUTE_PATH_LITERAL)].map((m) => m[2]);
        // The two prose paths are gone and the three code paths survive. The
        // ORDER of the fixture is the second half of the pin: `'/api/v1/wild/*'`
        // and `"http://host/…"` sit BEFORE the last code path, so a stripper
        // that read either string's punctuation as a comment opener would eat
        // everything after it and `/api/v1/tpl` would be missing here. That is
        // the direction that matters — a stripper which swallows live code
        // makes the census read clean while measuring nothing.
        expect(found).toEqual(['/api/v1/real/:id', '/api/v1/wild/*', '/api/v1/tpl']);
    });
});

describe('trigger-api route ledger hygiene', () => {
    it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
        const sdkWithout = TRIGGER_API_ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map(
            (e) => e.route,
        );
        expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

        const bareNonSdk = TRIGGER_API_ROUTE_LEDGER.filter((e) => e.disposition !== 'sdk' && !e.note).map(
            (e) => e.route,
        );
        expect(bareNonSdk, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
    });

    it('the inbound-hooks family is audited as reaching NO client method', () => {
        // Said as a measurement rather than left implicit, because the
        // assertion above holds vacuously while every row is `server-only`
        // (the `service-datasource` rule). What is measured is the #11863
        // audit's finding: `@objectstack/client`'s whole `automation`
        // namespace targets the DISPATCHER domain `/api/v1/automation`, and no
        // client method builds a `/automation/hooks/*` URL. The live half of
        // that is enforced next door, BY OMISSION: this ledger is deliberately
        // NOT one of `client-url-conformance.test.ts`'s union inputs, so a
        // client method that started calling this route would fail there with
        // "no ledger matches" — adding this ledger to that union would remove
        // exactly that protection.
        const claimed = TRIGGER_API_ROUTE_LEDGER.filter((e) => e.client != null).map((e) => e.route);
        expect(
            claimed,
            `trigger-api rows claiming a client method: ${claimed.join(', ')}. ` +
                'Promoting a row to SDK surface is a public-surface widening and belongs in the PR ' +
                'that adds the method, with the disposition re-reviewed.',
        ).toEqual([]);
    });

    it('gap and mismatch counts only shrink', () => {
        // Ratchet, not aspiration. This surface audited at ZERO of each
        // (#11863): the one route is a third-party webhook door, so there is
        // nothing for the SDK to be missing.
        const gaps = TRIGGER_API_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length;
        expect(gaps).toBeLessThanOrEqual(0);

        const mismatches = TRIGGER_API_ROUTE_LEDGER.filter((e) => e.disposition === 'mismatch').length;
        expect(mismatches).toBeLessThanOrEqual(0);
    });
});
