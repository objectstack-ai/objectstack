/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Rendering + security tests for the ADR-0046 markdown enrichments
 * (heading anchors, code highlighting, GitHub-style alerts) and the
 * sanitize gate that must survive all three.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import MarkdownImpl from './MarkdownImpl';

function render(md: string): string {
  return renderToStaticMarkup(React.createElement(MarkdownImpl, { content: md }));
}

describe('markdown enrichments (ADR-0046)', () => {
  it('gives headings slug ids so intra-doc #anchors resolve', () => {
    const html = render('## Cross References\n\nbody');
    expect(html).toMatch(/<h2[^>]*id="cross-references"/);
  });

  it('keeps the slug id verbatim (no user-content- clobber prefix)', () => {
    const html = render('## Setup\n');
    expect(html).toContain('id="setup"');
    expect(html).not.toContain('user-content-');
  });

  it('appends an anchor affordance to headings', () => {
    const html = render('# Title\n');
    expect(html).toMatch(/class="md-anchor"/);
  });

  it('highlights fenced code blocks (hljs token classes survive sanitize)', () => {
    const html = render('```js\nconst x = 1;\n```\n');
    expect(html).toContain('hljs');
    expect(html).toMatch(/class="[^"]*language-js/);
    // a keyword span must come through the sanitizer
    expect(html).toMatch(/hljs-keyword/);
  });

  it('renders GitHub-style alerts as a div.markdown-alert callout', () => {
    const html = render('> [!WARNING]\n> be careful\n');
    expect(html).toMatch(/class="[^"]*markdown-alert[^"]*markdown-alert-warning/);
    expect(html).toMatch(/markdown-alert-title/);
  });

  it('renders GFM tables and task lists', () => {
    const table = render('| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(table).toContain('<table');
    const tasks = render('- [x] done\n- [ ] todo\n');
    expect(tasks).toMatch(/type="checkbox"/);
  });

  // ── Security regression guards ──
  it('strips a raw <script> tag', () => {
    const html = render('hello\n\n<script>alert(1)</script>\n');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips javascript: links', () => {
    const html = render('[x](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('strips event-handler attributes from raw HTML', () => {
    const html = render('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('drops the alert icon SVG (no svg surface in the schema)', () => {
    const html = render('> [!NOTE]\n> info\n');
    expect(html).not.toContain('<svg');
  });
});

describe('mermaid diagrams (ADR-0046)', () => {
  it('routes ```mermaid blocks to a diagram container, not a code block', () => {
    const html = render('```mermaid\ngraph TD; A-->B;\n```\n');
    // rendered by the trusted <Mermaid> component, not the highlight pipeline
    expect(html).toContain('data-mermaid');
    expect(html).not.toMatch(/hljs[^"]*language-mermaid|language-mermaid[^"]*hljs/);
    // source preserved (a11y / fallback) while the async render runs
    expect(html).toContain('graph TD');
  });

  it('still renders ordinary fenced code as a highlighted block', () => {
    const html = render('```js\nconst x = 1;\n```\n');
    expect(html).not.toContain('data-mermaid');
    expect(html).toContain('hljs');
  });
});
