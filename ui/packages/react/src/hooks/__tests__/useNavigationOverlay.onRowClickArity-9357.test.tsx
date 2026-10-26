/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9357 — `UseNavigationOverlayOptions.onRowClick` declares the
 * modifier payload it is actually invoked with, and `handleClick` calls it
 * without a type assertion.
 *
 * ## The defect
 *
 * The option declared ONE parameter:
 *
 *     onRowClick?: (record: Record<string, unknown>) => void;
 *
 * and `handleClick`, 126 lines below in the same file, asserted that
 * declaration away in order to call it with TWO — the record and the modifier
 * payload a host needs for Cmd/Ctrl/middle-click. The assertion was the only
 * thing holding the two apart: a declaration that had lost an argument, not a
 * hook that needed one.
 *
 * ## Why the instrument here is not an assignability assertion
 *
 * ⭐ Widening this option is source-compatible in BOTH directions — a
 * one-parameter handler stays assignable to a two-parameter optional
 * signature, and a two-parameter optional handler stays assignable to the
 * one-parameter spelling (its minimum argument count is still 1). That is the
 * measurement `SOURCE COMPATIBILITY` below makes. It is a statement about those
 * two spellings and nothing wider: one class of consumer IS refused by the
 * widening — a handler whose second parameter is annotated narrower than
 * `HandleClickModifiers` — and `THE ACCEPT-SET BOUNDARY` below pins it.
 *
 * It is also exactly why an `extends` / assignability pin would assert
 * NOTHING here. Both spellings satisfy each other, so such a pin is green on
 * the broken tree and green on the repaired one — a dead instrument on a
 * type-only card. The two instruments that CAN separate them are used
 * instead, and both are proven able to fire:
 *
 *  - the COMPILE-TIME half reads the parameter LIST (`Parameters<…>` and its
 *    `length`) through an exact-identity `Equal`, which distinguishes the two
 *    spellings where `extends` cannot. It runs only under
 *    `packages/react`'s `tsconfig.test.json`; vitest erases every line of it.
 *  - the BYTES half reads the declaration and the call site off disk, so the
 *    assertion cannot creep back in under a green type-check.
 *
 * The third block is a RUNTIME control: the implementation really does hand
 * the second argument through. It was true before this card too — it is what
 * made the assertion look harmless — so it is labelled a control rather than
 * a pin, and it reds if a later change makes the widened declaration a
 * promise the implementation stops keeping.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { useNavigationOverlay } from '../useNavigationOverlay';
import type {
  HandleClickModifiers,
  NavigationOverlayState,
  UseNavigationOverlayOptions,
} from '../useNavigationOverlay';
import { uiRoot } from '../../../../../scripts/ui-root.mjs';

/* ------------------------------------------------------------------ *
 * COMPILE-TIME half — erased at runtime. `tsc -p tsconfig.test.json`
 * (chained from this package's `type-check` script) is the only thing
 * that executes it.
 * ------------------------------------------------------------------ */

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type OnRowClick = NonNullable<UseNavigationOverlayOptions['onRowClick']>;
type OnRowClickParams = Parameters<OnRowClick>;

/** The declaration as it stood before this card — the measurement subject. */
type NarrowOnRowClick = (record: Record<string, unknown>) => void;

/**
 * THE PIN. The option takes the record AND the optional modifier payload, so
 * its parameter list spans one-or-two rather than exactly one.
 */
type _AritySpansBoth = Expect<Equal<OnRowClickParams['length'], 1 | 2>>;
type _FirstParamIsTheRecord = Expect<Equal<OnRowClickParams[0], Record<string, unknown>>>;
type _SecondParamIsTheModifiers = Expect<
  Equal<OnRowClickParams[1], HandleClickModifiers | undefined>
>;

/**
 * The option and the handler that invokes it are now the SAME function type.
 * `handleClick` always declared both parameters; this is the half that had
 * drifted.
 */
type _OptionAgreesWithHandleClick = Expect<
  Equal<OnRowClick, NavigationOverlayState['handleClick']>
>;

/**
 * SOURCE COMPATIBILITY — the measurement, reported as a result rather than
 * assumed. Both directions hold between these two spellings, so assigning
 * either to the other breaks nobody (the class that IS broken is annotation-
 * shaped, and is pinned under `THE ACCEPT-SET BOUNDARY` below)...
 */
type _NarrowIsAssignableToWide = Expect<NarrowOnRowClick extends OnRowClick ? true : false>;
type _WideIsAssignableToNarrow = Expect<OnRowClick extends NarrowOnRowClick ? true : false>;

/**
 * ...and THIS is the consequence that decides the instrument: because both
 * directions hold, assignability cannot tell the repaired declaration from
 * the broken one. Exact identity can, and does.
 */
type _IdentityStillSeparatesThem = Expect<Equal<Equal<OnRowClick, NarrowOnRowClick>, false>>;

