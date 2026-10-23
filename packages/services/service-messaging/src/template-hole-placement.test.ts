// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25082 — the notification template's HTML hole placement judge, one
 * placement class at a time, and the readings it takes where a parser's tree
 * builder decides.
 *
 * Each case names the class it asserts; the bodies carry holes and markup only,
 * never a value. Grammar parity with the renderer is pinned at the bottom,
 * against `renderNotification` itself.
 */
import { describe, expect, it } from 'vitest';

import {
    HOLE_PLACEMENT_LABELS,
    judgeTemplateHtmlHoles,
    SUPPORTED_HOLE_PLACEMENTS,
    type TemplateHolePlacement,
} from './template-hole-placement.js';
import { isHtmlFormat, renderNotification, templateHoles } from './template-renderer.js';

const one = (html: string) => {
    const holes = judgeTemplateHtmlHoles(html);
    expect(holes, html).toHaveLength(1);
    return holes[0];
};

describe('the supported placements', () => {
    it.each([
        ['<p>{{ who }}</p>', 'element-text'],
        ['{{who}}', 'element-text'],
        ['<table><tr><td>{{ payload.who }}</td></tr></table>', 'element-text'],
        ['<p>a < {{who}} > b</p>', 'element-text'],
        ['<p>&{{who}};</p>', 'element-text'],
        ['<title>{{who}}</title>', 'element-text'],
        ['<textarea>{{who}}</textarea>', 'element-text'],
        ['<p title="{{who}}">x</p>', 'quoted-attribute'],
        ["<p title='{{who}}'>x</p>", 'quoted-attribute'],
        ['<td width="{{w}}" class="a {{c}} b">x</td>', 'quoted-attribute'],
        ['<img alt="{{who}}" />', 'quoted-attribute'],
        ['<p data-who="{{who}}">x</p>', 'quoted-attribute'],
        ['<mj-text css-class="{{c}}">{{who}}</mj-text>', 'quoted-attribute'],
    ] as const)('%s → %s, supported', (html, placement) => {
        const holes = judgeTemplateHtmlHoles(html);
        expect(holes.length).toBeGreaterThan(0);
        expect(holes.every((hole) => hole.supported), html).toBe(true);
        expect(holes[0].placement).toBe(placement);
    });

    it('the supported list is the two encoded placements', () => {
        expect([...SUPPORTED_HOLE_PLACEMENTS]).toEqual(['element-text', 'quoted-attribute']);
    });
});

