/**
 * Reading a spawned child's verdict WITHOUT depending on how it prints.
 *
 * objectui#7897. A test that spawns a child process and matches a regex against
 * the child's human-readable stdout has two independent failure modes, and both
 * of them are silent where it matters:
 *
 *   1. **Colour.** Under GitHub Actions a child that colours its output puts SGR
 *      sequences INSIDE the text being matched, so `\s+` — and any pattern that
 *      spans two coloured spans — stops matching. The assertion is green on
 *      every local run and red only in CI, which is the expensive direction: it
 *      is discovered by burning a CI cycle on an unrelated PR. Measured on
 *      objectui PR #7889 (CI run 34003883330, job 101407488095).
 *   2. **A count that admits zero.** `\d+ cases pass` matches `0 cases pass`.
 *      An assertion shaped that way does not discriminate "the child ran its
 *      cases" from "the child's case table is empty" — it reads as a pin while
 *      being satisfied by the outcome it exists to refuse. Nothing in CI catches
 *      that, ever, because the assertion passes.
 *
 * The rule this module encodes: read a NUMBER out of the child's verdict and
 * assert on the number. ANSI stripping is the second belt, applied here so no
 * caller has to remember it — the repo's own gates do not colour (measured on
 * `01c27c431`: no ANSI in any `scripts/*.mjs`), but a caller cannot tell that
 * from the call site, and `scripts/shadcn-sync.js` in this same tree colours
 * unconditionally.
 */

/**
 * ANSI SGR sequences, built from the escape's CODE POINT. A raw control byte in
 * this source is exactly what `pnpm check:control-bytes` exists to refuse.
 */
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** The child's output with every SGR sequence removed. */
export function stripAnsi(text: string): string {
  return text.replace(SGR, '');
}

/**
 * Pull a single count out of a child's verdict line.
 *
 * Throws — rather than returning a default — when the pattern does not match:
 * a missing verdict means the child did not do what the caller thinks it did,
 * and a `0` returned quietly there would be indistinguishable from a real zero.
 * The whole output rides on the error so the failure names itself.
 *
 * @param output  the child's stdout (and stderr, if the caller joined them)
 * @param pattern a regex with exactly ONE capturing group, the digits
 * @param what    what the number counts, for the error message
 */
export function verdictCount(output: string, pattern: RegExp, what: string): number {
  const plain = stripAnsi(output);
  const match = plain.match(pattern);
  if (!match) {
    throw new Error(`no ${what} in the child's verdict -- ${pattern} did not match:\n${plain}`);
  }
  return Number(match[1]);
}

/**
 * The number of cases a repo gate's `--self-test` reports passing.
 *
 * Every gate in this tree ends its self-test with `<gate> self-test: N cases
 * pass`, some prefixed `✓`, one prefixed `OK`. The prefix is presentation and is
 * deliberately not matched.
 */
export function selfTestCases(output: string, gate: string): number {
  const escaped = gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return verdictCount(output, new RegExp(`${escaped} self-test: (\\d+) cases pass`), `${gate} self-test case count`);
}
