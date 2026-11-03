// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A package README's `>` blockquotes render as quotes, and a GitHub alert
 * (`> [!NOTE]` and its siblings) as the same plain quote without its marker.
 *
 * Seen on staging, on HotCRM 6.0.0's package page: the About card printed the
 * README's opening quote with its leading `>` on every line, and its
 * `> [!NOTE]` callout with the `[!NOTE]` marker as literal text, because
 * `MarkdownText` had no blockquote rule and read the lines as a paragraph.
 *
 * The CONTROLS pin the edges: a `>` inside a fenced block is code, a bracketed
 * word that is not one of GitHub's five alert types stays text, and the
 * marker counts only on a quote's first line.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownText } from '../MarkdownText';

/** HotCRM's README opening and its NOTE callout, as it publishes them. */
const HOTCRM_README = [
  '# HotCRM',
  '',
  '> **The ontology is the software.** One executable business ontology.',
  '>',
  '> 本体即软件。',
  '',
  'HotCRM is the reference implementation.',
  '',
  '> [!NOTE]',
  '> **Small enough for an agent to hold whole.** The sales package carries **~68k tokens**.',
  '> Measured, not estimated: `node scripts/check-source-token-ratchet.mjs` prints both figures.',
].join('\n');

function renderMd(source: string) {
  return render(<MarkdownText source={source} />).container;
}

describe('a README with blockquotes', () => {
  it('renders each quote as a blockquote, with no literal `>`', () => {
    const root = renderMd(HOTCRM_README);

    const quotes = root.querySelectorAll('blockquote');
    expect(quotes).toHaveLength(2);
    expect(root.textContent).not.toContain('>');

    // The first quote: two paragraphs (the bare `>` line separates them), inline marks rendered.
    const [first, second] = Array.from(quotes);
    const paras = first.querySelectorAll(':scope > p');
    expect(paras).toHaveLength(2);
    expect(paras[0].querySelector('strong')?.textContent).toBe('The ontology is the software.');
    expect(paras[0].textContent).toBe('The ontology is the software. One executable business ontology.');
    expect(paras[1].textContent).toBe('本体即软件。');

    // The paragraph between the quotes is outside both.
    const between = Array.from(root.querySelectorAll(':scope > div > p')).map((p) => p.textContent);
    expect(between).toEqual(['HotCRM is the reference implementation.']);

    // The alert's two lines are one paragraph, as in any quote.
    expect(second.querySelectorAll(':scope > p')).toHaveLength(1);
    expect(second.querySelector('code')?.textContent).toBe('node scripts/check-source-token-ratchet.mjs');
  });

  it('drops the GitHub alert marker and keeps the quote', () => {
    const root = renderMd(HOTCRM_README);
    expect(root.textContent).not.toContain('[!NOTE]');
    expect(root.textContent).not.toContain('NOTE');
    const alert = root.querySelectorAll('blockquote')[1];
    expect(alert.textContent).toMatch(/^Small enough for an agent to hold whole\. The sales package carries ~68k tokens\./);
  });

  it.each(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION', 'note', 'Warning'])('drops the %s marker', (type) => {
    const root = renderMd(`> [!${type}]\n> Body.`);
    expect(root.querySelector('blockquote')?.textContent).toBe('Body.');
    expect(root.textContent).not.toContain('[!');
  });

  it('parses a quote’s content as blocks: a list and a nested quote inside it', () => {
    const root = renderMd(['> Steps:', '>', '> - one', '> - two', '>', '> > nested'].join('\n'));
    const outer = root.querySelector(':scope > div > blockquote')!;
    expect(outer.querySelectorAll('li')).toHaveLength(2);
    expect(outer.querySelector('blockquote')?.textContent).toBe('nested');
    expect(root.textContent).not.toContain('>');
  });

  it('ends a paragraph where a quote starts, and a quote at the first unprefixed line', () => {
    const root = renderMd('Intro line\n> quoted\nafter');
    expect(root.querySelector('blockquote')?.textContent).toBe('quoted');
    expect(Array.from(root.querySelectorAll(':scope > div > p')).map((p) => p.textContent)).toEqual(['Intro line', 'after']);
  });
});

describe('controls', () => {
  it('a `>` inside a fenced block is code', () => {
    const root = renderMd('```\n> not a quote\n```');
    expect(root.querySelector('blockquote')).toBeNull();
    expect(root.querySelector('pre')?.textContent).toBe('> not a quote');
  });

  it('a bracketed word that is not an alert type stays text', () => {
    const root = renderMd('> [!FOO]\n> Body.');
    expect(root.querySelector('blockquote')?.textContent).toBe('[!FOO] Body.');
  });

  it('the marker counts only on the quote’s first line', () => {
    const root = renderMd('> Body.\n>\n> [!NOTE]');
    expect(root.querySelector('blockquote')?.textContent).toContain('[!NOTE]');
  });

  it('raw HTML inside a quote is still skipped', () => {
    const root = renderMd('> <div align="center">\n> <img src="x.svg">\n> </div>\n>\n> Text.');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('blockquote')?.textContent).toBe('Text.');
  });
});
