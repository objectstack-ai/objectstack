import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Plain-JS CI helpers. Their types are INFERRED from the .mjs sources by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import { findCallSites } from '../check-vi-mock-specifiers.mjs';
import { maskComments, scanSource } from '../js-comment-mask.mjs';

import { selfTestCases, stripAnsi } from './helpers/child-verdict';

/**
 * objectui#6891 — a JSX closing tag is not a regex literal.
 *
 * `scanSource` opens a REGEX when the character before a `/` is not a value. A
 * JSX closing tag puts a `/` straight after a `<`, so a phantom regex opened
 * there and ran to end of line. Measured on this tree before the fix: 1,623 of
 * 4,322 tracked source files carried a wrong mask, 129,998 bytes of live JSX
 * were handed to callers as string content, and SEVEN `vi.mock` call sites in
 * seven files could not have their argument list delimited at all.
 *
 * ## Why this file exists rather than the module's own `--self-test`
 *
 * `node scripts/js-comment-mask.mjs --self-test` is wired into no workflow and
 * no `package.json` script in this repository — `git grep` finds the string in
 * the module's own header and nowhere else. A self-test nothing runs is the
 * `scripts/invoked-as.mjs` shape this module's header already warns about
 * (objectui#6078): enforcement that reads as present and is absent. So this
 * file both pins the flags directly AND executes that self-test as a
 * subprocess, which is what actually puts it on every PR.
 *
 * ## What is pinned, and in which direction
 *
 * Three groups, and the second and third are what stop the first from passing
 * vacuously:
 *
 *  1. **the fix** — a closing tag, a fragment and a member tag open no span,
 *     and the `)` that closes the enclosing call stays code;
 *  2. **the negative controls** — a `/` that really does open a regex, one
 *     space or one character away from the excluded shape. A rule spelled
 *     "never open a regex anywhere near a `<`" passes group 1 and fails here;
 *  3. **the KNOWN LIMITS** — the half of the defect this change deliberately
 *     does not close (a `/` after `}` or `>`: the SELF-closing tag, and a `/`
 *     in JSX text). Pinned as the behaviour they have TODAY, in the same
 *     two-way style the workaround in `check-vi-mock-inherit.mjs` used against
 *     this card: when someone closes them, these fail loudly and get retired on
 *     purpose rather than rotting into a false claim of coverage.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.join(HERE, '..', 'js-comment-mask.mjs');
const REPO_ROOT = path.resolve(HERE, '..', '..');

/** Flags for `source`, as one string: `C`omment, `L`iteral, `.` code. */
function flagsOf(source: string): string {
  const { comment, literal } = scanSource(source);
  let out = '';
  for (let i = 0; i < source.length; i++) out += comment[i] ? 'C' : literal[i] ? 'L' : '.';
  return out;
}

describe('a JSX closing tag opens no span', () => {
  // The exact shape the card measured, and the shape `check-vi-mock-inherit.mjs`
  // had to work around: the phantom reached the `)` that closes the call.
  const jsx = 'const C = ({ open, children }: any) => (open ? <div>{children}</div> : null);';

  it('the bytes of the closing tag are code', () => {
    const { literal } = scanSource(jsx);
    // The `/` was consumed as the opener, so the first byte INSIDE the old
    // phantom was the `d` of `div`. That byte is what must now read as code.
    expect(literal[jsx.indexOf('</div>') + 2]).toBe(0);
  });

  it('THE CONSEQUENCE: the `)` closing the enclosing call is code, so a delimiter walk balances', () => {
    const { literal } = scanSource(jsx);
    expect(literal[jsx.indexOf(': null)')]).toBe(0);
    expect(literal[jsx.lastIndexOf(')')]).toBe(0);
  });

  it('nothing on the line is flagged at all', () => {
    expect(flagsOf(jsx)).toBe('.'.repeat(jsx.length));
  });

  it.each([
    ['fragment', 'const F = () => (<>{x}</>);'],
    ['member expression', 'const M = () => (<Foo.Bar>{x}</Foo.Bar>);'],
    ['namespaced tag', 'const N = () => (<svg:use>{x}</svg:use>);'],
    ['hyphenated tag', 'const H = () => (<my-el>{x}</my-el>);'],
    ['two closing tags on one line', 'const T = () => (<a><b>{x}</b></a>);'],
  ])('%s', (_name, src) => {
    expect(flagsOf(src)).toBe('.'.repeat(src.length));
  });

  it('a comment AFTER a closing tag is still masked — the fabrication direction', () => {
    // The phantom used to swallow the comment opener, so genuinely commented-
    // out text came back to a caller as live code. That is the direction this
    // module's header calls the worse one.
    for (const src of [
      'const C = () => <div>x</div>; // dead = 1;',
      'const C = () => <div>x</div>; /* dead = 1; */',
      'const F = () => <>x</>; // dead = 1;',
    ]) {
      expect(maskComments(src)).not.toContain('dead');
    }
  });
});

