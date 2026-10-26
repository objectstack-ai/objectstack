/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A bare `useObjectTranslation()` fills its inline default's `{{holes}}` even
 * with no `I18nProvider` mounted — objectui#6219.
 *
 * ## What this pins, and why it has to render
 *
 * react-i18next's not-ready `t` (`notReadyT`, used when no i18next instance is
 * initialised) returns `options.defaultValue` VERBATIM. So an inline default
 * written `'Deleted {{count}} rows'` used to reach the user with the braces
 * intact — 68 of them across 24 files, on any host that embeds an ObjectUI
 * component without a provider, which is the configuration
 * `createSafeTranslation` exists for (objectui#3865).
 *
 * ⚠️ **A test that mounts `I18nProvider` can never see that defect.** With a
 * provider, i18next is ready, the pack value wins and the inline default never
 * renders at all — such an assertion is true before and after the fix. Every
 * case below that is doing the actual work therefore renders PROVIDER-LESS and
 * reads `textContent` off the DOM, rather than inspecting the return value of a
 * `t` this file called itself.
 *
 * ## Which cases would still pass on a revert, and why they are here
 *
 * Stated rather than left to be rediscovered:
 *
 *   - `the positive control` — by construction. It proves the probe really is
 *     on the not-ready path (no global instance, raw key for an unknown key).
 *     Green either way is what makes it a control.
 *   - `a pre-interpolated template literal is left exactly as written` — green
 *     either way, deliberately. It is the ⭐ corollary from objectui#4905: at a
 *     bare `useObjectTranslation()` the template-literal form is the CORRECT
 *     spelling, and this fix must not have made it wrong. Its job is to fail if
 *     someone later "tidies" these defaults into `{{hole}}` form or teaches the
 *     interpolator to touch text with no holes.
 *   - `an i18next-only spelling is still not resolved here` — green either way.
 *     objectui#3512 ruled against teaching the fallback i18next's other
 *     dialects; this fix widens which BINDINGS interpolate, never which
 *     SPELLINGS resolve, and this case is what holds that line.
 *   - `with a provider mounted, the pack value still wins` — green either way.
 *     A must-not-break, and the structural half of "never interpolate twice".
 *
 * Everything under `THE PIN` fails on a revert.
 */

import { describe, it, expect } from 'vitest';
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { getI18n, useTranslation } from 'react-i18next';
import { I18nProvider, useObjectTranslation } from '../index';

/** A key no locale pack defines, so the inline default is what renders. */
const MISSING = 'probe.no.such.key.6219';

function Probe({
  options,
  tKey = MISSING,
}: {
  options?: Record<string, unknown>;
  tKey?: string;
}) {
  const { t } = useObjectTranslation();
  // `as string`: with an options object react-i18next's overload widens to
  // `string | TFunctionDetailedResult`, and the detailed shape only appears
  // under `returnObjects`/`returnDetails`, which nothing here passes. Casting
  // at the probe keeps the assertions about text rather than about types.
  const value = (options === undefined ? t(tKey) : t(tKey, options as never)) as string;
  return <span data-testid="out">{value}</span>;
}

const out = () => screen.getByTestId('out').textContent;

describe('the not-ready `t` interpolates its inline default (objectui#6219)', () => {
  it('the positive control: this really is the provider-less, no-instance path', () => {
    // Green before and after the fix — that is the point. Without it every
    // assertion below could be passing through a leaked global instance from
    // some earlier file, which is exactly the leak `vitest.setup.i18n-global.ts`
    // exists to prevent (objectui#4514).
    expect(getI18n()).toBeUndefined();
    render(<Probe />);
    // No instance, no pack: `notReadyT` answers with the key itself.
    expect(out()).toBe(MISSING);
  });

  it('THE PIN: a {{hole}} in an inline default is filled, not printed', () => {
    render(<Probe options={{ defaultValue: 'Deleted {{count}} rows', count: 3 }} />);
    expect(out()).toBe('Deleted 3 rows');
    expect(out()).not.toContain('{{');
  });

  it('THE PIN: every occurrence, not just the first (objectui#3418 parity)', () => {
    render(
      <Probe options={{ defaultValue: 'Selected {{count}} of {{count}} items', count: 7 }} />,
    );
    expect(out()).toBe('Selected 7 of 7 items');
  });

  it('THE PIN: `$` sequences in the DATA are literal, not replacement syntax', () => {
    // `split/join` rather than `replace`/`replaceAll`, so `$&` in a runtime
    // value (a record label, a search term) cannot re-expand. objectui#3418's
    // second finding, now reachable on this binding too.
    render(<Probe options={{ defaultValue: 'Searching for {{q}}', q: '$& $` cost' }} />);
    expect(out()).toBe('Searching for $& $` cost');
  });

  it('THE PIN: a real-shaped console default renders as prose', () => {
    // The exact shape measured on this tree — `apps/console/.../AppManagementPage.tsx`
    // and `packages/app-shell/src/layout/InboxPopover.tsx` write defaults like
    // this at a bare `useObjectTranslation()`.
    render(
      <Probe options={{ defaultValue: 'Signed in as {{email}}', email: 'ada@example.com' }} />,
    );
    expect(out()).toBe('Signed in as ada@example.com');
  });

  it('`defaultValue` is a lookup control, never interpolation data (objectui#3865)', () => {
    // Same reserved-name rule `createSafeTranslation`'s `fallbackT` follows,
    // because it is now literally the same function.
    render(<Probe options={{ defaultValue: 'x {{defaultValue}} y' }} />);
    expect(out()).toBe('x {{defaultValue}} y');
  });

  it('a pre-interpolated template literal is left exactly as written (⭐ objectui#4905)', () => {
    // WOULD STILL PASS ON A REVERT — deliberately. At a bare
    // `useObjectTranslation()` this is the CORRECT spelling, not residue, and
    // the whole point of fixing the seam instead of the 68 call sites is that
    // it stays correct. Fails if anyone rewrites these into `{{hole}}` form
    // without the holes' data, or teaches the interpolator to touch text that
    // has none.
    const n = 3;
    render(<Probe options={{ defaultValue: `Deleted ${n} rows` }} />);
    expect(out()).toBe('Deleted 3 rows');
  });

  it('an i18next-only spelling is still not resolved here (objectui#3512 held)', () => {
    // WOULD STILL PASS ON A REVERT. #3512 ruled deliberately AGAINST teaching
    // the provider-less fallback i18next's other three dialects, and gated the
    // copy to `{{name}}` instead. This fix widens which bindings interpolate,
    // never which spellings resolve; this case is the line.
    render(<Probe options={{ defaultValue: 'Total {{ count }}', count: 5 }} />);
    expect(out()).toBe('Total {{ count }}');
  });

  it('with no options there is nothing to fill from', () => {
    render(<Probe options={{ defaultValue: 'Deleted {{count}} rows' }} />);
    expect(out()).toBe('Deleted {{count}} rows');
  });
});

describe('the provider path is untouched (objectui#6219 must-not-break)', () => {
  it('with a provider mounted, the pack value still wins and interpolates', () => {
    // WOULD STILL PASS ON A REVERT. Held because the fix must not reach the
    // ready path at all.
    render(
      <I18nProvider
        config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}
        persistLanguage={false}
      >
        <Probe tKey="form.createTitle" options={{ object: 'Contacts', defaultValue: 'IGNORED' }} />
      </I18nProvider>,
    );
    expect(out()).toContain('Contacts');
    expect(out()).not.toContain('IGNORED');
    expect(out()).not.toContain('{{');
  });

  it('with a provider, a `{{hole}}` that came from the DATA is not re-expanded', () => {
    // WOULD STILL PASS ON A REVERT, and it is the behavioural pin for "never
    // interpolate twice": the fix must not reach the ready path at all.
    //
    // Measured on this tree — i18next renders
    // `t('form.createTitle', { object: '{{leak}}', leak: 'BOOM' })` as
    // `'Create {{leak}}'`: it substitutes from the data ONCE and does not
    // re-scan its own output. A second pass by this package's interpolator
    // would then see that `{{leak}}` and turn it into `'BOOM'` — user data
    // reinterpreted as copy syntax. So this asserts on the brace surviving,
    // which is exactly the property that a wrapped ready path would destroy.
    render(
      <I18nProvider
        config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}
        persistLanguage={false}
      >
        <Probe tKey="form.createTitle" options={{ object: '{{leak}}', leak: 'BOOM' }} />
      </I18nProvider>,
    );
    expect(out()).toBe('Create {{leak}}');
    expect(out()).not.toContain('BOOM');
  });
});

