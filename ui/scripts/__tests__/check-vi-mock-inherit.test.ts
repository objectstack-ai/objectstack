import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { childVitestEnv } from './helpers/child-vitest-env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
import {
  COVERED_SPECIFIERS,
  FLOORS,
  findCallSites,
  scan,
  summarise,
} from '../check-vi-mock-inherit.mjs';
import { maskComments, scanSource } from '../js-comment-mask.mjs';

/**
 * objectui#6849 — the test for `scripts/check-vi-mock-inherit.mjs`.
 *
 * ## Why this file carries more weight than usual
 *
 * The gate is GREEN AT REST: every `@object-ui/react` mock in the tree inherits
 * the real export surface, and the expectation is that they keep doing so. A
 * green run over this repo therefore proves only that the tree is clean — it
 * cannot tell a working gate from one that matches nothing, which is the exact
 * defect the gate exists to catch, one level up. Triage made the non-vacuity
 * control a delivery precondition for precisely that reason.
 *
 * So this file carries BOTH legs of the ablation, and neither is decoration:
 *
 *   - the POSITIVE control (`ablation`): the real historical instance,
 *     reconstructed byte-for-byte from `ObjectView.contractEnvelope-6726.test.tsx`
 *     as PR #6847 left it, driven end to end through `main()` for the exit code;
 *   - the NEGATIVE control (`the eleven`): every already-correct spelling the
 *     grep in #6768 mis-counted, each as its own case AND pinned against the
 *     real files on disk, because a gate that reddens on correct code gets
 *     deleted rather than fixed.
 *
 * ## Fixture discipline: never write a matchable call site into this source
 *
 * This file is inside the gate's own scan scope. Every fixture is built through
 * `mockCall()`, which interpolates the quote character — the source text here
 * reads `vi.${fn}(` and the pattern needs a literal `mock`/`doMock` followed by
 * a quote, so it never matches. Anything that DID match would be inside a string
 * literal, which the gate classifies as `embedded` and declines to judge anyway.
 * The first is what keeps the census figure honest. Same discipline, and the
 * same reasons, as `check-vi-mock-specifiers.test.ts`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A quote, from its code point — see "Fixture discipline" above. */
const Q = String.fromCharCode(39);

/** A backtick, from its code point — same discipline as `Q`. */
const BT = String.fromCharCode(96);

const COVERED = '@object-ui/react';

/** Escape a specifier list for embedding in a `RegExp` source. */
function escapeRe(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A `vi.mock` call as SOURCE TEXT, unmatchable in this file, matchable on disk. */
const mockCall = (spec: string, factory: string, fn: 'mock' | 'doMock' = 'mock') =>
  `vi.${fn}(${Q}${spec}${Q}, ${factory});`;

/** `vi.importActual(<spec>)` as source text, likewise unmatchable here. */
const importActual = (spec: string, generic = '') => `vi.${'importActual'}${generic}(${Q}${spec}${Q})`;

/** Classify one factory in isolation, through the real code path. */
function verdictOf(factory: string, spec: string = COVERED) {
  const sites = findCallSites(mockCall(spec, factory), { covered: [COVERED] });
  expect(sites, 'the fixture must produce exactly one call site').toHaveLength(1);
  return sites[0];
}

/** Build a throwaway tree and hand back its root plus a relative file list. */
function fixtureTree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vi-mock-inherit-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return { root, files: Object.keys(files) };
}

/** Fixture scans pass their own file list and switch the floors off. */
const scanFixture = (root: string, files: string[]) => scan(root, { files, floors: {} });

// ---------------------------------------------------------------------------
// THE NEGATIVE CONTROL — every already-correct spelling, none of them flagged
// ---------------------------------------------------------------------------

describe('the eleven — spellings the `importOriginal` grep mis-counted as broken', () => {
  /**
   * #6768 counted 36 frozen sites from a grep for the literal `importOriginal`.
   * The true count was 25. These are the eleven the grep called broken and that
   * are, in fact, correct. A name-matching gate demands edits to all eleven; a
   * gate that does that is overturned in its first review, so each spelling gets
   * its own case here rather than being trusted to the repo scan below.
   */

  it('the canonical spelling: a parameter named `importOriginal`, spread', () => {
    const site = verdictOf(`async (importOriginal) => ({ ...(await importOriginal()), SchemaRenderer: Stub })`);
    expect(site.verdict).toBe('inherits');
  });

  it('the SAME shape with a generic argument — 25 files in this tree write it', () => {
    expect(
      verdictOf(`async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), X: Stub })`).verdict,
    ).toBe('inherits');
  });

  it('a parameter named `importActual` — EnvironmentListToolbar.test.tsx', () => {
    // Same code, different word. Nothing about the NAME is load-bearing.
    expect(verdictOf(`async (importActual) => ({ ...(await importActual<any>()), X: Stub })`).verdict).toBe('inherits');
  });

  it('a parameter named `orig`, called through a cast — PageView.test.tsx', () => {
    // The real spelling: the parameter is not called directly, it is cast first.
    const site = verdictOf(
      `async (orig) => { const actual = await (orig as any)(); return { ...actual, X: Stub }; }`,
    );
    expect(site.verdict).toBe('inherits');
  });

  it('a ZERO-PARAMETER factory using vi.importActual — the nine in plugin-dashboard', () => {
    // No callback parameter exists at all, so a gate looking for one finds
    // nothing and calls this frozen. It is the largest of the three groups.
    const site = verdictOf(`async () => { const actual: any = await ${importActual(COVERED)}; return { ...actual, X: Stub }; }`);
    expect(site.verdict).toBe('inherits');
  });

  it('a parameter under a name nobody has used yet — the criterion is not a word list', () => {
    expect(verdictOf(`async (whateverTheyCalledIt) => ({ ...(await whateverTheyCalledIt()), X: Stub })`).verdict).toBe(
      'inherits',
    );
  });

  it('an obtained module handed through a chain of bindings', () => {
    expect(
      verdictOf(`async (importOriginal) => { const mod = await importOriginal(); const actual = mod; return { ...actual, X: Stub }; }`)
        .verdict,
    ).toBe('inherits');
  });

  it('an initialiser wrapped across lines — its call parentheses are on another line', () => {
    // A line-bounded read of the initialiser cuts before the `()` and reports a
    // binding that never calls anything: a fabricated finding on correct code.
    expect(
      verdictOf(
        [
          'async (importOriginal) => {',
          '  const actual = await importOriginal<',
          '    Record<string, unknown>',
          '  >();',
          '  return { ...actual, X: Stub };',
          '}',
        ].join('\n'),
      ).verdict,
    ).toBe('inherits');
  });

  // -- objectui#8183: what the OPERAND grammar has to keep accepting ---------
  // The tightening in `the failing shape` below refuses a spread whose operand
  // merely MENTIONS the obtained module. These are its accept-side
  // counterweight: a false refusal reds correct code, and that is how a gate
  // gets deleted rather than fixed.

  it('a parenthesised binding — `...(actual)`', () => {
    expect(
      verdictOf(`async (importOriginal) => { const actual = await importOriginal(); return { ...(actual), X: Stub }; }`)
        .verdict,
    ).toBe('inherits');
  });

  it('nested parentheses around an asserted call — ObjectTree.rowCeiling-7210.test.tsx', () => {
    // The one site in this tree that writes this shape, byte-for-byte.
    expect(
      verdictOf(
        `async (importOriginal) => ({ ...((await importOriginal<any>()) as Record<string, unknown>), X: Stub })`,
      ).verdict,
    ).toBe('inherits');
  });

  it('a non-null assertion is transparent — `...actual!`', () => {
    expect(
      verdictOf(`async (importOriginal) => { const actual = await importOriginal(); return { ...actual!, X: Stub }; }`)
        .verdict,
    ).toBe('inherits');
  });

  it('a property read off the module still inherits — the interop shape', () => {
    // `(await importOriginal()).default` freezes nothing: the key set is still
    // one the real module OWNS, so it grows when the module grows. No site in
    // this tree writes it today; refusing it would be a false refusal waiting
    // for the first file that does.
    const site = verdictOf(`async (importOriginal) => ({ ...(await importOriginal()).default, X: Stub })`);
    expect(site.verdict).toBe('inherits');
    expect(site.reason).toBe('...(await importOriginal()).default');
  });
});

// ---------------------------------------------------------------------------
// THE POSITIVE CONTROL — the failing shape, in each of its forms
// ---------------------------------------------------------------------------

