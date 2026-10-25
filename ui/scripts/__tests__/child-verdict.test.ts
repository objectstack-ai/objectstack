import { describe, expect, it } from 'vitest';

import { selfTestCases, stripAnsi, verdictCount } from './helpers/child-verdict';

/**
 * objectui#7897 — the reader that the child-spawning pin tests in this directory
 * share, pinned in the two directions it exists to close.
 *
 * Both directions are pinned against the OLD spelling as well as the new one.
 * A reader that only demonstrated the new spelling working would leave the next
 * person free to conclude the two are interchangeable — and they are not: that
 * is the entire content of this module.
 */

/** ANSI escapes built from the code point; a raw control byte here is refused by `pnpm check:control-bytes`. */
const E = String.fromCharCode(27);

describe('stripAnsi — the colour CI adds', () => {
  /**
   * The exact bytes from objectui PR #7889's failing CI job (run 34003883330,
   * job 101407488095), rebuilt from the escape's code point: under GitHub
   * Actions a child vitest colours its summary, so `Tests ` and `1 failed` are
   * separated by SGR sequences rather than by whitespace.
   */
  const AS_CI_PRINTED = `${E}[2m      Tests ${E}[22m ${E}[1m${E}[31m1 failed${E}[39m${E}[22m${E}[90m (1)${E}[39m`;

  it('the historical defect reproduces: the raw bytes do NOT match the prose regex', () => {
    expect(AS_CI_PRINTED, 'green locally, red only in CI -- the shape objectui#7897 sweeps').not.toMatch(
      /Tests\s+1 failed/,
    );
  });

  it('and the same bytes match once the SGR sequences are gone', () => {
    expect(stripAnsi(AS_CI_PRINTED)).toMatch(/Tests\s+1 failed/);
    expect(stripAnsi(AS_CI_PRINTED)).toBe('      Tests  1 failed (1)');
  });

  it('leaves output that carries no escape at all byte-identical', () => {
    const plain = '✓ check-doc-fence-languages self-test: 26 cases pass.\n';
    expect(stripAnsi(plain)).toBe(plain);
  });
});

describe('selfTestCases — a count, not a shape', () => {
  const REAL = '✓ check-bash32-floor self-test: 155 cases pass.\n';
  /** `check-governed-queue-guard` prefixes `OK` rather than `✓`; the prefix is presentation. */
  const OK_PREFIXED = 'OK check-governed-queue-guard self-test: 132 cases pass (the five ruled surfaces...).\n';

  it('reads the number out of a real gate verdict, whatever the prefix', () => {
    expect(selfTestCases(REAL, 'check-bash32-floor')).toBe(155);
    expect(selfTestCases(OK_PREFIXED, 'check-governed-queue-guard')).toBe(132);
  });

  it('reads it through colour, so a gate that starts colouring does not turn every caller red in CI only', () => {
    const coloured = `${E}[32m✓ check-entry-guard self-test: ${E}[1m63${E}[22m cases pass${E}[39m`;
    expect(coloured, 'the raw bytes do not match -- the SGR sits inside the count').not.toMatch(
      /check-entry-guard self-test: \d+ cases pass/,
    );
    expect(selfTestCases(coloured, 'check-entry-guard')).toBe(63);
  });

  /**
   * ⭐ The non-equivalence pin. `\d+ cases pass` is satisfied by a self-test
   * whose case table is EMPTY — it passes for the outcome it exists to refuse,
   * and no CI run can catch that, because the assertion is green.
   */
  it('the OLD spelling accepts an empty case table; the count refuses it', () => {
    const vacuous = '✓ check-bash32-floor self-test: 0 cases pass.\n';
    expect(vacuous, 'the old spelling: a pin satisfied by the absence of what it pins').toMatch(
      /check-bash32-floor self-test: \d+ cases pass/,
    );
    expect(selfTestCases(vacuous, 'check-bash32-floor')).toBe(0);
    // ...which is what every call site now asserts against:
    expect(() => expect(selfTestCases(vacuous, 'check-bash32-floor')).toBeGreaterThan(0)).toThrow();
  });

  it('throws, naming the output, when the verdict is absent rather than reporting zero', () => {
    expect(() => selfTestCases('the gate crashed before printing anything\n', 'check-bash32-floor')).toThrow(
      /check-bash32-floor self-test case count/,
    );
  });

  it('does not answer about one gate from another gate line', () => {
    expect(() => selfTestCases(REAL, 'check-entry-guard')).toThrow();
  });
});

describe('verdictCount — the generic reader', () => {
  it('captures the digits the pattern names', () => {
    const out = '✓ check-upstream-port-parity: 3 ported file(s) match objectstack-ai/objectstack@bf10debd5 modulo...';
    expect(verdictCount(out, /(\d+) ported file\(s\) match/, 'ported file count')).toBe(3);
  });

  it('is not satisfied by a zero the un-captured spelling would accept', () => {
    const empty = '✓ check-upstream-port-parity: 0 ported file(s) match objectstack-ai/objectstack@bf10debd5 modulo...';
    expect(empty, 'the old spelling passes on an EMPTY pin').toMatch(/ported file\(s\) match/);
    expect(verdictCount(empty, /(\d+) ported file\(s\) match/, 'ported file count')).toBe(0);
  });

  it('throws with the whole output when nothing matches', () => {
    expect(() => verdictCount('nothing here\n', /(\d+) widgets/, 'widget count')).toThrow(/nothing here/);
  });
});
