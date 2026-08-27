// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12620 — when the dev port search runs out of ports, `os serve` SAYS SO,
 * carrying the message the search itself threw.
 *
 * ## The defect was a discarded sentence, not a wrong behaviour
 *
 * `getAvailablePort` throws `Could not find an available port starting from
 * <n>` — a sentence that names the problem exactly. The caller's `catch` used
 * to read `// Ignore — fall through and try the requested port` and did exactly
 * that: it dropped the sentence and bound `requestedPort` anyway, the port the
 * search had just proven was taken. The boot then died on the kernel's raw
 * `EADDRINUSE` with nothing anywhere explaining it.
 *
 * ⛔ The fallthrough itself is NOT changed and this file does not argue for
 * changing it. Whether an exhausted search should refuse instead is #11113's
 * production/development policy split and belongs to that card.
 *
 * ## ⛔ Why this file binds no sockets
 *
 * The obvious test — hold 101 real ports and boot — is the wrong test: slow,
 * flaky, and hostile to a shared many-agent container whose ephemeral range is
 * already crowded. #12441 measured that contention taking a full CLI suite red
 * (`1 failed | 2101 passed`, clean on an isolated re-run), which is why
 * `serve-port-bind-probe.test.ts` exists at all. So the SEAM is driven instead:
 * `getAvailablePort` now takes its port probe as a parameter, defaulting to the
 * real one, and every runtime assertion below drives that parameter. Zero
 * sockets, zero spawns.
 *
 * ⚠️ That parameter is the change that made this card testable at all. Without
 * it the exhausted path is reachable only by exhausting a real range, which is
 * the test this card's ruling forbids.
 *
 * ## THE THREE-WAY DISCRIMINATION (the anti-vacuity requirement)
 *
 * A test asserting only "the notice appears when the search is exhausted"
 * passes just as green against code that prints it unconditionally. Three arms,
 * each pinned at the level it is actually decidable at:
 *
 *  1. **exhausted search** → the notice appears, carrying the thrown message.
 *     RUNTIME, at the seam.
 *  2. **ordinary auto-shift** (`port !== requestedPort`, search SUCCEEDED) →
 *     this notice does not appear; #12543's drift notice does. RUNTIME, at the
 *     seam — and exactly, not by proxy: a successful search RETURNS, so the
 *     `catch` never runs and the notice is unreachable by construction. The
 *     drift half of that arm has its own landed runtime pin in
 *     `test/serve-port-drift-notice.e2e.test.ts`, which spawns a real boot
 *     against a real HTTP neighbour; it is not re-spawned here.
 *  3. **production branch** (`portAutoShiftAllowed` false) → neither notice;
 *     the existing `Port … is already in use` line fires. STRUCTURAL, against
 *     the live source: this notice's only call site is lexically inside the
 *     `if (portAutoShiftAllowed)` block and the production line is in the
 *     `else if`, so a production boot cannot reach it. The production line's
 *     own runtime pin is landed in
 *     `test/serve-node-env-production-default.e2e.test.ts`.
 *
 * ⚠️ Arm 3 is deliberately not a fourth spawner file. This package's own
 * `vitest.config.ts` records that its 39 spawner files carry 89.4% of its test
 * wall at a ~5.5-6.0s floor each, and arms 2 and 3 already hold the landed
 * runtime pins named above. What was missing from them was the discrimination
 * against THIS notice, and that is what the source-anchored arm supplies.
 *
 * ## The mutual-exclusion arm, and why it is not decoration
 *
 * The three notices are also asserted to be pairwise non-matching. One of those
 * pairs is load-bearing beyond legibility: `PORT_TAKEN_PATTERNS` in
 * `test/helpers/serve-process.ts` turns `/Port (\d+) is already in use/` and
 * `/EADDRINUSE[^\n]*?:(\d+)/` into a "port contention" verdict for every
 * spawner in this package. This notice names EADDRINUSE in prose on purpose —
 * that is what the operator is about to see — so if it ever grew a `:<digits>`
 * after that word, an exhausted-search boot would be mis-reported as a lost
 * port race by an unrelated file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatExhaustedPortSearchNotice, getAvailablePort } from './serve.js';

/** Seeded from `import.meta.url`, the spelling `check:cross-package-test-inputs` recognises. */
const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** The live source, for the arms decided lexically rather than at runtime. */
const SERVE_SOURCE = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');

/**
 * Strip SGR escapes. `chalk` is inert under a non-TTY runner but not
 * guaranteed to be, and an assertion that only passes when colour happens to be
 * off is a flake waiting for the first person who runs this attached.
 */
