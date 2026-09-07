#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Raw `:type` route-param comparison guard (#6241).
 *
 * ## What it guards
 *
 * The `/meta/:type` routes serve BOTH spellings of the type segment — the
 * protocol normalizes singular <-> plural — and Prime Directive #3 makes the
 * PLURAL one canonical (`/api/v1/meta/books/:name`). So a gate that compares
 * the RAW `:type` param against a singular literal is a gate the canonical
 * spelling walks straight past:
 *
 *     if (… && req.params.type !== 'doc' && req.params.type !== 'book') {   // BAD
 *     if (… && metaType !== 'doc' && metaType !== 'book') {                 // GOOD
 *
 * Both spellings reach the same handler, so the two halves of that `if` are
 * the same request answered two different ways.
 *
 * ## Why a scan, and why now
 *
 * This is not a hypothetical. It is one defect that has now been fixed three
 * times in one file:
 *
 *   - #3984 — every per-type gate on `/meta` compared the literal singular, so
 *     the plural spelling bypassed ALL of them: book audience, app RBAC,
 *     dashboard capability. Measured: `GET /meta/book/admin_guide` -> 401,
 *     `GET /meta/books/admin_guide` -> 200. Its ruled fix was structural —
 *     normalize once at the top of each handler, let every gate read that.
 *   - #5881 — the same file's cached-read exclusion listed `app` but not
 *     `dashboard`, so the ADR-0057 D10 widget gate never ran on the default
 *     path. Fixed with a NORMALIZED comparison.
 *   - #6241 — eight days after #3984 landed, the same cached-read exclusion
 *     still spelled `doc` / `book` as RAW literals, so `GET /meta/books/:name`
 *     took the cached branch and the ADR-0046 §6.7 audience gate — which lives
 *     in the other branch — never ran at all. A `{ permissionSet }`-gated book
 *     was served in full to a signed-in caller holding no set.
 *
 * Each fix was correct and each was found by hand, by someone reading the file
 * for another reason. Per-defect tests pin the gates that exist today; nothing
 * refuses the NEXT raw comparison, which is the only thing that would have
 * stopped the third instance. This scan is that refusal.
 *
 * ## Why AST, not grep
 *
 * The pattern's own documentation quotes it. `rest-server.ts` carries several
 * JSDoc blocks containing the literal text `req.params.type === 'book'` to
 * explain what went wrong — a textual scan would flag the explanation and force
 * whoever writes the next post-mortem to obfuscate it. The AST does not see
 * comments, so the guard and the history can coexist.
 *
 * ## What is covered, and what is not
 *
 * Covered, on any `*.params.type` / `*.params?.type` chain:
 *   - `===` / `!==` / `==` / `!=` comparisons, either side;
 *   - `switch` discriminants;
 *   - membership tests: `[...].includes(raw)`, `set.has(raw)`, `[…].indexOf(raw)`.
 *
 * NOT covered, and deliberately named rather than implied: a raw param copied
 * into a local first (`const t = req.params.type; if (t === 'doc')`). Detecting
 * that needs dataflow, and a guard that claims more than it checks is worse
 * than one that says where it stops. The convention the guard exists to protect
 * makes the copy unnecessary anyway — the local you want already exists, and it
 * is the normalized one.
 *
 * PASS-THROUGHS ARE NOT COMPARISONS and are not flagged. Handing the raw param
 * to the protocol (`p.getMetaItem({ type: req.params.type, … })`) is correct:
 * the metadata protocol folds plural -> singular itself (#4432), and it is the
 * layer that owns that normalization. What this guard bans is the REST layer
 * making a DECISION on the un-normalized value.
 *
 * ## Exemptions
 *
 * `EXEMPT` maps `<file>:<line-anchored source text>` to a reason. It is empty
 * today, and that is the point: #6241 removed the last raw comparison from
 * `packages/rest/src`, so this starts from zero rather than from a ratchet.
 * A new entry needs a reason a reader can check, not a name.
 */

// dispatch-gates: wide-population -- SCAN_DIRS is packages/rest/src, walked for non-test TypeScript sources only. The DIRECTORY is narrow enough to name and the glob would still be false six times in seven: that tree is 133 test files to 21 sources -- 21 of 154 (14%). What cannot be spelled here is the file-KIND filter, not the subtree, which is why the recorded verdict in scripts/pm/bare-root-worklist.mjs is REFUSE-UNSPELLABLE rather than REFUSE-WIDE.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Directories scanned. Route handlers that read `:type` live here. */
const SCAN_DIRS = [join('packages', 'rest', 'src')];

/**
 * Blessed raw comparisons: `'<relative-path>::<trimmed source text>'` -> reason.
 * Empty by design — see the header.
 */
const EXEMPT = Object.create(null);

/** Membership calls that decide on their argument the way a comparison does. */
const MEMBERSHIP_METHODS = new Set(['includes', 'has', 'indexOf', 'lastIndexOf']);

const COMPARISON_OPS = new Set([
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
]);

/**
 * Is this node the RAW route param — a `.params.type` / `.params?.type` chain?
 * Matches any receiver (`req`, `request`, `ctx.req`, …) so a renamed handler
 * argument cannot slip past.
 */
function isRawTypeParam(node) {
    if (!ts.isPropertyAccessExpression(node)) return false;
    if (node.name.text !== 'type') return false;
    const owner = node.expression;
    if (ts.isPropertyAccessExpression(owner)) return owner.name.text === 'params';
    // `req.params?.type` parses the `params` hop as the same node shape; an
    // element access (`req['params'].type`) is covered here too.
    if (ts.isElementAccessExpression(owner)) {
        const arg = owner.argumentExpression;
        return !!arg && ts.isStringLiteralLike(arg) && arg.text === 'params';
    }
    return false;
}

function walkFiles(dir, out) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            walkFiles(full, out);
        } else if (/\.(m|c)?tsx?$/.test(entry) && !/\.(test|spec)\.(m|c)?tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

/** Every raw-param decision site in one file. */
function findViolations(file) {
    const text = readFileSync(file, 'utf8');
    const source = parseSourceFile(file, text);
    const found = [];

    const record = (node, kind) => {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push({
            file: relative(ROOT, file).split(sep).join('/'),
            line: line + 1,
            kind,
            text: node.getText(source).replace(/\s+/g, ' ').trim(),
        });
    };

    const visit = (node) => {
        if (ts.isBinaryExpression(node) && COMPARISON_OPS.has(node.operatorToken.kind)) {
            if (isRawTypeParam(node.left) || isRawTypeParam(node.right)) {
                record(node, 'comparison');
            }
        } else if (ts.isSwitchStatement(node) && isRawTypeParam(node.expression)) {
            record(node.expression, 'switch discriminant');
        } else if (
            ts.isCallExpression(node)
            && ts.isPropertyAccessExpression(node.expression)
            && MEMBERSHIP_METHODS.has(node.expression.name.text)
            && node.arguments.some((a) => isRawTypeParam(a))
        ) {
            record(node, 'membership test');
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    return found;
}

/**
 * Self-test: the guard must catch each covered shape and must NOT catch the
 * two things that are legitimately raw — a pass-through into the protocol, and
 * the pattern quoted inside a comment. A guard nobody tests is a guard that
 * silently stops matching.
 */

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-meta-type-normalized self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `problems.length` used to be this self-test's ONLY success condition, so
// "every case
// held" and "the cases never ran" printed the same line. Closed the way
// PR #13487 validated on check-doc-authoring: what is pinned is the registered
// NAMES, not a number. The floor requires the OPENED set to equal the DECLARED
// set with each battery at or above its own count.
//
// This file declares ONE battery, opened at the top of the self-test body. It
// carries exactly ONE named section banner, which is fewer than the two the
// sectioning criterion needs, and ⛔ a single banner is NOT split on — nor is
// any comment promoted to a section head, which is a judgement per comment this
// transplant does not make. The hoisted single battery is the shape PR #14896,
// PR #15003 and PR #15217 landed for exactly this case.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'check-meta-type-normalized self-test': 4,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

function selfTest() {
    // The battery ledger this self-test's floor is evaluated against (#13489).
    // `battery()` opens a battery; every assertion below is attributed to the one
    // most recently opened, so a section that stops running stops registering and
    // names ITSELF at the floor rather than going quiet.
    const batterySeen = new Map();
    let openBattery = null;
    const battery = (name) => {
        openBattery = name;
    };
    const registerCase = () => {
        const b = openBattery ?? UNATTRIBUTED_BATTERY;
        batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
    };
    battery('check-meta-type-normalized self-test');
    // The thunk PR #15198 measured: it registers the case and then runs the
    // existing site VERBATIM, so no assertion condition is inverted or rewritten
    // and the sink keeps its own semantics. Registration happens whether or not
    // the site fires, which is what makes the count a floor on cases RUN rather
    // than a count of failures.
    const check = (fn) => {
        registerCase();
        fn();
    };
    const fixture = `
        // if (req.params.type === 'doc') {} -- quoted in a line comment
        /** JSDoc quoting req.params.type !== 'book' for the post-mortem. */
        const a = req.params.type === 'doc';
        const b = 'book' !== req.params.type;
        const c = req.params?.type === 'app';
        switch (req.params.type) { default: break; }
        const d = ['doc', 'book'].includes(req.params.type);
        const ok1 = p.getMetaItem({ type: req.params.type, name: req.params.name });
        const ok2 = RestServer.metaTypeSingular(req.params.type) === 'book';
        const ok3 = metaType === 'doc';
    `;
    const source = parseSourceFile('fixture.ts', fixture);
    const hits = [];
    const visit = (node) => {
        if (ts.isBinaryExpression(node) && COMPARISON_OPS.has(node.operatorToken.kind)
            && (isRawTypeParam(node.left) || isRawTypeParam(node.right))) hits.push('comparison');
        else if (ts.isSwitchStatement(node) && isRawTypeParam(node.expression)) hits.push('switch');
        else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && MEMBERSHIP_METHODS.has(node.expression.name.text)
            && node.arguments.some((a) => isRawTypeParam(a))) hits.push('membership');
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);

    const comparisons = hits.filter((h) => h === 'comparison').length;
    const problems = [];
    // Three comparisons: a, b, c. NOT ok2 — its left side is the normalizer's
    // return value, not the raw param, which is the whole distinction.
    check(() => {
        if (comparisons !== 3) problems.push(`expected 3 comparisons, saw ${comparisons}`);
    });
    check(() => {
        if (!hits.includes('switch')) problems.push('missed the switch discriminant');
    });
    check(() => {
        if (!hits.includes('membership')) problems.push('missed the membership test');
    });
    check(() => {
        if (hits.length !== 5) problems.push(`expected 5 findings total, saw ${hits.length} — a pass-through or a comment was flagged`);
    });

    // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
    //
    // Evaluated after every battery has had its chance and BEFORE the verdict, so
    // the success line below can only be printed by a run in which the set of
    // batteries that registered assertions EQUALS the set declared. A set
    // difference names WHICH battery stopped; a count says only that something did.
    // This file's sink IS the `problems` ledger, so the floor speaks its idiom: a
    // breach is recorded as a problem and reds through the existing verdict below.
    const floorFailure = (message) => { problems.push(message); };
    const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
    let floorBreached = false;
    if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
        floorBreached = true;
        floorFailure(
            `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
                + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
        );
    }
    for (const [name, count] of batterySeen) {
        if (declaredBatteries.includes(name)) continue;
        floorBreached = true;
        floorFailure(
            `self-test battery "${name}" registered ${count} case(s) but is not declared in `
                + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
        );
    }
    for (const name of declaredBatteries) {
        const count = batterySeen.get(name) ?? 0;
        if (count >= SELF_TEST_BATTERIES[name]) continue;
        floorBreached = true;
        floorFailure(
            count === 0
                ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
                    + 'The verdict below would have claimed those cases hold.'
                : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
                    + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
        );
    }
    if (floorBreached) {
        floorFailure(
            'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
                + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
                + 'skips) and restore it.',
        );
    }

    if (problems.length) {
        console.error('check:meta-type-normalized --self-test FAILED');
        for (const p of problems) console.error(`  - ${p}`);
        process.exit(1);
    }
    console.log('check:meta-type-normalized --self-test passed (5 shapes caught, pass-through and comments untouched)');

    return SELF_TEST_VERDICT;
}

function main() {
    if (process.argv.includes('--self-test')) {
        if (selfTest() !== SELF_TEST_VERDICT) {
            console.error(
                '\n✗ check-meta-type-normalized self-test: selfTest() returned without reaching its verdict,\n'
                    + 'so no success line was printed. Exiting 0 here would report a self-test\n'
                    + 'that never finished as a self-test that passed.\n',
            );
            process.exit(1);
        }
        return;
    }
    if (selfTest() !== SELF_TEST_VERDICT) {
        console.error(
            '\n✗ check-meta-type-normalized self-test: selfTest() returned without reaching its verdict,\n'
                + 'so no success line was printed. Running the gate on top of a self-test\n'
                + 'that never finished would report an unverified gate as a verified one.\n',
        );
        process.exit(1);
    }

    const files = [];
    for (const dir of SCAN_DIRS) walkFiles(join(ROOT, dir), files);

    const violations = [];
    for (const file of files) {
        for (const v of findViolations(file)) {
            const key = `${v.file}::${v.text}`;
            if (EXEMPT[key]) continue;
            violations.push(v);
        }
    }

    if (violations.length === 0) {
        console.log(`check:meta-type-normalized: OK (${files.length} file(s), no raw \`:type\` param decisions)`);
        return;
    }

    console.error(`check:meta-type-normalized: ${violations.length} raw \`:type\` param decision(s)\n`);
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}  [${v.kind}]`);
        console.error(`    ${v.text}`);
    }
    console.error(`
The \`/meta/:type\` routes serve BOTH spellings and the PLURAL one is canonical
(Prime Directive #3), so a decision made on the raw param is a decision the
canonical spelling skips. Normalize ONCE at the top of the handler and compare
against that local:

    const metaType = RestServer.metaTypeSingular(req.params.type);
    …
    if (metaType === 'book') { … }

This has been the same authorization bypass three times (#3984, #5881, #6241).
If a site genuinely must read the raw spelling, add it to EXEMPT in
scripts/check-meta-type-normalized.mjs with a reason a reader can check.`);
    process.exit(1);
}

main();
