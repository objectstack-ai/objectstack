/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5034 point 3 — the url contract for `navigateOnSuccess`.
 *
 * Points 1 and 2 (mount-blindness, and a refused destination reported as a plain
 * success) landed in PR #5558 and are pinned by
 * `navigateOnSuccess.mountSeam.test.tsx`. Those changed WHO travels and left
 * WHICH destinations are accepted byte-identical, deliberately, because the
 * acceptance set was ruled but not yet implemented. This file is that acceptance
 * set.
 *
 * ## The ruling being implemented
 *
 * Maintainer, 2026-08-17, recorded on the card, verbatim 「同意」:
 *
 *   "As a compat alias it runs under the os#7496 ruled semantics: relative-only
 *   (same-origin absolutes refused like any out-of-contract value), navigation
 *   through the injected seam ruled on #4989 once it lands (mount-aware), and the
 *   interpolated id URL-escaped."
 *
 * Three admissions follow, and each has its own block below: relative-only,
 * escaped interpolation, and the `{id}` / `{recordId}` dialect kept for existing
 * authors of this key (the compat half of the same ruling — the docs point new
 * authoring at `submitBehavior`, the code keeps honouring the old spelling).
 *
 * ## Why the two halves are pinned separately
 *
 * Relative-only is a rule about where a destination STARTS; escaping is a rule
 * about what a token may inject further along. Neither implies the other, and
 * `submitRedirect.ts` records the same split for the ruled sibling. The block
 * `neither half substitutes for the other` measures that directly: it drives one
 * value through each half and shows which assertion fires.
 *
 * ## Two properties asserted over a corpus rather than case by case
 *
 * 1. **No widening** (the card only ever narrows). Every destination this helper
 *    accepts must still be same-origin — the exact question the guard it replaces
 *    asked — so the reachable set can only have shrunk.
 * 2. **The deleted browser-navigation arm is unreachable.** Both call sites used
 *    to fork on `isAppRelativeDestination(nav)` and fall back to
 *    `window.location.assign`. That arm is deleted, and this is the proof it was
 *    dead rather than the argument that it should be: the real predicate is
 *    imported and asked about every accepted value.
 *
 * The same corpus does double duty as the drift detector for the deliberate
 * SECOND spelling of the relative test (`successBehavior.ts` does not import
 * `isAppRelativeDestination` — see its docblock for why the two keys must stay
 * free to diverge). If the two ever disagree, `the two predicates agree` goes red
 * on that day rather than silently moving this key's acceptance set.
 *
 * ## Reverse verification — direction predicted before running, counts measured
 *
 * Mutation A, restoring the pre-ruling admission (the same-origin guard in place
 * of the relative-only test), escaping left in place. PREDICTED: red on the
 * same-origin absolute refusals and on the corpus properties, with the escaping
 * and compat blocks green because the escape is independent of the admission
 * test. MEASURED: **5 red here** — the 2 relative-only refusals, `neither half
 * substitutes`, and 2 of the 3 corpus properties.
 *
 * The corpus half is the one worth reading. `THE DELETED ARM IS UNREACHABLE`
 * goes RED, which is what makes it a proof rather than a tautology: widen the
 * admission door and the corpus immediately produces an accepted destination
 * that is not app-relative — i.e. one that would have reached the browser
 * navigation arm this card deleted. `NO WIDENING` stays GREEN, correctly and
 * not incidentally: it asks about ORIGIN, and the pre-ruling admission was a
 * same-origin test, so it has nothing to detect here. It is a change detector
 * for a future widening past same-origin, not for this mutation.
 *
 * Mutation B, deleting the `encodeURIComponent` (interpolating the raw value),
 * relative-only left in place. PREDICTED: red on the escaping block, with one
 * case going red by turning ACCEPTED-and-escaped into REFUSED rather than by
 * returning a differently-escaped string. MEASURED: **5 red here**, and the
 * prediction was right about the phenomenon and wrong about its address — all
 * five failures here are value mismatches (`/r/a/b c` for `/r/a%2Fb%20c`, and
 * the address surviving intact in `neither half substitutes`). The
 * accepted-turns-refused case exists but lands in the verdict table of
 * `navigateOnSuccess.mountSeam.test.tsx`, where a template of `{id}` with an
 * origin in the id raw-interpolates into an absolute URL and is then refused by
 * the still-present relative-only test: `expected null to be
 * 'http%3A%2F%2Flocalhost%3A3000%2Fr'`. The asymmetry is real; this file is
 * simply not where it shows.
 *
 * Full output for both is recorded in the PR body.
 */

