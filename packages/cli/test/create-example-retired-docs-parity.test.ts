// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DOCS PARITY (#16483, #16690) — no public page and no SHIPPED file still
 * offers `os create example` to run.
 *
 * ## The half no process can check
 *
 * `create-example-retired.e2e.test.ts` drives the real CLI and proves the
 * refusal: non-zero, and the message names `os init`. That says nothing about
 * the public pages which present `os create` as a user-facing command. A
 * reader who follows a page rather than a terminal is exactly the reader the
 * #15531 ruling is protecting, and a page that still prints
 * `os create example my-app` in a copyable block hands them a command that now
 * refuses.
 *
 * ## Why this is a SEPARATE file from the pin next door
 *
 * That one is `*.e2e.test.*`, a NAME-decided tier (`scripts/nightly-tiers.mjs`,
 * #16455): those files are excluded from the per-PR and merge-queue population
 * and run in the nightly job. That is the right lane for four cold `tsx` spawns
 * and the wrong lane for a handful of `readFileSync` calls — a docs-only PR
 * that reintroduced the retired command would otherwise be caught the following
 * night instead of on the PR. This file spawns nothing, so it stays queue-tier
 * and reddens where the edit is made.
 *
 * ## The property, which is not "the string is gone"
 *
 * A page that still SAYS `os create example` is fine, and is often exactly what
 * a reader arriving from a search engine or an older tutorial needs. What the
 * ruling fixed is two narrower things, and those are what is asserted:
 *
 *   a. nothing a reader can COPY carries it, so there is nothing left to paste
 *      into a terminal;
 *   b. a page that mentions it in prose also names `os init`, so the mention is
 *      a signpost rather than a leftover.
 *
 * ⛔ Never satisfy a red here by deleting a page's `os create` section. The
 * positive controls below fail when a carrier stops showing a SURVIVING
 * `os create`, which is what makes the assertions capable of failing at all.
 *
 * All four pages are already declared as cross-package inputs of
 * `@objectstack/cli` (`scripts/cross-package-test-inputs.mjs`, mirrored into
 * `turbo.json`), so a docs-only edit reaches this suite instead of replaying a
 * cached green. The shipped carriers below live inside this package, so
 * `$TURBO_DEFAULT$` already hashes them and they need no declaration.
 *
 * ## The carrier the docs population could not see (#16690)
 *
 * The four pages above are the WEBSITE. `packages/cli/README.md` is not one of
 * them, and it is the carrier that actually ships: this package's own `files`
 * names it — `["dist", "README.md", "CHANGELOG.md"]` — so it goes out in every
 * tarball as the npm front page. Of the five carriers of the retired command,
 * the four that were guarded were documentation pages and the one that was not
 * is the one in the tarball.
 *
 * ## Widening the population without widening the READER is worse than the gap
 *
 * Adding the README to `DOC_SITES` and changing nothing else was MEASURED, and
 * it does not work. On a clean tree that naive addition fails exactly one test
 * — the `os create plugin` FENCE control, because the README shows that
 * command in prose and in a table, never in a fence. With `os create example`
 * written into the README's command roster TABLE ROW it fails THAT SAME ONE
 * TEST AND NO OTHER: both retirement assertions passed over a README that was
 * carrying the retired command. The two failure signatures are identical, so
 * the red says nothing about the retirement — an author would silence it by
 * adding a fenced `os create plugin` to the README and land a fully green
 * suite that had just been shown a retired roster row.
 *
 * ⇒ A roster row is not a fence and the fence reader cannot see it. So the
 *   reader is widened here too, and the same widening is applied to the four
 *   pages: `content/docs/deployment/cli.mdx` was measured to carry four
 *   `os create` TABLE ROWS of its own, so fence-only reading left the same
 *   blind spot on a page the suite already claimed to guard.
 *
 * ## What counts as an OFFER, and why it stops short of prose
 *
 * `offeredLines` reads two shapes, applied to both populations:
 *
 *   - lines inside a fenced code block — what a reader copies to a terminal;
 *   - markdown table rows — a command roster IS a list of runnable commands,
 *     and a table is the shape both the README and `cli.mdx` present them in.
 *
 * ⛔ It deliberately does NOT read inline code in running prose, and that
 * boundary is measured rather than assumed: `packages/cli/CHANGELOG.md` ships
 * too, and it carries `os create example` in two historical entries (it has no
 * fences at all, and none of its 348 table rows names `os create`). A
 * changelog's job is to RECORD that a command existed and was retired;
 * reddening on it would demand rewriting history to keep a gate green. The
 * boundary test below pins that, so the next author who widens the reader sees
 * which line they are about to cross.
 *
 * ⚠️ NOT COVERED, stated plainly so this suite is not read as claiming it: an
 * inline `os create example` written into README PROSE is invisible here.
 * Closing that needs a rule separating an offer from a mention inside running
 * text, and the CHANGELOG is the proof that the rule is not "it is in
 * backticks".
 *
 * ## The shipped population is DERIVED, never restated
 *
 * `SHIPPED_MARKDOWN` is read out of `packages/cli/package.json`'s `files`. A
 * second hand-written shipping list is the drift this card exists to fix, so
 * the only hand-written thing is a TRIPWIRE on the entries that are NOT
 * markdown — `dist` today, measured to ship 0 `.md` files out of 500. A new
 * entry there may be a prose carrier this suite cannot see, and it must fail
 * until someone re-derives the population rather than extending a list.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETIRED_TEMPLATES, templates } from '../src/commands/create.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

