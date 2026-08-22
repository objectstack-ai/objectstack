// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Pins #10322 part 3 — the substantive half, per triage: the generated
// `AGENTS.md` calls `validate` the command you must never skip ("Never report
// a metadata change as done until `npm run validate` passes"), and the
// newcomer's primary doc, the blank template's own README, must name it where
// a newcomer reading top-to-bottom actually sees it, not only in a section
// further down the file. This template is a STATIC file — `index.ts` copies
// it byte-for-byte (only the first H1 line is rewritten, by
// `rewriteProjectIdentity`) — so there is no code path to unit-test; this
// source-text pin is what covers it. A fuller explanation of *why* to run it
// already lives in the "## Verify your changes" section further down; this
// pin is deliberately about the FIRST section a newcomer reads, not a
// duplicate of that explanation.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const blankRoot = path.resolve(HERE, 'templates', 'blank');
const readme = fs.readFileSync(path.join(blankRoot, 'README.md'), 'utf8');

describe('blank template README names `validate` at first touch (#10322)', () => {
  it('reads the real template README (vacuity guard)', () => {
    expect(readme).toMatch(/^## Getting started$/m);
  });

  it('mentions `validate` in or immediately after "Getting started" — not only further down', () => {
    // Everything from the "Getting started" heading up to (not including) the
    // next `## ` heading after it, minus the heading's own code fence — this
    // is what a newcomer reads before scrolling past the first section.
    const gettingStarted = readme.split(/^## Getting started$/m)[1]?.split(/^## /m)[0] ?? '';
    expect(
      gettingStarted,
      '"Getting started" must mention `validate` — otherwise a newcomer who ' +
        'only reads the first section never learns about the command ' +
        "AGENTS.md calls unskippable.",
    ).toMatch(/\bvalidate\b/);
  });

  it('the validate step named at first touch matches the fuller explanation below', () => {
    expect(readme).toMatch(/^## Verify your changes$/m);
    const verifySection = readme.split(/^## Verify your changes$/m)[1]?.split(/^## /m)[0] ?? '';
    expect(verifySection).toMatch(/\bvalidate\b/);
  });

  it('names one consistent package manager throughout — no bare npm mixed into a pnpm doc', () => {
    // #10322 part 1: pick one and say it everywhere. The blank template
    // already used pnpm consistently; this pin keeps it that way. Excludes
    // the `engines.pnpm` prose about pnpm-version floors living in
    // template-consistency.test.ts, and non-pm words like "npm" never occur
    // here at all today — so a plain absence check is the right shape.
    expect(readme).not.toMatch(/\bnpm run\b/);
    expect(readme).not.toMatch(/\bnpm install\b/);
  });
});
