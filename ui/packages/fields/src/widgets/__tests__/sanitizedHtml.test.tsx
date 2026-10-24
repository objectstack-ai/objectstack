/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `html` / `richtext` display pipeline's trust boundary
 * (`../sanitizedHtml.tsx`), read through the renderer every read surface uses.
 *
 * Two halves, and both are load-bearing:
 *
 *   - HOSTILE: each class of stored markup that can carry script comes out
 *     inert. The assertions are STRUCTURAL — no `on*` attribute anywhere, no
 *     script-bearing URL in any attribute, none of the embedding / foreign
 *     content elements, no `style` — read off the rendered DOM, so they hold
 *     for any spelling of a payload within its class, not just the one
 *     written here.
 *   - FORMATTING: a representative rich-text document renders back byte for
 *     byte. A sanitizer that drops everything passes the first half; this
 *     half is what refuses it.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HtmlCellRenderer, RICH_TEXT_CELL_RENDERERS } from '../richTextDisplay';
import { RICH_TEXT_SANITIZE_SCHEMA } from '../sanitizedHtml';

afterEach(cleanup);

function renderHtml(value: string): HTMLElement {
  const { container } = render(
    <HtmlCellRenderer value={value} field={{ name: 'notes', type: 'richtext' } as never} />,
  );
  const prose = container.querySelector<HTMLElement>('div.prose');
  expect(prose, 'a populated value opens its prose container').not.toBeNull();
  return prose!;
}

/** Elements whose presence alone means the value was not neutralised. */
const FORBIDDEN_ELEMENTS =
  'script, style, iframe, frame, object, embed, applet, svg, math, link, meta, base, form, template, noscript';

/** Attributes that take a URL, in either namespace. */
const URL_ATTRIBUTES = ['href', 'src', 'action', 'formaction', 'data', 'xlink:href', 'srcset', 'cite', 'poster', 'background'];

/** Everything a hostile value must NOT have left in the DOM. */
function expectInert(prose: HTMLElement, label: string) {
  expect(prose.querySelector(FORBIDDEN_ELEMENTS), `${label}: no embedding or foreign-content element`).toBeNull();
  for (const element of Array.from(prose.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      expect(name.startsWith('on'), `${label}: <${element.localName}> keeps no ${name}`).toBe(false);
      expect(name, `${label}: <${element.localName}> keeps no style`).not.toBe('style');
      expect(name, `${label}: <${element.localName}> keeps no srcdoc`).not.toBe('srcdoc');
      if (URL_ATTRIBUTES.includes(name)) {
        // Normalised the way a URL parser reads it: control characters and
        // whitespace removed, case folded.
        const url = Array.from(attribute.value)
          .filter((char) => char.charCodeAt(0) > 0x20)
          .join('')
          .toLowerCase();
        expect(url, `${label}: <${element.localName} ${name}> is not a script URL`).not.toMatch(
          /^(javascript|vbscript|data):/,
        );
      }
    }
  }
}

