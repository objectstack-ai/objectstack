// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12662 — a port value that cannot be a port is refused HERE, in the
 * operator's own vocabulary, instead of dying at the socket layer.
 *
 * ## The defect
 *
 * `--port` was a `Flags.string` whose only consumer was a bare
 * `parseInt(flags.port)`. `--port abc` therefore became `NaN`, travelled the
 * whole port policy, and reached the real `listen()`, which refused it with
 * `ERR_SOCKET_BAD_PORT: options.port should be >= 0 and < 65536` — an error
 * naming an internal option, raised from a code path with no connection to the
 * flag the operator typed. `--port 99999` parses fine and died identically.
 * `PORT=abc` and `OS_PORT=abc` are the same defect through a different door.
 *
 * ## Why this file binds no sockets
 *
 * Validation belongs BEFORE the socket, so a test that needs a socket to
 * observe it is testing the wrong layer. Everything below drives the three
 * exported pure functions and the live source text. Zero sockets, zero spawns —
 * the ruling `serve-exhausted-port-search-notice.test.ts` records for its own
 * path, for the same measured reason (#12441: real-port contention took a full
 * CLI suite red in this container).
 *
 * ## The arms, and what each one actually decides
 *
 *  1. **The three reported inputs** — `--port`, `PORT`, `OS_PORT` — are each
 *     refused, and the refusal NAMES the one that was used. A refusal saying
 *     only "invalid port" would repeat this card's own defect one level up.
 *  2. **The bounds are the measured bounds.** `0` is accepted (it is a real
 *     request — `listen(0)` binds a kernel-assigned port), and the ceiling is
 *     65535, not the 65536 the kernel's message names.
 *  3. **Nothing that boots today is refused.** The `TODAY` table is the
 *     executable form of that claim, and it is the arm that fails the moment
 *     someone "tightens" this to what `Flags.integer` accepts — which refuses
 *     `" 3000"`, `"3000.0"`, `"0x0BB8"`, `"+3000"` and `"3e3"`, every one of
 *     which boots a server today. That would narrow a published CLI's accepted
 *     input, which is a contract question and not this card's to answer; this
 *     arm is where such a change has to come and argue.
 *  4. **The range the message states is the range the code enforces** — read
 *     back out of the validator rather than out of a constant, so a
 *     hand-written second copy of either bound reds here.
 *  5. **The source naming mirrors `readEnvWithDeprecation`** and is pinned
 *     against it, empty-string case included.
 *  6. **Placement**, decided against the live source: the guard precedes the
 *     `portAutoShiftAllowed` branch, so all three boot paths are downstream of
 *     one check, and it writes through `printDiagnostic` (stderr, #7915).
 *  7. **Mutual exclusion** from the three sibling port notices — two of those
 *     patterns are `PORT_TAKEN_PATTERNS` in `test/helpers/serve-process.ts`,
 *     which every spawner in this package uses to decide a boot lost a port
 *     race. A refusal tripping them would be mis-reported as contention.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvWithDeprecation } from '@objectstack/types';

