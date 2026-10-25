/**
 * I18nProvider — a translation bundle that lands AFTER mount reaches the
 * consumers already on screen (objectui#10382).
 *
 * Both of the provider's asynchronous loads end in `addResourceBundle`: the
 * app bundle from `loadLanguage`, and the built-in catalogue for the booted
 * language. Each used to follow the write with a "force re-render" that set the
 * provider's `language` state to the value it already held, so React bailed out
 * and nothing re-rendered. A consumer that drew the fallback before the bundle
 * arrived kept drawing it until something unrelated re-rendered it.
 *
 * What these cases pin, in the order the card and its grading ask for:
 *
 *   (a) the card's reader — `useObjectLabel` — shows the late app bundle with
 *       no other action, including a reader that memoises on the resolver the
 *       way `ObjectDataTable` does (a re-render alone does not reach that one;
 *       only a new `t` does);
 *   (b) a raw `t()` reader updates too;
 *   (c) control: a language switch still re-renders exactly once and loads the
 *       target language's bundle;
 *   (d) no render loop: one re-render per load, then still; and a catalogue the
 *       instance already holds wakes nobody.
 *
 * Plus the grading's sibling check — the built-in catalogue path — in both
 * sequences that reach it, and the stale-revert that the old "force re-render"
 * line caused when the boot bundle landed after a switch.
 *
 * The DOM projects make every built-in catalogue resident before any test
 * mounts (`vitest.setup.i18n-catalogues.ts`), so the "not fetched yet" state is
 * rebuilt on the instance itself: its bundle for the language is replaced with
 * the empty one `createI18n` gives a catalogue that is not resident yet.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { useMemo } from 'react';
import { act, render, screen } from '@testing-library/react';
import { createI18n } from '../i18n';
import { I18nProvider, useI18nContext, useObjectTranslation } from '../provider';
import { useObjectLabel } from '../useObjectLabel';
import ja from '../locales/ja';
import zh from '../locales/zh';

/** The card's config — not a built-in code, so only the app bundle is in play. */
const ZH_CN = { defaultLanguage: 'zh-CN', detectBrowserLanguage: false } as const;

/** What the fixed starter loader hands the provider for the card's spec payload (objectui#10381). */
const ZH_CN_BUNDLE = {
  app: {
    objects: { crm_lead: { label: '线索' } },
    fields: { crm_lead: { name: '名称' } },
  },
};

const FR_CA_BUNDLE = { app: { objects: { crm_lead: { label: 'Piste' } } } };

const JA_BUNDLE = { app: { objects: { crm_lead: { label: 'リード' } } } };

const LEAD = { name: 'crm_lead', label: 'Lead' };

/** The provider context, as `useI18nContext` hands it over. */
type I18nContextValue = ReturnType<typeof useI18nContext>;

const renders = { label: 0, memo: 0, raw: 0, save: 0 };
type Counted = keyof typeof renders;

afterEach(() => {
  renders.label = 0;
  renders.memo = 0;
  renders.raw = 0;
  renders.save = 0;
});

/**
 * `Profiler`'s commit callback, keyed by the profiler's `id`: how often each
 * reader rendered, counted the way React reports it rather than by writing to
 * module state from a render body.
 */
function countCommit(id: string) {
  renders[id as Counted] += 1;
}

function Count({ id, children }: { id: Counted; children: React.ReactNode }) {
  return (
    <React.Profiler id={id} onRender={countCommit}>
      {children}
    </React.Profiler>
  );
}

function LabelText() {
  const { objectLabel, fieldLabel } = useObjectLabel();
  return (
    <>
      <span data-testid="object">{objectLabel(LEAD)}</span>
      <span data-testid="field">{fieldLabel('crm_lead', 'name', 'Name')}</span>
    </>
  );
}

/** (a) The card's reader. */
function LabelReader() {
  return (
    <Count id="label">
      <LabelText />
    </Count>
  );
}

function MemoText() {
  const { objectLabel } = useObjectLabel();
  const text = useMemo(() => objectLabel(LEAD), [objectLabel]);
  return <span data-testid="memo">{text}</span>;
}

