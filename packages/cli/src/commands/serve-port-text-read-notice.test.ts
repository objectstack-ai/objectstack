// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12674 — when `os serve` reads a port as something other than what the text
 * says, it SAYS SO. The accept set is untouched.
 *
 * ## The defect
 *
 * `parseInt` is the reader, and #12662's ruling keeps it: no value that boots
 * today may be refused, because narrowing a published CLI's accepted input is a
 * contract decision. But `parseInt`'s tolerance changes the ANSWER, not just
 * the spelling. `os serve --port 3e3` binds port **3**. `--port 0x0BB8` binds
 * 3000. `--port 3000abc` binds 3000. The boot SUCCEEDS, on a port the operator
 * never named, and nothing anywhere says so.
 *
 * ⭐ The harm is not that a strange value is accepted — it is a server
 * listening somewhere nobody asked for. That is what the notice repairs, and it
 * repairs only that: behaviour is unchanged, byte for byte.
 *
 * ## Why this file binds no sockets
 *
 * The decision is made before any socket exists, so a test that needs one is
 * testing the wrong layer — the ruling `serve-port-validation.test.ts` and
 * `serve-exhausted-port-search-notice.test.ts` both record, for the measured
 * reason (#12441: real-port contention took a full CLI suite red in this shared
 * container). Everything below drives exported pure functions and the live
 * source text. Zero sockets, zero spawns.
 *
 * ## THE THREE-WAY DISCRIMINATION (the anti-vacuity requirement)
 *
 * A pin asserting only "a mismatch prints a notice" is just as green against an
 * implementation that prints unconditionally. Three arms, each decidable at
 * runtime at the same seam:
 *
 *  1. **mismatch** (`3e3` → 3, `0x0BB8` → 3000) → a notice naming BOTH the text
 *     and the port it selected.
 *  2. **agreement** (`3000`, `" 3000"`, `"+3000"`, `"08080"`) → `null`. ⭐ This
 *     is the arm the whole card turns on: `" 3000"` is what production `PORT`
 *     values look like, and a notice there would drone at every ordinary boot.
 *  3. **not a port at all** (`abc`, `99999`) → #12662's REFUSAL owns it, and
 *     this notice is unreachable — the guard exits the process above the call
 *     site. Pinned both ways: `parseRequestedPort` returns `null` for those
 *     values, and the call site is lexically downstream of that exit.
 *
 * The three must not overlap or swallow one another, so the mutual-exclusion
 * arm covers all four port notices this command now carries — one pair of which
 * is load-bearing beyond legibility: `PORT_TAKEN_PATTERNS` in
 * `test/helpers/serve-process.ts` turns two of them into a "port contention"
 * verdict for every spawner in this package.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseRequestedPort,
  strictPortReading,
  portTextReadNotice,
  formatInvalidPortNotice,
  type PortInputSource,
// Moved out of `serve.ts` by #12673: the port contract is now ONE module that
// `dev`, `start` and `serve` all import, so this suite reads it from its home
// rather than through the command that used to declare it. The assertions are
// unchanged — only the path is.
} from '../utils/port-contract.js';

/** Seeded from `import.meta.url`, the spelling `check:cross-package-test-inputs` recognises. */
const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** The live source, for the arms decided lexically rather than at runtime. */
const SERVE_SOURCE = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');

/**
 * Strip SGR escapes — `chalk` is inert under a non-TTY runner but not
 * guaranteed to be, and an assertion that only passes with colour off is a
 * flake waiting for the first person who runs this attached. The ESC byte is
 * built with `String.fromCharCode` because this repo refuses raw control bytes
 * in source (`check:nul-bytes`).
 */
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const plain = (text: string): string => text.replace(SGR, '');

/**
 * Does `notice` name this exact source spelling?
 *
 * ⚠️ The anchor is WIDENED rather than the assertion loosened, for the trap
 * `serve-port-validation.test.ts` measured on its own arm: `OS_PORT="3e3"`
 * CONTAINS `PORT="3e3"`, so a plain `toContain`/`not.toContain` pair reports
 * the OS_PORT notice as also naming PORT. A preceding `_` disqualifies the
 * match; a message that really did name both would still carry a `PORT=` with
 * no `_` in front of it and would still be caught.
 */