const HOSTILE: ReadonlyArray<readonly [string, string]> = [
  // Slash-separated attributes: no whitespace before the handler name.
  ['slash-separated img handler', '<p>a</p><img/src=x/onerror=alert(1)>'],
  ['slash-separated svg handler', '<svg/onload=alert(1)>'],
  ['slash before a quoted handler', '<img src="x"/onerror="alert(1)">'],
  ['handler on an allowed element', '<p onclick="alert(1)" onmouseover=alert(1)>text</p>'],
  ['mixed-case handler', '<a href="https://x.test" OnClIcK="alert(1)">x</a>'],
  // Unquoted and otherwise disguised script URLs.
  ['unquoted javascript href', '<a href=javascript:alert(1)>x</a>'],
  ['mixed-case javascript href', '<a href="JaVaScRiPt:alert(1)">x</a>'],
  ['leading-space javascript href', '<a href="  javascript:alert(1)">x</a>'],
  ['tab inside the scheme', '<a href="java\tscript:alert(1)">x</a>'],
  ['vbscript href', '<a href="vbscript:msgbox(1)">x</a>'],
  ['data URL href', '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'],
  ['javascript img src', '<img src="javascript:alert(1)">'],
  // Entity-encoded schemes.
  ['decimal-entity scheme', '<a href="&#106;avascript:alert(1)">x</a>'],
  ['hex-entity scheme', '<a href="&#x6A;&#x61;&#x76;&#x61;script&colon;alert(1)">x</a>'],
  ['entity-encoded tab in the scheme', '<a href="jav&#x09;ascript:alert(1)">x</a>'],
  ['padded decimal entities', '<a href="&#0000106&#0000097vascript:alert(1)">x</a>'],
  // SVG and MathML.
  ['svg animate handler', '<svg><animate onbegin=alert(1) attributeName=x dur=1s></svg>'],
  ['svg link', '<svg><a xlink:href="javascript:alert(1)"><text x="0" y="20">x</text></a></svg>'],
  ['svg set href', '<svg><a><set attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>'],
  ['svg foreignObject', '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>'],
  ['math link', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>'],
  ['math href', '<math href="javascript:alert(1)"><mtext>x</mtext></math>'],
  ['math style breakout', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
  // Embedding elements.
  ['iframe src', '<iframe src="javascript:alert(1)"></iframe>'],
  ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['object data', '<object data="javascript:alert(1)"></object>'],
  ['embed src', '<embed src="javascript:alert(1)">'],
  ['frameset', '<frameset onload=alert(1)><frame src="javascript:alert(1)"></frameset>'],
  // Styles.
  ['style attribute with a script URL', '<div style="background:url(javascript:alert(1))">x</div>'],
  ['style element with a script URL', '<style>p{background:url(javascript:alert(1))}</style><p>x</p>'],
  ['style attribute with an expression', '<p style="width:expression(alert(1))">x</p>'],
  // Script and its neighbours.
  ['script block', '<p>ok</p><script>alert(1)</script>'],
  ['script with a src', '<script src="https://evil.test/x.js"></script>'],
  ['nested script tags', '<scr<script>ipt>alert(1)</scr</script>ipt>'],
  ['noscript breakout', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
  ['template content', '<template><img src=x onerror=alert(1)></template>'],
  // Navigation and form vectors.
  ['form action', '<form action="javascript:alert(1)"><button>go</button></form>'],
  ['button formaction', '<button formaction="javascript:alert(1)">go</button>'],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
  ['base href', '<base href="javascript:alert(1)//"><a href="/x">x</a>'],
  ['link import', '<link rel="import" href="https://evil.test/x.html">'],
  ['comment breakout', '<!--<img src="--><img src=x onerror=alert(1)//">'],
];

describe('html / richtext display: stored markup comes out inert', () => {
  for (const [label, payload] of HOSTILE) {
    it(label, () => {
      expectInert(renderHtml(payload), label);
    });
  }

  it('hides the body of a stripped element rather than printing it as text', () => {
    const prose = renderHtml('<p>kept</p><script>alert(1)</script><style>p{}</style><svg><text>svg</text></svg>');
    expect(prose.textContent).toBe('kept');
  });

  it('prefixes stored ids so they cannot shadow the page’s own', () => {
    const prose = renderHtml('<h2 id="root">Title</h2><a name="main">x</a>');
    expect(prose.querySelector('h2')?.id).toBe('user-content-root');
    expect(prose.querySelector('a')?.getAttribute('name')).toBe('user-content-main');
  });

  it('html and richtext share the one renderer', () => {
    expect(RICH_TEXT_CELL_RENDERERS.richtext).toBe(RICH_TEXT_CELL_RENDERERS.html);
  });

  it('the schema strips the script-bearing elements with their content', () => {
    for (const tag of ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math']) {
      expect(RICH_TEXT_SANITIZE_SCHEMA.strip, tag).toContain(tag);
    }
  });
});

/**
 * What a rich-text document is made of, already in the canonical form the
 * pipeline serialises back (lower-case tags, double-quoted attributes, an
 * image's `src` after its other attributes), so the comparison below is byte
 * for byte.
 */
const FORMATTED_DOCUMENT = [
  '<h1>Account review</h1>',
  '<h2>Summary</h2>',
  '<p>Body with <strong>bold</strong>, <em>emphasis</em>, <b>b</b>, <i>i</i>, <del>removed</del>, ',
  '<sub>sub</sub>, <sup>sup</sup> and <code>inline code</code>.<br>Second line.</p>',
  '<h3>Links</h3>',
  '<p><a href="https://objectstack.ai/docs?x=1#top">absolute</a>, <a href="mailto:sales@example.com">mail</a>, ',
  '<a href="/app/crm/lead/1">relative</a> and <a href="http://example.com">plain http</a>.</p>',
  '<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>',
  '<ol start="3"><li>three</li><li>four</li></ol>',
  '<blockquote><p>Quoted text.</p></blockquote>',
  '<pre><code>const x = 1;\n</code></pre>',
  '<table><thead><tr><th>Stage</th><th align="right">Amount</th></tr></thead>',
  '<tbody><tr><td>Won</td><td align="right">1,000</td></tr><tr><td colspan="2">Total</td></tr></tbody></table>',
  '<p><img alt="Logo" width="120" height="40" title="Logo" src="https://cdn.example.com/logo.png"></p>',
  '<hr>',
  '<dl><dt>Term</dt><dd>Definition</dd></dl>',
  '<details><summary>More</summary><p>Hidden detail.</p></details>',
].join('');

describe('html / richtext display: a formatted document keeps its formatting', () => {
  it('round-trips byte for byte', () => {
    expect(renderHtml(FORMATTED_DOCUMENT).innerHTML).toBe(FORMATTED_DOCUMENT);
  });

  it('keeps the safe part of a mixed value', () => {
    const prose = renderHtml(
      '<p onclick="alert(1)">Hello <strong>world</strong></p><a href="javascript:alert(1)">bad</a><a href="https://ok.test">good</a>',
    );
    expect(prose.innerHTML).toBe('<p>Hello <strong>world</strong></p><a>bad</a><a href="https://ok.test">good</a>');
  });

  it('keeps the text of an element it does not allow', () => {
    expect(renderHtml('<p><u>underlined</u> and <font color="red">coloured</font></p>').innerHTML).toBe(
      '<p>underlined and coloured</p>',
    );
  });

  it('renders plain text that holds no markup as text', () => {
    expect(renderHtml('5 < 6 & 7 > 3').textContent).toBe('5 < 6 & 7 > 3');
  });
});