/** (a) A reader that memoises on the resolver, as `ObjectDataTable`'s column memo does. */
function MemoReader() {
  return (
    <Count id="memo">
      <MemoText />
    </Count>
  );
}

function RawText() {
  const { t } = useObjectTranslation();
  return <span data-testid="raw">{t('app.objects.crm_lead.label', { defaultValue: 'Lead' })}</span>;
}

/** (b) A raw `t()` reader. */
function RawReader() {
  return (
    <Count id="raw">
      <RawText />
    </Count>
  );
}

function SaveText() {
  const { t } = useObjectTranslation();
  return <span data-testid="save">{t('common.save')}</span>;
}

/** A built-in key, for the catalogue path. */
function SaveReader() {
  return (
    <Count id="save">
      <SaveText />
    </Count>
  );
}

/** Hands the test the provider's own context, so a switch goes through `changeLanguage` as a switcher's does. */
function captureContext(sink: { current: I18nContextValue | null }) {
  return function Capture() {
    sink.current = useI18nContext();
    return null;
  };
}

/** A `loadLanguage` whose answers the test delivers, one language at a time. */
function heldLoader() {
  const pending = new Map<string, (bundle: Record<string, unknown>) => void>();
  const loadLanguage = vi.fn(
    (lang: string) =>
      new Promise<Record<string, unknown>>((resolve) => {
        pending.set(lang, resolve);
      }),
  );
  const deliver = async (lang: string, bundle: Record<string, unknown>) => {
    const resolve = pending.get(lang);
    if (!resolve) throw new Error(`loadLanguage was never asked for '${lang}'`);
    await act(async () => {
      resolve(bundle);
    });
  };
  return { loadLanguage, deliver };
}

/** Let promise callbacks and anything they schedule run, inside act. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

/** An instance whose `lang` bundle is the empty one a not-yet-fetched catalogue gets. */
function instanceWithoutCatalogue(bootLanguage: string, emptied: string) {
  const instance = createI18n({ defaultLanguage: bootLanguage, detectBrowserLanguage: false });
  instance.removeResourceBundle(emptied, 'translation');
  instance.addResourceBundle(emptied, 'translation', {});
  return instance;
}

