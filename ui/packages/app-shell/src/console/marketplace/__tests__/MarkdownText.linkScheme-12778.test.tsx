// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A package README's inline Markdown is drawn by `@object-ui/components`'
 * `renderInlineMarkdown`, the one `element:text` uses (objectui#12778), so a
 * README link now passes the same scheme check: an `href` survives only for
 * `http:`, `https:`, `mailto:`, `tel:` or a scheme-less path. Before, the
 * destination went into `href` as written. The rest of the inline pass renders
 * as it did: the CONTROL block pins it, beside the objectui#12146 fixtures.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownText } from '../MarkdownText';

function renderMd(source: string) {
  return render(<MarkdownText source={source} />).container;
}

describe('a README link with a refused scheme', () => {
  it.each(['javascript:alert%281%29', 'JAVASCRIPT:void0', 'data:text/html;base64,PHNjcmlwdD4='])(
    'prints %j as its link text, with no anchor',
    (href) => {
      const root = renderMd(`Read [the guide](${href}) first.\n\n- [in a list](${href})`);
      expect(root.querySelector('a, [href]')).toBeNull();
      expect(root.querySelector('p')?.textContent).toBe('Read the guide first.');
      expect(root.querySelector('li')?.textContent).toBe('in a list');
    },
  );
});

describe('CONTROL — the README inline pass renders as before', () => {
  it('keeps an https link, in a new tab, with the card’s link look', () => {
    const root = renderMd('See the [homepage](https://acme.example/docs) and [mail us](mailto:hi@acme.example).');
    const [web, mail] = [...root.querySelectorAll('a')];
    expect(web.getAttribute('href')).toBe('https://acme.example/docs');
    expect(web.getAttribute('target')).toBe('_blank');
    expect(web.getAttribute('rel')).toBe('noopener noreferrer');
    expect(web).toHaveClass('text-violet-600');
    // Every README link opens a new tab, as before: a README is third-party content.
    expect(mail.getAttribute('href')).toBe('mailto:hi@acme.example');
    expect(mail.getAttribute('target')).toBe('_blank');
  });

  it('draws bold, italic and code in a heading, a paragraph and a list item', () => {
    const root = renderMd('# The **CRM**\n\nSet *one* `flag`.\n\n- a **b** c');
    expect(root.querySelector('h2 strong')?.textContent).toBe('CRM');
    expect(root.querySelector('p em')?.textContent).toBe('one');
    expect(root.querySelector('p code')?.textContent).toBe('flag');
    expect(root.querySelector('li strong')?.textContent).toBe('b');
  });
});
