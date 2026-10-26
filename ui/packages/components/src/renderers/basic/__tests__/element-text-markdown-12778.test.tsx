/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:text` draws the inline Markdown its spec declares (objectui#12778).
 *
 * `ElementTextPropsSchema.content` is described as "Text or Markdown content",
 * and the renderer printed it verbatim: the pricing page's footer sentence had
 * its `[sales](mailto:…)` link come out as typed, so the address became a
 * separate button. The tag is one `p` or `h1`-`h6`, so the subset is inline:
 * links, `**bold**`, `*italic*`, `` `code` ``. Raw HTML is skipped, and a link
 * keeps its `href` only for `http:`, `https:`, `mailto:`, `tel:` or a
 * scheme-less path. The CONTROLS pin plain text that only looks like Markdown,
 * and block syntax, which prints as typed.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Module scope, not a hook: the cold transform is billed to the import phase,
// which has no test/hook timeout (AGENTS.md, objectui#3010).
import '../../../renderers';

function renderText(content: unknown, language?: string) {
  const node = <SchemaRenderer schema={{ type: 'element:text', properties: { content } } as never} />;
  const { container } = render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>{node}</I18nProvider>
    ) : (
      node
    ),
  );
  const root = container.querySelector('p, h1, h2, h3, h4, h5, h6') as HTMLElement;
  return root;
}

describe('element:text renders its declared inline Markdown', () => {
  it('draws a link and bold text, as the pricing footer authors them', () => {
    const root = renderText('Need more seats? **Talk to us** at [sales](mailto:sales@example.com).');
    const link = root.querySelector('a');
    expect(link?.getAttribute('href')).toBe('mailto:sales@example.com');
    expect(link?.textContent).toBe('sales');
    // mailto stays in this tab: no new window for a mail client.
    expect(link?.hasAttribute('target')).toBe(false);
    expect(root.querySelector('strong')?.textContent).toBe('Talk to us');
    expect(root.textContent).toBe('Need more seats? Talk to us at sales.');
  });

  it('draws the Markdown of a localized content map, in the active language', () => {
    const root = renderText(
      { en: 'See [pricing](/pricing) for **details**.', 'zh-CN': '详见 [价格](/pricing) 中的 **说明**。' },
      'zh-CN',
    );
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/pricing');
    expect(root.querySelector('a')?.textContent).toBe('价格');
    expect(root.querySelector('strong')?.textContent).toBe('说明');
  });

  it('opens an http(s) link in a new tab and keeps a same-site path in this one', () => {
    const root = renderText('[Docs](https://docs.example.com) or [settings](/settings).');
    const [external, local] = [...root.querySelectorAll('a')];
    expect(external.getAttribute('target')).toBe('_blank');
    expect(external.getAttribute('rel')).toBe('noopener noreferrer');
    expect(local.getAttribute('href')).toBe('/settings');
    expect(local.hasAttribute('target')).toBe(false);
  });

  it('draws italic and code', () => {
    const root = renderText('Set *only* the `name` field.');
    expect(root.querySelector('em')?.textContent).toBe('only');
    expect(root.querySelector('code')?.textContent).toBe('name');
  });
});

describe('CONTROL — what the subset refuses', () => {
  it.each([
    'javascript:alert%281%29',
    'JavaScript:alert%281%29',
    ' javascript:alert%281%29',
    'java\tscript:alert%281%29',
    'data:text/html,<b>x</b>',
    'vbscript:msgbox%281%29',
  ])('prints a %j link as its text, with no href', (href) => {
    // A Markdown destination ends at its first `)`, so the payloads are percent-encoded.
    const root = renderText(`Click [here](${href}) now.`);
    expect(root.querySelector('a')).toBeNull();
    expect(root.querySelector('[href]')).toBeNull();
    expect(root.textContent).toBe('Click here now.');
  });

  it('renders no raw HTML, and prints none of its source', () => {
    const root = renderText('Hi <img src=x onerror="alert(1)"><b>there</b>.');
    expect(root.querySelector('img, b')).toBeNull();
    expect(root.textContent).toBe('Hi there.');
  });
});

describe('CONTROL — plain text renders exactly as before', () => {
  it.each([
    'Rated 5 * by users',
    '2 * 3 * 4 = 24',
    'Use snake_case and __dunder__ names',
    'Pick [one] or [two] (or none)',
    'Holds when a < b and c > d',
    'A plain sentence.',
  ])('%j', (text) => {
    const root = renderText(text);
    expect(root.children).toHaveLength(0);
    expect(root.textContent).toBe(text);
  });

  it.each([
    '# Not a heading',
    '- not a list item',
    '1. not a numbered item',
    '```js\nconst x = 1;\n```',
  ])('block syntax %j prints as typed', (text) => {
    const root = renderText(text);
    expect(root.children).toHaveLength(0);
    expect(root.textContent).toBe(text);
  });
});