/**
 * THE ACCEPT-SET BOUNDARY — the one class the widening refuses, pinned rather
 * than only described. A handler passed DIRECTLY to `useNavigationOverlay`
 * whose second parameter is annotated NARROWER than `HandleClickModifiers`
 * compiled before this card and is refused now. Measured on this change:
 *
 *     error TS2322: Type '(_record: Record<string, unknown>, _ev?:
 *     ReactMouseEvent) => void' is not assignable to type '(record:
 *     Record<string, unknown>, event?: HandleClickModifiers | undefined) =>
 *     void'. … Type 'HandleClickModifiers' is missing the following properties
 *     from type 'MouseEvent<Element, MouseEvent>': altKey, buttons, clientX,
 *     clientY, and 26 more.
 *
 * It compiled before only because the old declaration had no second parameter
 * to check the annotation against. Now the parameter is checked
 * contravariantly, so the annotation has to ADMIT `HandleClickModifiers` —
 * and React's mouse event, the shape a host writing against the
 * implementation rather than the declaration reaches for, does not. The remedy
 * at such a call site is one line: annotate the parameter
 * `HandleClickModifiers`, or drop the annotation.
 *
 * ⭐ Why this is a `@ts-expect-error` and not another `Expect` row: the
 * changeset publishes this class and that remedy, and changeset text ships
 * verbatim into `packages/react/CHANGELOG.md`, where it cannot be corrected
 * after release. A directive whose error stops occurring is itself an error
 * (TS2578), so this line reds if the boundary ever moves — the option widened
 * back to one parameter, or the payload respelled `any` — and the published
 * sentence gets revisited instead of going quietly stale. Both readings were
 * taken: refused against the repaired declaration, TS2578-unused against
 * `origin/main`'s.
 */
type NarrowerSecondParam = (record: Record<string, unknown>, event?: ReactMouseEvent) => void;
// @ts-expect-error a second parameter narrower than `HandleClickModifiers` is refused (TS2322)
type _NarrowerSecondParamIsRefused = Expect<NarrowerSecondParam extends OnRowClick ? true : false>;

/**
 * Control: the checker is live in this file and the parameter list really
 * stops at two. If the declaration ever grew a third parameter this directive
 * would become UNUSED and `tsc` would fail with TS2578 — which is why the
 * control is written as an expected error rather than as another assertion.
 */
// @ts-expect-error the option declares no third parameter
type _NoThirdParameter = OnRowClickParams[2];

/* ------------------------------------------------------------------ *
 * BYTES half — the declaration and the call site, read off disk.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/react/src/hooks/__tests__  ->  repo root
const repoRoot = path.resolve(here, '../../../../..');
const HOOK_REL = 'packages/react/src/hooks/useNavigationOverlay.ts';
const HOOK_ABS = path.join(repoRoot, HOOK_REL);

/**
 * Mask `//` and block comments with spaces, leaving every other byte — string
 * contents included — in place. Quoted spans are walked rather than blanked,
 * purely so a `//` inside a URL literal is not read as a comment start.
 */
function maskComments(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && d === '*') {
      out[i++] = ' ';
      out[i++] = ' ';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) {
        out[i++] = ' ';
        out[i++] = ' ';
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

/** The body of a `{ … }` block opened at `openIndex`, brace-balanced. */
function blockAt(masked: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') {
      depth--;
      if (depth === 0) return masked.slice(openIndex + 1, i);
    }
  }
  throw new Error('unbalanced block');
}

const HOOK_SOURCE = readFileSync(HOOK_ABS, 'utf8');
const HOOK_MASKED = maskComments(HOOK_SOURCE);

const OPTIONS_DECL = 'export interface UseNavigationOverlayOptions';
const optionsOpen = HOOK_MASKED.indexOf('{', HOOK_MASKED.indexOf(OPTIONS_DECL));
const OPTIONS_BODY = blockAt(HOOK_MASKED, optionsOpen);

const HANDLE_CLICK_DECL = 'const handleClick = useCallback(';
const handleClickOpen = HOOK_MASKED.indexOf('{', HOOK_MASKED.indexOf(HANDLE_CLICK_DECL));
const HANDLE_CLICK_BODY = blockAt(HOOK_MASKED, handleClickOpen);

/** `onRowClick` declared with a second, optional, named parameter. */
const TWO_PARAMETER_MEMBER =
  /onRowClick\?:\s*\(\s*record:\s*Record<string,\s*unknown>\s*,\s*event\?:\s*HandleClickModifiers\s*\)\s*=>\s*void\s*;/;
/** `onRowClick` declared with exactly one parameter — the defect's spelling. */
const ONE_PARAMETER_MEMBER =
  /onRowClick\?:\s*\(\s*record:\s*Record<string,\s*unknown>\s*\)\s*=>\s*void\s*;/;
/** Any type assertion applied to the `onRowClick` value. */
const ONROWCLICK_ASSERTION = /\bonRowClick\s+as\b/;
/** The call, made on the declared value with both arguments. */
const DIRECT_TWO_ARGUMENT_CALL = /\bonRowClick\(\s*record\s*,\s*event\s*\)/;

