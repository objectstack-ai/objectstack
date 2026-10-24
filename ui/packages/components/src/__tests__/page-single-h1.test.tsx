/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * "One page, one h1" — accessibility contract for PageRenderer (objectui#3434).
 *
 * Two components can render the page's title: PageRenderer's own implicit
 * heading (from `title`/`label`) and the authored `page:header` block. Before
 * this guard they BOTH rendered on every non-record page, so the showcase
 * master-detail page shipped two `heading level 1` nodes with the identical
 * accessible name — a broken document outline, a title a screen reader
 * announces twice, and the same string printed twice on screen. The live e2e
 * caught it as a Playwright strict-mode violation:
 * `getByRole('heading', { name: 'New Project + Tasks' })` resolved to 2
 * elements, taking `e2e/live/master-detail.spec.ts` down in `beforeEach`.
 *
 * The assertions below are written against the ACCESSIBLE TREE (`getAllByRole`
 * with an explicit level), not against class names, so they pin the fact the
 * e2e locator actually depends on. The negative controls matter as much as the
 * positive one: delegating the heading must never leave a page with ZERO `h1`.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionProvider } from '@object-ui/react';
import { SchemaRenderer } from '@object-ui/react';
// Module scope, not a hook: registers PageRenderer (`app`/`home`/`record`/…)
// and `page:header`. A cold `await import()` inside a hook is billed to
// `hookTimeout` and races the assertions (AGENTS.md §测试纪律, objectui#3010).
import '../renderers';

/**
 * The showcase master-detail page, reduced to the parts that render headings.
 *
 * ⚠️ `type: 'app'` below is EVIDENCE about a real stored document, ⛔ not a
 * convenience (objectui#9642). It is the spec page KIND, which the app-shell
 * page view writes verbatim into the SchemaNode discriminator, so this fixture
 * exercises the page-kind to node-type channel as the shipped page does. On
 * objectui#9263 it was edited to `'page'` so a change removing the `'app'`
 * registration would keep passing — that PR was closed without merging and the
 * card was re-ruled letter E, "⛔ not a defect". ⇒ If a change turns this file
 * red, read `page-kind-node-type-channel-9642` in this directory before
 * touching the value: a fixture that mirrors a real document is a reading, and
 * editing it to agree with a change destroys the signal instead of taking it.
 */
function masterDetailPage(headerProps: Record<string, unknown> | null, extra?: Record<string, unknown>) {
  return {
    type: 'app',
    pageType: 'app',
    name: 'showcase_project_workspace',
    // Spec pages carry `label`; PageRenderer dual-reads it as the page title.
    label: 'New Project + Tasks',
    template: 'default',
    regions: [
      ...(headerProps
        ? [{ name: 'header', width: 'full', components: [{ type: 'page:header', properties: headerProps }] }]
        : []),
      {
        name: 'main',
        width: 'large',
        components: [{ type: 'element:text', properties: { text: 'body' } }],
      },
    ],
    ...extra,
  } as any;
}

function renderPage(schema: any) {
  return render(
    <ActionProvider>
      <SchemaRenderer schema={schema} />
    </ActionProvider>,
  );
}

describe('PageRenderer — one page, one h1 (objectui#3434)', () => {
  it('renders exactly ONE h1 when a titled page:header carries the same name', () => {
    renderPage(
      masterDetailPage({
        title: 'New Project + Tasks',
        subtitle: 'Master-detail entry — fill the project, add its tasks inline, and save them together.',
      }),
    );

    // The exact locator the live e2e uses. Before the fix this threw
    // "found multiple elements"; Playwright reported the same as a strict-mode
    // violation resolving to 2 elements.
    expect(screen.getByRole('heading', { name: 'New Project + Tasks' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // The surviving h1 is the authored header's, and the header keeps its subtitle.
    expect(screen.getByRole('heading', { level: 1 }).closest('header')).not.toBeNull();
    expect(screen.getByText(/Master-detail entry/)).toBeTruthy();
  });

  it('drops the implicit title even when the page:header names the page differently', () => {
    // app-crm welcome.page.ts: label 'CRM Welcome' + header 'Welcome to the CRM'.
    renderPage({ ...masterDetailPage({ title: 'Welcome to the CRM' }), label: 'CRM Welcome' });

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome to the CRM');
    expect(screen.queryByText('CRM Welcome')).toBeNull();
  });

  it('still renders the implicit h1 when the page authors NO page:header', () => {
    renderPage(masterDetailPage(null));

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('New Project + Tasks');
  });

  it('still renders the implicit h1 when the page:header has no title of its own', () => {
    // Negative control against a zero-h1 page: PageHeaderRenderer's bare branch
    // renders `{explicitTitle && <h1>}`, so an untitled header contributes no
    // heading at all and the page's own title must stay.
    renderPage(masterDetailPage({ subtitle: 'Just a subtitle' }));

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('New Project + Tasks');
  });

  it('still renders the implicit h1 when the header title interpolates to nothing', () => {
    // `title: '{name}'` with no record in scope → `interpolate()` blanks it →
    // no header heading. Suppressing ours here would leave the page headingless.
    renderPage(masterDetailPage({ title: '{name}' }));

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('New Project + Tasks');
  });

  it('treats a whitespace-only title as no title at all (objectui#9174)', () => {
    // No `{`, so `interpolate()`'s fast path used to return the template
    // VERBATIM, skipping the trim the token path applies. Truthy whitespace
    // then passed PageHeaderRenderer's `explicitTitle && <h1>` gate, drawing a
    // blank `h1` — and because `literalTitleText` (page.tsx) already trims and
    // correctly read "no title", PageRenderer also drew its own implicit `h1`,
    // for two `h1` elements on the document.
    renderPage(masterDetailPage({ title: '   ' }));

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('New Project + Tasks');
  });

  it('still renders a real header title verbatim (lit control)', () => {
    // A normal, non-empty title must still render through the untouched fast
    // path — this is the control the trim-unification must not break.
    renderPage(masterDetailPage({ title: 'Welcome to the CRM' }));

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome to the CRM');
  });

  it('honours an inline-translation map as a real header title', () => {
    renderPage(masterDetailPage({ title: { en: 'Get in touch', 'zh-CN': '联系我们' } }));

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Get in touch');
  });

  it('keeps the page description when the header takes over the heading', () => {
    // `description` is the page's own prose, not a duplicate of the header
    // `subtitle` — delegating the h1 must not delete unrelated content.
    renderPage(masterDetailPage({ title: 'New Project + Tasks' }, { description: 'Page-level prose.' }));

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Page-level prose.')).toBeTruthy();
  });

  it('record pages keep delegating the whole title block (unchanged)', () => {
    renderPage({
      ...masterDetailPage({ title: 'New Project + Tasks' }),
      type: 'record',
      pageType: 'record',
      description: 'record prose',
    });

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByText('record prose')).toBeNull();
  });
});