import { describe, it, expect } from 'vitest';
import { resolveSuccessNavigate } from './successBehavior';
import { isAppRelativeDestination } from './thankYouRedirectNavigation';

/** The origin the test environment serves — never spelled literally. */
const ORIGIN = window.location.origin;

describe('objectui#5034 point 3 — relative-only admission', () => {
  it('refuses a same-origin ABSOLUTE template, like any other out-of-contract value', () => {
    // The line the ruling moves. Before: accepted, and navigated at browser
    // level. After: refused at the door, so the submitter gets the success toast
    // carrying the refusal note and NOBODY navigates.
    expect(resolveSuccessNavigate(`${ORIGIN}/r/{id}`, { id: 'r1' })).toBeNull();
  });

  it('refuses a same-origin absolute carrying no token at all', () => {
    // The template needs no interpolation to be out of contract: the shape is
    // refused, not the substitution.
    expect(resolveSuccessNavigate(`${ORIGIN}/r`, { id: 'r1' })).toBeNull();
  });

  it('refuses cross-origin, protocol-relative and scheme-bearing destinations', () => {
    expect(resolveSuccessNavigate('https://evil.example.com/r/{id}', { id: 'r1' })).toBeNull();
    expect(resolveSuccessNavigate('//evil.example.com/r/{id}', { id: 'r1' })).toBeNull();
    expect(resolveSuccessNavigate('javascript:alert(1)', { id: 'r1' })).toBeNull();
  });

  it('keeps admitting every relative shape it admitted before', () => {
    // Narrowing is to ABSOLUTES only. This key is a compat alias with authors on
    // it, so the shapes that are relative today keep working: rooted,
    // document-relative, query-only and fragment-only.
    expect(resolveSuccessNavigate('/r/{id}', { id: 'r1' })).toBe('/r/r1');
    expect(resolveSuccessNavigate('r/{id}', { id: 'r1' })).toBe('r/r1');
    expect(resolveSuccessNavigate('?opened={id}', { id: 'r1' })).toBe('?opened=r1');
    expect(resolveSuccessNavigate('#{id}', { id: 'r1' })).toBe('#r1');
  });
});

describe('objectui#5034 point 3 — the interpolated id is URL-escaped', () => {
  it('escapes structure out of the substituted value', () => {
    // `/` and the space are the two that add path structure. The template is the
    // AUTHOR's and is untouched; only the id — data read off the written record —
    // is escaped.
    expect(resolveSuccessNavigate('/r/{id}', { id: 'a/b c' })).toBe('/r/a%2Fb%20c');
    expect(resolveSuccessNavigate('/r/{recordId}', { recordId: '../../admin' }))
      .toBe('/r/..%2F..%2Fadmin');
  });

  it('cannot let an id become the destination', () => {
    // With the raw value this returned the address in the id. Escaped, it is one
    // opaque segment of the path the author wrote.
    expect(resolveSuccessNavigate('/r/{id}', { id: 'https://evil.example.com/steal' }))
      .toBe('/r/https%3A%2F%2Fevil.example.com%2Fsteal');
  });

  it('does not re-read replacement patterns out of record data', () => {
    // `String.prototype.replace` with a STRING replacement re-interprets the
    // dollar-sign patterns out of the substituted value. This helper passes a
    // function, so an id spelling one of them is data, not an instruction.
    expect(resolveSuccessNavigate('/r/{id}', { id: '$&' })).toBe('/r/%24%26');
    expect(resolveSuccessNavigate('/r/{id}', { id: '$1x' })).toBe('/r/%241x');
  });

  it('escapes every occurrence, not just the first', () => {
    expect(resolveSuccessNavigate('/r/{id}/c/{id}', { id: 'a b' })).toBe('/r/a%20b/c/a%20b');
  });

  it('leaves an id that needs no escaping byte-identical', () => {
    // The overwhelmingly common case — an opaque record id — must read exactly as
    // it did before, or this ruling would have churned every deployed form.
    expect(resolveSuccessNavigate('/r/{id}', { id: 'r1' })).toBe('/r/r1');
    expect(resolveSuccessNavigate('/r/{id}', { id: '65a1f0c3e4b09d7a12345678' }))
      .toBe('/r/65a1f0c3e4b09d7a12345678');
  });
});

