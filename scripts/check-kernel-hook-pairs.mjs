#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Paired kernel-hook pin gate (#5282).
 *
 * ## What it guards
 *
 * This repo boots plugins on two kernels: `ObjectKernel` (production) and
 * `LiteKernel` (vitest / serverless / edge). They share plugin code, they share
 * the hook vocabulary — and they do NOT share a class: `ObjectKernel` does not
 * extend `ObjectKernelBase`, so each keeps its own `hooks` map. #5282 shared the
 * two DISPATCH loops (`packages/core/src/hook-dispatch.ts`, option B of the
 * ruling); the storage is still two maps, which is why the residue needs a gate.
 *
 * The residue is worth a gate because the same defect landed three times in a
 * row, each time as "one hook name means opposite things on the two kernels":
 *
 *   - #5170 — `kernel:ready`: LiteKernel swallowed a throwing handler while
 *     ObjectKernel failed the boot.
 *   - #5257 — `kernel:bootstrapped` / `kernel:listening`: the same, and the
 *     worst-shaped specimen — `HonoServerPlugin` awaits `server.listen(port)`
 *     in `kernel:listening`, so a failed listen was swallowed on LiteKernel and
 *     the process printed "✅ Bootstrap complete" with nothing listening.
 *   - #5274 — `kernel:shutdown`, in the other direction: ObjectKernel's
 *     propagating dispatch let one bad handler skip every `destroy()` and
 *     `process.exit(1)`.
 *
 * All three were caught by a HUMAN noticing the asymmetry, and what holds the
 * two kernels together afterwards is a pair of hand-written tests — a
 * convention, not a mechanism. A fifth lifecycle hook added tomorrow gets no
 * pairing automatically, and nothing goes red when it is missing. This gate is
 * that mechanism (option C of the same ruling):
 *
 *   every `kernel:*` hook DISPATCHED in `packages/core/src` must be named in a
 *   test title in BOTH `kernel.test.ts` and `lite-kernel.test.ts`.
 *
 * A missing pair fails, naming the hook AND the side that lacks it.
 *
 * ## What counts as a dispatch
 *
 * A call to one of `DISPATCH_CALLEES` whose first argument is a `kernel:*`
 * string literal — `ctx.trigger('kernel:ready')`,
 * `this.triggerHookOrThrow('kernel:listening')`,
 * `dispatchHookIsolating('kernel:shutdown', …)` — plus a direct
 * `hooks.get('kernel:x')`, which is how both hand-written loops opened before
 * #5282 and is therefore how a re-mirrored one would open again.
 *
 * SUBSCRIPTION is deliberately not a dispatch: `ctx.hook('kernel:ready', fn)`
 * in a plugin (e.g. `fallbacks/authored-translation-sync.ts`) consumes a hook
 * the kernel already dispatches and pins nothing new. Only the kernels decide
 * what a hook MEANS, so only their dispatch sites owe a paired pin.
 *
 * ## What counts as a named pin
 *
 * The hook name appearing verbatim in an `it()` / `test()` / `describe()`
 * title. Titles, not bodies: a hook that only shows up inside a test body is
 * usually incidental setup (`ctx.hook('kernel:ready', …)` to reach some other
 * behaviour), whereas a title carrying the name is someone asserting what that
 * hook does on that kernel. Both title forms are accepted so the gate stays
 * about the PAIRING, never about title style.
 *
 * ## Usage
 *
 *     node scripts/check-kernel-hook-pairs.mjs             # audit the repo
 *     node scripts/check-kernel-hook-pairs.mjs --list      # print what it sees
 *     node scripts/check-kernel-hook-pairs.mjs --self-test # verify the checker
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseSourceFile } from './ts-parse.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Where kernels live, and the two files that must pin every hook they dispatch. */
const KERNEL_SRC = 'packages/core/src';
const PAIRED_TEST_FILES = ['kernel.test.ts', 'lite-kernel.test.ts'];

/**
 * Callees that DISPATCH a hook. `trigger` covers `PluginContext.trigger` on
 * both kernels; `triggerHook` / `triggerHookOrThrow` are the base's two
 * flavours; the `dispatchHook*` pair is the shared module #5282 introduced.
 * `hooks.get` is included because that is how a hand-rolled dispatch loop
 * begins — the exact shape #5282 removed, kept in the vocabulary so its return
 * is visible rather than silent.
 */
const DISPATCH_CALLEES = new Set([
    'trigger',
    'triggerHook',
    'triggerHookOrThrow',
    'dispatchHookIsolating',
    'dispatchHookPropagating',
    'get', // only counted on a `hooks.get(...)` receiver — see isHooksGet()
]);

