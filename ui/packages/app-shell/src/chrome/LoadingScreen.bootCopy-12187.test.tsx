/**
 * objectui#12187 — the boot screen says one honest line, walks no steps, and
 * shows no English before the user's locale.
 *
 * ## What was measured, and what these pins hold
 *
 * The screen used to take its language from `document.documentElement.lang`.
 * `I18nProvider` writes that attribute in a passive effect — after its
 * children's first render — so the first commit read the document's static
 * `lang="en"` on every browser. Measured on the pre-fix component under the
 * real provider, `zh-CN` browser, `<html lang="en">`: English at the first
 * commit with `lang` still `en`; still English after the provider's effect had
 * set `lang` to `zh`; Chinese only at 1200 ms, when the step timer's first tick
 * happened to re-render it. The first pin below is that ordering, asserted the
 * other way round.
 *
 * "First commit" is read from a sibling's layout effect: layout effects run
 * after React has written the DOM and before any passive effect, so the
 * provider's `lang` write has provably not happened yet. The pin asserts that
 * too, so it cannot pass by measuring a later frame.
 *
 * ## Residency
 *
 * The DOM test setup makes all ten catalogues resident, the state the console
 * reaches by awaiting `preloadBootstrapLocale()`. The "pack not resident" case
 * needs the other state, so `getLoadedBuiltInLocales` — the snapshot the screen
 * reads — is wrapped to hide named codes, and nothing else is replaced.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useLayoutEffect } from 'react';

// Heavy barrel at module scope, not mid-assertion (AGENTS.md, the test-discipline section).
import '@object-ui/components';

import { I18nProvider, createI18n, en } from '@object-ui/i18n';
import { zh, ja } from '@object-ui/i18n/locales';
import { LoadingScreen } from './LoadingScreen.js';

const residency = vi.hoisted(() => ({ hidden: new Set<string>() }));

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/i18n')>();
  return {
    ...actual,
    getLoadedBuiltInLocales: () =>
      Object.fromEntries(
        Object.entries(actual.getLoadedBuiltInLocales()).filter(([code]) => !residency.hidden.has(code)),
      ),
  };
});

/** The default product name: no runtime config is served in this file. */
const PRODUCT = 'ObjectOS';

interface CommitSnapshot {
  htmlLang: string;
  text: string;
}

/** Records the document as it stands at the first commit, before any passive effect. */
function FirstCommitProbe({ into }: { into: CommitSnapshot[] }) {
  useLayoutEffect(() => {
    into.push({ htmlLang: document.documentElement.lang, text: document.body.textContent ?? '' });
  }, [into]);
  return null;
}

function browserLanguage(tag: string) {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(tag);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  residency.hidden.clear();
  document.documentElement.lang = 'en';
  document.documentElement.dir = '';
});

describe('LoadingScreen boot copy (objectui#12187)', () => {
  it('paints the zh line on the FIRST commit, before the provider has written <html lang>', () => {
    browserLanguage('zh-CN');
    document.documentElement.lang = 'en';
    const first: CommitSnapshot[] = [];

    render(
      <I18nProvider persistLanguage={false}>
        <LoadingScreen />
        <FirstCommitProbe into={first} />
      </I18nProvider>,
    );

    expect(first).toHaveLength(1);
    // The ordering this card measured: at the first commit the provider has
    // not written the attribute yet...
    expect(first[0].htmlLang, 'measured too late: the provider had already written <html lang>').toBe('en');
    // ...and the screen is already in the user's language — not English, and
    // not waiting for a re-render that nothing schedules any more.
    expect(first[0].text).toBe(`${PRODUCT}${zh.console.initializing}`);
    // The provider does write it afterwards; the screen no longer depends on that.
    expect(document.documentElement.lang).toBe('zh');
  });

  it('control: an en browser paints the en line on the first commit', () => {
    browserLanguage('en-US');
    const first: CommitSnapshot[] = [];

    render(
      <I18nProvider persistLanguage={false}>
        <LoadingScreen />
        <FirstCommitProbe into={first} />
      </I18nProvider>,
    );

    expect(first[0].text).toBe(`${PRODUCT}${en.console.initializing}`);
  });

  it('renders the product name and one line — no step list, no hint, and nothing walks on a timer', () => {
    vi.useFakeTimers();
    browserLanguage('en-US');

    const { container } = render(
      <I18nProvider persistLanguage={false}>
        <LoadingScreen />
      </I18nProvider>,
    );

    // The whole visible text is the heading and the one line, so a step, a hint
    // or any second line fails here by existing.
    const expected = `${PRODUCT}${en.console.initializing}`;
    expect(container.textContent).toBe(expected);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(PRODUCT);

    // The old screen advanced a step every 1200 ms. Nothing may change with time.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.textContent).toBe(expected);
  });

  it('shows no line — not English — while the active pack is not resident, and the line once it lands', () => {
    browserLanguage('ja-JP');
    residency.hidden.add('ja');
    const i18n = createI18n();
    expect(i18n.language).toBe('ja');

    const { container } = render(
      <I18nProvider instance={i18n} persistLanguage={false}>
        <LoadingScreen />
      </I18nProvider>,
    );

    // Neutral: the product name alone.
    expect(container.textContent).toBe(PRODUCT);
    expect(screen.queryByText(en.console.initializing)).toBeNull();

    // The catalogue lands: resident in the registry, then the store write the
    // provider performs on its arrival — which is what re-renders the screen.
    residency.hidden.delete('ja');
    act(() => {
      i18n.addResourceBundle('ja', 'translation', { console: { initializing: ja.console.initializing } }, true, false);
    });

    expect(container.textContent).toBe(`${PRODUCT}${ja.console.initializing}`);
  });

  it.each([
    ['loading', {}],
    ['message', { message: 'Signing you in' }],
    ['error', { error: 'boom', onRetry: () => {} }],
  ] as const)('marks its root with data-boot-splash in the %s state, and the mark goes with it', (_state, props) => {
    // The language-independent hook a readiness wait keys on (round 2): the
    // line is absent until the pack lands, so a wait on the copy passes while
    // the splash is still up. Asserted on the ROOT, so the hook names the
    // whole screen.
    const { container, rerender } = render(<LoadingScreen {...props} />);
    const root = container.firstElementChild;
    expect(root?.hasAttribute('data-boot-splash'), 'the splash root carries the marker').toBe(true);
    expect(document.querySelectorAll('[data-boot-splash]')).toHaveLength(1);

    rerender(<div data-testid="destination" />);
    expect(document.querySelector('[data-boot-splash]'), 'the marker outlived the splash').toBeNull();
  });

  it('keeps the error block, in the provider language', () => {
    browserLanguage('zh-CN');

    render(
      <I18nProvider persistLanguage={false}>
        <LoadingScreen error="boom" onRetry={() => {}} />
      </I18nProvider>,
    );

    expect(screen.getByText(zh.console.error.connectionFailed)).toBeTruthy();
    expect(screen.getByText(zh.console.error.checkServer)).toBeTruthy();
    expect(screen.getByRole('button', { name: zh.console.actions.retry })).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
  });
});