describe('objectui#5034 point 3 — neither half substitutes for the other', () => {
  it('shows which half refuses which value', () => {
    // One value per half, driven through both, so the file records WHY there are
    // two rules rather than asserting it in prose.
    //
    // Relative-only cannot see structure injected mid-path: raw-interpolated this
    // would be `/r/https://evil.example.com/steal`, which still starts with `/`
    // and is a perfectly good relative reference. Only the escape catches it.
    expect(resolveSuccessNavigate('/r/{id}', { id: 'https://evil.example.com/steal' }))
      .not.toContain('/steal');
    // The escape cannot see an authored absolute, because the template is not
    // escaped — only the id is. Only relative-only catches it.
    expect(resolveSuccessNavigate(`${ORIGIN}/r/{id}`, { id: 'r1' })).toBeNull();
  });
});

describe('objectui#5034 — the compat half of the ruling is preserved', () => {
  it('keeps the single-brace `{id}` / `{recordId}` dialect and the id fallbacks', () => {
    // Ruled to STAY for existing authors of this key: the convergence the ruling
    // orders is a docs/deprecation pointer at `submitBehavior`, not a silent
    // removal of the spelling deployed forms already carry.
    expect(resolveSuccessNavigate('/r/{id}', { id: 'r1' })).toBe('/r/r1');
    expect(resolveSuccessNavigate('/r/{recordId}', { recordId: 'r2' })).toBe('/r/r2');
    expect(resolveSuccessNavigate('/r/{id}', { _id: 'r3' })).toBe('/r/r3');
  });

  it('keeps every refusal that was already a refusal', () => {
    expect(resolveSuccessNavigate(undefined, { id: 'r1' })).toBeNull();
    expect(resolveSuccessNavigate('/r/{id}', {})).toBeNull();
    expect(resolveSuccessNavigate('/r/{id}', { id: '' })).toBeNull();
    expect(resolveSuccessNavigate('/r/{id}', { id: null })).toBeNull();
    expect(resolveSuccessNavigate('/r/{id}', undefined)).toBeNull();
  });

  it('keeps coercing a non-string id rather than refusing it', () => {
    // `String(id)` is unchanged: WHICH ids count as usable is not this card's,
    // and a numeric id is the ordinary shape for a relational DataSource.
    expect(resolveSuccessNavigate('/r/{id}', { id: 42 })).toBe('/r/42');
    expect(resolveSuccessNavigate('/r/{id}', { id: 0 })).toBe('/r/0');
  });
});

/**
 * One corpus, three properties. Deliberately mixed: authored absolutes, hostile
 * ids, the shapes a URL parser treats specially, and the ordinary case.
 */
