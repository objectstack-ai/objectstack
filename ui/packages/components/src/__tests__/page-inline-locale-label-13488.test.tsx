/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#13488 — a page whose `label` and `description` are the spec's
 * inline locale map (`I18nLabel`, `{ 'zh-CN', en }`) renders, in the viewer's
 * language.
 *
 * ## The defect
 *
 * `PageSchema` in `@objectstack/spec` types both keys as `I18nLabelSchema`,
 * so the map is valid metadata and the `/meta` read serves it unchanged.
 * `PageRenderer` drew `label` as the page's implicit heading and `description`
 * under it as given, and handed the raw description to a titled `page:header`
 * through `PageDescriptionContext`: React refused the object as a child (error
 * #31) and the page was blank for every viewer.
 *
 * ## Discrimination
 *
 * Each map leg goes red on the raw read it pins: the heading leg on the h1,
 * the description leg on the paragraph under it, the header leg on the
 * description the header draws. The zh-CN and en legs read different strings
 * out of the same map, which a resolver that took the first entry, or always
 * `en`, cannot both pass. `PLAIN_STRING_CONTROL` is the same pages written with
 * plain strings, asserted unchanged in both languages.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DeclaredNode } from '@object-ui/types';
// Module scope, not a hook: registers PageRenderer (`app`/`home`/`record`/…)
// and `page:header` (AGENTS.md §测试纪律).
import '../renderers';

afterEach(cleanup);

/** Each inline map, and what each viewer must read out of it. */
const LABEL_MAP = { 'zh-CN': '供应商门户首页', en: 'Supplier Portal Home' };
const DESCRIPTION_MAP = { 'zh-CN': '待办的订单与对账一览。', en: 'Open orders and reconciliations at a glance.' };
const HEADER_TITLE = 'Supplier portal';

/** PLAIN_STRING_CONTROL — the same page written with plain strings. */
const PLAIN = { label: 'Welcome', description: 'Shown to suppliers first.' };

type Lang = 'en' | 'zh-CN';
const pick = (map: Record<string, string>, lang: Lang) => (lang === 'zh-CN' ? map['zh-CN'] : map.en);

/**
 * An `app` page: not a record page, so it draws its own heading. Its label and
 * description arrive as data (a served document), so the literal is cast once
 * here rather than typed against the authoring face.
 */
function appPage(fields: Record<string, unknown>, regions: unknown[] = []): DeclaredNode {
  return { type: 'app', pageType: 'app', name: 'welcome', regions, ...fields } as unknown as DeclaredNode;
}

/** A header region with a titled `page:header`: the header owns the h1 and draws the description. */
const TITLED_HEADER_REGION = [{ name: 'header', components: [{ type: 'page:header', properties: { title: HEADER_TITLE } }] }];

function renderPage(schema: DeclaredNode, lang: Lang) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }} persistLanguage={false}>
      <ActionProvider>
        <SchemaRenderer schema={schema} />
      </ActionProvider>
    </I18nProvider>,
  );
}

describe.each<Lang>(['en', 'zh-CN'])('objectui#13488 — a page with inline locale maps, viewer in %s', (lang) => {
  it('HEADING_MAP_RESOLVES — the page\'s heading is the viewer\'s label', () => {
    renderPage(appPage({ label: LABEL_MAP }), lang);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(pick(LABEL_MAP, lang));
  });

  it('DESCRIPTION_MAP_RESOLVES — the line under the heading is the viewer\'s description', () => {
    renderPage(appPage({ label: PLAIN.label, description: DESCRIPTION_MAP }), lang);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PLAIN.label);
    expect(screen.getByText(pick(DESCRIPTION_MAP, lang))).toBeInTheDocument();
  });

  it('HEADER_DESCRIPTION_MAP_RESOLVES — a titled `page:header` draws the viewer\'s description', () => {
    const { container } = renderPage(appPage({ label: PLAIN.label, description: DESCRIPTION_MAP }, TITLED_HEADER_REGION), lang);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(HEADER_TITLE);
    expect(container.querySelector('[data-page-description]')).toHaveTextContent(pick(DESCRIPTION_MAP, lang));
  });

  it('PLAIN_STRING_CONTROL — a plain-string label and description draw unchanged', () => {
    renderPage(appPage(PLAIN), lang);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PLAIN.label);
    expect(screen.getByText(PLAIN.description)).toBeInTheDocument();
    cleanup();
    const { container } = renderPage(appPage(PLAIN, TITLED_HEADER_REGION), lang);
    expect(container.querySelector('[data-page-description]')).toHaveTextContent(PLAIN.description);
  });
});