describe('the failing shape — a factory that hand-lists the export surface', () => {
  it('a zero-parameter factory returning a hand-written object is FROZEN', () => {
    const site = verdictOf(`() => ({ SchemaRenderer: Stub, useDataScope: Stub })`);
    expect(site.verdict).toBe('frozen');
    expect(site.reason).toMatch(/never obtains the real module/);
  });

  it('OBTAINING WITHOUT SPREADING is still frozen — both halves are required', () => {
    // The card says so explicitly, and it is the half a "does it call
    // importOriginal?" check would miss.
    const site = verdictOf(`async (importOriginal) => { await importOriginal(); return { SchemaRenderer: Stub }; }`);
    expect(site.verdict).toBe('frozen');
    expect(site.reason).toMatch(/never spreads it/);
  });

  it('spreading the CALLBACK rather than what it returns is frozen', () => {
    // `...importOriginal` spreads a function. It reads like the correct
    // spelling and inherits nothing — the shape a green-at-rest gate is most
    // likely to wave through.
    expect(verdictOf(`async (importOriginal) => ({ ...importOriginal, X: Stub })`).verdict).toBe('frozen');
  });

  it('DESTRUCTURING names out of the real module is not inheriting its surface', () => {
    expect(
      verdictOf(`async (importOriginal) => { const { useDataScope } = await importOriginal(); return { useDataScope, X: Stub }; }`)
        .verdict,
    ).toBe('frozen');
  });

  it('spreading something that is not the real module is frozen', () => {
    const site = verdictOf(`async (importOriginal) => ({ ...baseStubs, X: Stub })`);
    expect(site.verdict).toBe('frozen');
    expect(site.reason).toMatch(/not the real module/);
  });

  it('vi.importActual of a DIFFERENT specifier does not inherit THIS one', () => {
    // The real file this guards against obtains `react`, not the mocked module.
    const site = verdictOf(`async () => { const R = await import(${Q}react${Q}); return { C: R.createContext(null) }; }`);
    expect(site.verdict).toBe('frozen');
    expect(verdictOf(`async () => ({ ...(await ${importActual('@object-ui/core')}) })`).verdict).toBe('frozen');
  });

  it('catches the same defect written as vi.doMock', () => {
    const sites = findCallSites(mockCall(COVERED, `() => ({ X: Stub })`, 'doMock'), { covered: [COVERED] });
    expect(sites[0].fn).toBe('doMock');
    expect(sites[0].verdict).toBe('frozen');
  });

  // -- objectui#8183: an operand that merely MENTIONS the module -------------

  /**
   * Rows C and D of the recogniser table. Both obtain the real module, both
   * spread, and both read `inherits` until objectui#8183 — the gate quoted the
   * evasion back in its own reason line. The returned object carries exactly
   * ONE inherited key (`_`), so the next export any module in the import graph
   * reads at module scope still resolves to `undefined`: the #6849 failure,
   * wearing the accepted spelling's clothes.
   *
   * NON-VACUITY. Each case is paired with the SAME fixture minus the object
   * literal, and that twin must read `inherits`. The two differ by the wrapper
   * alone, so a `frozen` verdict here cannot come from the gate bailing out
   * early (`indirect`, `unreadable`, "never obtains the real module") — it can
   * only come from the gate having READ the operand. The reason string is
   * pinned for the same purpose: it is the one the gate emits after collecting
   * spreads, not the one it emits before looking.
   */
  it('C — spreading an object literal that merely HOLDS the obtained module is frozen', () => {
    const site = verdictOf(`async (importOriginal) => ({ ...({ _: await importOriginal() }), X: Stub })`);
    expect(site.verdict).toBe('frozen');
    expect(site.reason).toBe('the factory spreads something, but not the real module');

    const twin = verdictOf(`async (importOriginal) => ({ ...(await importOriginal()), X: Stub })`);
    expect(twin.verdict, 'the same fixture without the wrapper must still inherit').toBe('inherits');
  });

  it('D — the same evasion with the obtained value bound to a const first', () => {
    const site = verdictOf(
      `async (importOriginal) => { const actual = await importOriginal(); return { ...({ _: actual }), X: Stub }; }`,
    );
    expect(site.verdict).toBe('frozen');
    expect(site.reason).toBe('the factory spreads something, but not the real module');

    const twin = verdictOf(
      `async (importOriginal) => { const actual = await importOriginal(); return { ...actual, X: Stub }; }`,
    );
    expect(twin.verdict, 'the same fixture without the wrapper must still inherit').toBe('inherits');
  });

  it('the nesting is refused one level up too — a BINDING that merely holds it', () => {
    // `const wrapper = { _: await importOriginal() }` must not enter the
    // inherited set, or C walks back in through the binding-propagation loop.
    const site = verdictOf(
      `async (importOriginal) => { const wrapper = { _: await importOriginal() }; return { ...wrapper, X: Stub }; }`,
    );
    expect(site.verdict).toBe('frozen');
    expect(site.reason).toBe('the factory spreads something, but not the real module');

    const twin = verdictOf(
      `async (importOriginal) => { const wrapper = await importOriginal(); return { ...wrapper, X: Stub }; }`,
    );
    expect(twin.verdict, 'the same fixture without the wrapper must still inherit').toBe('inherits');
  });

  it('an ARRAY around the obtained module is refused for the same reason', () => {
    const site = verdictOf(`async (importOriginal) => ({ ...[await importOriginal()], X: Stub })`);
    expect(site.verdict).toBe('frozen');
    expect(site.reason).toBe('the factory spreads something, but not the real module');
  });

  it('an object literal is refused even when its OWN contents would inherit', () => {
    // Deliberate, and documented in the header rather than left to be read as
    // an oversight: the nesting IS the evasion shape, and the one nesting that
    // would be correct spells the same thing as `...actual`. No call site in
    // this tree writes either.
    expect(
      verdictOf(`async (importOriginal) => { const actual = await importOriginal(); return { ...{ ...actual }, X: Stub }; }`)
        .verdict,
    ).toBe('frozen');
  });

  it('the callback spread without a CALL stays frozen under the operand grammar', () => {
    // `...(importOriginal)` is a FUNCTION wearing parentheses. The grammar
    // reaches the bare token and stops at the obtainer, which is not the module.
    expect(verdictOf(`async (importOriginal) => ({ ...(importOriginal), X: Stub })`).verdict).toBe('frozen');
  });
});

// ---------------------------------------------------------------------------
// Scope — the narrow gate triage ruled for, and what it must NOT touch
// ---------------------------------------------------------------------------

/**
 * The shape a hand-written array of exempt file paths declares itself with.
 *
 * Named rather than inlined so a failure can point at THE pattern instead of
 * asking the reader to copy one out of an expectation by hand (objectui#8117).
 */
const EXEMPTION_DECLARATION_RE = /^\s*(export )?const (ALLOW|EXEMPT|IGNORE|SKIP|KNOWN)[A-Z_]*\s*=/m;

