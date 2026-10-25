/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A settings `info_banner` speaks the session locale, draws a warning in amber,
 * and renders its body as Markdown (objectui#12671).
 *
 * ## What was broken
 *
 * The `info_banner` arm of `SettingsField` drew `<AlertTitle>` from the
 * manifest's `label` and the body from the manifest's `bannerText`, both as
 * literals, while the `group` arm two blocks up already asked
 * `labels.groupTitle(spec.id, …)`. objectstack#23886 declares the slot a
 * bundle translates a banner through, `settings.NAMESPACE.banners.BANNER_ID`
 * with `title` (for `label`) and `text` (for `bannerText`), so a zh-CN admin
 * read every settings banner in the manifest's English even once the bundle
 * carried the translation. Two more gaps sat on the same arm:
 *
 * - only `error` was mapped (to `destructive`); a `warning`, which is every
 *   banner the platform ships, drew the neutral `default` Alert;
 * - the spec declares `bannerText` a Markdown body, and the arm drew it as a
 *   text child, so the Feature Flags notice showed its backticks.
 *
 * ## How the bundle reaches the hook
 *
 * Through `transformSpecTranslations`, the transform `loadLanguage.ts` applies
 * to the server's translations, so the tree lands under `app` as it does in
 * the running console (the same reason `useSettingsLabel.conventionProbe-11801`
 * gives for doing it this way).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  createI18n,
  I18nProvider,
  transformSpecTranslations,
  type SpecTranslationData,
} from '@object-ui/i18n';
// The banner body renders behind two lazy boundaries: `SettingsField`'s own
// `import('@object-ui/plugin-markdown')` and the plugin's
// `import('./MarkdownImpl')`. Importing both here, by the specifiers that
// resolve to the same modules, puts their load in the import phase, outside
// any `findBy` budget (AGENTS.md, test discipline: a lazy boundary is a race
// against the module loader, not a timeout to raise).
import '@object-ui/plugin-markdown';
import '../../../../../../packages/plugin-markdown/src/MarkdownImpl';
import { SettingsField } from '../SettingsField';
import { useSettingsLabel } from '../useSettingsLabel';
import type { Specifier } from '../types';

afterEach(cleanup);

/** The Feature Flags manifest's banner, as the server declares it. */
const BETA_NOTICE: Specifier = {
  type: 'info_banner',
  id: 'beta_notice',
  label: 'Heads up',
  required: false,
  bannerText:
    'Beta features may change without notice. Pin via env vars (e.g. `OS_FEATURE_FLAGS_AI_ENABLED=true`) to lock for the whole deployment.',
  bannerSeverity: 'warning',
};

const ZH_TITLE = '注意';
const ZH_TEXT = '测试版功能可能随时变更。通过环境变量（例如 `OS_FEATURE_FLAGS_AI_ENABLED=true`）固定后对整个部署生效。';

function servedWith(featureFlags: Record<string, unknown>): SpecTranslationData {
  return { settings: { feature_flags: featureFlags } };
}

function BannerRow({ spec, namespace }: { spec: Specifier; namespace: string }) {
  const labels = useSettingsLabel(namespace);
  return <SettingsField spec={spec} value={undefined} onChange={() => {}} labels={labels} />;
}

function renderBanner(spec: Specifier, served: SpecTranslationData | null, namespace = 'feature_flags') {
  const instance = createI18n({
    defaultLanguage: 'zh',
    detectBrowserLanguage: false,
    warnMissingKeys: false,
    resources: served ? { zh: transformSpecTranslations(served) } : {},
  });
  return render(
    <I18nProvider instance={instance}>
      <BannerRow spec={spec} namespace={namespace} />
    </I18nProvider>,
  );
}

/** The banner's body once the Markdown renderer has drawn it. */
async function renderedBody() {
  const alert = screen.getByRole('alert');
  // `data-slot="markdown"` is the renderer's own container (`MarkdownImpl`);
  // finding it is what says the body went through Markdown, not a text child.
  return within(alert).findByText((_, el) => el?.getAttribute('data-slot') === 'markdown');
}

