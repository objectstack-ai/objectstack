// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25189 — the mail HTML hole placement judge, one placement class at a time.
 *
 * Each case names the class it asserts; the bodies carry holes and markup
 * only, never a value. The judge's grammar parity with the renderer is pinned
 * in `plugin-email` (`text-field-html-outlets.pin.test.ts`), where the
 * renderer is.
 */
import { describe, expect, it } from 'vitest';

import {
  judgeMailHtmlHoles,
  MAIL_HTML_PLACEMENT_LABELS,
  MAIL_HTML_SUPPORTED_PLACEMENTS,
  type MailHtmlHolePlacement,
} from './mail-html-hole-placement';

const one = (html: string, urlVariables: string[] = []) => {
  const holes = judgeMailHtmlHoles(html, { urlVariables });
  expect(holes, html).toHaveLength(1);
  return holes[0];
};

describe('the supported placements', () => {
  it.each([
    ['<p>{{ who }}</p>', 'element-text'],
    ['{{who}}', 'element-text'],
    ['<table><tr><td>{{ who | upper }}</td></tr></table>', 'element-text'],
    ['<title>{{who}}</title>', 'element-text'],
    ['<textarea>{{who}}</textarea>', 'element-text'],
    ['<p title="{{who}}">x</p>', 'quoted-attribute'],
    ["<p title='{{who}}'>x</p>", 'quoted-attribute'],
    ['<td width="{{w}}" class="a {{c}} b">x</td>', 'quoted-attribute'],
  ] as const)('%s → %s, supported', (html, placement) => {
    for (const hole of judgeMailHtmlHoles(html)) {
      expect(hole.placement).toBe(placement);
      expect(hole.supported).toBe(true);
      expect(hole.raw).toBe(false);
    }
  });

  it('a triple-braced hole is supported as a declared url variable forming the whole double-quoted href', () => {
    for (const html of ['<a href="{{{url}}}">go</a>', '<a HREF="{{{ url }}}">go</a>', '<a class="b" href = "{{{url}}}">go</a>']) {
      const hole = one(html, ['url']);
      expect(hole).toMatchObject({ raw: true, placement: 'url-attribute', supported: true, path: 'url' });
    }
  });

  it('the supported list is the two encoded placements', () => {
    expect([...MAIL_HTML_SUPPORTED_PLACEMENTS]).toEqual(['element-text', 'quoted-attribute']);
  });
});