describe('the instrument can fire (controls)', () => {
  it('anchors on this file, not on the cwd', () => {
    expect(repoRoot).toBe(uiRoot());
    expect(existsSync(HOOK_ABS)).toBe(true);
  });

  it('found both spans it reads, and they are not empty', () => {
    expect(HOOK_MASKED).toContain(OPTIONS_DECL);
    expect(HOOK_MASKED).toContain(HANDLE_CLICK_DECL);
    expect(OPTIONS_BODY).toContain('onRowClick');
    expect(HANDLE_CLICK_BODY).toContain('onRowClick');
  });

  it('flags an assertion applied to the value', () => {
    // Assembled from fragments so this control is not itself a hit if a
    // source-scanning gate ever walks this file.
    const asserted = '(onRowClick' + ' as ' + '(r: R, e?: E) => void)(record, event);';
    expect(ONROWCLICK_ASSERTION.test(maskComments(asserted))).toBe(true);
  });

  it('masks comments, so prose about the defect is not the defect', () => {
    const commented = '// (onRowClick' + ' as ' + '(r: R) => void)(record, event);\nconst x = 1;';
    expect(ONROWCLICK_ASSERTION.test(maskComments(commented))).toBe(false);
    const block = '/* onRowClick' + ' as ' + 'X */\nconst x = 1;';
    expect(ONROWCLICK_ASSERTION.test(maskComments(block))).toBe(false);
  });

  it('separates the one-parameter spelling from the two-parameter one', () => {
    const narrow = 'onRowClick?: (record: Record<string, unknown>) => void;';
    const wide =
      'onRowClick?: (record: Record<string, unknown>, event?: HandleClickModifiers) => void;';
    expect(TWO_PARAMETER_MEMBER.test(narrow)).toBe(false);
    expect(TWO_PARAMETER_MEMBER.test(wide)).toBe(true);
    // Both matchers are needed and neither subsumes the other: one asserts the
    // repaired spelling is PRESENT, the other that the defect's spelling is
    // ABSENT, and a third spelling would have to satisfy both.
    expect(ONE_PARAMETER_MEMBER.test(narrow)).toBe(true);
    expect(ONE_PARAMETER_MEMBER.test(wide)).toBe(false);
  });
});

describe('UseNavigationOverlayOptions.onRowClick declares its modifier payload (objectui#9357)', () => {
  it('declares the record and the optional modifier payload', () => {
    expect(
      TWO_PARAMETER_MEMBER.test(OPTIONS_BODY),
      [
        `${HOOK_REL}: \`UseNavigationOverlayOptions.onRowClick\` does not declare the`,
        'modifier payload `handleClick` hands it. Every consumer reads this',
        'declaration to learn what its own pass-through receives, so an',
        'understated arity here is copied outward (objectui#9357).',
      ].join('\n'),
    ).toBe(true);
  });

  it('no longer carries the one-parameter spelling', () => {
    const offender = OPTIONS_BODY.match(ONE_PARAMETER_MEMBER)?.[0]?.replace(/\s+/g, ' ');
    expect(
      offender ?? null,
      'the option is declared with one parameter again — the objectui#9357 defect',
    ).toBeNull();
  });
});

describe('handleClick calls the option through its declaration (objectui#9357)', () => {
  it('applies no type assertion to onRowClick', () => {
    expect(
      ONROWCLICK_ASSERTION.test(HOOK_MASKED),
      [
        `${HOOK_REL}: \`onRowClick\` is invoked through a type assertion.`,
        'An assertion here is the producer paying for its own understated',
        'declaration — AGENTS.md #0.1 sends that back to the producer, and the',
        'producer is this file. Declare the parameter instead (objectui#9357).',
      ].join('\n'),
    ).toBe(false);
  });

  it('calls it with both arguments, directly', () => {
    expect(DIRECT_TWO_ARGUMENT_CALL.test(HANDLE_CLICK_BODY)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * RUNTIME control — the implementation keeps the widened promise.
 * ------------------------------------------------------------------ */

describe('the implementation delivers what the declaration now promises', () => {
  it('forwards the record and the modifier payload to onRowClick', () => {
    const onRowClick = vi.fn<(record: Record<string, unknown>, event?: HandleClickModifiers) => void>();
    const { result } = renderHook(() =>
      useNavigationOverlay({ navigation: { mode: 'drawer' }, objectName: 'account', onRowClick }),
    );

    const record = { id: 'a1', name: 'Acme' };
    const event: HandleClickModifiers = { metaKey: true, ctrlKey: false, button: 0 };
    act(() => {
      result.current.handleClick(record, event);
    });

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(record, event);
    // The external handler takes full priority: no overlay is opened behind it.
    expect(result.current.isOpen).toBe(false);
  });

  it('still calls a one-parameter handler, which the widening keeps legal', () => {
    const calls: Array<Record<string, unknown>> = [];
    const oneArg: (record: Record<string, unknown>) => void = (record) => {
      calls.push(record);
    };
    const { result } = renderHook(() =>
      useNavigationOverlay({ navigation: { mode: 'page' }, objectName: 'account', onRowClick: oneArg }),
    );

    const record = { id: 'b2' };
    act(() => {
      result.current.handleClick(record);
    });

    expect(calls).toEqual([record]);
  });
});