/** Test-title callees whose first string argument can carry a named pin. */
const TITLE_CALLEES = new Set(['it', 'test', 'describe']);

const HOOK_NAME = /^kernel:[A-Za-z][A-Za-z0-9_:-]*$/;

// ── Scanning ─────────────────────────────────────────────────────────────────

function parse(fileName, source) {
    return parseSourceFile(fileName, source, ts.ScriptKind.TS);
}

/** The identifier a call expression ends in: `a.b.c(x)` → `c`, `c(x)` → `c`. */
function calleeName(expression) {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return undefined;
}

/** `<anything>.hooks.get(…)` — the opening line of a hand-rolled dispatch loop. */
function isHooksGet(expression) {
    return (
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === 'get' &&
        ts.isPropertyAccessExpression(expression.expression) &&
        expression.expression.name.text === 'hooks'
    );
}

/**
 * First argument as a plain string literal, when it is one. `isStringLiteralLike`
 * also accepts a substitution-free template literal, which is a perfectly good
 * title or hook name; anything interpolated is not statically knowable and is
 * deliberately left unresolved rather than guessed.
 */
function firstStringArg(call) {
    const [arg] = call.arguments;
    if (arg && ts.isStringLiteralLike(arg)) return arg.text;
    return undefined;
}

/**
 * Every `kernel:*` hook dispatched in one source file.
 * @returns {{hook: string, line: number, callee: string}[]}
 */
