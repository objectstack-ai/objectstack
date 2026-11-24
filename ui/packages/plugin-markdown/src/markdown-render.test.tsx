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

/**
 * Bold that ends in full-width punctuation, followed directly by a CJK letter.
 *
 * CommonMark counts full-width punctuation (）。：) as punctuation, so a
 * closing `**` with that punctuation before it and a CJK letter after it is
 * not right-flanking, and the run stays literal asterisks. A Chinese or
 * Japanese sentence puts no space there. The manual reader renders package
 * docs through this pipeline, so the sources below are lines from shipped
 * zh-CN manuals. The chat surface carries the same rule
 * (`plugin-chatbot/src/chatMarkdownPlugins.ts`).
 */
describe('bold next to CJK full-width punctuation', () => {
  /** Every element tag name in the rendered markup, deduplicated. */
  const tagNames = (html: string): string[] =>
    [...new Set([...html.matchAll(/<([a-z][a-z0-9]*)\b/g)].map((m) => m[1]))].sort();

  it.each([
    ['a closer after a full-width parenthesis, before a CJK letter', '**关闭日期**和**解决耗时（小时）**会被清空', ['关闭日期', '解决耗时（小时）']],
    ['a closer after a full-width full stop, before a CJK letter', '- **每个项目一张报销单。**每个项目的费用', ['每个项目一张报销单。']],
    ['a closer after a full-width colon, before a CJK letter', '**它跳过和拒绝什么：**已经在活动中的人', ['它跳过和拒绝什么：']],
    ['a closer after a full-width parenthesis holding a percent sign', '**投资回报率（%）**是（收入 − 成本）', ['投资回报率（%）']],
  ])('%s renders strong', (_label, md, bold) => {
    const html = render(md);
    for (const text of bold) expect(html).toContain(`<strong>${text}</strong>`);
    expect(html).not.toContain('**');
  });

  it('adds no element the sanitizer did not already allow', () => {
    const html = render('**解决耗时（小时）**会被清空');
    expect(tagNames(html)).toEqual(['div', 'p', 'strong']);
  });

  it('keeps raw HTML and javascript: links stripped inside a CJK bold run', () => {
    const html = render('**<img src=x onerror="alert(1)">（小时）**会被清空，**[链接](javascript:alert(1))。**然后');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('**');
  });

  it.each([
    ['plain English bold', 'a **bold** word', '<strong>bold</strong>'],
    ['intraword ASCII bold', 'foo**bar**baz', 'foo<strong>bar</strong>baz'],
  ])('leaves %s as CommonMark has it', (_label, md, expected) => {
    expect(render(md)).toContain(expected);
  });

  it.each([
    ['a closer after whitespace', '**not bold **here', '**not bold **here'],
    ['a code span', '`**x**`', '<code>**x**</code>'],
    ['backslash escapes', '\\*\\*x\\*\\*', '**x**'],
  ])('keeps %s literal, as CommonMark has it', (_label, md, expected) => {
    const html = render(md);
    expect(html).toContain(expected);
    expect(html).not.toContain('<strong>');
  });

  it('still renders a CJK bold run inside an alert and a GFM table', () => {
    const alert = render('> [!NOTE]\n> **解决耗时（小时）**会被清空\n');
    expect(alert).toMatch(/class="[^"]*markdown-alert[^"]*markdown-alert-note/);
    expect(alert).toContain('<strong>解决耗时（小时）</strong>');
    const table = render('| 字段 | 说明 |\n|---|---|\n| 耗时 | **解决耗时（小时）**会被清空 |\n');
    expect(table).toContain('<table');
    expect(table).toContain('<strong>解决耗时（小时）</strong>');
  });
});