// One `resolve(HERE, …)` call per line and nothing split across lines:
// `check:cross-package-test-inputs` reconstructs these reads by SOURCE SCAN,
// and a spelling it cannot parse leaves the glob declared and held by nothing.
const CLI_DOCS = resolve(HERE, '../../..', 'content/docs/deployment/cli.mdx');
const PLUGINS_INDEX = resolve(HERE, '../../..', 'content/docs/plugins/index.mdx');
const KERNEL_INDEX = resolve(HERE, '../../..', 'content/docs/protocol/kernel/index.mdx');
const PLUGIN_SPEC = resolve(HERE, '../../..', 'content/docs/protocol/kernel/plugin-spec.mdx');
const CLI_PACKAGE_ROOT = resolve(HERE, '..');
const CLI_PACKAGE_JSON = resolve(HERE, '..', 'package.json');

/** The four public pages that present `os create` as a user-facing command. */
const DOC_SITES: Record<string, string> = {
  'content/docs/deployment/cli.mdx': CLI_DOCS,
  'content/docs/plugins/index.mdx': PLUGINS_INDEX,
  'content/docs/protocol/kernel/index.mdx': KERNEL_INDEX,
  'content/docs/protocol/kernel/plugin-spec.mdx': PLUGIN_SPEC,
};

/**
 * This package's OWN shipping declaration. ⛔ Never restate it here: `files` is
 * the one list that cannot drift out of step with what `npm pack` emits, and
 * `packages/cli/package.json` is read for it and never written by this suite.
 */
const SHIPPED: readonly string[] = (
  JSON.parse(readFileSync(CLI_PACKAGE_JSON, 'utf8')) as { files: string[] }
).files;

/** The shipped carriers that can hold prose, derived from the line above. */
const SHIPPED_MARKDOWN = SHIPPED.filter((entry) => entry.endsWith('.md'));

const shippedText = (rel: string): string => readFileSync(resolve(CLI_PACKAGE_ROOT, rel), 'utf8');

/** Every fenced code block on a page — what a reader copies into a terminal. */
function fences(md: string): string[] {
  return [...md.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]);
}

/** Every markdown table row — the shape a COMMAND ROSTER is written in. */
function tableRows(md: string): string[] {
  return md.split('\n').filter((line) => /^\s*\|/.test(line));
}

/**
 * What a carrier OFFERS a reader to run. Fences and roster rows both present a
 * command as runnable; running prose does not, and the CHANGELOG boundary test
 * below is what holds that line in place.
 */
function offeredLines(md: string): string[] {
  return [...fences(md).flatMap((block) => block.split('\n')), ...tableRows(md)];
}

/** The retired spelling, DERIVED from the registry rather than written twice. */
const RETIRED = Object.keys(RETIRED_TEMPLATES).map((key) => `os create ${key}`);

const offersRetired = (md: string): string[] =>
  offeredLines(md)
    .filter((line) => RETIRED.some((cmd) => line.includes(cmd)))
    .map((line) => line.trim());