export function findDispatches(source, fileName = 'kernel.ts') {
    const sf = parse(fileName, source);
    const out = [];
    const visit = (node) => {
        if (ts.isCallExpression(node)) {
            const name = calleeName(node.expression);
            const counted = name === 'get' ? isHooksGet(node.expression) : DISPATCH_CALLEES.has(name);
            if (counted) {
                const hook = firstStringArg(node);
                if (hook && HOOK_NAME.test(hook)) {
                    out.push({
                        hook,
                        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
                        callee: name,
                    });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

/**
 * Every test/describe title in one test file.
 * @returns {string[]}
 */
export function findTitles(source, fileName = 'kernel.test.ts') {
    const sf = parse(fileName, source);
    const out = [];
    const visit = (node) => {
        if (ts.isCallExpression(node)) {
            // `it`, `it.each(…)`, `describe.skip`, … all reduce to the base
            // identifier by peeling property accesses and the `.each(…)` call.
            let expression = node.expression;
            while (ts.isPropertyAccessExpression(expression) || ts.isCallExpression(expression)) {
                expression = expression.expression;
            }
            if (ts.isIdentifier(expression) && TITLE_CALLEES.has(expression.text)) {
                const title = firstStringArg(node);
                if (title) out.push(title);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

// ── Audit ────────────────────────────────────────────────────────────────────

function discoverSourceFiles() {
    const out = [];
    const skip = new Set(['node_modules', 'dist', 'build', '.turbo', 'coverage']);
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            if (skip.has(entry)) continue;
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) { walk(full); continue; }
            if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
            if (entry.includes('.test.') || entry.includes('.spec.')) continue;
            out.push(relative(ROOT, full).split(sep).join('/'));
        }
    };
    walk(join(ROOT, KERNEL_SRC));
    return out.sort();
}

/**
 * The whole audit, over an injectable corpus so the self-test can run it on
 * synthetic files instead of the repo.
 *
 * @param {{sources: Record<string,string>, tests: Record<string,string>}} corpus
 * @returns {{dispatches: Map<string, string[]>, problems: string[]}}
 */
export function audit(corpus) {
    /** hook → where it is dispatched */
    const dispatches = new Map();
    for (const [file, source] of Object.entries(corpus.sources)) {
        const seen = new Set();
        for (const { hook, line, callee } of findDispatches(source, file)) {
            // One dispatch statement can match twice — `dispatchHookIsolating(
            // 'kernel:shutdown', this.hooks.get('kernel:shutdown') …)` is both
            // an outer dispatch call and an inner `hooks.get`. Report the site
            // once, under the outermost callee (visited first).
            if (seen.has(`${file}:${line}`)) continue;
            seen.add(`${file}:${line}`);
            if (!dispatches.has(hook)) dispatches.set(hook, []);
            dispatches.get(hook).push(`${file}:${line} (${callee})`);
        }
    }

    const titles = new Map(
        Object.entries(corpus.tests).map(([file, source]) => [file, findTitles(source, file)]),
    );

    const problems = [];
    for (const hook of [...dispatches.keys()].sort()) {
        const missing = [];
        for (const file of PAIRED_TEST_FILES) {
            const found = (titles.get(file) ?? []).some((title) => title.includes(hook));
            if (!found) missing.push(file);
        }
        if (missing.length > 0) {
            problems.push(
                `${hook} — dispatched at ${dispatches.get(hook).join(', ')} — has no named pin in: ${missing.join(', ')}`,
            );
        }
    }
    return { dispatches, problems };
}

function readCorpus() {
    const sources = {};
    for (const file of discoverSourceFiles()) sources[file] = readFileSync(join(ROOT, file), 'utf8');

    const tests = {};
    for (const file of PAIRED_TEST_FILES) {
        tests[file] = readFileSync(join(ROOT, KERNEL_SRC, file), 'utf8');
    }
    return { sources, tests };
}

function run() {
    const { dispatches, problems } = audit(readCorpus());

    if (problems.length > 0) {
        console.error('✗ kernel hook pin pairing\n');
        for (const problem of problems) console.error(`  ✗ ${problem}`);
        console.error(
            `\nEvery kernel:* hook dispatched in ${KERNEL_SRC} must be named in a test title in BOTH` +
                `\n${PAIRED_TEST_FILES.map((f) => `  ${KERNEL_SRC}/${f}`).join('\n')}` +
                '\n\nThe two kernels do not share a hooks map, so a hook pinned on one side only can mean' +
                '\nthe opposite thing on the other and no test says so — the shape of #5170, #5257 and' +
                '\n#5274. Add a test on the missing side naming the hook in its title (or, if the hook is' +
                '\nnot a lifecycle hook both kernels dispatch, stop dispatching it from packages/core/src).',
        );
        process.exit(1);
    }

    console.log(
        `✓ kernel hook pin pairing: ${dispatches.size} dispatched kernel:* hook(s), each pinned in both ` +
            PAIRED_TEST_FILES.join(' and '),
    );
}

function list() {
    const { dispatches } = audit(readCorpus());
    for (const hook of [...dispatches.keys()].sort()) {
        console.log(`${hook}\n  ${dispatches.get(hook).join('\n  ')}`);
    }
}

// ── Self-test ────────────────────────────────────────────────────────────────

function assert(condition, message) {
    if (!condition) {
        console.error(`✗ self-test: ${message}`);
        process.exit(1);
    }
}

function selfTest() {
    const PINNED = (hook) => `
        describe('Kernel', () => {
            it('fails the boot when a ${hook} handler throws', async () => {});
        });
    `;

    // 1. A hook pinned on both sides passes.
    {
        const { problems } = audit({
            sources: { 'kernel.ts': `await this.context.trigger('kernel:ready');` },
            tests: { 'kernel.test.ts': PINNED('kernel:ready'), 'lite-kernel.test.ts': PINNED('kernel:ready') },
        });
        assert(problems.length === 0, `a hook pinned on both sides passes (got ${problems.length})`);
    }

    // 2. Pinned on neither side ⇒ one problem naming BOTH files.
    {
        const { problems } = audit({
            sources: { 'kernel.ts': `await this.context.trigger('kernel:probe');` },
            tests: { 'kernel.test.ts': PINNED('kernel:ready'), 'lite-kernel.test.ts': PINNED('kernel:ready') },
        });
        assert(problems.length === 1, `an unpinned hook is one problem (got ${problems.length})`);
        assert(problems[0].includes('kernel:probe'), 'the problem names the hook');
        assert(problems[0].includes('kernel.test.ts'), 'the problem names kernel.test.ts as missing');
        assert(problems[0].includes('lite-kernel.test.ts'), 'the problem names lite-kernel.test.ts as missing');
        assert(problems[0].includes('kernel.ts:1 (trigger)'), 'the problem quotes the dispatch site');
    }

    // 3. Pinned on ONE side ⇒ still red, naming only the side that lacks it.
    //    This is the whole point: the pair is the unit, not the presence.
    {
        const { problems } = audit({
            sources: { 'kernel.ts': `await this.context.trigger('kernel:probe');` },
            tests: { 'kernel.test.ts': PINNED('kernel:probe'), 'lite-kernel.test.ts': PINNED('kernel:ready') },
        });
        assert(problems.length === 1, `a half-pinned hook is still a problem (got ${problems.length})`);
        assert(problems[0].includes('lite-kernel.test.ts'), 'the missing side is named');
        assert(
            !problems[0].includes('in: kernel.test.ts'),
            'the side that DOES pin it is not reported as missing',
        );
    }

    // 4. Every dispatch flavour is recognised, including the shared module
    //    #5282 introduced — a callee missing from the vocabulary is a hook the
    //    gate cannot see at all, which is worse than a false positive.
    {
        const { dispatches } = audit({
            sources: {
                'kernel.ts': `
                    await this.context.trigger('kernel:a');
                    await dispatchHookIsolating('kernel:b', handlers, this.logger);
                    await dispatchHookPropagating('kernel:c', handlers, undefined, args);
                `,
                'lite-kernel.ts': `
                    await this.triggerHook('kernel:d');
                    await this.triggerHookOrThrow('kernel:e');
                    const handlers = this.hooks.get('kernel:f') || [];
                `,
            },
            tests: { 'kernel.test.ts': '', 'lite-kernel.test.ts': '' },
        });
        assert(
            [...dispatches.keys()].sort().join(',') === 'kernel:a,kernel:b,kernel:c,kernel:d,kernel:e,kernel:f',
            `every dispatch flavour is seen (got: ${[...dispatches.keys()].sort().join(',')})`,
        );
    }

    // 5. Subscription is NOT dispatch. A plugin consuming `kernel:ready` owes
    //    no pin — the kernels decide what a hook means, plugins only listen.
    {
        const { dispatches } = audit({
            sources: { 'fallbacks/x.ts': `ctx.hook('kernel:ready', async () => {});` },
            tests: { 'kernel.test.ts': '', 'lite-kernel.test.ts': '' },
        });
        assert(dispatches.size === 0, `ctx.hook() is a subscription, not a dispatch (got ${dispatches.size})`);
    }

    // 6. A `get(…)` that is not a `hooks.get(…)` is not a dispatch — the
    //    vocabulary's most collision-prone name stays scoped to its receiver.
    {
        const { dispatches } = audit({
            sources: { 'kernel.ts': `const svc = this.services.get('kernel:ready');` },
            tests: { 'kernel.test.ts': '', 'lite-kernel.test.ts': '' },
        });
        assert(dispatches.size === 0, `services.get() is not a hook dispatch (got ${dispatches.size})`);
    }

    // 7. Non-`kernel:` hooks are out of scope: `data:beforeInsert` and friends
    //    are per-plugin vocabularies with no cross-kernel meaning to keep equal.
    {
        const { dispatches } = audit({
            sources: { 'kernel.ts': `await this.context.trigger('data:beforeInsert', doc);` },
            tests: { 'kernel.test.ts': '', 'lite-kernel.test.ts': '' },
        });
        assert(dispatches.size === 0, `only kernel:* hooks are paired (got ${dispatches.size})`);
    }

    // 8. A dynamic hook name cannot be resolved statically and is not guessed —
    //    that is the generic `trigger(name)` seam every hook flows through.
    {
        const { dispatches } = audit({
            sources: { 'kernel-base.ts': `await dispatchHookPropagating(name, this.hooks.get(name) || [], undefined, args);` },
            tests: { 'kernel.test.ts': '', 'lite-kernel.test.ts': '' },
        });
        assert(dispatches.size === 0, `a variable hook name is not invented (got ${dispatches.size})`);
    }

    // 9. Any title form carries the pin: `describe` counts, and so does a
    //    modified `it.each(…)`. The gate judges pairing, never title style.
    {
        const { problems } = audit({
            sources: { 'kernel.ts': `await this.context.trigger('kernel:probe');` },
            tests: {
                'kernel.test.ts': `describe('kernel:probe dispatch', () => { it('propagates', () => {}); });`,
                'lite-kernel.test.ts': `it.each([1])('kernel:probe propagates (%i)', () => {});`,
            },
        });
        assert(problems.length === 0, `describe() and it.each() titles both pin (got: ${problems[0] ?? ''})`);
    }

    // 10. The name must appear in a TITLE. A hook that only shows up in a test
    //     BODY is incidental setup for some other assertion, not a pin.
    {
        const { problems } = audit({
            sources: { 'kernel.ts': `await this.context.trigger('kernel:probe');` },
            tests: {
                'kernel.test.ts': `it('boots', () => { ctx.hook('kernel:probe', fn); });`,
                'lite-kernel.test.ts': `it('boots', () => { ctx.hook('kernel:probe', fn); });`,
            },
        });
        assert(problems.length === 1, `a body mention is not a named pin (got ${problems.length})`);
    }

    console.log('✓ self-test: 10 cases');
}

// Only act when invoked as the entry point. The audit helpers above are
// exported so a measurement can run this checker over a corpus that is not the
// working tree (e.g. `origin/main`, to prove a new gate has no false positives
// before it is pinned in CI) — an import that audited, printed and possibly
// called process.exit(1) as a side effect would make that impossible.
if (isEntrypoint(import.meta.url)) {
    if (process.argv.includes('--self-test')) selfTest();
    else if (process.argv.includes('--list')) list();
    else run();
}