const names = (notice: string, spelled: string): boolean =>
  new RegExp(`(?<!_)${spelled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(notice);

/**
 * Every spelling `parseRequestedPort` ACCEPTS, and whether the text says the
 * port that came out of it.
 *
 * MEASURED on this checkout with `node -e`, Node v22.22.2 — `parsed` is
 * `parseInt(raw)`, unchanged by this card:
 *
 * ```
 *   " 3000" → 3000   "3000 " → 3000   "+3000"  → 3000   "08080"   → 8080
 *   "3e3"   → 3      "1e10"  → 1      "0x0BB8" → 3000   "3000.0"  → 3000
 *   "0b111" → 0      "0o17"  → 0      "1_000"  → 1      "3000abc" → 3000
 * ```
 *
 * `saysIt` is this card's whole precision: whether a reader looking at the text
 * would name the port that was selected. Whitespace, a leading `+` and leading
 * zeros do not change what the text says; an exponent, a radix prefix, a
 * fraction, a separator and trailing text all do.
 */
const ACCEPTED: Array<{ raw: string; parsed: number; saysIt: boolean; note?: string }> = [
  { raw: '3000', parsed: 3000, saysIt: true },
  { raw: '0', parsed: 0, saysIt: true, note: 'kernel-assigned, and legal' },
  { raw: '65535', parsed: 65535, saysIt: true, note: 'the ceiling itself' },
  { raw: ' 3000', parsed: 3000, saysIt: true, note: 'production env vars carry whitespace' },
  { raw: '3000 ', parsed: 3000, saysIt: true, note: 'and on the other side' },
  { raw: '+3000', parsed: 3000, saysIt: true },
  { raw: '08080', parsed: 8080, saysIt: true, note: 'no leading-zero octal since ES5' },
  { raw: '3e3', parsed: 3, saysIt: false, note: "the card's own repro — binds 3, not 3000" },
  { raw: '1e10', parsed: 1, saysIt: false },
  { raw: '0x0BB8', parsed: 3000, saysIt: false, note: 'hex, and `Number()` agrees with parseInt here' },
  { raw: '3000.0', parsed: 3000, saysIt: false },
  { raw: '3000abc', parsed: 3000, saysIt: false, note: 'trailing text discarded' },
  { raw: '0b111', parsed: 0, saysIt: false, note: 'binds 0 — a kernel-assigned port, from text saying 7' },
  { raw: '0o17', parsed: 0, saysIt: false },
  { raw: '1_000', parsed: 1, saysIt: false, note: 'separator: binds 1' },
];

/** What #12662's refusal owns, and this notice must never reach. */
const REFUSED = ['abc', '', '   ', '65536', '99999', '-1'];

describe('#12674: a port read as something other than what the text says is announced', () => {
  it('guards its own table first — every row is still what `parseInt` produces, and still ACCEPTED', () => {
    // Without this, a drift in `parseInt` (or in the validator) would leave
    // every verdict below measuring something else while still passing.
    for (const { raw, parsed, note } of ACCEPTED) {
      const label = `${JSON.stringify(raw)}${note ? ` (${note})` : ''}`;
      expect(parseInt(raw), `the table's parseInt record is stale for ${label}`).toBe(parsed);
      expect(
        parseRequestedPort(raw),
        `${label} is no longer accepted — this row belongs to the refusal, not here`,
      ).toBe(parsed);
    }

    // Anti-vacuity for every loop over the table: both verdicts must occur in
    // it, or a table that drifted to all-mismatch (or all-agree) would prove
    // nothing while staying green.
    expect(ACCEPTED.filter((row) => row.saysIt).length).toBeGreaterThan(1);
    expect(ACCEPTED.filter((row) => !row.saysIt).length).toBeGreaterThan(1);
  });

  it('ARMS 1+2 — the notice fires on a difference and is SILENT on agreement, whole table', () => {
    for (const { raw, parsed, saysIt, note } of ACCEPTED) {
      const label = `${JSON.stringify(raw)}${note ? ` (${note})` : ''}`;
      const notice = portTextReadNotice(raw, '--port', parsed);

      if (saysIt) {
        // THE NOISE PIN. `" 3000"` is the shape of an ordinary production
        // `PORT`; a notice here fires at every boot of every deployment whose
        // env var carries whitespace.
        expect(notice, `${label} reads as the port it selected, yet is announced`).toBeNull();
      } else {
        expect(notice, `${label} was read as ${parsed} in silence`).not.toBeNull();
        // Both facts, not one. The operator has neither: the bound port alone
        // is what the ready banner already prints, and the text alone is what
        // they typed.
        const shown = plain(notice as string);
        expect(shown, `${label}: the notice does not quote the text`).toContain(JSON.stringify(raw));
        expect(shown, `${label}: the notice does not name the port it selected`).toContain(
          `port ${parsed}`,
        );
      }
    }
  });

  it('ARM 1 — names the input that was used, and not the others', () => {
    const cases: Array<{ source: PortInputSource; expected: string }> = [
      { source: '--port', expected: '--port "3e3"' },
      { source: 'PORT', expected: 'PORT="3e3"' },
      { source: 'OS_PORT', expected: 'OS_PORT="3e3"' },
    ];

    for (const { source, expected } of cases) {
      const notice = plain(portTextReadNotice('3e3', source, 3) as string);
      expect(notice, `the notice does not name ${source}`).toContain(expected);
      expect(names(notice, expected), `the ${source} spelling is not matchable`).toBe(true);

      // The discrimination, not merely the presence — a notice listing all
      // three would satisfy every assertion above while leaving the operator to
      // work out which one is theirs, which is the defect one level up.
      for (const other of cases) {
        if (other.source === source) continue;
        expect(
          names(notice, other.expected),
          `the notice for ${source} also names ${other.source}`,
        ).toBe(false);
      }
    }
  });

  it('ARM 1 — names the input the same way the refusal does, from one speller', () => {
    // Two notices, one input, one spelling. A second hand-written copy is free
    // to drift, and an operator who cannot recognise what they typed is the
    // defect both notices exist to fix.
    for (const source of ['--port', 'PORT', 'OS_PORT'] as PortInputSource[]) {
      const refusal = plain(formatInvalidPortNotice('3e3', source));
      const read = plain(portTextReadNotice('3e3', source, 3) as string);
      const spelled = source === '--port' ? '--port "3e3"' : `${source}="3e3"`;
      expect(refusal).toContain(spelled);
      expect(read, `the two notices spell ${source} differently`).toContain(spelled);
    }
  });

  it('ARM 1 — states the port SELECTED, never a second reading of the text', () => {
    // `3e3` looks like 3000 to a reader; `0b111` looks like 7; `1_000` looks
    // like 1000. The notice reports what was selected and refuses to guess what
    // was meant — a guess is wrong the first time it meets text that has no
    // second reading, and `3000abc` is that text.
    const apparent = Number('0b111');
    expect(apparent, 'the arm is measuring the wrong thing').toBe(7);

    const notice = plain(portTextReadNotice('0b111', '--port', 0) as string);
    expect(notice).toContain('port 0');
    expect(notice, 'the notice invented a value the operator might have meant').not.toContain(
      String(apparent),
    );
  });

  it('ARM 3 — a value that cannot be a port belongs to the REFUSAL, and never reaches this notice', () => {
    for (const raw of REFUSED) {
      expect(
        parseRequestedPort(raw),
        `${JSON.stringify(raw)} is accepted, so the two paths now overlap`,
      ).toBeNull();
    }

    // …and structurally: the guard exits the process above this call site, so
    // no refused value can reach it. Anchors first — missing ones would leave
    // the ordering assertions comparing -1s and passing while measuring nothing.
    const refusal = SERVE_SOURCE.indexOf('printDiagnostic(formatInvalidPortNotice(flags.port, portSource));');
    const exit = SERVE_SOURCE.indexOf('this.exit(1);', refusal);
    const callSite = SERVE_SOURCE.indexOf(
      'const textReadNotice = portTextReadNotice(flags.port, portSource, requestedPort);',
    );
    const autoShift = SERVE_SOURCE.indexOf('if (portAutoShiftAllowed) {');

    expect(refusal, "the refusal's call site is gone").toBeGreaterThan(-1);
    expect(exit, 'the refusal no longer exits').toBeGreaterThan(-1);
    expect(callSite, 'this notice has no call site').toBeGreaterThan(-1);
    expect(autoShift, 'the `portAutoShiftAllowed` branch head is gone').toBeGreaterThan(-1);

    expect(exit, 'the notice can now be reached by a value that was refused').toBeLessThan(callSite);
    // And ahead of the port policy, so it states the port that was ASKED FOR
    // while #12543's drift notice states the one taken instead.
    expect(callSite).toBeLessThan(autoShift);
  });

  it('prints only when there IS something to say — the call site is the `if`', () => {
    // ARM 2 returns `null`, and this is what makes that arm mean anything end
    // to end: an unconditional `printDiagnostic(portTextReadNotice(...))` would
    // write the string `null` at every boot.
    expect(SERVE_SOURCE).toContain('if (textReadNotice) printDiagnostic(textReadNotice);');
  });

  it('writes through `printDiagnostic`, which is stderr (#7915 stdout purity)', () => {
    // `stdout` is the JSON-RPC channel whenever the stdio MCP transport is
    // mounted, which is what `serve-stdio-stdout-purity.e2e.test.ts` pins. A
    // notice written anywhere else reds that suite from this file.
    expect(SERVE_SOURCE, '`printDiagnostic` no longer writes to stderr').toMatch(
      /const printDiagnostic = \(text = ''\) => \{\s*\n\s*if \(!bootQuiet\) process\.stderr\.write/,
    );
  });

  it('MUTUAL EXCLUSION — cannot be mistaken for the three notices it sits beside', () => {
    const notice = plain(portTextReadNotice('3e3', 'PORT', 3) as string);

    /** #12543's drift notice. */
    const DRIFT_NOTICE = /Port (\d+) is in use — serving on (\d+) instead\./;
    /** #11113's production refusal — and the first of `PORT_TAKEN_PATTERNS`. */
    const PRODUCTION_REFUSAL = /Port (\d+) is already in use/;
    /** #12662's refusal. */
    const INVALID_REFUSAL = /Invalid port:/;
    /** This one. */
    const READ_NOTICE = /was read as port (\d+)\./;

    expect(notice, "the read notice reads as #12543's drift notice").not.toMatch(DRIFT_NOTICE);
    expect(notice, 'the read notice reads as the production refusal').not.toMatch(
      PRODUCTION_REFUSAL,
    );
    expect(notice, "the read notice reads as #12662's refusal — it refuses nothing").not.toMatch(
      INVALID_REFUSAL,
    );

    // Load-bearing beyond legibility: `PORT_TAKEN_PATTERNS` in
    // `test/helpers/serve-process.ts` turns two of these into a "port
    // contention" verdict for every spawner in this package. A notice tripping
    // one would report a healthy boot as a lost port race.
    expect(notice, 'the read notice now trips the EADDRINUSE contention pattern').not.toMatch(
      /EADDRINUSE[^\n]*?:(\d+)/,
    );
    expect(notice, "the read notice claims a span it never walked (#12620's notice)").not.toMatch(
      /probed/,
    );

    // …and the other way: the three siblings must not read as THIS one, or the
    // exclusion is only half measured.
    expect(plain(formatInvalidPortNotice('abc', 'PORT')), "#12662's refusal reads as this notice")
      .not.toMatch(READ_NOTICE);
    expect('  Port 3000 is in use — serving on 3001 instead.').not.toMatch(READ_NOTICE);
    expect('  Port 3000 is already in use.').not.toMatch(READ_NOTICE);

    // …and every pattern above is a live instrument, not a dead regex: each
    // still matches the text it was written for, or the negatives prove nothing.
    expect(notice).toMatch(READ_NOTICE);
    expect('  Port 3000 is in use — serving on 3001 instead.').toMatch(DRIFT_NOTICE);
    expect('  Port 3000 is already in use.').toMatch(PRODUCTION_REFUSAL);
    expect(plain(formatInvalidPortNotice('abc', 'PORT'))).toMatch(INVALID_REFUSAL);
  });

  it('draws the boundary on the TRIMMED text, and not with `Number()`', () => {
    // The two halves of the line, each stated as the thing that breaks if it
    // moves. Whitespace first: this is the shape production `PORT` values have.
    expect(strictPortReading(' 3000'), 'whitespace now counts as a difference').toBe(3000);
    expect(strictPortReading('3000 ')).toBe(3000);
    expect(strictPortReading('+3000')).toBe(3000);
    expect(strictPortReading('08080')).toBe(8080);

    // …and the near-miss implementation, named because it is the one a reader
    // would reach for: `Number()` AGREES with `parseInt` on a hex literal, so a
    // boundary built on it would be blind to `0x0BB8` — one of the two
    // coercions this card exists to see.
    expect(Number('0x0BB8'), 'the near-miss is no longer a near-miss').toBe(parseInt('0x0BB8'));
    expect(strictPortReading('0x0BB8'), '`0x0BB8` now reads as a plain decimal').toBeNull();
    expect(portTextReadNotice('0x0BB8', '--port', 3000), 'the hex case went silent').not.toBeNull();

    // …and the other direction, where `Number()` disagrees with `parseInt`:
    // the text a reader would call 3000, selecting port 3.
    expect(Number('3e3')).toBe(3000);
    expect(parseInt('3e3')).toBe(3);
    expect(strictPortReading('3e3')).toBeNull();
  });
});
