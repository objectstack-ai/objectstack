// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The tripwire on the ioredis / ioredis-mock version pair** that the
 * inertness declaration at the top of `redis.contract.test.ts` was measured
 * against (#15467 / PR #15985).
 *
 * ## What that declaration claims, and why prose alone was not enough
 *
 * This package depends on `ioredis@^6`, while the double its contract suites
 * run on declares `peerDependencies: { ioredis: "^5" }`. That one-major gap
 * was not closed — it was measured, command by command, and declared INERT on
 * the surface those suites actually drive. The entire deliverable of that
 * work is a paragraph of prose.
 *
 * And that paragraph states its own expiry condition:
 *
 * > If the `ioredis` or `ioredis-mock` range in package.json moves — OR if the
 * > version either one RESOLVES to moves under an unchanged caret range, which
 * > a lockfile bump alone will do — this paragraph expires and the diff has to
 * > be re-taken.
 *
 * Nothing checked that. A bump six months out silently invalidates a header
 * that still reads as authoritative — prose that was correct when written and
 * rotted without a signal. This file is that signal.
 *
 * ## Why it keys on the RESOLVED versions, not only on the declared ranges
 *
 * A pin asserting only that the two ranges still read `^6.0.0` and `^8.13.1`
 * would stay green through a **lockfile-only bump** — a resolution moving
 * under an unchanged caret — which is one of the two moves the expiry clause
 * names, and the one no manifest read can see. So the resolved versions are
 * read off the **installed tree**, out of the very manifests
 * `import RedisMock from 'ioredis-mock'` and ioredis's own types resolve to.
 * That is the honest source: a lockfile records what pnpm WOULD install, the
 * installed tree is what this test process is loading right now. The declared
 * ranges are pinned as well, because the expiry clause names them too and a
 * range can move without moving the resolution.
 *
 * ## Why the last assertion reads the declaration's own text
 *
 * The failure mode this design is most afraid of is the one the card asking
 * for it named: *a pin that fires on routine maintenance trains people to
 * edit the pin rather than re-do the measurement, which would be worse than
 * no pin.* ⇒ Editing the constants below is deliberately NOT enough to get
 * back to green — the pinned pair must also still appear in the declaration's
 * own text, so a bump that updates this file and leaves the header stale
 * stays red. Green costs a re-measure, which is the only outcome worth having.
 *
 * ## What it deliberately does NOT check
 *
 * The declaration's v5 leg — "5.11.1, newest release satisfying the mock's
 * `^5` peer" — is a REGISTRY fact, not a workspace one: no ioredis 5.x is
 * installed here (the mock's peer resolves onto the 6.x copy). A newer 5.x
 * release ages that leg with no local signal, and no offline pin can see it.
 * Recorded rather than pretended.
 *
 * ⛔ Nor does it re-litigate the inertness measurement, and ⛔ nor should the
 * untyped `ioredis-mock` import be "fixed" by adopting `@types/ioredis-mock`:
 * measured and rejected, because those types declare the mock constructor as
 * returning a real ioredis `Redis` — asserting conformance instead of
 * verifying it, which is this whole family's failure mode one layer up.
 *
 * Both reads stay inside this package (`src/` to the package root, and a
 * sibling source file), so neither is a `check:cross-package-test-inputs`
 * escape and neither needs a declaration.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

// One `resolve(HERE, …)` per line on purpose — `check:cross-package-test-inputs`
// reconstructs a test's reads by scanning source text, and a path assembled
// across statements is a spelling it does not know.
const MANIFEST = resolve(HERE, '../package.json');
const DECLARATION = resolve(HERE, './redis.contract.test.ts');

/** Repo-relative, for the failure message — an absolute temp path helps nobody. */
const DECLARATION_PATH =
    'packages/services/service-cluster-redis/src/redis.contract.test.ts';
const DECLARATION_SECTION =
    '## The double is one major version behind the client it doubles';

/**
 * The pair the declaration was measured against, and the ranges that resolved
 * to it.
 *
 * ⛔ These are not configuration. Editing them to match a new install is the
 * one move this file exists to prevent; the failure message explains why and
 * the last assertion makes it insufficient anyway.
 */
const PINNED = {
    resolved: { ioredis: '6.0.0', 'ioredis-mock': '8.13.1' },
    ranges: { ioredis: '^6.0.0', 'ioredis-mock': '^8.13.1' },
} as const;

const requireFromHere = createRequire(import.meta.url);

/** The version actually installed for `name`, read from its own manifest. */
function resolvedVersion(name: string): string {
    const path = requireFromHere.resolve(`${name}/package.json`);
    return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
};

const declarationText = readFileSync(DECLARATION, 'utf8');

/** `6.0.0` as a standalone token, so `16.0.0` and `6.0.0-rc.1` do not match. */
function namesVersion(text: string, version: string): boolean {
    const escaped = version.replace(/\./g, '\\.');
    return new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`).test(text);
}

/**
 * The message a reader gets mid-bump, having never heard of the measurement.
 * It has to answer three questions before they reach for the constants above:
 * what just expired, where it is written, and what the remedy is.
 */
function expired(fact: string, pinned: string, found: string): string {
    return [
        '',
        "The ioredis / ioredis-mock pair this package's inertness declaration was",
        'measured against has moved:',
        '',
        `    ${fact}: pinned ${pinned}, found ${found}`,
        '',
        `That declaration is the section "${DECLARATION_SECTION}"`,
        `at the top of ${DECLARATION_PATH}. It states, in its own words, that it`,
        'expires when either range moves OR either resolved version moves — which',
        'is what just happened. Every "inert" conclusion in it now describes a',
        'pair that is no longer what this package installs.',
        '',
        '⛔ Do NOT edit the pinned constants to match. This file is not the claim,',
        'it is the tripwire on the claim, and editing it green re-asserts a',
        'measurement nobody has taken. It would not even work: the last assertion',
        "in this file requires the declaration's own text to name the same pair.",
        '',
        'Re-do the measurement instead:',
        '  1. Re-take the diff that section describes, for the NEW pair — the type',
        '     declarations of every command `src/*.ts` issues, of `multi()` and',
        '     `exec()`, and of the `RedisOptions` keys `client.ts` sets.',
        '  2. Rewrite the section with the new pair and whatever it now reads.',
        '  3. Only then update the constants here, in the same commit.',
        '',
        'If the re-measure finds the gap is no longer inert, the fix is upstream —',
        'the dependency or the double — not this pin and not the declaration.',
        '',
    ].join('\n');
}

describe('ioredis / ioredis-mock version pair pin', () => {
    it('still resolves the ioredis version the declaration was measured against', () => {
        const found = resolvedVersion('ioredis');
        const pinned = PINNED.resolved.ioredis;
        expect(found, expired('ioredis, resolved on disk', pinned, found)).toBe(pinned);
    });

    it('still resolves the ioredis-mock version the declaration was measured against', () => {
        const found = resolvedVersion('ioredis-mock');
        const pinned = PINNED.resolved['ioredis-mock'];
        expect(found, expired('ioredis-mock, resolved on disk', pinned, found)).toBe(
            pinned,
        );
    });

    it('still declares the two ranges that resolved to that pair', () => {
        // Pinned per dependency block, not looked up across both: moving the
        // double into `dependencies` would ship a test-only package to every
        // consumer, and that move should be seen here too.
        const foundClient = manifest.dependencies['ioredis'];
        expect(
            foundClient,
            expired('ioredis, declared range', PINNED.ranges.ioredis, String(foundClient)),
        ).toBe(PINNED.ranges.ioredis);

        const foundDouble = manifest.devDependencies['ioredis-mock'];
        expect(
            foundDouble,
            expired(
                'ioredis-mock, declared devDependency range',
                PINNED.ranges['ioredis-mock'],
                String(foundDouble),
            ),
        ).toBe(PINNED.ranges['ioredis-mock']);
    });

    it('keeps the declaration itself present and naming the pinned pair', () => {
        // Without this, the cheapest way back to green after a bump is to edit
        // the constants above and leave the header describing a pair nobody
        // installs any more — a pin that has been trained to lie. With it, the
        // header and the pin can only move together.
        const remedy = [
            '',
            `${DECLARATION_PATH} no longer carries the claim this file defends,`,
            'or no longer names the pair pinned here.',
            '',
            `Expected that file to contain the section "${DECLARATION_SECTION}"`,
            `naming ioredis-mock ${PINNED.resolved['ioredis-mock']} and ioredis ${PINNED.resolved.ioredis}.`,
            '',
            'If the measurement was re-taken, update the constants in this file in',
            'the same commit. If the declaration was deleted on purpose, delete',
            'this pin with it — a tripwire on a claim that no longer exists is the',
            'same rot one level up. ⛔ What is not an option is silencing this',
            'assertion and leaving the header in place.',
            '',
        ].join('\n');

        expect(declarationText.includes(DECLARATION_SECTION), remedy).toBe(true);
        expect(
            declarationText.includes(`ioredis-mock@${PINNED.resolved['ioredis-mock']}`),
            remedy,
        ).toBe(true);
        expect(namesVersion(declarationText, PINNED.resolved.ioredis), remedy).toBe(true);
    });
});
