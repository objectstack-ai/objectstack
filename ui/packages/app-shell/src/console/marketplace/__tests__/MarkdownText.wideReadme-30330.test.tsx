// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A package README fits the detail page (objectstack#30330).
 *
 * Seen on HotCRM's detail page: the badge row printed as literal
 * `![License](LICENSE) ![Manifest](src/sales/index.ts) …`, the screenshot
 * tables printed their pipes, and a 259-character line in a fenced block
 * pushed the whole README past the page's right edge, where it was cut off.
 *
 * Images: an image renders only from an absolute `https:` URL; any other
 * source (a repository-relative path, `http:`, `data:`, `javascript:`) is
 * left out, alt text included, never printed as markup. A linked image keeps
 * its anchor only for an absolute `http(s):` destination. Tables: a GFM pipe
 * table renders as a table inside its own horizontal scroller. Width: long
 * words wrap, and only code and tables scroll within themselves.
 *
 * jsdom does no layout, so the width half is pinned on the classes that carry
 * it; the measured before/after in a real browser is on the pull request.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownText } from '../MarkdownText';

function renderMd(source: string, size?: 'base' | 'compact') {
  return render(<MarkdownText source={source} size={size} />).container;
}

/** HotCRM's badge row, as its README writes it. */
const BADGES = [
  '[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)',
  '[![Manifest](https://img.shields.io/badge/manifest-app.objectstack.hotcrm-blueviolet)](src/sales/index.ts)',
  '[![Version](https://img.shields.io/badge/version-6.1.0-brightgreen)](CHANGELOG.md)',
  '[![Marketplace](https://img.shields.io/badge/marketplace-cloud.objectos.app-orange)](https://cloud.objectos.app)',
].join('\n');

describe('README images', () => {
  it('renders the badge row as images, never as markup', () => {
    const root = renderMd(BADGES);
    const imgs = [...root.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(['License', 'Manifest', 'Version', 'Marketplace']);
    expect(imgs[0].getAttribute('src')).toBe('https://img.shields.io/badge/license-Apache--2.0-blue.svg');
    expect(root.textContent).not.toMatch(/!\[|\]\(/);
    expect(root.textContent?.trim()).toBe('');
  });

  it('loads a third-party image without sending the console URL as referrer', () => {
    const img = renderMd('![Build](https://ci.acme.example/badge.svg)').querySelector('img')!;
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img).toHaveClass('max-w-full');
  });

  it('keeps a linked image’s anchor only for an absolute http(s) destination', () => {
    const anchors = [...renderMd(BADGES).querySelectorAll('a')];
    // `LICENSE`, `src/sales/index.ts` and `CHANGELOG.md` would resolve against the console, not the repository.
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute('href')).toBe('https://cloud.objectos.app');
    expect(anchors[0].getAttribute('target')).toBe('_blank');
    expect(anchors[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchors[0].querySelector('img')?.getAttribute('alt')).toBe('Marketplace');
  });

  it.each([
    'assets/screenshots/hotcrm/customer-360/en.png',
    '/assets/icon.svg',
    '//cdn.acme.example/a.png',
    'http://acme.example/a.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
  ])('leaves out an image whose source is %j, alt text included', (src) => {
    const root = renderMd(`Before ![Shot](${src}) after.\n\n- [![Badge](${src})](https://acme.example)`);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('p')?.textContent).toBe('Before  after.');
    expect(root.querySelector('li')?.textContent).toBe('');
    expect(root.querySelector('a')).toBeNull();
  });

  it('keeps a linked https image when the link’s scheme is refused, without the anchor', () => {
    const root = renderMd('[![Badge](https://img.example/b.svg)](javascript:alert(1))');
    expect(root.querySelector('a, [href]')).toBeNull();
    expect(root.querySelector('img')?.getAttribute('src')).toBe('https://img.example/b.svg');
  });

  it('reads an image title, and prints image syntax inside a code span as code', () => {
    const root = renderMd('See ![Logo](https://img.example/l.png "The logo") and `![x](https://img.example/y.png)`.');
    expect(root.querySelectorAll('img')).toHaveLength(1);
    expect(root.querySelector('img')?.getAttribute('src')).toBe('https://img.example/l.png');
    expect(root.querySelector('code')?.textContent).toBe('![x](https://img.example/y.png)');
  });
});

