// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A package README's raw HTML is neither rendered nor printed (objectui#12146
 * item 2).
 *
 * Seen on staging, on HotCRM's package page: the About card began with the
 * README's opening block printed as literal text, tags and all, because
 * `MarkdownText` read the block as a paragraph. Not rendering it is right (a
 * README is third-party content); printing it is noise, and its relative
 * `assets/icon.svg` would not resolve anyway.
 *
 * `MarkdownText` is this console's own CommonMark-subset renderer, so the fix
 * is in its parser: raw HTML is recognised by CommonMark's grammar (the "HTML
 * blocks" start conditions and the inline "Raw HTML" forms) and skipped, as
 * react-markdown's `skipHtml` skips it. The CONTROLS pin the other half: HTML
 * inside code still prints, and text that only looks like a tag stays text.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownText } from '../MarkdownText';

/** The README's opening as HotCRM publishes it: a centred icon block, then the markdown. */
const HOTCRM_README = [
  '<p align="center">',
  '  <img src="assets/icon.svg" alt="HotCRM" width="128" height="128">',
  '</p>',
  '',
  '# HotCRM',
  '',
  'The CRM for **sales teams**.',
].join('\n');

function renderMd(source: string) {
  return render(<MarkdownText source={source} />).container;
}

describe('a README with a raw-HTML block', () => {
  it('neither renders nor prints the block, and renders the markdown after it', () => {
    const root = renderMd(HOTCRM_README);

    // Not rendered: no element the block declared reached the DOM.
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('[align]')).toBeNull();
    // Not printed: none of its source reached the text either.
    expect(root.textContent).not.toContain('<');
    expect(root.textContent).not.toContain('assets/icon.svg');
    expect(root.textContent).not.toContain('align=');

    // The markdown after it is untouched.
    expect(root.querySelector('h2')?.textContent).toBe('HotCRM');
    expect(root.querySelector('strong')?.textContent).toBe('sales teams');
    expect(root.textContent).toContain('The CRM for sales teams.');
  });

  it('drops the one-line form of the same block', () => {
    const root = renderMd('<p align="center"> <img src="assets/icon.svg" alt="HotCRM" width="128" height="128"> </p>\n\nBody.');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toBe('Body.');
  });

  it('drops every start condition: script, comment, declaration, a block tag, a lone tag', () => {
    const root = renderMd([
      '<script>',
      'alert(1)',
      '</script>',
      'After the script.',
      '',
      '<!-- badges -->',
      '',
      '<!DOCTYPE html>',
      '',
      '<details>',
      '<summary>More</summary>',
      'Hidden detail.',
      '</details>',
      '',
      '<img src="https://example.com/banner.png">',
      '',
      'Last line.',
    ].join('\n'));

    expect(root.querySelector('script, img, details, summary')).toBeNull();
    expect(root.textContent).not.toContain('<');
    expect(root.textContent).not.toContain('alert(1)');
    expect(root.textContent).not.toContain('Hidden detail.');
    // A condition-1 block ends on its own closing line, so the next line is markdown again.
    expect(root.textContent).toContain('After the script.');
    expect(root.textContent).toContain('Last line.');
  });

  it('ends a paragraph where a block-level HTML start interrupts it', () => {
    const root = renderMd('Intro line.\n<div align="center">\ninside the div\n</div>\n\nOutro.');
    const paragraphs = [...root.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['Intro line.', 'Outro.']);
  });

  it('drops inline raw HTML and keeps the text between the tags', () => {
    const root = renderMd('Built by <b>Acme</b> for <a href="https://acme.example">everyone</a>.<br/>');
    expect(root.querySelector('b, a, br')).toBeNull();
    expect(root.textContent).toBe('Built by Acme for everyone.');
  });
});

describe('CONTROL — what only looks like HTML, or is code, still prints', () => {
  it('keeps HTML inside a code span and a fenced block as code', () => {
    const root = renderMd('Wrap it in `<div>` tags.\n\n```html\n<p align="center">x</p>\n```');
    const codes = [...root.querySelectorAll('code')].map((c) => c.textContent);
    expect(codes).toEqual(['<div>', '<p align="center">x</p>']);
  });

  it('keeps a comparison and an autolink-shaped URL as text', () => {
    const root = renderMd('Holds when a < b and c > d.\n\nSee <https://example.com>.');
    expect(root.textContent).toContain('Holds when a < b and c > d.');
    expect(root.textContent).toContain('See <https://example.com>.');
  });

  it('renders a README with no HTML exactly as markdown', () => {
    const root = renderMd('# Title\n\n- one\n- two\n\n1. first\n\nA [link](https://example.com) and *em*.');
    expect(root.querySelector('h2')?.textContent).toBe('Title');
    expect([...root.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['one', 'two']);
    expect(root.querySelector('ol li')?.textContent).toBe('first');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(root.querySelector('em')?.textContent).toBe('em');
  });
});