describe('the refused placements, by class', () => {
  it.each([
    ['<script>{{x}}</script>', 'raw-text-element'],
    ['<style>p { color: {{x}} }</style>', 'raw-text-element'],
    ['<noscript>{{x}}</noscript>', 'raw-text-element'],
    ['<plaintext>{{x}}', 'raw-text-element'],
    ['<!-- {{x}} -->', 'comment'],
    ['<!--[if mso]><p>{{x}}</p><![endif]-->', 'comment'],
    ['<!DOCTYPE {{x}}>', 'comment'],
    ['<? {{x}} ?>', 'comment'],
    ['<td width={{x}}>a</td>', 'unquoted-attribute'],
    ['<td width=1{{x}}>a</td>', 'unquoted-attribute'],
    ['<p {{x}}>a</p>', 'tag'],
    ['<{{x}}>', 'tag'],
    ['</{{x}}>', 'tag'],
    ['<p title="a"{{x}}>a</p>', 'tag'],
    ['<p data-{{x}}="1">a</p>', 'tag'],
    ['<a href="{{x}}">a</a>', 'url-attribute'],
    ['<a href="https://example.test/{{x}}">a</a>', 'url-attribute'],
    ['<img src="{{x}}">', 'url-attribute'],
    ['<form action="{{x}}"></form>', 'url-attribute'],
    ['<td background="{{x}}">a</td>', 'url-attribute'],
    ['<a xlink:href="{{x}}">a</a>', 'url-attribute'],
    ['<meta http-equiv="refresh" content="{{x}}">', 'url-attribute'],
    ['<p onclick="{{x}}">a</p>', 'event-handler-attribute'],
    ['<p style="color: {{x}}">a</p>', 'style-attribute'],
    ['<iframe srcdoc="{{x}}"></iframe>', 'markup-attribute'],
    ['<svg><text>{{x}}</text></svg>', 'foreign-content'],
    ['<svg width="{{x}}"></svg>', 'foreign-content'],
    ['<math><mi>{{x}}</mi></math>', 'foreign-content'],
  ] as const)('%s → %s, refused', (html, placement) => {
    const hole = one(html);
    expect(hole.placement).toBe(placement);
    expect(hole.supported).toBe(false);
  });

  it('a triple-braced hole anywhere but the href shape is refused', () => {
    const refused: Array<[string, string[]]> = [
      ['<p>{{{url}}}</p>', ['url']],
      ['<p title="{{{url}}}">a</p>', ['url']],
      ['<a href="{{{url}}}">a</a>', []],
      ['<a href="{{{other}}}">a</a>', ['url']],
      ['<a href="{{{ url | upper }}}">a</a>', ['url']],
      ["<a href='{{{url}}}'>a</a>", ['url']],
      ['<a href="{{{url}}}/next">a</a>', ['url']],
      ['<a href="https://example.test/{{{url}}}">a</a>', ['url']],
      ['<a href={{{url}}}>a</a>', ['url']],
      ['<img src="{{{url}}}">', ['url']],
      ['<a data-href="{{{url}}}">a</a>', ['url']],
      ['<svg><a href="{{{url}}}">a</a></svg>', ['url']],
    ];
    for (const [html, urlVariables] of refused) {
      const hole = one(html, urlVariables);
      expect(hole.raw, html).toBe(true);
      expect(hole.supported, html).toBe(false);
    }
  });

  it('a hole after a closed raw-text element, comment or foreign root is judged by the markup that follows', () => {
    const holes = judgeMailHtmlHoles(
      '<style>p{}</style><p>{{a}}</p><!-- c --><b>{{b}}</b><svg></svg><i>{{c}}</i><script></SCRIPT ><u>{{d}}</u>',
    );
    expect(holes.map((h) => [h.path, h.placement, h.supported])).toEqual([
      ['a', 'element-text', true],
      ['b', 'element-text', true],
      ['c', 'element-text', true],
      ['d', 'element-text', true],
    ]);
  });

  it('text inside a raw-text element that only looks like a closing tag does not close it', () => {
    expect(one('<script></scriptx>{{x}}</script>').placement).toBe('raw-text-element');
    expect(one('<style></style-x>{{x}}</style>').placement).toBe('raw-text-element');
  });

  it('an abruptly closed comment ends where the parser ends it', () => {
    expect(one('<!--><p>{{x}}</p>').placement).toBe('element-text');
    expect(one('<!---><p>{{x}}</p>').placement).toBe('element-text');
    expect(one('<!-- a --!><p>{{x}}</p>').placement).toBe('element-text');
  });

  it('every refused class has an author-facing label', () => {
    const classes: MailHtmlHolePlacement[] = [
      'element-text', 'quoted-attribute', 'url-attribute', 'event-handler-attribute', 'style-attribute',
      'markup-attribute', 'unquoted-attribute', 'tag', 'raw-text-element', 'comment', 'foreign-content',
    ];
    expect(Object.keys(MAIL_HTML_PLACEMENT_LABELS).sort()).toEqual([...classes].sort());
  });
});

describe('what is and is not a hole — the renderer\'s grammar', () => {
  it('text the renderer leaves verbatim is markup, not a hole', () => {
    expect(judgeMailHtmlHoles('<p>{{ not a path }}</p>')).toEqual([]);
    expect(judgeMailHtmlHoles('<p>{x}</p>')).toEqual([]);
    expect(judgeMailHtmlHoles('')).toEqual([]);
  });

  it('a verbatim brace pair still moves the markup around it', () => {
    // The pair is not a hole, so the renderer leaves it in the output — and the
    // tag it opens there is where the hole after it sits.
    const holes = judgeMailHtmlHoles('<p>{{ <b }}{{x}}</p>');
    expect(holes).toHaveLength(1);
    expect(holes[0]).toMatchObject({ path: 'x', placement: 'tag', supported: false });
  });

  it('a hole\'s span, braces included, and its form', () => {
    expect(judgeMailHtmlHoles('a {{ x.y | currency:EUR }} b {{{z}}} c {{{w}}')).toEqual([
      expect.objectContaining({ start: 2, text: '{{ x.y | currency:EUR }}', path: 'x.y', raw: false }),
      expect.objectContaining({ text: '{{{z}}}', path: 'z', raw: true }),
      expect.objectContaining({ text: '{{{w}}', path: 'w', raw: false }),
    ]);
  });
});