/** The shape one ENTRY of such an array has: a quoted test file, then `,` or `]`. */
const EXEMPTION_ENTRY_RE = /\.test\.tsx?['"`]\s*[,\]]/;

/**
 * Every line of `code` that matches `re`, as `<line number>: <source line>`.
 *
 * ## Why not `expect(src).not.toMatch(re)` (objectui#8117)
 *
 * `not.toMatch` over this gate prints its ~1850-line source as the "received"
 * value and never says WHERE the match was; locating it needed a separate
 * `grep -nP` with the pattern copied out of this file by hand. The assertion
 * below is the same assertion — zero matches — reported so its failure names
 * the offending line. `line` is looked up in `original`, which is the raw
 * source: `maskComments` preserves byte offsets, so the numbering is shared.
 */
function offendingLines(code: string, re: RegExp, original: string = code) {
  const lines = original.split('\n');
  const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const out: string[] = [];
  for (let m = all.exec(code); m; m = all.exec(code)) {
    // Count to the first NON-WHITESPACE byte of the match, not to `m.index`.
    // `EXEMPTION_DECLARATION_RE` opens with `^\s*`, and `\s` matches a newline:
    // against a declaration with a blank line above it the match STARTS on that
    // blank line, so the naive offset reported `1853: ` — an empty line, one
    // above the carve-out, which is worse than useless in a failure message.
    const at = m.index + /^\s*/.exec(m[0])![0].length;
    const n = code.slice(0, at).split('\n').length;
    out.push(`${n}: ${lines[n - 1].trim()}`);
    if (all.lastIndex === m.index) all.lastIndex += 1;
  }
  return [...new Set(out)];
}

describe('scope — narrow, and out of scope by construction rather than by exemption', () => {
  it('a RELATIVE specifier is never judged — whole-module replacement is legitimate', () => {
    // `plugin-calendar/src/registration.test.tsx` replaces `./ObjectCalendar`
    // wholesale and its own comment explains why. There is no growing export
    // surface to inherit; a gate that reddened here would be deleted.
    const site = verdictOf(`() => ({ ObjectCalendar: Stub })`, './ObjectCalendar');
    expect(site.scope).toBe('local');
    expect(site.verdict).toBe('unjudged');
  });

  it('a third-party package is never judged', () => {
    expect(verdictOf(`() => ({ toast: Stub })`, 'sonner').scope).toBe('external');
  });

  it('a workspace package outside the covered set is counted, not judged', () => {
    // 299 frozen factories live on these today (objectui#6892). Judging them
    // would land this gate RED on 298 sites it was not dispatched to sweep.
    const site = verdictOf(`() => ({ useAuth: Stub })`, '@object-ui/auth');
    expect(site.scope).toBe('workspace');
    expect(site.verdict).toBe('unjudged');
  });

  it('there is NO per-file exception list anywhere in the gate', () => {
    // Triage: ⛔ 不要顺手加例外白名单. An exemption means the recogniser called
    // correct code broken — the repair is the recogniser, not a carve-out.
    const src = fs.readFileSync(path.join(repoRoot, 'scripts/check-vi-mock-inherit.mjs'), 'utf8');
    // objectui#8117: the ENTRY pattern is read over the COMMENT-BLANKED source,
    // the gate's own "only text the language would EXECUTE is judged" rule
    // turned on the gate's own file. The header docblock is this sweep's
    // per-slice logbook by construction, so recording a sweep means naming test
    // files — and a backticked filename followed by a comma is byte-identical
    // to one entry of the array this pin exists to catch. It reddened twice on
    // running prose (#8116, #8207 at `e104c509d`), and both times the repair
    // was to reword the sentence: a tax on every future slice author, paid to a
    // pin whose failure text points at a regex while the only "fix" it suggests
    // is the carve-out the comment above forbids. Blanking costs the pin
    // nothing — a real exemption array is a string LITERAL, which the shared
    // masker leaves intact; the sibling case below drives both directions.
    //
    // The DECLARATION pattern still reads the raw source: it cannot match a
    // docblock line (`^\s*` reaches the ` * ` prefix and stops), so it has no
    // false red to fix and narrowing it would buy nothing.
    expect(offendingLines(src, EXEMPTION_DECLARATION_RE)).toEqual([]);
    expect(offendingLines(maskComments(src), EXEMPTION_ENTRY_RE, src)).toEqual([]);
  });

  it('that pin reads CODE, and the header prose it used to redden on is intact', () => {
    // Both legs are needed: on a tree whose header already avoids the comma,
    // an empty reading proves only that today's prose dodges the pattern, not
    // that the pin stopped judging prose. The RAW assertions are the control —
    // each fixture MUST match before masking, or the leg below measures nothing.
    const entry = (file: string) => `${Q}packages/x/src/${file}${Q},`;
    const array = `const ALLOWLIST = [${entry('A.test.tsx')} ${entry('B.test.ts')}];`;
    // The exact shape #8116 measured: one sweep record naming a swept file.
    const prose = `/**\n *     ${BT}ObjectView.expandFls-7429.test.tsx${BT}, landed by objectui#7429\n */`;

    expect(EXEMPTION_ENTRY_RE.test(array), 'the positive fixture is matchable at all').toBe(true);
    expect(EXEMPTION_ENTRY_RE.test(prose), 'the prose fixture is matchable BEFORE masking').toBe(true);

    // A real exemption array survives the mask — the pin keeps every tooth.
    expect(offendingLines(maskComments(array), EXEMPTION_ENTRY_RE, array)).toEqual([
      `1: ${array}`,
    ]);
    // The header record does not — that is the false red, and it is gone.
    expect(offendingLines(maskComments(prose), EXEMPTION_ENTRY_RE, prose)).toEqual([]);
    // And the same masking must not blind the pin to an array written INSIDE
    // the docblock's file: prose above it does not shelter the code below it.
    const both = `${prose}\n${array}`;
    expect(offendingLines(maskComments(both), EXEMPTION_ENTRY_RE, both)).toEqual([`4: ${array}`]);
  });

  it('a reported line is the DECLARATION, never the blank line above it', () => {
    // Measured, not hypothetical: the first draft of `offendingLines` counted to
    // `m.index`, and `EXEMPTION_DECLARATION_RE` opens with `^\s*` where `\s`
    // matches a newline. Appending a carve-out to the gate with a blank line
    // before it therefore reported `1853: ` — an empty line, one above the
    // declaration. A failure message that names the wrong line is the defect
    // objectui#8117 is about, one level down, so it gets its own case.
    const decl = "const KNOWN_BAD = ['packages/x/src/A.test.tsx'];";
    const withBlankLineAbove = `const ok = 1;\n\n${decl}\n`;
    expect(offendingLines(withBlankLineAbove, EXEMPTION_DECLARATION_RE)).toEqual([`3: ${decl}`]);
  });

  it('the covered set is non-empty and names only real workspace packages', () => {
    // A typo here empties the population silently, and the gate then reports OK
    // over nothing. The `covered` floor below is the other half of that guard.
    expect(COVERED_SPECIFIERS.length).toBeGreaterThan(0);
    for (const spec of COVERED_SPECIFIERS) {
      const dir = spec.replace('@object-ui/', '');
      const pkg = path.join(repoRoot, 'packages', dir, 'package.json');
      expect(fs.existsSync(pkg), `${spec} names no package in this workspace`).toBe(true);
      expect(JSON.parse(fs.readFileSync(pkg, 'utf8')).name).toBe(spec);
    }
  });

  /**
   * THE MEMBERSHIP LEDGER — objectui#8018.
   *
   * Every specifier a landed sweep has added, written out ONCE and BY HAND.
   * The gate's header declares the covered set GROW-ONLY and the ratchet's
   * whole force rests on that, but `findCallSites` classifies by MEMBERSHIP:
   * a specifier that leaves the set stops being `covered` and its call sites
   * become `unjudged`. So a removal does not redden — it makes that
   * specifier's whole population invisible while the gate reports OK over a
   * tree it no longer looks at. Measured before this ledger existed, by
   * dropping each of the 21 members from the constant in turn and running this
   * file: 18 of them left all 86 cases GREEN, together 384 judged call sites
   * — `@object-ui/auth` (136) and `@object-ui/permissions` (48) among them.
   *
   * ⛔ It is NOT derived from `COVERED_SPECIFIERS`. A pin that reads its
   * expectation from the thing it pins asserts `x === x` and cannot fail; the
   * cautionary example is already in this file, where the verdict-line case
   * builds its expectation with `COVERED_SPECIFIERS.join(', ')` and therefore
   * ADAPTS to a removal rather than resisting it. That is this repo's
   * recurring shape and it is the reason these names are typed out.
   *
   * The two cases below pin the list in BOTH directions, and the second is
   * what keeps a hand-written ledger from silently falling behind:
   *
   *   - nothing may LEAVE the covered set (the ratchet direction); and
   *   - nothing may JOIN it without being recorded here in the same PR, so a
   *     member added tomorrow arrives already pinned rather than joining an
   *     unprotected majority.
   *
   * ⚠ What it still permits, stated so no one reads it as more: an author
   * who deletes a member from the constant AND its line here in one edit
   * passes. That is the floor of any literal pin, and it is the point — the
   * ratchet's promise is that a member cannot leave SILENTLY, not that it can
   * never leave. Retirement becomes a visible, reviewable edit to a list whose
   * docblock says the set only grows.
   *
   * Names only, deliberately: the gate's own header carries the slice, the
   * measurement and the PR behind each entry, and a second copy of that
   * provenance here would be an unchecked hand-copy of exactly the kind this
   * case exists to catch.
   */
  const SWEPT_MEMBERS: readonly string[] = [
    '@object-ui/react',
    '@object-ui/i18n',
    '@object-ui/plugin-markdown',
    '@object-ui/data-objectstack',
    '@object-ui/plugin-report',
    '@object-ui/plugin-charts',
    '@object-ui/plugin-dashboard',
    '@object-ui/auth',
    '@object-ui/collaboration',
    '@object-ui/plugin-form',
    '@object-ui/components',
    '@object-ui/plugin-grid',
    '@object-ui/permissions',
    '@object-ui/plugin-detail',
    '@object-ui/plugin-chatbot',
    '@object-ui/plugin-designer',
    '@object-ui/plugin-list',
    '@object-ui/fields',
    '@object-ui/app-shell',
    '@object-ui/plugin-view',
    '@object-ui/core',
  ];

  it('NOTHING LEAVES the covered set — every swept specifier is still a member', () => {
    // The generalisation of the `@object-ui/i18n` pin further down, whose
    // rationale applies verbatim to all 21: dropping a member makes every one
    // of its call sites unjudged, so the gate stays GREEN over a population it
    // no longer looks at — the one direction a ratchet must never be free to
    // move.
    const covered = new Set<string>(COVERED_SPECIFIERS);
    const retired = SWEPT_MEMBERS.filter((spec) => !covered.has(spec));
    expect(
      retired,
      'a landed sweep left COVERED_SPECIFIERS: its call sites are now unjudged and the gate reports OK over them',
    ).toEqual([]);
  });

  it('NOTHING JOINS unrecorded — a new member is pinned in the PR that adds it', () => {
    // Without this half the ledger is a snapshot that decays: every specifier
    // added after it was written would inherit the same unprotected state the
    // 18 were measured in. With it, the pin grows with the set by construction
    // — the sweep PR that widens the constant widens this list too, which is
    // the same PR the gate's "precondition for widening" already requires.
    const ledger = new Set<string>(SWEPT_MEMBERS);
    const unrecorded = COVERED_SPECIFIERS.filter((spec: string) => !ledger.has(spec));
    expect(
      unrecorded,
      'add the new member to SWEPT_MEMBERS in this same PR — until then it has no membership pin',
    ).toEqual([]);
  });

  it('the header states what it does NOT cover, and the precondition for widening', () => {
    // Triage asked for both in writing, so that a later reader widening the set
    // knows what evidence is owed rather than guessing at it.
    //
    // The window is the leading docblock ITSELF, not a byte budget. It used to
    // be `.slice(0, 12000)`, and every sweep that appends its per-specifier
    // record pushes the paragraphs below it further down: objectui#6892's
    // FOURTH slice took the header past 12000 bytes and reddened this pin
    // without touching a word either assertion reads. A byte count is not what
    // the rule is about, and re-raising it would only defer the same failure to
    // the next slice.
    const source = fs.readFileSync(path.join(repoRoot, 'scripts/check-vi-mock-inherit.mjs'), 'utf8');
    const opened = source.indexOf('/**');
    const closed = source.indexOf('\n */\n', opened);
    expect(opened, 'the gate has a leading docblock').toBeGreaterThanOrEqual(0);
    expect(closed, 'that docblock terminates').toBeGreaterThan(opened);
    const header = source.slice(opened, closed);
    // The window must still be a HEADER, not the whole file -- otherwise these
    // two assertions would pass on a match anywhere in the source, including
    // inside the code they are supposed to be documenting.
    expect(header.length).toBeLessThan(source.length);
    expect(header).toMatch(/whole-module replacement/i);
    expect(header).toMatch(/precondition for widening is a sweep/i);
    // objectui#8141: the scope the resolver actually implements includes the
    // subpaths of a member, so the header has to say so -- a verdict line that
    // claims more than the prose explains is the same over-claim one level up.
    expect(header).toMatch(/covers its SUBPATHS/i);
  });
});

// ---------------------------------------------------------------------------
// The subpath boundary (objectui#8141)
// ---------------------------------------------------------------------------

describe('a member covers its SUBPATHS — the boundary objectui#8141 moved', () => {
  /**
   * The resolver decided scope by EXACT equality until objectui#8141, so
   * `@object-ui/components/ui/sonner` -- a subpath of the member slice 6 swept
   * -- was counted in the "other workspace" bucket and never judged, while the
   * verdict line named the package as covered. Measured on `b38014e82` with
   * the gate's own `scan()`: 2 such sites in the tree, both already inheriting,
   * so the prefix match landed as a ratchet (623 -> 625 judged, 37 -> 35 other
   * workspace, 0 frozen either way).
   */

  const SUBPATH = `${COVERED}/testing`;

  it('a SUBPATH of a covered member is JUDGED rather than bucketed as workspace', () => {
    const site = verdictOf(`() => ({ SchemaRenderer: Stub })`, SUBPATH);
    expect(site.scope).toBe('covered');
    expect(site.verdict).toBe('frozen');
  });

  it('the same subpath in the inheriting form is green', () => {
    const site = verdictOf(`async (importOriginal) => ({ ...(await importOriginal()), X: Stub })`, SUBPATH);
    expect(site.scope).toBe('covered');
    expect(site.verdict).toBe('inherits');
  });

  it('vi.importActual of the SUBPATH inherits it — the specifier match follows the subpath', () => {
    const site = verdictOf(
      `async () => ({ ...(await ${importActual(SUBPATH)}), X: Stub })`,
      SUBPATH,
    );
    expect(site.verdict).toBe('inherits');
  });

  it('THE REGRESSION PIN: a frozen subpath factory makes the gate RED, not silently green', () => {
    // This is the whole card in one case. Revert the resolver to exact
    // equality and the site drops into `workspace`: `frozen` empties, the run
    // reports OK, and the green claims a package the gate never checked.
    const { root, files } = fixtureTree({
      'packages/plugin-form/src/Toast.test.tsx': `${mockCall(SUBPATH, `() => ({ toast: Stub })`)}
`,
    });
    const result = scanFixture(root, files);
    expect(result.frozen.map((f: { specifier: string }) => f.specifier)).toEqual([SUBPATH]);
    expect(result.census.covered).toBe(1);
    expect(result.census.workspace).toBe(0);
  });

  it('a sibling package whose NAME starts with a member is NOT covered', () => {
    // The separator is part of the prefix. `@object-ui/react-native` would be a
    // different package with its own sweep to do, not a subpath of the member.
    for (const spec of [`${COVERED}-native`, `${COVERED}ive`]) {
      const site = verdictOf(`() => ({ X: Stub })`, spec);
      expect(site.scope, `${spec} must not be swallowed by the prefix`).toBe('workspace');
      expect(site.verdict).toBe('unjudged');
    }
  });

  it('the constant still names package ROOTS only — reach widened, membership did not', () => {
    // ⛔ The repair is NOT enumerating subpaths in the constant: that keeps the
    // gap open per subpath forever, and a subpath member would also fail the
    // package.json case above. A member joins only by sweep.
    for (const spec of COVERED_SPECIFIERS) {
      expect(spec.split('/'), `${spec} is not a package root`).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Only text the language would execute
// ---------------------------------------------------------------------------

describe('only text the language would execute', () => {
  it('ignores a commented-out mock: it is not executed, so it cannot freeze anything', () => {
    expect(findCallSites(`// ${mockCall(COVERED, '() => ({ X: Stub })')}`)).toEqual([]);
    expect(findCallSites(`/* ${mockCall(COVERED, '() => ({ X: Stub })')} */`)).toEqual([]);
  });

  it('counts a call quoted inside a literal as `embedded`, and does not judge it', () => {
    const sites = findCallSites(`const sample = \`${mockCall(COVERED, '() => ({ X: Stub })')}\`;`);
    expect(sites).toHaveLength(1);
    expect(sites[0].scope).toBe('embedded');
    expect(sites[0].verdict).toBe('unjudged');
  });

  it('still sees a real call in a file that also holds prose about one', () => {
    // The blinding direction: a mask that dropped too much reports clean over
    // live code. This gate's own header quotes the defect in prose.
    const sites = findCallSites(
      [`/** docs mentioning ${mockCall(COVERED, '() => ({ X: Stub })')} */`, mockCall(COVERED, '() => ({ Y: Stub })')].join('\n'),
    );
    expect(sites).toHaveLength(1);
    expect(sites[0].verdict).toBe('frozen');
  });

  it('an automock (no factory) inherits the surface by construction', () => {
    const sites = findCallSites(`vi.${'mock'}(${Q}${COVERED}${Q});`);
    expect(sites[0].verdict).toBe('automock');
  });

  it('a factory that is NOT written inline fails rather than passing unread', () => {
    // The obvious evasion, and the direction that matters: a gate that reports
    // OK for a factory it never read is a gate that can be walked around
    // without anybody deciding to walk around it.
    const site = verdictOf(`sharedReactFactory()`);
    expect(site.verdict).toBe('indirect');
    const { root, files } = fixtureTree({ 'a.test.tsx': `${mockCall(COVERED, 'sharedReactFactory()')}\n` });
    expect(scanFixture(root, files).unreadable).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The JSX mask — a real mis-mask in the shared scanner, since fixed
// ---------------------------------------------------------------------------

describe('a JSX closing tag — the shared masker USED to read `</div>` as a regex literal', () => {
  /**
   * `js-comment-mask` opened a regex when a `/` followed something that is not
   * a value. In `</div>` that something is `<`, so a PHANTOM regex opened and
   * ran to the end of the line, swallowing whatever was there — including the
   * `)` that closes a `vi.mock` call. Measured on this tree at the time: SEVEN
   * call sites could not be delimited at all, one of them a covered site.
   *
   * That is history. The shared masker handles `</tag>` itself since
   * objectui#6891, whose own pin
   * (`scripts/__tests__/js-comment-mask-jsx-6891.test.ts`) holds the scanner,
   * and THIS gate rewrites nothing before masking any more — objectui#7883
   * retired the local `deJsxClosingTags` workaround and its two unit cases
   * with it.
   *
   * The three cases below are what say the retirement changed nothing: the
   * first reads the mask directly on the RAW source, and the two behavioural
   * ones drive the gate end to end on a factory that returns JSX. They pass
   * with no rewrite in the gate at all.
   *
   * ⛔ Not a claim that the masker is correct on JSX: objectui#6891 closed
   * only the `<` `/` half, and a `/` after `}` or `>` still opens a phantom
   * (objectui#7882, still open). The retired rewrite never covered that half
   * either, so nothing was lost with it.
   */

  const jsxFactory = `({ open, children }: any) => (open ? <div>{children}</div> : null)`;

  it('the mis-mask is GONE: the shared masker was fixed, so this workaround is now redundant', () => {
    // This case was written the other way up — it pinned the CAUSE, asserting
    // the mis-mask was real, so that fixing the shared module would fail here
    // and the workaround could be retired deliberately rather than rotting.
    // That is what happened: objectui#6891 taught `scanSource` that a `/`
    // whose immediately preceding byte is `<` opens nothing, and this case
    // has been turned over to pin the fix instead.
    //
    // `deJsxClosingTags` was deliberately NOT removed in that change — it was
    // a second gate's source, outside that card's file surface. objectui#7883
    // then retired it, and these assertions are what made that a decision
    // rather than a guess: the raw source, with no rewrite anywhere, already
    // masks correctly.
    const src = `const C = ${jsxFactory};\n`;
    const { literal } = scanSource(src);
    const inside = src.indexOf('</div>') + 2;
    expect(literal[inside], 'the shared masker mis-reads a JSX closing tag again').toBe(0);
    // ...and, the property this gate actually needs: the `)` that closes the
    // call is code, so a delimiter walk over the RAW source balances.
    expect(literal[src.indexOf(': null)')]).toBe(0);
    expect(literal[src.lastIndexOf(')')]).toBe(0);
  });

  it('THE CONSEQUENCE: a covered factory returning JSX is READ, not skipped', () => {
    // Under the mis-mask this call site was `unreadable`. `unreadable` fails
    // the gate, so the defect would not have been silent — but it would have
    // reddened five innocent files instead of judging them. This case is now
    // the load-bearing half: it goes red if the shared masker ever regresses.
    const site = verdictOf(`async (importOriginal) => ({ ...(await importOriginal()), C: ${jsxFactory} })`);
    expect(site.verdict).toBe('inherits');
  });

  it('...and a FROZEN factory returning JSX is still caught', () => {
    expect(verdictOf(`() => ({ C: ${jsxFactory} })`).verdict).toBe('frozen');
  });
});

// ---------------------------------------------------------------------------
// THE ABLATION — the real historical instance, end to end
// ---------------------------------------------------------------------------

describe('ablation — the 26th, reconstructed from the site this PR converts', () => {
  /**
   * `packages/plugin-view/src/__tests__/ObjectView.contractEnvelope-6726.test.tsx`
   * as PR #6847 left it. It is the card's own thesis in the second direction:
   * the sweep's grep for `importOriginal` produced eleven false positives AND
   * missed this one, which contains that token nowhere. `git cat-file -e
   * 1e14d70ae:<path>` succeeds and `git diff 1e14d70ae HEAD -- <path>` was empty
   * before this PR, so the sweep really did look at these bytes.
   */

  const FROZEN_FACTORY = [
    'async () => {',
    `  const React = await import(${Q}react${Q});`,
    '  return {',
    '    SchemaRenderer: ({ data }: any) => {',
    '      if (Array.isArray(data)) delivered.push(data);',
    '      return <div data-testid="schema-renderer" />;',
    '    },',
    '    SchemaRendererContext: React.createContext(null),',
    '    subscribeDataChanges: () => () => {},',
    '    notifyDataChanged: () => {},',
    '  };',
    '}',
  ].join('\n');

  const CONVERTED_FACTORY = FROZEN_FACTORY.replace('async () => {', 'async (importOriginal) => {').replace(
    '  return {',
    '  return {\n    ...(await importOriginal<Record<string, unknown>>()),',
  );

  const suiteAt = 'packages/plugin-view/src/__tests__/ObjectView.contractEnvelope-6726.test.tsx';

  const runWith = (factory: string) => {
    const { root, files } = fixtureTree({ [suiteAt]: `${mockCall(COVERED, factory)}\n` });
    return scanFixture(root, files);
  };

  it('THE HISTORICAL INSTANCE: the gate goes RED on it', () => {
    const result = runWith(FROZEN_FACTORY);
    expect(result.frozen.map((f: { file: string }) => f.file)).toEqual([suiteAt]);
    expect(result.frozen[0].reason).toMatch(/never obtains the real module/);
  });

  it('the converted form is recognised as a fix — the gate goes GREEN', () => {
    const result = runWith(CONVERTED_FACTORY);
    expect(result.frozen).toEqual([]);
    expect(result.census.inherits).toBe(1);
  });

  it('names the file and the line, so the finding is actionable', () => {
    expect(runWith(FROZEN_FACTORY).frozen[0].line).toBe(1);
  });

  it('THE DISCRIMINATING HALF: correct neighbours in the same file are NOT flagged', () => {
    // A real file mocks several specifiers at once. Only the covered one is
    // judged, and the inheriting spellings beside it stay green.
    //
    // The workspace neighbour is deliberately a specifier that NO package
    // publishes. It used to name a real uncovered package, and objectui#6892's
    // sweep of that package turned this fixture's frozen factory into a genuine
    // finding -- the case failed for a reason that had nothing to do with what
    // it asserts. `COVERED_SPECIFIERS` is grow-only, so any real name here is
    // only ever on loan; the scope resolver classifies by string prefix and
    // never resolves the module, so a name that cannot be swept keeps this case
    // about the resolver instead of about the covered set's current membership.
    const { root, files } = fixtureTree({
      [suiteAt]: [
        mockCall('@object-ui/plugin-never-swept-fixture', `() => ({ ObjectGrid: Stub })`),
        mockCall('sonner', `() => ({ toast: Stub })`),
        mockCall('./ObjectCalendar', `() => ({ ObjectCalendar: Stub })`),
        mockCall(COVERED, `async (orig) => { const actual = await (orig as any)(); return { ...actual, X: Stub }; }`),
      ].join('\n'),
    });
    const result = scanFixture(root, files);
    expect(result.frozen).toEqual([]);
    expect(result.unreadable).toEqual([]);
    expect(result.census.covered).toBe(1);
  });

  it('catches the broken one while its out-of-scope neighbours sit around it', () => {
    const { root, files } = fixtureTree({
      [suiteAt]: [
        mockCall('sonner', `() => ({ toast: Stub })`),
        mockCall(COVERED, FROZEN_FACTORY),
        mockCall('./ObjectCalendar', `() => ({ ObjectCalendar: Stub })`),
      ].join('\n'),
    });
    expect(scanFixture(root, files).frozen).toHaveLength(1);
  });

  it('exits NON-ZERO on a frozen factory, with the guidance in the message', () => {
    // End to end through `main()`, because the exit code is the whole contract
    // with CI — a `main()` that swallowed `frozen` would pass every case above.
    //
    // The gate resolves its repo root from its OWN location, never from `cwd`,
    // so the probe copies the import graph into a throwaway git repo and adds
    // one frozen fixture there.
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vi-mock-inherit-red-'));
    let status = 0;
    let output = '';
    try {
      fs.mkdirSync(path.join(probe, 'scripts'));
      for (const f of ['check-vi-mock-inherit.mjs', 'invoked-as.mjs', 'js-comment-mask.mjs']) {
        fs.copyFileSync(path.join(repoRoot, 'scripts', f), path.join(probe, 'scripts', f));
      }
      // Floors would fire on a tree this small and mask the signal, so the
      // probe raises the frozen finding on its own: floors are OFF here by
      // pointing the fixture's own file list at a lowered FLOORS is not
      // available across a process boundary, so instead the probe asserts the
      // FROZEN section specifically rather than the bare exit code.
      fs.mkdirSync(path.join(probe, 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(probe, 'pkg', 'a.test.tsx'), `${mockCall(COVERED, '() => ({ X: Stub })')}\n`);
      execFileSync('git', ['init', '-q'], { cwd: probe });
      execFileSync('git', ['add', '-A'], { cwd: probe });
      try {
        execFileSync('node', ['scripts/check-vi-mock-inherit.mjs'], { cwd: probe, encoding: 'utf8' });
      } catch (err) {
        const e = err as { status: number; stdout: string; stderr: string };
        status = e.status;
        output = `${e.stdout}${e.stderr}`;
      }
    } finally {
      fs.rmSync(probe, { recursive: true, force: true });
    }
    expect(status, 'a frozen factory must be RED — a green here is the defect itself').toBe(1);
    expect(output).toMatch(/freezes the mock export surface/);
    expect(output).toContain('pkg/a.test.tsx:1');
    expect(output, 'the message must show the fix, not just the finding').toMatch(/importOriginal/);
  });
});

// ---------------------------------------------------------------------------
// NON-VACUITY — a scan that finds nothing must FAIL, not pass
// ---------------------------------------------------------------------------

describe('non-vacuity — the population refuses to collapse', () => {
  it('declares a floor for every counter a collapse would zero', () => {
    expect(Object.keys(FLOORS).sort()).toEqual(['covered', 'sources', 'testFiles']);
    for (const [name, floor] of Object.entries(FLOORS)) {
      expect(floor, `FLOORS.${name} must be a real floor, not zero`).toBeGreaterThan(0);
    }
  });

  it('reports every floor as breached when the walk returns nothing at all', () => {
    const result = scan(repoRoot, { files: [] });
    expect(result.frozen).toEqual([]); // clean by the only measure it has...
    expect(result.vacuous.map((v: { counter: string }) => v.counter).sort()).toEqual([
      'covered',
      'sources',
      'testFiles',
    ]); // ...and that is exactly why it must still fail
  });

  it('breaches the covered floor when the walk finds sources but no covered mocks', () => {
    // The specific collapse this gate is exposed to: `COVERED_SPECIFIERS` is
    // renamed or misspelled, every call site drops out of scope, and the gate
    // reports OK over a population of zero.
    const files = Array.from({ length: 2000 }, (_, i) => `packages/p/src/__tests__/m${i}.test.ts`);
    const result = scan(repoRoot, { files });
    const breached = result.vacuous.map((v: { counter: string }) => v.counter);
    expect(breached).toContain('covered');
    expect(breached).not.toContain('sources');
    expect(breached).not.toContain('testFiles');
  });

  it('exits non-zero on a collapsed population, with the census in the message', () => {
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vi-mock-inherit-empty-'));
    fs.mkdirSync(path.join(probe, 'scripts'));
    for (const f of ['check-vi-mock-inherit.mjs', 'invoked-as.mjs', 'js-comment-mask.mjs']) {
      fs.copyFileSync(path.join(repoRoot, 'scripts', f), path.join(probe, 'scripts', f));
    }
    execFileSync('git', ['init', '-q'], { cwd: probe });

    let status = 0;
    let output = '';
    try {
      // Nothing is `git add`ed, so `git ls-files` succeeds and returns nothing.
      execFileSync('node', ['scripts/check-vi-mock-inherit.mjs'], { cwd: probe, encoding: 'utf8' });
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      status = e.status;
      output = `${e.stdout}${e.stderr}`;
    } finally {
      fs.rmSync(probe, { recursive: true, force: true });
    }
    expect(status, 'an empty scan must be RED — a green here is the defect itself').toBe(1);
    expect(output).toMatch(/population COLLAPSED/);
    expect(output, 'the message must name which counters collapsed').toMatch(/sources: found 0, floor is/);
  });
});

// ---------------------------------------------------------------------------
// The tree as it stands
// ---------------------------------------------------------------------------

describe('repo state — the gate is green on this tree', () => {
  const result = scan(repoRoot);

  it('has no frozen and no unreadable factory on a covered specifier', () => {
    expect(
      result.frozen.map((f: { file: string; line: number; reason?: string }) => `${f.file}:${f.line} ${f.reason}`),
      'Run `pnpm check:vi-mock-inherit` for the full report and the fix guidance.',
    ).toEqual([]);
    expect(result.unreadable.map((u: { file: string; line: number }) => `${u.file}:${u.line}`)).toEqual([]);
  });

  it('actually walked the tree rather than silently matching nothing', () => {
    // The empty-verdict trap: without these, the assertion above passes for the
    // wrong reason on the day the walk breaks. Floors, not exact counts — the
    // measured figures move every day (4004 / 2286 / 107 when this landed).
    expect(result.census.sources).toBeGreaterThan(1000);
    expect(result.census.testFiles).toBeGreaterThan(1000);
    expect(result.census.covered).toBeGreaterThan(50);
    expect(result.census.inherits).toBe(result.census.covered - result.census.automock);
    expect(result.vacuous).toEqual([]);
  });

  it('THE ELEVEN, pinned against the real files — a future edit reddens here', () => {
    // The negative control on disk rather than on a fixture. Each of these was
    // counted as broken by #6768's grep and is correct.
    const eleven = [
      'packages/plugin-dashboard/src/__tests__/ObjectDataTable.bindNotForwarded-6575.test.tsx',
      'packages/plugin-dashboard/src/__tests__/ObjectDataTable.cells.test.tsx',
      'packages/plugin-dashboard/src/__tests__/ObjectDataTable.columnHeader.test.tsx',
      'packages/plugin-dashboard/src/__tests__/ObjectDataTable.columnIdentity.test.tsx',
      'packages/plugin-dashboard/src/__tests__/ObjectDataTable.emitBoundary-6373.test.tsx',
      'packages/plugin-dashboard/src/__tests__/ObjectDataTable.overrideSource-6425.test.tsx',
      'packages/plugin-dashboard/src/__tests__/ObjectDataTable.percentLocale.test.tsx',
      'packages/plugin-dashboard/src/__tests__/ObjectDataTable.stableEmptyRows.test.tsx',
      'packages/plugin-dashboard/src/__tests__/lookupRelationalMeta-6694.test.tsx',
      'packages/app-shell/src/environment/__tests__/EnvironmentListToolbar.test.tsx',
      'packages/app-shell/src/views/__tests__/PageView.test.tsx',
    ];
    expect(eleven).toHaveLength(11);
    for (const file of eleven) {
      expect(fs.existsSync(path.join(repoRoot, file)), `${file} moved — this control tests nothing`).toBe(true);
      const covered = findCallSites(fs.readFileSync(path.join(repoRoot, file), 'utf8')).filter(
        (s: { scope: string }) => s.scope === 'covered',
      );
      expect(covered.length, `${file} no longer mocks ${COVERED}`).toBeGreaterThan(0);
      for (const site of covered) expect(site.verdict, `${file}:${site.line}`).toBe('inherits');
    }
  });

  it('the deliberate whole-module replacement is out of scope, not exempted', () => {
    // `vi.mock('./ObjectCalendar', ...)` — triage named this one as the thing a
    // wide gate would have annoyed someone with.
    const file = 'packages/plugin-calendar/src/registration.test.tsx';
    expect(fs.existsSync(path.join(repoRoot, file))).toBe(true);
    const sites = findCallSites(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
    const calendar = sites.filter((s: { specifier: string }) => s.specifier === './ObjectCalendar');
    expect(calendar.length, 'the named instance is gone — this control tests nothing').toBeGreaterThan(0);
    for (const site of calendar) expect(site.scope).toBe('local');
  });

  it('THE SUBPATH SITES, pinned against the real files — objectui#8141', () => {
    // The on-disk half of the boundary. Both were `workspace` (counted, never
    // judged) until objectui#8141 and both already inherited, which is why the
    // prefix match was free; if a later edit re-freezes one, this reddens here
    // as well as in the gate.
    const subpathSites = ['packages/plugin-form/src/MasterDetailForm.outcomeToastSupersede.test.tsx', 'packages/plugin-form/src/WizardForm.outcomeToastSupersede.test.tsx'];
    for (const file of subpathSites) {
      expect(fs.existsSync(path.join(repoRoot, file)), `${file} moved — this control tests nothing`).toBe(true);
      const sites = findCallSites(fs.readFileSync(path.join(repoRoot, file), 'utf8')).filter(
        (s: { specifier: string }) => s.specifier.includes('/', s.specifier.indexOf('/') + 1),
      );
      const onAMember = sites.filter((s: { scope: string }) => s.scope === 'covered');
      expect(onAMember.length, `${file} no longer mocks a subpath of a covered member`).toBeGreaterThan(0);
      for (const site of onAMember) expect(site.verdict, `${file}:${site.line}`).toBe('inherits');
    }
  });

  it('puts the census in the verdict, so a reader sees the population', () => {
    // "OK" alone is what a gate that does nothing also prints.
    //
    // The names come from `COVERED_SPECIFIERS`, not from a copy of it: the list
    // is GROW-ONLY, and a case spelling one member reads as an assertion about
    // the verdict line while actually asserting the set's SIZE — measured, it
    // failed on objectui#7337's flip for that reason and nothing else.
    const named = COVERED_SPECIFIERS.join(', ');
    const line = summarise(result);
    expect(line).toMatch(/\d+ tracked source file\(s\)/);
    // "and their subpaths" is load-bearing rather than decorative: the resolver
    // judges a member AND its subpaths (objectui#8141), and a verdict line that
    // named only the members would claim less than the run actually checked --
    // the same over-claim in the other direction.
    expect(line).toMatch(new RegExp(`\\d+ call site\\(s\\) on ${escapeRe(named)} and their subpaths judged`));
    const out = execFileSync('node', ['scripts/check-vi-mock-inherit.mjs'], { cwd: repoRoot, encoding: 'utf8' });
    expect(out).toMatch(/check-vi-mock-inherit: OK/);
    expect(out).toContain(`${result.census.covered} call site(s) on ${named} and their subpaths judged`);
  });

  it('needs no install and no build — it is a cheap-tier gate', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'scripts/check-vi-mock-inherit.mjs'), 'utf8');
    const imports = [...src.matchAll(/^import .*? from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(3);
    for (const spec of imports) {
      expect(spec.startsWith('node:') || spec.startsWith('./'), `${spec} would need an install`).toBe(true);
    }
  });

  it('judges the SAME population the sibling specifier gate walks', () => {
    // The two gates ask different questions about one set of call sites. A
    // population that drifts between them is a hole neither one reports.
    const sibling = fs.readFileSync(path.join(repoRoot, 'scripts/check-vi-mock-specifiers.mjs'), 'utf8');
    const mine = fs.readFileSync(path.join(repoRoot, 'scripts/check-vi-mock-inherit.mjs'), 'utf8');
    const patternOf = (src: string) => src.match(/export const CALL_RE = (.+);/)?.[1];
    expect(patternOf(mine)).toBe(patternOf(sibling));
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe('wiring — the gate is reachable and every PR shape starts it', () => {
  const SCRIPT = 'scripts/check-vi-mock-inherit.mjs';
  const WORKFLOW = 'repo-gates.yml';
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));

  /** A workflow's YAML with whole-line comments removed — see the sibling suite. */
  const yamlOf = (file: string) =>
    fs
      .readFileSync(path.join(workflowDir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

  it('is exposed as a root package script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:vi-mock-inherit']).toBe(`node ${SCRIPT}`);
  });

  it('has a workflow that gates pull requests, not just pushes', () => {
    expect(fs.existsSync(path.join(workflowDir, WORKFLOW)), 'a check nothing runs is not a gate').toBe(true);
    const yaml = yamlOf(WORKFLOW);
    expect(yaml).toMatch(new RegExp(`run:\\s*node\\s+${SCRIPT.replace(/[.]/g, '\\.')}`));
    expect(yaml).toMatch(/^\s*pull_request:/m);
    expect(yaml).toMatch(/^\s*push:/m);
  });

  it('subscribes merge_group — a required check that skips a queue build stalls it', () => {
    expect(yamlOf(WORKFLOW)).toMatch(/^\s*merge_group:/m);
  });

  it('runs it in NO path-filtered workflow', () => {
    // A mock can be written into any package, so no path filter is correct.
    expect(workflowFiles.length, 'the workflow directory scan returned implausibly few files').toBeGreaterThan(5);
    for (const file of workflowFiles) {
      const yaml = yamlOf(file);
      if (!yaml.includes(SCRIPT)) continue;
      expect(yaml, `${file} runs ${SCRIPT} behind a paths-ignore`).not.toMatch(/paths-ignore:/);
      expect(yaml, `${file} runs ${SCRIPT} behind a paths filter — see objectui#3448`).not.toMatch(/^\s+paths:/m);
    }
  });

  it('has exactly one home', () => {
    expect(workflowFiles.filter((f) => yamlOf(f).includes(SCRIPT))).toEqual([WORKFLOW]);
  });

  it('installs nothing before running the gate — the cheap tier, mechanically', () => {
    // Since objectui#12214 the home is `repo-gates.yml`, ONE job that installs
    // after its install-free gates: the property is now an ORDER -- this gate's
    // step sits before the job's `pnpm install` -- and no longer an absence.
    const yaml = yamlOf(WORKFLOW);
    const gateAt = yaml.indexOf(SCRIPT);
    const installAt = yaml.indexOf('pnpm install');
    expect(gateAt).toBeGreaterThan(-1);
    expect(installAt === -1 || gateAt < installAt, 'the gate step moved below the install step').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// objectui#7337 — the `@object-ui/i18n` sweep
// ---------------------------------------------------------------------------

/** The specifier objectui#7337 swept, and the second member of `COVERED_SPECIFIERS`. */
const I18N = '@object-ui/i18n';

/** Classify one factory in isolation against an arbitrary covered specifier. */
function verdictFor(spec: string, factory: string) {
  const sites = findCallSites(mockCall(spec, factory), { covered: [spec] });
  expect(sites, 'the fixture must produce exactly one call site').toHaveLength(1);
  return sites[0];
}

describe('the generic argument NESTS — `vi.importActual<Record<string, unknown>>(…)`', () => {
  /**
   * The recogniser's optional generic was `<[^>]*>`, which stops at the FIRST
   * `>`. Against `vi.importActual<Record<string, unknown>>('@object-ui/i18n')`
   * it consumed `<Record<string, unknown>` and then failed on the `>` that
   * follows, so the whole call went unmatched and the factory was reported as
   * one that "never obtains the real module" — on code that obtains it and
   * spreads it.
   *
   * That is the failure this gate's own header rules out by name, and it stayed
   * invisible because the covered set was `@object-ui/react`, where nobody
   * writes the spelling. Measured over the whole tree at the fix: 349 frozen
   * across all 21 workspace specifiers became 344, and no site moved the other
   * way.
   */

  const RECEIVER = `async () => { const actual = await OBTAIN; return { ...actual, X: Stub }; }`;
  const withObtain = (generic: string) => RECEIVER.replace('OBTAIN', importActual(I18N, generic));

  it('reads the NESTED generic the four real files write', () => {
    expect(verdictFor(I18N, withObtain('<Record<string, unknown>>')).verdict).toBe('inherits');
  });

  it('still reads the spellings that always worked — no generic, and a flat one', () => {
    expect(verdictFor(I18N, withObtain('')).verdict).toBe('inherits');
    expect(verdictFor(I18N, withObtain('<any>')).verdict).toBe('inherits');
    expect(verdictFor(I18N, withObtain(`<typeof import(${Q}${I18N}${Q})>`)).verdict).toBe('inherits');
  });

  it('reads a generic nested twice — the scan is balanced, not one level deep', () => {
    expect(verdictFor(I18N, withObtain('<Record<string, Record<string, unknown>>>')).verdict).toBe('inherits');
  });

  it('an UNBALANCED angle bracket is not read as an obtain — it stays FROZEN', () => {
    // The failure direction of an unforeseen spelling is the verdict the old
    // regex already gave, never a false GREEN.
    expect(verdictFor(I18N, withObtain('<Record<string, unknown>')).verdict).toBe('frozen');
  });

  it('an importActual of a DIFFERENT specifier still does not inherit this one', () => {
    const other = RECEIVER.replace('OBTAIN', importActual('@object-ui/auth', '<Record<string, unknown>>'));
    expect(verdictFor(I18N, other).verdict).toBe('frozen');
  });

  it('THE FOUR REAL FILES: each obtains and spreads through the nested spelling', () => {
    // Pinned against the files on disk, not against a reconstruction: these are
    // the four the old regex called frozen, and a future edit reddens here.
    const misread = [
      'packages/app-shell/src/console/cloud-connection/__tests__/CloudConnectionPanel.bindError.test.tsx',
      'packages/app-shell/src/console/cloud-connection/__tests__/CloudConnectionPanel.bindErrorLocale.test.tsx',
      'packages/app-shell/src/layout/__tests__/AppSwitcher.publishState.test.tsx',
      'packages/app-shell/src/preview/__tests__/UnpublishedAppBar.test.tsx',
    ];
    for (const file of misread) {
      const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      expect(source, `${file} no longer writes the nested-generic obtain`).toContain(
        `${'importActual'}<Record<string, unknown>>`,
      );
      const judged = findCallSites(source, { covered: [I18N] }).filter((s: { scope: string }) => s.scope === 'covered');
      expect(judged.map((s: { verdict: string }) => s.verdict), file).toEqual(['inherits']);
    }
  });
});

describe('the sweep — every `@object-ui/i18n` factory inherits, and the specifier is covered', () => {
  /**
   * objectui#7337 converted 29 frozen factories and deleted a 30th
   * (`apps/console/dev/__tests__/setup/common-mocks.ts`, a helper with zero
   * importers repo-wide). The 31st — `DeclaredActionsBar.test.tsx` — was held
   * by an open PR at the time and kept the population at one, so the sweep
   * shipped without widening `COVERED_SPECIFIERS`: flipping it while a frozen
   * factory remains fails this gate on the very next run. That file has since
   * been converted and the specifier added, in the one PR the gate's own header
   * requires — so the assertions below are no longer a stand-in for the ratchet,
   * they are the census the ratchet is computed over.
   */

  const swept = () => scan(repoRoot, { covered: [I18N], floors: {} });

  it('no `@object-ui/i18n` factory freezes the surface', () => {
    const result = swept();
    expect(
      result.frozen.map((f: { file: string; line: number }) => `${f.file}:${f.line}`),
      'convert these to the obtain-and-spread form — the specifier is covered, so the gate reds too',
    ).toEqual([]);
    expect(result.unreadable, 'a factory the gate cannot read is never a pass').toEqual([]);
  });

  it('walked a real population — a collapsed scan cannot read as a swept one', () => {
    // Same discipline as `FLOORS`: this describe's green is a claim about 92
    // call sites, so the count is asserted rather than assumed.
    const census = swept().census;
    expect(census.covered).toBeGreaterThan(60);
    expect(census.inherits).toBeGreaterThan(60);
    expect(census.covered - census.inherits - census.automock).toBe(0);
  });

  it('the specifier IS in COVERED_SPECIFIERS — the sweep is held by the gate, not by this file', () => {
    // The positive half of the pin this replaces. Without it the third step of
    // objectui#7337 could be reverted in silence: dropping a member makes every
    // i18n call site unjudged, so the gate stays GREEN over a population it no
    // longer looks at — the one direction a ratchet must never be free to move.
    expect(
      COVERED_SPECIFIERS,
      'the sweep landed; removing the specifier retires the ratchet silently',
    ).toContain(I18N);
  });

  it('the zero-importer mock helper is gone, not merely unreferenced', () => {
    // The needle is ASSEMBLED, for the reason "Fixture discipline" gives above:
    // spelt whole it would appear in this file and the search would find
    // itself. Measured — the first draft of this case failed exactly that way.
    const needle = `applyCommon${'ConsoleMocks'}`;
    expect(fs.existsSync(path.join(repoRoot, 'apps/console/dev/__tests__/setup/common-mocks.ts'))).toBe(false);
    // `git grep` exits 1 on no match, which is the PASSING case, so the run is
    // read rather than thrown: `execFileSync` would turn the pass into an error.
    const hits = spawnSync('git', ['grep', '-l', needle, '--', '.'], { cwd: repoRoot, encoding: 'utf8' });
    expect((hits.stdout ?? '').trim(), 'the deleted helper is named again somewhere').toBe('');
    expect(hits.status, 'git grep itself failed — the search never ran').toBe(1);
  });
});

describe('THE DEATH — a frozen factory kills the file at COLLECTION, not in a test', () => {
  /**
   * The gate's verdict is a prediction about what vitest does. This case makes
   * the prediction and then checks it by running vitest for real, over a
   * throwaway package whose "next export" is the one added the day after the
   * factory was written — objectui#7337's own reproduction, minus the repo.
   *
   * Three legs, and the third is what stops the first from being vacuous:
   *
   *   1. FROZEN factory + a MODULE-SCOPE read  -> the suite never collects.
   *      `Tests  no tests`: zero failed assertions, which is why objectui#6768
   *      records that this reads as flake and bills the wrong author.
   *   2. INHERITING factory, same read         -> collects and passes.
   *   3. FROZEN factory + a LAZY read          -> collects, and fails as an
   *      ordinary assertion pointing at the culprit. So leg 1 is measuring the
   *      MODULE-SCOPE read, not merely the presence of a frozen factory —
   *      without leg 3 a suite that failed for any reason at all would satisfy
   *      it.
   */

  /** A specifier that exists only inside the fixture tree. */
  const SPEC = '@fixture/i18n';

  const REAL_MODULE = [
    `export const useObjectTranslation = () => ({ t: (k) => k });`,
    `// The export added the day AFTER every frozen factory below was written.`,
    `export const createSafeTranslation = (defaults) => () => ({ t: (k) => defaults?.[k] ?? k });`,
    '',
  ].join('\n');

  const FROZEN = `() => ({ useObjectTranslation: () => ({ t: (k) => k }) })`;
  const INHERITING = `async (importOriginal) => ({ ...(await importOriginal()), useObjectTranslation: () => ({ t: (k) => k }) })`;

  const EAGER = [
    `import { createSafeTranslation } from ${Q}${SPEC}${Q};`,
    `export const DISCARD_GUARD = createSafeTranslation({ discard: ${Q}Discard?${Q} });`,
    '',
  ].join('\n');

  const LAZY = [
    `import { createSafeTranslation } from ${Q}${SPEC}${Q};`,
    `export const discardGuard = () => createSafeTranslation({ discard: ${Q}Discard?${Q} });`,
    '',
  ].join('\n');

  const suite = (factory: string, importLine: string, body: string) =>
    [`import { expect, it, vi } from ${Q}vitest${Q};`, mockCall(SPEC, factory), importLine, body, ''].join('\n');

  const roots: string[] = [];

  /**
   * A throwaway package tree. `vitest` is resolved by walking UP from the
   * fixture, so one symlink is everything it borrows from this repo; the mocked
   * specifier is a REAL package inside the fixture's own `node_modules`, which
   * is what makes it a bare specifier the gate judges rather than a relative
   * one it declines to.
   */
  function fixturePackage(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-mock-collection-death-'));
    roots.push(root);
    const pkg = path.join(root, 'node_modules', SPEC);
    fs.mkdirSync(pkg, { recursive: true });
    fs.symlinkSync(path.join(repoRoot, 'node_modules/vitest'), path.join(root, 'node_modules/vitest'));
    fs.writeFileSync(
      path.join(pkg, 'package.json'),
      `${JSON.stringify({ name: SPEC, version: '0.0.0', type: 'module', main: 'index.mjs' }, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(pkg, 'index.mjs'), REAL_MODULE);
    for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), body);
    return root;
  }

  /**
   * ANSI SGR sequences, built from the escape's CODE POINT — a raw control byte
   * in this source is what `pnpm check:control-bytes` exists to refuse.
   */
  const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  const stripAnsi = (text: string) => text.replace(SGR, '');

  /**
   * The nested run.
   *
   * Three things about the child are DELIBERATE, and the first two are repairs
   * (CI run 34003883330, job 101407488095, where three assertions here failed
   * on output that visibly contained the text they were matching):
   *
   *   1. **The verdict comes from the JSON reporter, not from the summary.**
   *      Under GitHub Actions the child colours its output, so the summary line
   *      is really `Tests ` + SGR + `1 failed` + SGR + ` (1)` and `\s+` matches
   *      no escape sequence. Pinning a human-readable summary through a regex
   *      was the fragile part; the counts are read from structured data now and
   *      the prose is only checked after `stripAnsi`, which is belt to that
   *      brace. Reproduced byte-for-byte in `the summary matcher survives the
   *      colour CI adds` below.
   *   2. **`GITHUB_ACTIONS` is removed from the child's env.** Legs 1 and 3
   *      fail ON PURPOSE, and with that variable set the child switches on
   *      vitest's github-actions reporter and writes `::error file=…`
   *      annotations — which the CI log shows it did, decorating the parent's
   *      own run with failures from a fixture that is behaving correctly.
   *   3. `NO_COLOR` asks for uncoloured output. It is not relied on: the
   *      stripping above is what makes the assertions true either way. ⭐ It is
   *      stated at the call site rather than left to the environment, and that
   *      is now the only thing deciding it: `childVitestEnv()` removes the
   *      agent markers an agent container sets, which vitest otherwise reads to
   *      turn colour off, swap in its `agent` reporter and change coverage
   *      defaults — silently, and only outside CI (objectui#8616).
   */
  function runVitest(root: string) {
    const env = childVitestEnv({ NO_COLOR: '1' });
    delete env.GITHUB_ACTIONS;
    delete env.FORCE_COLOR;
    const reportAt = path.join(root, 'vitest-report.json');
    const run = spawnSync(
      path.join(repoRoot, 'node_modules/.bin/vitest'),
      ['run', '--root', root, '--reporter=default', '--reporter=json', `--outputFile.json=${reportAt}`],
      { cwd: root, encoding: 'utf8', env },
    );
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    if (!fs.existsSync(reportAt)) {
      throw new Error(`the nested vitest wrote no JSON report -- it did not run:\n${output}`);
    }
    const report = JSON.parse(fs.readFileSync(reportAt, 'utf8'));
    const suite = report.testResults?.[0] ?? {};
    return {
      status: run.status,
      plain: stripAnsi(output),
      /** Structured, so no assertion here depends on how vitest PRINTS. */
      facts: {
        success: report.success,
        total: report.numTotalTests,
        passed: report.numPassedTests,
        failed: report.numFailedTests,
        suiteStatus: suite.status,
        /** 0 when the file never collected: there was no test to run. */
        assertions: suite.assertionResults?.length ?? 0,
        /** A suite-level message is where a COLLECTION error lands. */
        suiteMessage: String(suite.message ?? ''),
      },
    };
  }

  afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  it('the gate PREDICTS the two outcomes before either is run', () => {
    expect(verdictFor(SPEC, FROZEN).verdict).toBe('frozen');
    expect(verdictFor(SPEC, INHERITING).verdict).toBe('inherits');
  });

  it('the summary matcher survives the colour CI adds', () => {
    // The exact bytes from CI run 34003883330, job 101407488095, rebuilt from
    // the escape's code point. Under GitHub Actions the child colours its
    // summary, so `Tests ` and `1 failed` are separated by SGR sequences rather
    // than by whitespace -- which is why three assertions here failed on output
    // that visibly contained the text they were matching.
    const e = String.fromCharCode(27);
    const asCiPrinted = `${e}[2m      Tests ${e}[22m ${e}[1m${e}[31m1 failed${e}[39m${e}[22m${e}[90m (1)${e}[39m`;
    expect(asCiPrinted, 'the historical defect, reproduced').not.toMatch(/Tests\s+1 failed/);
    expect(stripAnsi(asCiPrinted), 'and what this file matches on now').toMatch(/Tests\s+1 failed/);
    expect(stripAnsi(asCiPrinted)).toBe('      Tests  1 failed (1)');
  });

  it('LEG 1 — frozen factory, module-scope read: the file dies during COLLECTION', () => {
    const root = fixturePackage({
      'consumer.mjs': EAGER,
      'frozen.test.mjs': suite(
        FROZEN,
        `import { DISCARD_GUARD } from ${Q}./consumer.mjs${Q};`,
        `it(${Q}never runs${Q}, () => { expect(DISCARD_GUARD).toBeTypeOf(${Q}function${Q}); });`,
      ),
    });
    const { status, plain, facts } = runVitest(root);
    expect(status, plain).not.toBe(0);
    // STRUCTURED, so nothing here depends on how vitest prints. The suite was
    // found and failed, and NO test inside it ever existed to be run: that is
    // collection death, and `total: 0` is what leg 3 will contradict.
    expect(facts.suiteStatus).toBe('failed');
    expect(facts.total, 'a collected file would report its tests').toBe(0);
    expect(facts.assertions, 'no test ran, so there is nothing to blame').toBe(0);
    expect(facts.failed, 'the signature objectui#6768 measured: ZERO failed assertions').toBe(0);
    expect(facts.suiteMessage, 'the collection error lands on the SUITE').toContain(
      'No "createSafeTranslation" export is defined on the "@fixture/i18n" mock',
    );
    // ...and the human-readable half the card quotes, after ANSI is stripped.
    expect(plain).toMatch(/Failed Suites\s+1/);
    expect(plain, 'zero failed assertions is what makes this read as flake').toMatch(/Tests\s+no tests/);
  }, 120_000);

  it('LEG 2 — the converted factory, same read: it collects and passes', () => {
    const root = fixturePackage({
      'consumer.mjs': EAGER,
      'inheriting.test.mjs': suite(
        INHERITING,
        `import { DISCARD_GUARD } from ${Q}./consumer.mjs${Q};`,
        `it(${Q}runs${Q}, () => { expect(DISCARD_GUARD).toBeTypeOf(${Q}function${Q}); });`,
      ),
    });
    const { status, plain, facts } = runVitest(root);
    expect(status, plain).toBe(0);
    expect(facts.success).toBe(true);
    expect(facts.total).toBe(1);
    expect(facts.passed).toBe(1);
    expect(plain).toMatch(/Tests\s+1 passed/);
  }, 120_000);

  it('LEG 3 — the NON-VACUITY control: a lazy read fails as an ordinary test', () => {
    const root = fixturePackage({
      'lazy-consumer.mjs': LAZY,
      'lazy.test.mjs': suite(
        FROZEN,
        `import { discardGuard } from ${Q}./lazy-consumer.mjs${Q};`,
        `it(${Q}collects, then fails${Q}, () => { expect(discardGuard()).toBeTypeOf(${Q}function${Q}); });`,
      ),
    });
    const { status, plain, facts } = runVitest(root);
    expect(status, plain).not.toBe(0);
    // Same missing export, same frozen factory -- and a completely different
    // shape, because the read is no longer at module scope. THESE THREE are
    // what stop leg 1 from being satisfied by any red run at all: the file
    // COLLECTED, one test existed, and the failure is an assertion.
    expect(facts.total, 'the file collected, so its test exists').toBe(1);
    expect(facts.assertions, 'and it ran -- leg 1 reports 0 here').toBe(1);
    expect(facts.failed).toBe(1);
    expect(facts.suiteMessage, 'nothing failed at COLLECTION this time').toBe('');
    expect(plain).toContain('No "createSafeTranslation" export is defined on the "@fixture/i18n" mock');
    expect(plain, 'a lazy read collects, so the failure is an assertion').toMatch(/Tests\s+1 failed/);
    expect(plain).not.toMatch(/Failed Suites/);
  }, 120_000);
});