describe('[#16483] the docs and the retirement registry agree', () => {
  it('has something retired to look for, and a survivor to control against', () => {
    // Both halves, so neither loop below can pass over an empty population.
    expect(RETIRED).toEqual(['os create example']);
    expect(Object.keys(templates)).toEqual(['plugin']);
  });

  it.each(Object.keys(DOC_SITES))('%s still documents `os create` (control)', (site) => {
    const text = readFileSync(DOC_SITES[site], 'utf8');
    expect(text).toContain('os create plugin');
    expect(
      fences(text).some((f) => f.includes('os create plugin')),
      `${site} shows no runnable \`os create plugin\` block — the control for the two `
        + 'assertions below is gone, so neither can fail any more',
    ).toBe(true);
  });

  it.each(Object.keys(DOC_SITES))('%s offers nothing to COPY that now refuses', (site) => {
    expect(
      offersRetired(readFileSync(DOC_SITES[site], 'utf8')),
      `${site} still shows a retired command as runnable — it exits non-zero now`,
    ).toEqual([]);
  });

  it.each(Object.keys(DOC_SITES))('%s that mentions it at all points at `os init`', (site) => {
    const text = readFileSync(DOC_SITES[site], 'utf8');
    if (!RETIRED.some((cmd) => text.includes(cmd))) return;
    expect(
      text,
      `${site} names a retired command without naming its replacement`,
    ).toContain('os init');
  });
});

describe('[#16690] what SHIPS carries the retirement too', () => {
  it('derives a non-empty carrier population from the package `files` array', () => {
    expect(
      SHIPPED_MARKDOWN.length,
      '`files` names no markdown, so every assertion below passes over an empty '
        + 'population — re-derive the population, do not delete these tests',
    ).toBeGreaterThan(0);
    for (const rel of SHIPPED_MARKDOWN) {
      expect(() => shippedText(rel), `\`files\` names ${rel}, which is not on disk`).not.toThrow();
    }
  });

  it('has no shipped entry that could carry prose unread (tripwire)', () => {
    // ⛔ NOT a second shipping list — the population above is derived. This is a
    // tripwire: `dist` was measured to ship 0 `.md` files out of 500, so it
    // carries no prose. A new entry here may, and must fail until someone
    // re-derives the population rather than widening this line.
    expect(
      SHIPPED.filter((entry) => !entry.endsWith('.md')),
      'a new non-markdown entry ships in the tarball — if it can carry a runnable '
        + 'command, it belongs in the suite population before this line changes',
    ).toEqual(['dist']);
  });

  it.each(SHIPPED_MARKDOWN)('%s offers nothing to COPY that now refuses', (rel) => {
    expect(
      offersRetired(shippedText(rel)),
      `${rel} ships in the npm tarball and still offers a retired command as `
        + 'runnable — it exits non-zero now',
    ).toEqual([]);
  });

  it('reads a roster TABLE ROW, not only a fence (control)', () => {
    // ⭐ The control that makes the assertion above capable of failing at all.
    // The README presents `os create` in a table cell and never in a fence, so
    // a fence-only reader finds nothing here and every assertion goes vacuous.
    const rosterRows = SHIPPED_MARKDOWN.flatMap((rel) => tableRows(shippedText(rel))).filter(
      (line) => line.includes('os create'),
    );
    expect(
      rosterRows.length,
      'no shipped markdown shows `os create` in a table row — the reader has '
        + 'nothing to prove it can see a roster cell, so the retirement '
        + 'assertion above can no longer fail',
    ).toBeGreaterThan(0);
  });

  it('records a retired command outside an offer position without reddening (boundary)', () => {
    // The CHANGELOG names `os create example` in historical entries. That is a
    // RECORD, not an offer, and it must stay green: a reader widened to all
    // inline code would demand rewriting shipped history to keep a gate green.
    const recorded = SHIPPED_MARKDOWN.flatMap((rel) => {
      const text = shippedText(rel);
      const offered = new Set(offeredLines(text));
      return text
        .split('\n')
        .filter((line) => RETIRED.some((cmd) => line.includes(cmd)) && !offered.has(line));
    });
    expect(
      recorded.length,
      'no shipped file mentions a retired command outside an offer position, so '
        + 'the offer/record boundary this reader depends on is no longer '
        + 'exercised — re-establish it or retire this control deliberately',
    ).toBeGreaterThan(0);
    expect(offersRetired(recorded.join('\n'))).toEqual([]);
  });
});