const plain = (text: string): string => text.replace(/\u001B\[[0-9;]*m/g, '');

/** An arbitrary start port. Nothing is bound, so it only has to be a number. */
const START = 34_500;

/** A probe that never finds a free port — the exhausted path, without a socket. */
function alwaysBusy(): { probe: (port: number) => Promise<boolean>; probed: number[] } {
  const probed: number[] = [];
  return {
    probed,
    probe: async (port: number) => {
      probed.push(port);
      return false;
    },
  };
}

/** #12543's notice, as its landed text. Held against the source below so it cannot go stale. */
const DRIFT_NOTICE = /Port (\d+) is in use — serving on (\d+) instead\./;
/** #11113's production refusal — and the first of `PORT_TAKEN_PATTERNS`. */
const PRODUCTION_REFUSAL = /Port (\d+) is already in use/;

describe('#12620: an exhausted port search is announced, in the words the search threw', () => {
  it('ARM 1 — the notice CARRIES the thrown message verbatim, as its headline', async () => {
    const { probe } = alwaysBusy();

    const thrown = await getAvailablePort(START, probe).then(
      (port) => {
        throw new Error(`the search returned ${port} against a probe that never says yes`);
      },
      (err: unknown) => err,
    );

    expect(thrown, 'the exhausted search no longer throws').toBeInstanceOf(Error);
    const message = (thrown as Error).message;

    // Guard the guard: an empty message would make the assertion below
    // vacuously true.
    expect(message, 'the thrown message no longer names the start port').toContain(String(START));

    const notice = plain(formatExhaustedPortSearchNotice(START, thrown));

    // ⭐ The pin. Not "says something similar" — the error's own text, and as
    // the headline, so a reader meets it first rather than digging for it.
    expect(
      notice.split('\n').find((line) => line.includes('⚠')),
      'the notice paraphrases the thrown message instead of carrying it',
    ).toBe(`  ⚠ ${message}`);
  });

  it('ARM 1 — the width it reports is the width it actually probed, endpoints included', async () => {
    const { probe, probed } = alwaysBusy();
    const thrown = await getAvailablePort(START, probe).catch((err: unknown) => err);

    // ⚠️ The search is a plain contiguous `port++` walk. A neighbouring card
    // described it as skipping ports; it does not, and a notice written from
    // that reading would name a range it never looked at.
    expect(
      probed.every((port, i) => port === START + i),
      `the search is no longer contiguous: ${probed.slice(0, 5).join(',')}…`,
    ).toBe(true);
    expect(probed[0], 'the walk no longer starts where it was asked to').toBe(START);

    // ⭐ The anti-off-by-one arm, and the reason it compares against `probed`
    // rather than against a literal: an inaccurate number inside a diagnostic
    // that exists to be accurate would be this card's own defect. BOTH terms
    // are measured here — how many ports the walk touched, and the last one it
    // reached.
    const notice = plain(formatExhaustedPortSearchNotice(START, thrown));
    expect(notice).toContain(`${probed.length} ports (${START}–${probed[probed.length - 1]})`);
  });

  it('makes NO span claim for a rejection that is not an exhausted walk', async () => {
    // ⚠️ The `catch` in serve.ts catches every rejection, not only exhaustion.
    // `isPortAvailable` rejects synchronously with ERR_SOCKET_BAD_PORT for any
    // port outside 0–65535 — reachable when the walk crosses the ceiling, and
    // when `--port` text parses to NaN. Measured, not supposed: `net`'s
    // `listen()` throws for both, inside the probe's promise executor.
    //
    // ⭐ On those paths nothing was probed, so a body claiming a range would
    // print `NaN–NaN` and assert a search that never ran — an inaccurate
    // diagnostic inside the diagnostic added to stop exactly that.
    const badPort = new RangeError('options.port should be >= 0 and < 65536. Received NaN.');
    const notice = plain(formatExhaustedPortSearchNotice(Number.NaN, badPort));

    // The thrown text is still carried — that ruling does not bend by branch.
    expect(notice).toContain(badPort.message);
    // …but the claim that is false here is simply not made.
    expect(notice, 'a span was claimed for a search that never walked one').not.toMatch(
      /probed \d+ ports/,
    );
    expect(notice, 'the notice printed a NaN range').not.toContain('NaN–');

    // Anti-vacuity for the two negatives above: the real exhausted notice DOES
    // make both claims, so their absence here is a discrimination and not a
    // regex that stopped matching anything.
    const { probe } = alwaysBusy();
    const real = await getAvailablePort(START, probe).catch((err: unknown) => err);
    const exhausted = plain(formatExhaustedPortSearchNotice(START, real));
    expect(exhausted).toMatch(/probed \d+ ports/);
    expect(exhausted).toContain(`${START}–`);
  });

  it('ARM 2 — a search that SUCCEEDS returns, so the notice is unreachable on the drift path', async () => {
    // Busy at the requested port, free at the next one: the ordinary auto-shift.
    const probed: number[] = [];
    const port = await getAvailablePort(START, async (candidate) => {
      probed.push(candidate);
      return candidate !== START;
    });

    // The drift really is a drift — without this the arm proves nothing.
    expect(port, 'the probe did not produce a shift to discriminate against').not.toBe(START);
    expect(port).toBe(START + 1);
    expect(probed).toEqual([START, START + 1]);

    // ⭐ THE DISCRIMINATION. `getAvailablePort` RESOLVED, so the caller's
    // `catch` — the only place this notice is written — cannot run. The notice
    // is not merely absent on this path; it is unreachable.
    //
    // What fires instead is #12543's drift notice, guarded on
    // `port !== requestedPort`: true here, and false on the exhausted path,
    // where the assignment never happens at all. Both guards are read from the
    // live source rather than described.
    expect(SERVE_SOURCE, 'the notice moved out of the catch that guards it').toMatch(
      /catch \(searchExhausted\) \{[\s\S]*?printDiagnostic\(formatExhaustedPortSearchNotice\(requestedPort, searchExhausted\)\);/,
    );
    expect(SERVE_SOURCE, "#12543's drift notice is no longer gated on a real shift").toContain(
      'if (port !== requestedPort) {',
    );
    expect(SERVE_SOURCE, "#12543's drift wording moved; this file's discrimination is stale").toMatch(
      /Port \$\{requestedPort\} is in use — serving on \$\{port\} instead\./,
    );
  });

  it('ARM 3 — the notice is inside the auto-shift branch, so production never reaches it', () => {
    const autoShift = SERVE_SOURCE.indexOf('if (portAutoShiftAllowed) {');
    const productionBranch = SERVE_SOURCE.indexOf('} else if (!(await isPortAvailable(requestedPort)))');
    const noticeCallSite = SERVE_SOURCE.indexOf('printDiagnostic(formatExhaustedPortSearchNotice(');
    const productionLine = SERVE_SOURCE.indexOf('is already in use.');

    // Every anchor has to exist, or the ordering assertions below compare -1s
    // and pass while measuring nothing.
    expect(autoShift, 'the `portAutoShiftAllowed` branch head is gone').toBeGreaterThan(-1);
    expect(productionBranch, 'the production `else if` is gone').toBeGreaterThan(-1);
    expect(noticeCallSite, 'the exhausted-search notice has no call site').toBeGreaterThan(-1);
    expect(productionLine, 'the production in-use line is gone').toBeGreaterThan(-1);

    // ⭐ The notice sits between the branch head and the `else if`; the
    // production line sits after it. A production boot never enters the block
    // this notice lives in.
    expect(noticeCallSite).toBeGreaterThan(autoShift);
    expect(noticeCallSite).toBeLessThan(productionBranch);
    expect(productionLine).toBeGreaterThan(productionBranch);
  });

  it('ARM 3 — the sink is `printDiagnostic`, which is stderr (#7915 stdout purity)', () => {
    // `stdout` is the JSON-RPC channel whenever the stdio MCP transport is
    // mounted, which is what `serve-stdio-stdout-purity.e2e.test.ts` pins. A
    // diagnostic written anywhere else reds that suite from this file.
    expect(SERVE_SOURCE).toContain('printDiagnostic(formatExhaustedPortSearchNotice(');
    expect(SERVE_SOURCE, '`printDiagnostic` no longer writes to stderr').toMatch(
      /const printDiagnostic = \(text = ''\) => \{\s*\n\s*if \(!bootQuiet\) process\.stderr\.write/,
    );
  });

  it('MUTUAL EXCLUSION — the three notices cannot be mistaken for one another', async () => {
    const { probe } = alwaysBusy();
    const thrown = await getAvailablePort(START, probe).catch((err: unknown) => err);
    const notice = plain(formatExhaustedPortSearchNotice(START, thrown));

    expect(notice, "the exhausted notice reads as #12543's drift notice").not.toMatch(DRIFT_NOTICE);

    // ⚠️ Load-bearing beyond legibility: this pattern is the first of
    // `PORT_TAKEN_PATTERNS` in `test/helpers/serve-process.ts`, which every
    // spawner in this package uses to decide that a boot lost a port race.
    expect(notice, 'the exhausted notice reads as the production refusal').not.toMatch(
      PRODUCTION_REFUSAL,
    );

    // The other half of that helper's pattern.
    expect(notice, 'the notice now trips the EADDRINUSE contention pattern').not.toMatch(
      /EADDRINUSE[^\n]*?:(\d+)/,
    );

    // …and both patterns are live instruments, not dead regexes: each must
    // still match the text it was written for, or the two negatives above
    // prove nothing at all.
    expect('  ⚠ Port 3000 is in use — serving on 3001 instead.').toMatch(DRIFT_NOTICE);
    expect('  ✗ Port 3000 is already in use.').toMatch(PRODUCTION_REFUSAL);
  });

  it('carries a non-Error rejection intact rather than rendering it as [object Object]', () => {
    // The probe is injectable, so the seam can now reject with anything. The
    // ruling is to carry the text the seam produced, whatever it is.
    const notice = plain(formatExhaustedPortSearchNotice(START, 'probe socket exploded'));
    expect(notice).toContain('probe socket exploded');
    expect(notice).not.toContain('[object Object]');
  });
});
