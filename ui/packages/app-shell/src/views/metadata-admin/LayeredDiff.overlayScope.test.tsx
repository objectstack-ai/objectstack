// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Layers tab's overlay badge speaks the UI language (objectui#4982).
 *
 * `LayeredDiff` renders four layer badges. Three of them — artifact / none /
 * merged — went through `translateConsoleValue`; the overlay one printed
 * `layered.overlayScope` raw, and `CONSOLE_VALUE_ZH.layer` had no entry for
 * either value that field can hold. So the badge's LANGUAGE depended on whether
 * the item had an overlay: a zh-CN admin opening an overlaid item read `org` /
 * `env`, while an un-overlaid one hit the `set` fallback and read 「已设」. One
 * badge, two languages, decided by data.
 *
 * The scope list is read from `GetMetaItemLayeredResponseSchema` rather than
 * spelled here, so a scope the spec adds is covered by these cases the moment it
 * exists — the same reason `MetadataOverlayScope` is derived rather than
 * restated. (The compile-time half of that coverage is `LAYER_SCOPE_ZH` in
 * `./i18n`, whose key type is the spec union: a new scope with no zh-CN label
 * fails `type-check` before it can reach a badge.)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { GetMetaItemLayeredResponseSchema } from '@objectstack/spec/api';
import type { MetadataLayered } from '@object-ui/data-objectstack';
import { LayeredDiff } from './LayeredDiff';
import { translateConsoleValue } from './i18n';

afterEach(cleanup);

/** Every overlay scope the producer's schema can send. */
const SPEC_SCOPES = GetMetaItemLayeredResponseSchema.shape.overlayScope.unwrap().options;

type Layered = MetadataLayered<Record<string, unknown>>;

function layeredWith(overlayScope: Layered['overlayScope']): Layered {
  const overlaid = overlayScope !== null;
  return {
    code: { label: 'Account' },
    overlay: overlaid ? { label: 'Client' } : null,
    overlayScope,
    effective: { label: overlaid ? 'Client' : 'Account' },
  };
}

describe('LayeredDiff overlay-scope badge (objectui#4982)', () => {
  it('every scope the spec can send has a zh-CN label', () => {
    for (const scope of SPEC_SCOPES) {
      expect(
        translateConsoleValue('layer', scope, 'zh-CN'),
        `CONSOLE_VALUE_ZH.layer has no entry for overlay scope '${scope}'`,
      ).not.toBe(scope);
    }
  });

  it.each(SPEC_SCOPES)('renders the zh-CN label for overlayScope=%s', (scope) => {
    render(<LayeredDiff layered={layeredWith(scope)} locale="zh-CN" />);
    const zh = translateConsoleValue('layer', scope, 'zh-CN');
    expect(screen.getByText(zh)).toBeInTheDocument();
    // The raw producer value must not be on screen anywhere.
    expect(screen.queryByText(scope)).toBeNull();
  });

  it('leaves the raw value alone outside zh — the helper has always done that', () => {
    // `translateConsoleValue` returns the input verbatim for every non-zh
    // locale, for all four layer badges. Whether the other nine locale packs
    // should gain these values is a separate decision, deliberately not made
    // here; this case pins that this fix did not quietly make it. `env` is a
    // scope on the installed spec and on objectstack `main` alike, which
    // narrows the enum to it (objectstack#15206 S5); `org` stood here, a scope
    // on the installed spec only (objectui#12093).
    render(<LayeredDiff layered={layeredWith('env')} locale="en-US" />);
    expect(screen.getByText('env')).toBeInTheDocument();
  });

  it('keeps the no-overlay branch on the "none" badge', () => {
    render(<LayeredDiff layered={layeredWith(null)} locale="zh-CN" />);
    expect(
      screen.getByText(translateConsoleValue('layer', 'none', 'zh-CN')),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(translateConsoleValue('layer', 'set', 'zh-CN')),
    ).toBeNull();
  });

  it('still falls back to "set" for an overlay that reports no scope', () => {
    // Off-contract per the spec (`overlayScope` is null exactly when `overlay`
    // is null), but the fallback branch predates this fix and is untouched by
    // it. Pinned so the rewrite of the badge expression is provably behaviour-
    // preserving on the path it did not aim at.
    render(
      <LayeredDiff
        layered={{ ...layeredWith(null), overlay: { label: 'Client' } }}
        locale="zh-CN"
      />,
    );
    expect(
      screen.getByText(translateConsoleValue('layer', 'set', 'zh-CN')),
    ).toBeInTheDocument();
  });
});