describe('SettingsField info_banner (objectui#12671)', () => {
  describe('the title and the body read settings.NAMESPACE.banners.BANNER_ID', () => {
    it('draws the translated pair a bundle carries under the banner id', async () => {
      renderBanner(
        BETA_NOTICE,
        servedWith({ banners: { beta_notice: { title: ZH_TITLE, text: ZH_TEXT } } }),
      );
      const alert = screen.getByRole('alert');
      expect(within(alert).getByRole('heading', { level: 5 })).toHaveTextContent(ZH_TITLE);
      const body = await renderedBody();
      expect(body).toHaveTextContent('测试版功能可能随时变更。');
      expect(alert).not.toHaveTextContent('Heads up');
      expect(alert).not.toHaveTextContent('Beta features may change without notice.');
    });

    it('draws the manifest literals when the bundle has no entry for the banner', async () => {
      renderBanner(BETA_NOTICE, servedWith({ title: '功能开关' }));
      const alert = screen.getByRole('alert');
      expect(within(alert).getByRole('heading', { level: 5 })).toHaveTextContent('Heads up');
      expect(await renderedBody()).toHaveTextContent('Beta features may change without notice.');
    });

    it('translates each half on its own: a title-only entry keeps the literal body', async () => {
      renderBanner(BETA_NOTICE, servedWith({ banners: { beta_notice: { title: ZH_TITLE } } }));
      const alert = screen.getByRole('alert');
      expect(within(alert).getByRole('heading', { level: 5 })).toHaveTextContent(ZH_TITLE);
      expect(await renderedBody()).toHaveTextContent('Beta features may change without notice.');
    });

    it.each([
      ['a singular `banner` branch', { banner: { beta_notice: { title: ZH_TITLE, text: ZH_TEXT } } }],
      ['a `notices` branch', { notices: { beta_notice: { title: ZH_TITLE, text: ZH_TEXT } } }],
      ['a `bannerText` leaf', { banners: { beta_notice: { title: 'x', bannerText: ZH_TEXT } } }],
      ['a `label` leaf for the title', { banners: { beta_notice: { label: ZH_TITLE } } }],
    ])('reads no other spelling: %s is not consulted', async (_name, featureFlags) => {
      renderBanner(BETA_NOTICE, servedWith(featureFlags));
      const alert = screen.getByRole('alert');
      expect(alert).not.toHaveTextContent(ZH_TITLE);
      expect(await renderedBody()).toHaveTextContent('Beta features may change without notice.');
    });

    it('asks no helper when the specifier has no id, as the group arm does', async () => {
      const { id: _drop, ...noId } = BETA_NOTICE;
      renderBanner(
        noId as Specifier,
        servedWith({ banners: { undefined: { title: ZH_TITLE, text: ZH_TEXT } } }),
      );
      const alert = screen.getByRole('alert');
      expect(within(alert).getByRole('heading', { level: 5 })).toHaveTextContent('Heads up');
      expect(await renderedBody()).toHaveTextContent('Beta features may change without notice.');
    });
  });

  describe('bannerSeverity picks the callout', () => {
    it('warning draws the amber callout over the default variant', () => {
      render(<SettingsField spec={BETA_NOTICE} value={undefined} onChange={() => {}} />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveClass('bg-amber-50', 'text-amber-800', 'border-amber-300/60');
      // tailwind-merge drops the default variant's colours, so amber is not
      // merely appended under a background that wins.
      expect(alert).not.toHaveClass('bg-background');
      expect(alert).not.toHaveClass('text-foreground');
    });

    it('error stays destructive, and is not amber', () => {
      render(
        <SettingsField
          spec={{ ...BETA_NOTICE, bannerSeverity: 'error' }}
          value={undefined}
          onChange={() => {}}
        />,
      );
      const alert = screen.getByRole('alert');
      expect(alert).toHaveClass('text-destructive');
      expect(alert).not.toHaveClass('bg-amber-50');
    });

    it.each(['info', 'success', undefined] as const)('%s draws the default variant, not amber', (severity) => {
      render(
        <SettingsField
          spec={{ ...BETA_NOTICE, bannerSeverity: severity }}
          value={undefined}
          onChange={() => {}}
        />,
      );
      const alert = screen.getByRole('alert');
      expect(alert).toHaveClass('bg-background');
      expect(alert).not.toHaveClass('bg-amber-50');
      expect(alert).not.toHaveClass('text-destructive');
    });
  });

  describe('bannerText renders as the Markdown body the spec declares', () => {
    it('draws inline code, emphasis and a link as elements, not as their source', async () => {
      render(
        <SettingsField
          spec={{
            ...BETA_NOTICE,
            bannerText: 'Pin via `OS_FEATURE_FLAGS_AI_ENABLED=true`, **before** you [read the guide](https://example.com/flags).',
          }}
          value={undefined}
          onChange={() => {}}
        />,
      );
      const body = await renderedBody();
      expect(within(body).getByText('OS_FEATURE_FLAGS_AI_ENABLED=true').tagName).toBe('CODE');
      expect(within(body).getByText('before').tagName).toBe('STRONG');
      expect(within(body).getByRole('link', { name: 'read the guide' })).toHaveAttribute(
        'href',
        'https://example.com/flags',
      );
      expect(body.textContent).not.toContain('`');
      expect(body.textContent).not.toContain('**');
    });

    it('draws a translated body through the same renderer', async () => {
      renderBanner(
        BETA_NOTICE,
        servedWith({ banners: { beta_notice: { title: ZH_TITLE, text: ZH_TEXT } } }),
      );
      const body = await renderedBody();
      expect(within(body).getByText('OS_FEATURE_FLAGS_AI_ENABLED=true').tagName).toBe('CODE');
    });

    it('draws no body when the banner declares none', () => {
      const { bannerText: _drop, ...titleOnly } = BETA_NOTICE;
      render(<SettingsField spec={titleOnly as Specifier} value={undefined} onChange={() => {}} />);
      const alert = screen.getByRole('alert');
      expect(within(alert).getByRole('heading', { level: 5 })).toHaveTextContent('Heads up');
      expect(alert.querySelector('[data-slot="markdown"]')).toBeNull();
      expect(alert.textContent).toBe('Heads up');
    });
  });
});