describe('the wrapper adds no identity churn of its own (objectui#6219)', () => {
  it('THE PIN: provider-less, `t` moves exactly when react-i18next’s own `t` moves', () => {
    // Call sites put `t` in `useMemo`/`useCallback` dependency arrays, so a
    // wrapper minted fresh on every render would invalidate every one of them
    // on every render — a real regression no output assertion above would
    // catch, because the wrapper would still return the right string.
    //
    // The bound is RELATIVE rather than absolute, and that is a measurement,
    // not a hedge. react-i18next's not-ready `t` is itself only sometimes
    // stable: `getSnapshot` returns the module-level `notReadySnapshot`, but
    // `useTranslation`'s final `useMemo` then wraps it in a fresh warn-once
    // arrow whenever `!ready && !useSuspense`. `createI18n` sets
    // `react: { useSuspense: false }` (packages/i18n/src/i18n.ts) and
    // `initReactI18next` writes that into react-i18next's MODULE-LEVEL
    // defaults, which `vitest.setup.i18n-global.ts` does not reset — it
    // restores the instance pointer, which is a different piece of state. So
    // whether `t` is referentially stable provider-less depends on whether a
    // provider was ever built in this process, and pinning "always stable"
    // would pin the test file's ordering rather than this package's behaviour.
    //
    // What IS this package's behaviour, in both regimes: the wrapper is
    // memoized on the `t` it wraps, so it moves when that moves and not
    // otherwise. Both halves are asserted, so the case cannot go vacuous by
    // sliding into "everything churns".
    function StabilityProbe() {
      const { t: ours } = useObjectTranslation();
      const { t: raw } = useTranslation();
      // `useState`'s lazy initializer, not a ref: it runs on the first render
      // only, so this records what the first render saw without writing during
      // later ones — and unlike `ref.current` it is a value React expects to be
      // read while rendering (`react-hooks/refs` flags the ref spelling).
      const [first] = useState(() => ({ ours, raw }));
      const sameOurs = ours === first.ours;
      const sameRaw = raw === first.raw;
      return <span data-testid="out">{`${sameRaw ? 'raw-same' : 'raw-moved'}/${sameOurs ? 'ours-same' : 'ours-moved'}`}</span>;
    }
    const { rerender } = render(<StabilityProbe />);
    rerender(<StabilityProbe />);
    rerender(<StabilityProbe />);
    expect(out()).toMatch(/^(raw-same\/ours-same|raw-moved\/ours-moved)$/);
  });
});