describe('README tables', () => {
  const TABLE = [
    'Intro line.',
    '',
    '| The key belongs to | What comes back |',
    '|:---|---:|',
    '| the dev admin, `admin@objectos.ai` | `isError: false` |',
    '| the **demo** rep \\| Nina | `isError: true` |',
    '',
    'After.',
  ].join('\n');

  it('renders a pipe table as a table, cells drawn inline, no pipes printed', () => {
    const root = renderMd(TABLE);
    const table = root.querySelector('table')!;
    expect([...table.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['The key belongs to', 'What comes back']);
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows).toEqual([
      ['the dev admin, admin@objectos.ai', 'isError: false'],
      ['the demo rep | Nina', 'isError: true'],
    ]);
    expect(table.querySelector('td code')?.textContent).toBe('admin@objectos.ai');
    expect(table.querySelector('td strong')?.textContent).toBe('demo');
    expect([...root.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['Intro line.', 'After.']);
  });

  it('honours the delimiter row’s alignment', () => {
    const [left, right] = [...renderMd(TABLE).querySelectorAll('th')];
    expect(left).toHaveClass('text-left');
    expect(right).toHaveClass('text-right');
  });

  it('scrolls a wide table inside its own box', () => {
    const table = renderMd(TABLE).querySelector('table')!;
    expect(table.parentElement).toHaveClass('overflow-x-auto');
  });

  it('pads a short row and drops cells past the header’s count', () => {
    const root = renderMd('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
    const rows = [...root.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows).toEqual([['1', ''], ['1', '2']]);
  });

  it('renders HotCRM’s screenshot table without printing its relative images', () => {
    const root = renderMd('| Account 360 | Lead workspace |\n|---|---|\n| ![Account 360](assets/a/en.png) | ![Lead](assets/b/en.png) |');
    expect(root.querySelectorAll('th')).toHaveLength(2);
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).not.toMatch(/!\[|\]\(|\|/);
  });
});

describe('README thematic breaks', () => {
  it.each(['---', '***', '___', ' - - -', '* * *'])('renders %j between blocks as a rule, not text', (rule) => {
    const root = renderMd(`One.\n\n${rule}\n\nTwo.`);
    expect(root.querySelector('hr')).not.toBeNull();
    expect([...root.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['One.', 'Two.']);
    expect(root.querySelector('ul')).toBeNull();
  });
});

describe('README width', () => {
  it('lets the README shrink to its column and wraps long words', () => {
    const root = renderMd('A https://acme.example/' + 'x'.repeat(300) + ' link.').firstElementChild!;
    expect(root).toHaveClass('min-w-0', 'break-words');
  });

  it('lets a list item’s text shrink beside its bullet, so a long word wraps', () => {
    const li = renderMd('- `' + 'y'.repeat(300) + '`').querySelector('li')!;
    expect(li.lastElementChild).toHaveClass('min-w-0');
  });

  it('control: a fenced block keeps scrolling inside itself and does not wrap', () => {
    const pre = renderMd('```bash\ncurl -d \'' + 'z'.repeat(259) + '\'\n```').querySelector('pre')!;
    expect(pre).toHaveClass('overflow-x-auto');
    expect(pre).not.toHaveClass('whitespace-pre-wrap');
  });
});

describe('CONTROL — what a README rendered before still renders the same', () => {
  it('keeps text links, emphasis, lists, quotes and code as before', () => {
    const root = renderMd(
      [
        '# Title',
        '',
        'See the [homepage](https://acme.example) and **bold** text.',
        '',
        '- one',
        '- two',
        '',
        '> quoted',
        '',
        '```',
        'code | with pipes',
        '```',
      ].join('\n'),
    );
    expect(root.querySelector('h2')?.textContent).toBe('Title');
    expect(root.querySelector('p a')?.getAttribute('href')).toBe('https://acme.example');
    expect([...root.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two']);
    expect(root.querySelector('blockquote p')?.textContent).toBe('quoted');
    expect(root.querySelector('pre code')?.textContent).toBe('code | with pipes');
    expect(root.querySelector('table, img, hr')).toBeNull();
  });

  it('keeps a pipe in prose as text when no delimiter row follows', () => {
    const root = renderMd('Use a | b for either.\nAnd c | d too.');
    expect(root.querySelector('table')).toBeNull();
    expect(root.querySelector('p')?.textContent).toBe('Use a | b for either. And c | d too.');
  });

  it('keeps a text link to a relative path as before', () => {
    expect(renderMd('Read [the changelog](CHANGELOG.md).').querySelector('a')?.getAttribute('href')).toBe('CHANGELOG.md');
  });

  it('renders the compact size (release notes) with the same block rules', () => {
    const root = renderMd('![b](https://img.example/b.svg)\n\n| a |\n|---|\n| 1 |', 'compact');
    expect(root.querySelector('img')).not.toBeNull();
    expect(root.querySelector('table td')?.textContent).toBe('1');
  });
});
