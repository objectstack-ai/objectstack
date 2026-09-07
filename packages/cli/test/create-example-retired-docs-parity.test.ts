// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DOCS PARITY (#16483) — no public page still offers `os create example` to run.
 *
 * ## The half no process can check
 *
 * `create-example-retired.e2e.test.ts` drives the real CLI and proves the
 * refusal: non-zero, and the message names `os init`. That says nothing about
 * the four public pages which present `os create` as a user-facing command. A
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
 * and the wrong lane for four `readFileSync` calls — a docs-only PR that
 * reintroduced the retired command would otherwise be caught the following
 * night instead of on the PR. This file spawns nothing, so it stays queue-tier
 * and reddens where the edit is made.
 *
 * ## The property, which is not "the string is gone"
 *
 * A page that still SAYS `os create example` is fine, and is often exactly what
 * a reader arriving from a search engine or an older tutorial needs. What the
 * ruling fixed is two narrower things, and those are what is asserted:
 *
 *   a. no FENCED CODE BLOCK on any public page carries it, so there is nothing
 *      left to copy into a terminal;
 *   b. a page that mentions it in prose also names `os init`, so the mention is
 *      a signpost rather than a leftover.
 *
 * ⛔ Never satisfy a red here by deleting a page's `os create` section. The
 * positive control below fails when a page stops showing `os create plugin` in
 * a fence, which is what makes the two assertions capable of failing at all.
 *
 * All four pages are already declared as cross-package inputs of
 * `@objectstack/cli` (`scripts/cross-package-test-inputs.mjs`, mirrored into
 * `turbo.json`), so a docs-only edit reaches this suite instead of replaying a
 * cached green.
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

/** The four public pages that present `os create` as a user-facing command. */
const DOC_SITES: Record<string, string> = {
  'content/docs/deployment/cli.mdx': CLI_DOCS,
  'content/docs/plugins/index.mdx': PLUGINS_INDEX,
  'content/docs/protocol/kernel/index.mdx': KERNEL_INDEX,
  'content/docs/protocol/kernel/plugin-spec.mdx': PLUGIN_SPEC,
};

/** Every fenced code block on a page — what a reader copies into a terminal. */
function fences(mdx: string): string[] {
  return [...mdx.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]);
}

/** The retired spelling, DERIVED from the registry rather than written twice. */
const RETIRED = Object.keys(RETIRED_TEMPLATES).map((key) => `os create ${key}`);

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
    const copyable = fences(readFileSync(DOC_SITES[site], 'utf8'))
      .flatMap((f) => f.split('\n'))
      .filter((line) => RETIRED.some((cmd) => line.includes(cmd)));
    expect(
      copyable.map((line) => line.trim()),
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