describe('the refused placements, by class', () => {
    it.each([
        ['<script>{{x}}</script>', 'raw-text-element'],
        ['<style>p { color: {{x}} }</style>', 'raw-text-element'],
        ['<xmp>{{x}}</xmp>', 'raw-text-element'],
        ['<iframe>{{x}}</iframe>', 'raw-text-element'],
        ['<noembed>{{x}}</noembed>', 'raw-text-element'],
        ['<noframes>{{x}}</noframes>', 'raw-text-element'],
        ['<noscript>{{x}}</noscript>', 'raw-text-element'],
        ['<plaintext>{{x}}', 'raw-text-element'],
        ['<!-- {{x}} -->', 'comment'],
        ['<!--[if mso]><p>{{x}}</p><![endif]-->', 'comment'],
        ['<!DOCTYPE {{x}}>', 'comment'],
        ['<!{{x}}>', 'comment'],
        ['<? {{x}} ?>', 'comment'],
        ['<td width={{x}}>a</td>', 'unquoted-attribute'],
        ['<td width=1{{x}}>a</td>', 'unquoted-attribute'],
        ['<p {{x}}>a</p>', 'tag'],
        ['<{{x}}>', 'tag'],
        ['</{{x}}>', 'tag'],
        ['<p>a <{{x}}</p>', 'tag'],
        ['<p title="a"{{x}}>a</p>', 'tag'],
        ['<p data-{{x}}="1">a</p>', 'tag'],
        ['<p>a</p title="{{x}}">', 'tag'],
        ['<title>a <{{x}}</title>', 'tag'],
        ['<title>a </{{x}}</title>', 'tag'],
        ['<a href="{{x}}">a</a>', 'url-attribute'],
        ['<a href="https://example.test/{{x}}">a</a>', 'url-attribute'],
        ['<a HREF="{{x}}">a</a>', 'url-attribute'],
        ['<img src="{{x}}">', 'url-attribute'],
        ['<img srcset="{{x}} 2x">', 'url-attribute'],
        ['<form action="{{x}}"></form>', 'url-attribute'],
        ['<td background="{{x}}">a</td>', 'url-attribute'],
        ['<a xlink:href="{{x}}">a</a>', 'url-attribute'],
        ['<param name="m" value="{{x}}">', 'url-attribute'],
        ['<mj-button href="{{x}}">a</mj-button>', 'url-attribute'],
        ['<meta http-equiv="refresh" content="{{x}}">', 'meta-attribute'],
        ['<meta charset="{{x}}">', 'meta-attribute'],
        ['<meta name="description" content="{{x}}">', 'meta-attribute'],
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

    it('every class has an author-facing label', () => {
        const classes: TemplateHolePlacement[] = [
            'element-text', 'quoted-attribute', 'url-attribute', 'event-handler-attribute', 'style-attribute',
            'markup-attribute', 'meta-attribute', 'unquoted-attribute', 'tag', 'raw-text-element', 'comment',
            'foreign-content',
        ];
        expect(Object.keys(HOLE_PLACEMENT_LABELS).sort()).toEqual([...classes].sort());
    });
});

describe('where an element ends, the markup after it is judged afresh', () => {
    it('a hole after a closed raw-text element or comment is judged by the markup that follows', () => {
        const holes = judgeTemplateHtmlHoles(
            '<style>p{}</style><p>{{a}}</p><!-- c --><b>{{b}}</b><script></SCRIPT ><u>{{c}}</u><title>t</title><i title="{{d}}">x</i>',
        );
        expect(holes.map((h) => [h.path, h.placement, h.supported])).toEqual([
            ['a', 'element-text', true],
            ['b', 'element-text', true],
            ['c', 'element-text', true],
            ['d', 'quoted-attribute', true],
        ]);
    });

    it('text inside a raw-text element that only looks like a closing tag does not close it', () => {
        expect(one('<script></scriptx>{{x}}</script>').placement).toBe('raw-text-element');
        expect(one('<style></style-x>{{x}}</style>').placement).toBe('raw-text-element');
        expect(one('<style></sty{{x}}le><p>a</p>').placement).toBe('raw-text-element');
    });

    it('past a comment opener in a script, no end tag closes it until the comment closer', () => {
        expect(one('<script><!-- </script><p>{{x}}</p>').placement).toBe('raw-text-element');
        expect(one('<script><!-- a --></script><p>{{x}}</p>')).toMatchObject({ placement: 'element-text', supported: true });
    });

    it('an abruptly closed comment ends where the parser ends it', () => {
        expect(one('<!--><p>{{x}}</p>').placement).toBe('element-text');
        expect(one('<!---><p>{{x}}</p>').placement).toBe('element-text');
        expect(one('<!-- a --!><p>{{x}}</p>').placement).toBe('element-text');
        expect(one('<!-- a -- b --><p>{{x}}</p>').placement).toBe('element-text');
        expect(one('<!-- a -><p>{{x}}</p>').placement).toBe('comment');
    });

    it('a markup declaration other than a comment ends at the next >', () => {
        expect(one('<!DOCTYPE html><p>{{x}}</p>').placement).toBe('element-text');
        expect(one('<![if !mso]><p>{{x}}</p><![endif]>').placement).toBe('element-text');
        expect(one('<![CDATA[ a > b ]]><p>{{x}}</p>').placement).toBe('element-text');
    });

    it('a character that opens no tag is reconsumed as text', () => {
        expect(one('<p>1 <2 {{x}}</p>').placement).toBe('element-text');
        expect(one('<p><<b>{{x}}</b></p>').placement).toBe('element-text');
    });
});

describe('the readings a parser\'s tree builder decides', () => {
    it('foreign content is never left: every hole after an svg or math root is refused', () => {
        for (const html of [
            '<svg></svg><p>{{x}}</p>',
            '<math></math><p>{{x}}</p>',
            '<svg></math><p title="{{x}}">a</p>',
            '<svg><foreignObject><div></svg></div><p>{{x}}</p>',
        ]) {
            expect(one(html), html).toMatchObject({ placement: 'foreign-content', supported: false });
        }
    });

    it('a self-closed svg root opens no foreign content', () => {
        expect(one('<svg/><p>{{x}}</p>')).toMatchObject({ placement: 'element-text', supported: true });
    });

    it('a noscript element is read both ways: as raw text, and as markup (scripting off, as in a mail client)', () => {
        // Read as raw text, the comment opener is text and the hole lands in a
        // paragraph; read as markup, the same hole lands in a comment.
        expect(one('<noscript><!--</noscript><p>{{x}}</p>-->')).toMatchObject({ placement: 'comment', supported: false });
        // A hole each reading places where the encoding is right stays supported.
        expect(one('<noscript><p title="</noscript>{{x}}">a</p>').supported).toBe(true);
        // A noscript holding plain text rejoins one reading at its end tag.
        expect(one('<noscript>text</noscript><p>{{x}}</p>')).toMatchObject({ placement: 'element-text', supported: true });
    });

    it('inside a select or after a frameset, a text element is read both ways, since its start tag may be ignored', () => {
        expect(one('<select><style><p style="</style>{{x}}">').supported).toBe(false);
        expect(one('<frameset><textarea><a href="</textarea>{{x}}">').supported).toBe(false);
        // Outside those, a style element is raw text and nothing else.
        expect(one('<style><p style="</style>{{x}}">')).toMatchObject({ placement: 'element-text', supported: true });
    });

    it('a hole refused under one reading is refused, with that reading\'s placement', () => {
        expect(one('<noscript>{{x}}</noscript>')).toMatchObject({ placement: 'raw-text-element', supported: false });
    });
});

describe('what is and is not a hole — the renderer\'s grammar', () => {
    it('text the renderer leaves verbatim is markup, not a hole', () => {
        expect(judgeTemplateHtmlHoles('<p>{{ not a path }}</p>')).toEqual([]);
        expect(judgeTemplateHtmlHoles('<p>{x}</p>')).toEqual([]);
        expect(judgeTemplateHtmlHoles('<p>{{ x | upper }}</p>')).toEqual([]);
        expect(judgeTemplateHtmlHoles('')).toEqual([]);
    });

    it('a verbatim brace pair still moves the markup around it', () => {
        const holes = judgeTemplateHtmlHoles('<p>{{ <b }}{{x}}</p>');
        expect(holes).toHaveLength(1);
        expect(holes[0]).toMatchObject({ path: 'x', placement: 'tag', supported: false });
    });

    it('a hole\'s span, braces included', () => {
        expect(judgeTemplateHtmlHoles('a {{ payload.x }} b {{{z}}} c')).toEqual([
            expect.objectContaining({ start: 2, end: 17, text: '{{ payload.x }}', path: 'payload.x' }),
            expect.objectContaining({ start: 21, end: 26, text: '{{z}}', path: 'z' }),
        ]);
    });

    it('the judge reads exactly the spans renderNotification substitutes on the html face', () => {
        const corpus = [
            '<p>{{ a }} {{b.c}} {{ $d }}</p>',
            '<p title="{{e}}">{{{f}}}</p>',
            '{{ not a path }} {{g}} {x} {{ h | upper }} {{\ni\n}}',
        ];
        for (const body of corpus) {
            const holes = templateHoles(body);
            const payload: Record<string, unknown> = {};
            for (const hole of holes) {
                const segments = hole.path.split('.');
                let cursor = payload;
                for (const segment of segments.slice(0, -1)) cursor = (cursor[segment] ??= {}) as Record<string, unknown>;
                cursor[segments[segments.length - 1]] = 'Z';
            }
            const rendered = renderNotification({ subject: 's', body, format: 'html' }, { topic: 't', payload }).html;
            // Replacing every span the judge reads with the value renders the
            // renderer's output, byte for byte.
            let expected = '';
            let at = 0;
            for (const hole of judgeTemplateHtmlHoles(body)) {
                expected += body.slice(at, hole.start) + 'Z';
                at = hole.end;
            }
            expected += body.slice(at);
            expect(rendered, body).toBe(expected);
        }
    });

    it('the formats judged are exactly the ones rendered to the html face, and an mjml body reaches it as written', () => {
        for (const format of ['html', 'mjml', 'markdown', 'text', null, undefined] as const) {
            const rendered = renderNotification({ subject: 's', body: '<mj-text>{{x}}</mj-text>', format }, { topic: 't', payload: { x: 'Z' } });
            expect(rendered.html !== undefined, String(format)).toBe(isHtmlFormat(format));
            if (rendered.html !== undefined) expect(rendered.html).toBe('<mj-text>Z</mj-text>');
        }
    });
});
