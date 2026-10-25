/**
 * objectui#5564 — `useObjectLabel`'s memo must hold whether or not an i18next
 * instance is bound.
 *
 * Every assertion here is on IDENTITY / recompute counts rather than on
 * rendered output, deliberately: nothing renders wrong today, so a rendering
 * assertion is green against the broken code. The defect is that the object
 * feeding every downstream `useMemo`/`useCallback` dependency list was rebuilt
 * on each render outside a provider — the very configuration
 * `useSafeFieldLabel` advertises — because react-i18next hands back a fresh
 * `i18n` object every render when it has no instance to bind to.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { I18nextProvider, getI18n, setI18n } from 'react-i18next';
import type { i18n as I18nInstance } from 'i18next';
import { createI18n } from '../i18n';
import { useObjectLabel, useSafeFieldLabel } from '../useObjectLabel';

type Labels = ReturnType<typeof useObjectLabel>;

/**
 * `createI18n` registers its instance as react-i18next's process-global (via
 * `initReactI18next`), and `useTranslation` falls back to that global whenever
 * no context supplies one. Detaching it is what makes "no instance" actually
 * mean no instance in this file: without it, a probe meant to run unbound would
 * silently bind to an instance built by an earlier test and assert nothing.
 */
function detachGlobalI18n(): void {
  setI18n(undefined as unknown as I18nInstance);
}

/** An i18next instance carrying one app-namespaced field translation. */
function createBoundInstance(): I18nInstance {
  const instance = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  instance.addResourceBundle(
    'en',
    'translation',
    { crm: { fields: { lead: { status: 'Localized Status' } } } },
    true,
    true,
  );
  detachGlobalI18n();
  return instance;
}

/** A component recording the hook's return value once per render, in order. */
function makeProbe(hook: () => Labels) {
  const seen: Labels[] = [];
  const Component: React.FC<{ tick: number }> = () => {
    seen.push(hook());
    return null;
  };
  return { seen, Component };
}

describe('useObjectLabel identity (objectui#5564)', () => {
  beforeEach(() => {
    detachGlobalI18n();
  });

  it('holds one identity across renders with no i18next instance bound', () => {
    // Precondition, asserted rather than assumed: a leaked global instance
    // would turn this into a test of the path that already worked.
    expect(getI18n()).toBeFalsy();

    const { seen, Component } = makeProbe(useObjectLabel);
    const { rerender } = render(<Component tick={0} />);
    rerender(<Component tick={1} />);
    rerender(<Component tick={2} />);
    rerender(<Component tick={3} />);

    // The card measured { renders: 4, distinctObject: 4, distinctFieldLabel: 4 }.
    expect(seen.length).toBeGreaterThanOrEqual(4);
    expect(new Set(seen).size).toBe(1);
    expect(new Set(seen.map((labels) => labels.fieldLabel)).size).toBe(1);
  });

  it('holds one identity across renders through useSafeFieldLabel with no instance', () => {
    expect(getI18n()).toBeFalsy();

    const { seen, Component } = makeProbe(() => useSafeFieldLabel() as unknown as Labels);
    const { rerender } = render(<Component tick={0} />);
    rerender(<Component tick={1} />);
    rerender(<Component tick={2} />);
    rerender(<Component tick={3} />);

    expect(new Set(seen).size).toBe(1);
    expect(new Set(seen.map((labels) => labels.fieldLabel)).size).toBe(1);
  });

  it('still holds one identity across renders with an instance bound', () => {
    // Regression guard on the path that already worked — the fix must not cost
    // stability where the memo was already holding.
    const instance = createBoundInstance();
    const { seen, Component } = makeProbe(useObjectLabel);
    const tree = (tick: number) => (
      <I18nextProvider i18n={instance}>
        <Component tick={tick} />
      </I18nextProvider>
    );

    const { rerender } = render(tree(0));
    rerender(tree(1));
    rerender(tree(2));
    rerender(tree(3));

    expect(new Set(seen).size).toBe(1);
    expect(seen[0].fieldLabel('lead', 'status', 'Status')).toBe('Localized Status');
  });

  it('recomputes exactly once when an instance appears after first render', () => {
    // Triage's dispatch clause: the late-instance transition is pinned, not
    // left as a surprise.
    const instance = createBoundInstance();
    expect(getI18n()).toBeFalsy();

    const { seen, Component } = makeProbe(useObjectLabel);
    // The provider element sits at the same position in every tree below, so
    // the probe is UPDATED rather than remounted when the instance arrives. A
    // remount would reset the memo and prove nothing about the transition.
    const tree = (i18n: I18nInstance | undefined, tick: number) => (
      <I18nextProvider i18n={i18n as I18nInstance}>
        <Component tick={tick} />
      </I18nextProvider>
    );

    const { rerender } = render(tree(undefined, 0));
    rerender(tree(undefined, 1));
    rerender(tree(undefined, 2));
    expect(new Set(seen).size).toBe(1);

    rerender(tree(instance, 3));
    rerender(tree(instance, 4));
    rerender(tree(instance, 5));

    // Exactly two identities over the whole run: one before the instance, one
    // after — i.e. the transition recomputed once and then held again. Asserted
    // as a distinct-count so an extra render scheduled by react-i18next's own
    // readiness effect cannot make this pass or fail for the wrong reason.
    const distinct = [...new Set(seen)];
    expect(distinct).toHaveLength(2);

    // And the recompute is real rather than cosmetic: the second object
    // resolves translations, the first one never does.
    expect(distinct[0].fieldLabel('lead', 'status', 'Status')).toBe('Status');
    expect(distinct[1].fieldLabel('lead', 'status', 'Status')).toBe('Localized Status');
  });

  it('offers the same member set with and without an instance', () => {
    // Guards `record:reference-rail`, which calls `useSafeFieldLabel().objectLabel(...)`
    // and may render outside a provider: narrowing the no-instance path to the
    // 5-member SAFE_FIELD_LABEL_FALLBACK would make that
    // `i18n.objectLabel is not a function`.
    const unbound = makeProbe(() => useSafeFieldLabel() as unknown as Labels);
    render(<unbound.Component tick={0} />);

    const instance = createBoundInstance();
    const bound = makeProbe(useObjectLabel);
    render(
      <I18nextProvider i18n={instance}>
        <bound.Component tick={0} />
      </I18nextProvider>,
    );

    expect(Object.keys(unbound.seen[0]).sort()).toEqual(Object.keys(bound.seen[0]).sort());
    // 26 was the surface measured on the card, minus `viewDescription`: the
    // member and its `_views.<view>.description` catalog convention were retired
    // by objectui#7219 (ruled 2026-09-02), taking the count from 27 to 26.
    // objectui#11344 added `actionOutcome` (an action's per-outcome success
    // copy), taking it back to 27. objectui#11696 added `objectPluralLabel`
    // (the name of an object's list), taking it to 28. objectui#11389 retired
    // `widgetSubCaption` with the metric sub-caption (ruling C), taking it to
    // 27. A new resolver must land
    // on both paths at once, because there is only one path — and a retired one
    // leaves both at once for the same reason, which is what the equality above
    // measures and this count anchors to an absolute.
    expect(Object.keys(unbound.seen[0])).toHaveLength(27);
    expect(Object.keys(unbound.seen[0])).not.toContain('widgetSubCaption');
    expect(typeof unbound.seen[0].objectLabel).toBe('function');
    expect(unbound.seen[0].objectLabel({ name: 'lead', label: 'Lead' })).toBe('Lead');
  });
});