const CORPUS: Array<[template: string, id: unknown]> = [
  ['/r/{id}', 'r1'],
  ['/r/{id}', 'a/b c'],
  ['/r/{id}', 'https://evil.example.com/steal'],
  ['/r/{id}', '//evil.example.com/steal'],
  ['/r/{id}', '../../admin'],
  ['/r/{id}', '?x=1'],
  ['/r/{id}', '#frag'],
  ['/r/{id}', ''],
  ['/r/{id}', 42],
  ['{id}', `${ORIGIN}/r`],
  ['{id}', 'https://evil.example.com/steal'],
  ['r/{id}', 'r1'],
  ['?opened={id}', 'r1'],
  ['#{id}', 'r1'],
  [`${ORIGIN}/r/{id}`, 'r1'],
  ['https://evil.example.com/r/{id}', 'r1'],
  ['//evil.example.com/r/{id}', 'r1'],
  ['javascript:alert({id})', 'r1'],
  // Control characters are written as escape sequences on purpose — a raw one
  // makes the whole file read as binary to grep, and this repo has paid for that.
  ['/r/{id}\u0009tab', 'r1'],
  ['\\\\evil.example.com/r/{id}', 'r1'],
  ['  /r/{id}', 'r1'],
];

/**
 * The shape space, spelled without any `{id}` token so that each string is its
 * own resolved destination. Rooted, document-relative, query-only,
 * fragment-only, already-escaped, brace-bearing-but-not-a-token, absolute
 * same-origin, cross-origin, protocol-relative, backslash-authority,
 * scheme-bearing, and leading-whitespace.
 */
const TOKEN_FREE_SHAPES: string[] = [
  '/r/r1',
  'r/r1',
  '?opened=r1',
  '#r1',
  '/r/a%2Fb%20c',
  '/r/{unknown}',
  `${ORIGIN}/r`,
  'https://evil.example.com/r',
  '//evil.example.com/r',
  '\\\\evil.example.com/r',
  'javascript:alert(1)',
  '  /r/r1',
];

describe('objectui#5034 point 3 — properties over a corpus', () => {
  it('NO WIDENING: every accepted destination is one the old guard also accepted', () => {
    // The guard this ruling replaced asked "does it resolve to this origin?".
    // Relative-only is strictly stronger — a relative reference cannot carry an
    // authority (RFC 3986) — so this must hold for every accepted value, and it
    // is the machine-checkable form of "this card only ever narrows".
    let accepted = 0;
    for (const [template, id] of CORPUS) {
      const result = resolveSuccessNavigate(template, { id });
      if (result === null) continue;
      accepted += 1;
      expect(new URL(result, window.location.href).origin).toBe(ORIGIN);
    }
    // A corpus that accepted nothing would satisfy the loop vacuously.
    expect(accepted).toBeGreaterThan(0);
  });

  it('THE DELETED ARM IS UNREACHABLE: every accepted destination is app-relative', () => {
    // Both call sites used to fork on this exact predicate and fall back to
    // `window.location.assign` for anything it refused. The fallback is gone; this
    // is the measurement that nothing could have reached it, asked of the real
    // function rather than of a restatement of it.
    for (const [template, id] of CORPUS) {
      const result = resolveSuccessNavigate(template, { id });
      if (result === null) continue;
      expect(isAppRelativeDestination(result)).toBe(true);
    }
  });

  it('the two predicates agree — the drift detector for the second spelling', () => {
    // `successBehavior.ts` spells the relative test itself instead of importing
    // this one, because the two keys are ruled in OPPOSITE directions on the
    // same-origin-absolute shape (objectui#5112 keeps browser navigation there;
    // this card refuses it here) and must stay free to diverge. Two spellings
    // that agree today drift silently unless something watches, so this watches.
    //
    // Its own corpus, TOKEN-FREE on purpose: with no `{id}` in the template the
    // resolved url IS the template, which is what makes one function's admission
    // comparable to the other function's verdict on the same string. The empty
    // template is absent because it is refused one guard earlier, by
    // `if (!template)`, and would compare unequal for a reason that is not drift.
    for (const shape of TOKEN_FREE_SHAPES) {
      expect(resolveSuccessNavigate(shape, { id: 'r1' }) !== null)
        .toBe(isAppRelativeDestination(shape));
    }
  });
});