describe('the negative controls — a `/` that really does open a regex', () => {
  it('a SPACED less-than still opens a regex: the rule reads the raw preceding byte', () => {
    // `a < /re/` is legal JavaScript and JSX cannot spell it — `< /div>` is not
    // a closing tag. A rule written against `prev` (which skips whitespace)
    // instead of `source[i - 1]` would break this and pass everything above.
    const src = 'const b = a < /re/.source.length;';
    expect(scanSource(src).literal[src.indexOf('/re/') + 1]).toBe(1);
  });

  it('a regex whose FIRST character is a less-than is untouched', () => {
    const src = "const t = s.replace(/<[a-z]/g, '');";
    expect(scanSource(src).literal[src.indexOf('/<[') + 1]).toBe(1);
  });

  it.each([
    ['division after a paren', 'const r = (a) / b;'],
    ['division after an identifier', 'const r = a / b;'],
    ['division after a subscript', 'const r = xs[0] / b;'],
  ])('%s opens nothing', (_name, src) => {
    expect(flagsOf(src)).toBe('.'.repeat(src.length));
  });

  it('a `/` inside a string is still literal CONTENT, delimiters excluded', () => {
    // Stated as the exact flag string rather than "not all dots": the quotes
    // stay code so a caller can pair them, and only the three bytes between
    // them are content. An assertion that merely counted `L`s would pass on a
    // scanner that flagged the quotes too.
    const src = "const p = 'a/b';";
    expect(flagsOf(src)).toBe(`${'.'.repeat(11)}LLL..`);
  });

  it('the self-test of the module still passes, and carries the JSX cases', () => {
    const out = execFileSync('node', [MODULE, '--self-test'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(out).toContain('a JSX closing tag opens no span');
    expect(out).toContain('a SPACED less-than still opens a regex');
    // objectui#7897 — the COUNT, not the shape. `\d+ cases pass` is satisfied
    // by `0 cases pass`, so the old spelling passed for a self-test whose case
    // table had gone empty: the outcome it exists to refuse. `selfTestCases`
    // also strips ANSI, the second belt for a child that starts colouring —
    // that is the CI-only direction, and no repo gate colours today.
    expect(stripAnsi(out)).toMatch(/self-test: \d+ cases pass/);
    expect(
      selfTestCases(out, 'js-comment-mask'),
      'a self-test that ran no cases is not a passing self-test',
    ).toBeGreaterThan(0);
  });
});

describe('the judged population — the silent direction this card was filed for', () => {
  /**
   * `check-vi-mock-specifiers.mjs` (and its sibling) classify a call whose `vi`
   * token sits inside a literal as `embedded` — a code SAMPLE quoted in a
   * string — and count it instead of judging it. A phantom span reaching that
   * token therefore does not redden anything: it removes the site from the
   * population and the gate reports on fewer sites than it claims. That is the
   * failure this card names as the one that matters.
   */
  // Assembled rather than written: a matchable call site in this file would
  // itself join the population these gates walk.
  const CALL = `vi.${'mock'}('@object-ui/react', () => ({}));`;

  it('a mock call after a JSX closing tag on the same line is JUDGED, not classified `embedded`', () => {
    const src = `const C = () => <div>x</div>; ${CALL}\n`;
    expect(scanSource(src).literal[src.indexOf(`vi.${'mock'}`)]).toBe(0);
    const sites = findCallSites(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].kind).not.toBe('embedded');
  });

  it('...while a genuinely quoted one is still `embedded`', () => {
    // The control: without it the assertion above would pass on a scanner that
    // flags nothing at all.
    const src = `const sample = \`${CALL}\`;\n`;
    const sites = findCallSites(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].kind).toBe('embedded');
  });
});

describe('KNOWN LIMITS — the half this change does not close', () => {
  /**
   * A `/` after `}` or `>` still opens a phantom, so a SELF-closing tag and a
   * `/` in JSX text are still mis-masked. There is no one-token rule for it:
   * `/>` is exactly how a regex matching `>` is spelled, and both `}` and `>`
   * before a `/` are genuinely ambiguous in JavaScript. Filed separately.
   *
   * These assertions state the DEFECT. They are here so it cannot be forgotten
   * and cannot be fixed silently — fixing it turns them red.
   */
  it('a SELF-closing tag still opens a phantom that runs to end of line', () => {
    const src = 'const a = <Foo bar={x} />;';
    expect(flagsOf(src)).toBe('.'.repeat(src.length - 2) + 'LL');
  });

  it('...and it still swallows a trailing comment opener', () => {
    const src = 'const c = <Foo bar={x} />; // dead = 1;';
    expect(maskComments(src)).toContain('dead');
  });

  it('a `/` in JSX TEXT still opens a phantom, bounded by the next closing tag', () => {
    const src = 'const b = (<div>{p}/{q}</div>);';
    expect(flagsOf(src)).toBe('.'.repeat(20) + 'LLLL' + '.'.repeat(src.length - 24));
  });

  it('a self-closing tag whose `/` follows a VALUE was never affected', () => {
    // The discriminator is the preceding byte, not the tag shape: `<br />`
    // reads its `/` as division and always did. That is why the limit above is
    // about `}` and `>`, not about self-closing tags as a category.
    for (const src of ['const e = <br />;', 'const f = <Foo />;']) {
      expect(flagsOf(src)).toBe('.'.repeat(src.length));
    }
    // ...and an attribute STRING ends in a value too, so only its content is
    // flagged and the `/` after it is division.
    const attr = 'const g = <Foo x="1" />;';
    expect(flagsOf(attr)).toBe(`${'.'.repeat(18)}L.....`);
  });
});