describe('an app bundle that lands after mount (objectui#10382)', () => {
  it('(a)(b) reaches every reader already on screen, with no other action', async () => {
    const { loadLanguage, deliver } = heldLoader();
    render(
      <I18nProvider loadLanguage={loadLanguage} config={ZH_CN} persistLanguage={false}>
        <LabelReader />
        <MemoReader />
        <RawReader />
      </I18nProvider>,
    );

    // Preconditions: the loader was asked for the boot language, and the first
    // paint is the fallback — so the assertions below measure the arrival.
    expect(loadLanguage).toHaveBeenCalledWith('zh-CN');
    expect(screen.getByTestId('object').textContent).toBe('Lead');
    expect(screen.getByTestId('memo').textContent).toBe('Lead');
    expect(screen.getByTestId('raw').textContent).toBe('Lead');

    await deliver('zh-CN', ZH_CN_BUNDLE);

    expect(screen.getByTestId('object').textContent).toBe('线索');
    expect(screen.getByTestId('field').textContent).toBe('名称');
    expect(screen.getByTestId('memo').textContent).toBe('线索');
    expect(screen.getByTestId('raw').textContent).toBe('线索');
  });

  it('(d) re-renders each reader once for the load, then holds still', async () => {
    const { loadLanguage, deliver } = heldLoader();
    render(
      <I18nProvider loadLanguage={loadLanguage} config={ZH_CN} persistLanguage={false}>
        <LabelReader />
        <MemoReader />
      </I18nProvider>,
    );
    await settle();
    const mounted = { label: renders.label, memo: renders.memo };

    await deliver('zh-CN', ZH_CN_BUNDLE);
    await settle();
    await settle();

    expect(renders.label).toBe(mounted.label + 1);
    expect(renders.memo).toBe(mounted.memo + 1);
  });

  it('(c) control: a switch still re-renders once and loads the target language bundle', async () => {
    const { loadLanguage, deliver } = heldLoader();
    const ctx: { current: I18nContextValue | null } = { current: null };
    const Capture = captureContext(ctx);
    render(
      <I18nProvider loadLanguage={loadLanguage} config={ZH_CN} persistLanguage={false}>
        <Capture />
        <LabelReader />
      </I18nProvider>,
    );
    await deliver('zh-CN', ZH_CN_BUNDLE);
    await settle();
    const beforeSwitch = renders.label;

    // A BUILT-IN target with its app bundle held: the switch writes the
    // catalogue, then waits on the network before `changeLanguage`. A write
    // that announced itself would re-render every reader in the OLD language
    // during that wait; only `languageChanged` may re-render them. (A target
    // with no catalogue writes once, in the same tick as `languageChanged`,
    // and React batches the two — that sequence cannot tell them apart.)
    let switching: Promise<void> | undefined;
    await act(async () => {
      switching = ctx.current!.changeLanguage('ja');
    });
    await deliver('ja', JA_BUNDLE);
    await act(async () => {
      await switching;
    });
    await settle();

    expect(loadLanguage).toHaveBeenCalledWith('ja');
    expect(ctx.current!.language).toBe('ja');
    expect(screen.getByTestId('object').textContent).toBe('リード');
    expect(renders.label).toBe(beforeSwitch + 1);
  });

  it('a boot bundle that lands after a switch does not pull the context back to the boot language', async () => {
    const { loadLanguage, deliver } = heldLoader();
    const ctx: { current: I18nContextValue | null } = { current: null };
    const Capture = captureContext(ctx);
    render(
      <I18nProvider loadLanguage={loadLanguage} config={ZH_CN} persistLanguage={false}>
        <Capture />
        <LabelReader />
      </I18nProvider>,
    );

    // Switch while the boot language's bundle is still in flight.
    let switching: Promise<void> | undefined;
    await act(async () => {
      switching = ctx.current!.changeLanguage('fr-CA');
    });
    await deliver('fr-CA', FR_CA_BUNDLE);
    await act(async () => {
      await switching;
    });
    expect(ctx.current!.language).toBe('fr-CA');

    await deliver('zh-CN', ZH_CN_BUNDLE);
    await settle();

    expect(ctx.current!.i18n.language).toBe('fr-CA');
    expect(ctx.current!.language).toBe('fr-CA');
    expect(screen.getByTestId('object').textContent).toBe('Piste');
  });
});

describe('the built-in catalogue path — the grading sibling', () => {
  it('a boot catalogue that lands after mount reaches the reader already on screen', async () => {
    const instance = instanceWithoutCatalogue('zh', 'zh');
    render(
      <I18nProvider instance={instance} persistLanguage={false}>
        <SaveReader />
      </I18nProvider>,
    );
    // Precondition: the first paint is the `en` fallback the provider documents.
    expect(screen.getByTestId('save').textContent).toBe('Save');

    await settle();

    expect(zh.common.save).not.toBe('Save');
    expect(screen.getByTestId('save').textContent).toBe(zh.common.save);
  });

  it('a switch made on the instance directly reaches the reader once its catalogue lands', async () => {
    const instance = instanceWithoutCatalogue('en', 'ja');
    render(
      <I18nProvider instance={instance} persistLanguage={false}>
        <SaveReader />
      </I18nProvider>,
    );
    await settle();
    expect(screen.getByTestId('save').textContent).toBe('Save');

    await act(async () => {
      await instance.changeLanguage('ja');
    });
    await settle();

    expect(ja.common.save).not.toBe('Save');
    expect(screen.getByTestId('save').textContent).toBe(ja.common.save);
  });

  it('(d) a catalogue the instance already holds wakes nobody', async () => {
    const instance = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    render(
      <I18nProvider instance={instance} persistLanguage={false}>
        <SaveReader />
      </I18nProvider>,
    );
    await settle();
    await settle();

    expect(screen.getByTestId('save').textContent).toBe('Save');
    expect(renders.save).toBe(1);
  });
});