import {
  parseRequestedPort,
  describePortSource,
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
 * Strip SGR escapes. `chalk` is inert under a non-TTY runner but not guaranteed
 * to be, and an assertion that only passes when colour happens to be off is a
 * flake waiting for the first person who runs this attached.
 *
 * The ESC byte is built with `String.fromCharCode` rather than written: this
 * repo refuses raw control bytes in source (`check:nul-bytes`), and an escape
 * spelling inside a regex literal is exactly the thing an editing tool
 * materialises into a real byte.
 */
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const plain = (text: string): string => text.replace(SGR, '');

/**
 * What `os serve` does with each spelling TODAY, on `main`, before this change.
 *
 * `parsed` is `parseInt(raw)` — the reader this card keeps. `bindsToday` is
 * whether that number reaches a bound socket, MEASURED with
 * `net.createServer().listen(v)` on this checkout (Node v22.22.2):
 *
 * ```
 *   listen(0)     → OK (bound 43025, kernel-assigned)   listen(65536) → ERR_SOCKET_BAD_PORT
 *   listen(3)     → OK                                  listen(99999) → ERR_SOCKET_BAD_PORT
 *   listen(65535) → OK                                  listen(-1)    → ERR_SOCKET_BAD_PORT
 *                                                       listen(NaN)   → ERR_SOCKET_BAD_PORT
 * ```
 *
 * `3e3` is in this table on purpose and its `parsed` is **3**, not 3000:
 * `parseInt` stops at the `e`. That boot succeeds today on a port the operator
 * never named — a silent coercion, a different defect from this one, and
 * preserved here rather than repaired, because repairing it would narrow what
 * boots.
 */
/**
 * Does `notice` name this exact source spelling?
 *
 * Substring containment is not enough in one direction, and it is not a
 * quibble: `OS_PORT="abc"` CONTAINS `PORT="abc"`, so a plain
 * `toContain`/`not.toContain` pair reports the OS_PORT refusal as ALSO naming
 * PORT — measured, it reds this file's first arm. The anchor is WIDENED (a
 * preceding `_` disqualifies the match) rather than the assertion loosened: a
 * message that really did name both sources would still carry a `PORT=` with no
 * `_` in front of it, and would still be caught.
 */
const names = (notice: string, spelled: string): boolean =>
  new RegExp(`(?<!_)${spelled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(notice);

const TODAY: Array<{ raw: string; parsed: number; bindsToday: boolean; note?: string }> = [
  { raw: '3000', parsed: 3000, bindsToday: true },
  { raw: '0', parsed: 0, bindsToday: true, note: 'kernel-assigned — legal, and a floor of 1 would refuse it' },
  { raw: '1', parsed: 1, bindsToday: true },
  { raw: '65535', parsed: 65535, bindsToday: true, note: 'the ceiling itself' },
  { raw: ' 3000', parsed: 3000, bindsToday: true, note: 'production env vars carry whitespace' },
  { raw: '3000 ', parsed: 3000, bindsToday: true },
  { raw: '3000.0', parsed: 3000, bindsToday: true },
  { raw: '0x0BB8', parsed: 3000, bindsToday: true },
  { raw: '+3000', parsed: 3000, bindsToday: true },
  { raw: '08080', parsed: 8080, bindsToday: true },
  { raw: '3e3', parsed: 3, bindsToday: true, note: 'binds 3, NOT 3000 — preserved, not repaired' },
  { raw: 'abc', parsed: Number.NaN, bindsToday: false, note: "the card's own repro" },
  { raw: '', parsed: Number.NaN, bindsToday: false, note: "OS_PORT='' is DEFINED, so no fallback to 3000" },
  { raw: '   ', parsed: Number.NaN, bindsToday: false },
  { raw: '65536', parsed: 65536, bindsToday: false, note: "the kernel's own `< 65536`, off by one" },
  { raw: '99999', parsed: 99999, bindsToday: false, note: "the card's second repro" },
  { raw: '-1', parsed: -1, bindsToday: false },
];

describe('#12662: an invalid port is refused before the socket, naming what the operator set', () => {
  afterEach(() => {
    delete process.env.OS_PORT;
    delete process.env.PORT;
  });

  it('refuses the three reported inputs, and NAMES the one that was used', () => {
    const cases: Array<{ source: PortInputSource; expected: string }> = [
      { source: '--port', expected: '--port "abc"' },
      { source: 'PORT', expected: 'PORT="abc"' },
      { source: 'OS_PORT', expected: 'OS_PORT="abc"' },
    ];

    expect(parseRequestedPort('abc'), '`abc` is no longer refused').toBeNull();

    for (const { source, expected } of cases) {
      const notice = plain(formatInvalidPortNotice('abc', source));
      expect(notice, `the refusal does not name ${source}`).toContain(expected);
      expect(names(notice, expected), `the ${source} spelling is not matchable`).toBe(true);

      // The discrimination, not merely the presence: naming ONE source means
      // not naming the others. Without this, a message listing all three
      // ("--port / PORT / OS_PORT is invalid") would satisfy every assertion
      // above while repeating the defect the card is about — the operator would
      // still have to work out which one is theirs.
      for (const other of cases) {
        if (other.source === source) continue;
        expect(
          names(notice, other.expected),
          `the refusal for ${source} also names ${other.source}`,
        ).toBe(false);
      }
    }
  });

  it('keeps `--port 99999` from the socket the way `--port abc` is kept from it', () => {
    // The card's second repro: numerically fine, unbindable, and today it dies
    // at the same place with the same raw error.
    expect(parseRequestedPort('99999')).toBeNull();
    const notice = plain(formatInvalidPortNotice('99999', '--port'));
    expect(notice).toContain('--port "99999"');
    // The refusal must not read as a typo diagnosis: the value IS a number.
    expect(notice).toContain('65535');
  });

  it('accepts the MEASURED bounds — 0 is a request, and the ceiling is 65535', () => {
    // `0` is the trap in the low direction. `listen(0)` binds a kernel-assigned
    // port, so `os serve --port 0` boots today; a floor of 1 would have refused
    // a working input in the name of validating it.
    expect(parseRequestedPort('0'), '0 is no longer accepted — a working input was refused').toBe(0);

    // And the high one: the kernel's own message says `< 65536`, an exclusive
    // bound. The largest port that binds is one less.
    expect(parseRequestedPort('65535')).toBe(65535);
    expect(
      parseRequestedPort('65536'),
      '65536 was taken from the message instead of measured',
    ).toBeNull();
    expect(parseRequestedPort('-1')).toBeNull();
  });

  it('refuses NOTHING that boots today — the whole table, both directions', () => {
    for (const { raw, parsed, bindsToday, note } of TODAY) {
      const label = `${JSON.stringify(raw)}${note ? ` (${note})` : ''}`;

      // Guard the table first. If `parseInt` ever stopped producing these
      // values, every verdict below would be measuring something else while
      // still passing.
      if (Number.isNaN(parsed)) {
        expect(parseInt(raw), `the table's parseInt record is stale for ${label}`).toBeNaN();
      } else {
        expect(parseInt(raw), `the table's parseInt record is stale for ${label}`).toBe(parsed);
      }

      const verdict = parseRequestedPort(raw);
      if (bindsToday) {
        // THE ANTI-NARROWING PIN. Not "is not null" — the SAME port, so a
        // repair that accepts the value but re-interprets it is caught too.
        expect(
          verdict,
          `${label} boots today and is now refused — this narrows the accepted input`,
        ).toBe(parsed);
      } else {
        expect(
          verdict,
          `${label} dies at listen() today and is still not refused here`,
        ).toBeNull();
      }
    }

    // Anti-vacuity for the loop: both verdicts have to occur in it, or a table
    // that drifted to all-accept (or all-refuse) would pass silently.
    expect(TODAY.filter((row) => row.bindsToday).length).toBeGreaterThan(1);
    expect(TODAY.filter((row) => !row.bindsToday).length).toBeGreaterThan(1);
  });

  it('states the range it ENFORCES — read back from the validator, not from a constant', () => {
    // The bounds are recovered by ASKING the validator, so this arm cannot be
    // satisfied by a message that hand-wrote its own copy of them — the failure
    // mode this card's own family (#12620's `PORT_SEARCH_SPAN`) exists to
    // prevent. Import the constants and the pin would only prove the message
    // agrees with itself.
    let floor: number | null = null;
    let ceiling: number | null = null;
    for (let candidate = -1; candidate <= 65_540; candidate++) {
      if (parseRequestedPort(String(candidate)) === null) continue;
      if (floor === null) floor = candidate;
      ceiling = candidate;
    }

    expect(floor, 'the validator accepts nothing at all').not.toBeNull();
    expect(ceiling).not.toBeNull();

    const notice = plain(formatInvalidPortNotice('abc', '--port'));
    expect(
      notice,
      `the message names a range other than the enforced ${floor}-${ceiling}`,
    ).toContain(`from ${floor} to ${ceiling}`);
  });

  it('names the env var by the same precedence `readEnvWithDeprecation` reads it', () => {
    // `describePortSource` MIRRORS that precedence, and a mirror drifts. This is
    // the pin: for every combination, the name the refusal would print is the
    // name the value actually came from.
    const combinations: Array<{ OS_PORT?: string; PORT?: string }> = [
      { OS_PORT: '9001', PORT: '9002' },
      { OS_PORT: '9001' },
      { PORT: '9002' },
      // The case a truthiness check gets wrong: an empty `OS_PORT` is DEFINED,
      // so it wins, and `readEnvWithDeprecation` returns `''` rather than
      // falling through to `PORT` (or to the 3000 default).
      { OS_PORT: '', PORT: '9002' },
    ];

    for (const combination of combinations) {
      delete process.env.OS_PORT;
      delete process.env.PORT;
      Object.assign(process.env, combination);

      const source = describePortSource(true, process.env);
      const value = readEnvWithDeprecation('OS_PORT', 'PORT', { silent: true });

      expect(source, `no env var named for ${JSON.stringify(combination)}`).not.toBe(
        'the built-in default',
      );
      expect(
        process.env[source as 'OS_PORT' | 'PORT'],
        `the refusal would name ${source}, but the value came from elsewhere`,
      ).toBe(value);
    }

    // The two ends of the discriminator itself.
    expect(describePortSource(false, { PORT: '9002' })).toBe('--port');
    expect(describePortSource(true, {})).toBe('the built-in default');
  });

  it('sits ahead of the port policy, so all three boot paths are downstream of one check', () => {
    const guard = SERVE_SOURCE.indexOf('const parsedPort = parseRequestedPort(flags.port);');
    const autoShift = SERVE_SOURCE.indexOf('if (portAutoShiftAllowed) {');
    const productionBranch = SERVE_SOURCE.indexOf(
      '} else if (!(await isPortAvailable(requestedPort)))',
    );

    // Every anchor has to exist, or the ordering assertions below compare -1s
    // and pass while measuring nothing.
    expect(guard, 'the port guard has no call site').toBeGreaterThan(-1);
    expect(autoShift, 'the `portAutoShiftAllowed` branch head is gone').toBeGreaterThan(-1);
    expect(productionBranch, 'the production `else if` is gone').toBeGreaterThan(-1);

    // The coverage argument, as an assertion: dev auto-shift, production, and
    // the boot that enters neither all run AFTER this line. A guard that
    // migrated into either branch would cover that branch alone — precisely
    // what a `Flags.integer` repair could not fix for `PORT`/`OS_PORT` either.
    expect(guard).toBeLessThan(autoShift);
    expect(guard).toBeLessThan(productionBranch);

    // …and it refuses before anything binds: the first probe of the requested
    // port sits inside the branch that follows the guard.
    expect(SERVE_SOURCE.indexOf('await isPortAvailable(requestedPort)')).toBeGreaterThan(guard);
  });

  it('writes the refusal through `printDiagnostic`, which is stderr (#7915 stdout purity)', () => {
    // `stdout` is the JSON-RPC channel whenever the stdio MCP transport is
    // mounted, which is what `serve-stdio-stdout-purity.e2e.test.ts` pins. A
    // refusal written anywhere else reds that suite from this file.
    expect(SERVE_SOURCE).toContain(
      'printDiagnostic(formatInvalidPortNotice(flags.port, portSource));',
    );
    expect(SERVE_SOURCE, '`printDiagnostic` no longer writes to stderr').toMatch(
      /const printDiagnostic = \(text = ''\) => \{\s*\n\s*if \(!bootQuiet\) process\.stderr\.write/,
    );
  });

  it('cannot be mistaken for the three notices it sits beside', () => {
    const notice = plain(formatInvalidPortNotice('abc', 'PORT'));

    /** #12543's drift notice. */
    const DRIFT_NOTICE = /Port (\d+) is in use — serving on (\d+) instead\./;
    /** #11113's production refusal — and the first of `PORT_TAKEN_PATTERNS`. */
    const PRODUCTION_REFUSAL = /Port (\d+) is already in use/;

    expect(notice, "the invalid-port refusal reads as #12543's drift notice").not.toMatch(
      DRIFT_NOTICE,
    );
    expect(notice, 'the invalid-port refusal reads as the production refusal').not.toMatch(
      PRODUCTION_REFUSAL,
    );

    // Load-bearing beyond legibility: `PORT_TAKEN_PATTERNS` in
    // `test/helpers/serve-process.ts` turns these into a "port contention"
    // verdict for every spawner in this package. A refusal that tripped one
    // would be reported as a lost port race — a boot failing for a reason it
    // did not fail for.
    expect(notice, 'the refusal now trips the EADDRINUSE contention pattern').not.toMatch(
      /EADDRINUSE[^\n]*?:(\d+)/,
    );
    expect(notice, "the refusal claims a span it never walked (#12620's notice)").not.toMatch(
      /probed/,
    );

    // …and the patterns are live instruments, not dead regexes: each must still
    // match the text it was written for, or the negatives prove nothing.
    expect('  Port 3000 is in use — serving on 3001 instead.').toMatch(DRIFT_NOTICE);
    expect('  Port 3000 is already in use.').toMatch(PRODUCTION_REFUSAL);
  });

  it('renders the raw text so whitespace and control bytes are visible, not pasted', () => {
    // The whitespace case is the one an operator stares at without seeing. It is
    // also NOT refused (see the table) — this covers only how a value that IS
    // refused is shown.
    expect(plain(formatInvalidPortNotice(' abc ', 'PORT'))).toContain('PORT=" abc "');

    // A control byte is escaped rather than written to the terminal. Built with
    // `String.fromCharCode` so this file carries no raw control byte itself.
    const withControlByte = `30${String.fromCharCode(0)}0`;
    expect(plain(formatInvalidPortNotice(withControlByte, 'PORT'))).toContain('\\u0000');
  });
});
