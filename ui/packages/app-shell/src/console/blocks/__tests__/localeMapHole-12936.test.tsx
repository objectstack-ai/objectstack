/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12936: a block whose copy is an inline locale map carrying a `${…}`
 * hole draws the bound value in every language.
 *
 * Blocks resolve such copy with `pickLocalized` off the node's evaluated props,
 * and the renderer used to hand a locale map over as authored, so the picked
 * line drew `${data...}` as text. `SchemaRenderer` now evaluates each member
 * like a plain string on the same key (the rule is pinned in `@object-ui/react`,
 * `SchemaRenderer.localeMapHoles-12936.test.tsx`), and no block changed. This
 * file reads it end to end, through the real renderer and two real blocks that
 * read their props two ways: `hero` (the card's case, off `schema.properties`,
 * bound to the spec's API binding) and `element:text` (through `readProps`).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
// The basic renderers, for `element:text`.
import '@object-ui/components';
import { I18nProvider } from '@object-ui/i18n';
import { PredicateScopeProvider, SchemaRenderer, SchemaRendererContext } from '@object-ui/react';
import type { DeclaredNode } from '@object-ui/types';
import '../productBlocks';

const HOME = { success: true, data: { environments: [{ lastPublishedAt: 'Oct 16' }] } };

let urlSeq = 0;

function renderNode(language: string, schema: Record<string, unknown>) {
  urlSeq += 1;
  const apiFetch = vi.fn(async () => new Response(JSON.stringify(HOME), { status: 200 }));
  const node = schema.dataSource === 'api'
    ? { ...schema, dataSource: { provider: 'api', read: { url: '/api/v1/home-12936-' + urlSeq }, path: 'data' } }
    : schema;
  render(
    <I18nProvider persistLanguage={false} config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MemoryRouter>
        <PredicateScopeProvider scope={{ user: { name: 'Ada' } }}>
          <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch }}>
            <SchemaRenderer schema={node as DeclaredNode} />
          </SchemaRendererContext.Provider>
        </PredicateScopeProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
  return apiFetch;
}

afterEach(() => cleanup());

const HOLE_TITLE = {
  zh: '最近发布 ${data.environments[0].lastPublishedAt}',
  en: 'Published ${data.environments[0].lastPublishedAt}',
};

describe('hero: an inline locale map `title` with a `data.*` hole (objectui#12936)', () => {
  it.each([
    ['zh', '最近发布 Oct 16'],
    ['en', 'Published Oct 16'],
  ])('draws the bound value in %s', async (language, heading) => {
    const apiFetch = renderNode(language, { type: 'hero', dataSource: 'api', properties: { title: HOLE_TITLE } });
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByTestId('hero-block').textContent).not.toContain('${');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['zh', '你的工作区'],
    ['en', 'Your workspace'],
  ])('draws a locale map without a hole unchanged in %s (control)', async (language, heading) => {
    renderNode(language, { type: 'hero', dataSource: 'api', properties: { title: { zh: '你的工作区', en: 'Your workspace' } } });
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });
});

describe('element:text: an inline locale map `content` with a `current_user` hole (objectui#12936)', () => {
  it.each([
    ['zh-CN', '欢迎回来,Ada'],
    ['en', 'Welcome back, Ada'],
  ])('draws the evaluated member in %s', async (language, text) => {
    renderNode(language, {
      type: 'element:text',
      properties: { content: { en: 'Welcome back, ${current_user.name}', 'zh-CN': '欢迎回来,${current_user.name}' } },
    });
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});
