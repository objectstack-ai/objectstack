// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37365 (ADR-0160 D9) — `?section=ANCHOR` names a heading of the
 * record's body by the anchor the server's body outline issued. The surface
 * derives it with the same spec function (`headingsOf`), and finds the heading
 * element among the field's drawn headings by reading, counting repeats.
 *
 * The DOM here is written by hand, so the matching is pinned apart from any
 * renderer: a heading of another title the outline does not list (a setext
 * heading) must not shift a later one onto the wrong section, and when the face
 * draws a different number of same-titled headings than the outline lists, the
 * field is opened rather than a heading that may be another one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { headingsOf } from '@objectstack/spec/ai';
import {
  RECORD_SECTION_TARGET_ATTR,
  focusRecordSection,
  locateSection,
  sectionCandidates,
} from './recordSectionAnchor';
import { RECORD_SECTION_PARAM, RESERVED_URL_PARAMS } from '../urlParams';

const MARKDOWN = ['# Intro', '', 'Hello.', '', '## Scope', '', 'Everyone.', '', '## Scope', '', 'Again.'].join('\n');
const HTML = '<h1>Intro</h1><p>x</p><h2>Data &amp; <em>privacy</em></h2><p>y</p>';

const FIELDS = {
  title: { type: 'text' },
  summary: { type: 'textarea' },
  content: { type: 'markdown' },
  legal: { type: 'richtext' },
};

const RECORD = {
  title: '# Scope',
  summary: 'Plain text, no headings.',
  content: MARKDOWN,
  legal: HTML,
};

function row(field: string, inner: string): string {
  return `<div data-detail-field="${field}">${inner}</div>`;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('objectstack#37365 — the section param', () => {
  it('is the reserved `section`', () => {
    expect(RECORD_SECTION_PARAM).toBe('section');
    expect(RESERVED_URL_PARAMS).toContain(RECORD_SECTION_PARAM);
  });
});

describe('objectstack#37365 — sectionCandidates derives the anchor as the server does', () => {
  it("answers the body field whose spec outline issues the anchor, the server's anchors included", () => {
    const server = headingsOf(MARKDOWN, false).map((h) => h.anchor);
    expect(server).toEqual(['intro', 'scope', 'scope-2']);
    expect(sectionCandidates(FIELDS, RECORD, 'scope')).toEqual([
      { field: 'content', face: 'markdown', reading: 'scope', ordinal: 0, count: 2, unlisted: 0 },
    ]);
    expect(sectionCandidates(FIELDS, RECORD, 'scope-2')).toEqual([
      { field: 'content', face: 'markdown', reading: 'scope', ordinal: 1, count: 2, unlisted: 0 },
    ]);
  });

  it('reads an html body as html', () => {
    expect(headingsOf(HTML, true).map((h) => h.anchor)).toContain('data-privacy');
    expect(sectionCandidates(FIELDS, RECORD, 'data-privacy')).toEqual([
      { field: 'legal', face: 'html', reading: 'dataprivacy', ordinal: 0, count: 1, unlisted: 0 },
    ]);
  });

  it('a `textarea` body is a candidate drawn as text', () => {
    const record = { ...RECORD, summary: '# Steps\n\nDo it.' };
    expect(sectionCandidates(FIELDS, record, 'steps')).toEqual([
      { field: 'summary', face: 'text', reading: 'steps', ordinal: 0, count: 1, unlisted: 0 },
    ]);
  });

  it('a stale anchor, a non-text field, or no anchor answers none', () => {
    expect(sectionCandidates(FIELDS, RECORD, 'renamed-heading')).toEqual([]);
    // `title` is a `text` field: never a body, whatever it holds.
    expect(sectionCandidates({ title: { type: 'text' } }, RECORD, 'scope')).toEqual([]);
    expect(sectionCandidates(FIELDS, RECORD, null)).toEqual([]);
    expect(sectionCandidates(undefined, RECORD, 'scope')).toEqual([]);
  });
});

describe('objectstack#37365 — locateSection finds the drawn heading', () => {
  it('takes the Nth heading that reads the same, so an unlisted heading shifts nothing', () => {
    // A setext heading the outline does not list is drawn first; a bare
    // position (the second heading for `scope`) would land on the first Scope.
    document.body.innerHTML = row(
      'content',
      '<h1>Preface</h1><h1>Intro</h1><h2>Scope</h2><p>Everyone.</p><h2 id="second">Scope</h2>',
    );
    const target = locateSection(document.body, sectionCandidates(FIELDS, RECORD, 'scope-2'));
    expect(target?.heading?.id).toBe('second');
  });

  it('a same-titled heading the outline does not list opens the field, never that heading; CONTROL: titled otherwise, the cited heading is marked', () => {
    // A setext `Scope` above `# Scope`: the outline lists only the ATX one
    // (`scope`), the face draws both. Index 0 of the drawn `Scope`s would be
    // the setext heading.
    const body = ['Scope', '=====', '', 'x', '', '# Scope', '', 'y'].join('\n');
    expect(headingsOf(body, false).map((h) => h.anchor)).toEqual(['scope']);
    const candidates = sectionCandidates(FIELDS, { content: body }, 'scope');
    expect(candidates).toEqual([{ field: 'content', face: 'markdown', reading: 'scope', ordinal: 0, count: 1, unlisted: 1 }]);
    document.body.innerHTML = row('content', '<h1 id="setext">Scope</h1><p>x</p><h1 id="atx">Scope</h1><p>y</p>');
    const target = locateSection(document.body, candidates);
    expect(target?.field.getAttribute('data-detail-field')).toBe('content');
    expect(target?.heading).toBeUndefined();
    // CONTROL: the setext heading titled otherwise; the ATX `Scope` is found.
    const control = ['Preface', '=======', '', 'x', '', '# Scope', '', 'y'].join('\n');
    document.body.innerHTML = row('content', '<h1>Preface</h1><p>x</p><h1 id="atx">Scope</h1><p>y</p>');
    expect(locateSection(document.body, sectionCandidates(FIELDS, { content: control }, 'scope'))?.heading?.id).toBe('atx');
  });

  it('a listed heading the face does not draw opens the field, for either anchor; CONTROL: without it, the heading is marked', () => {
    // `# Scope` inside a raw HTML block: the outline lists it (`scope`) and the
    // real heading after it (`scope-2`); the face draws only the real one.
    const body = ['<div>', '# Scope', '</div>', '', '# Scope', '', 'y'].join('\n');
    expect(headingsOf(body, false).map((h) => h.anchor)).toEqual(['scope', 'scope-2']);
    document.body.innerHTML = row('content', '<div># Scope</div><h1 id="real">Scope</h1><p>y</p>');
    for (const anchor of ['scope', 'scope-2']) {
      const target = locateSection(document.body, sectionCandidates(FIELDS, { content: body }, anchor));
      expect(target?.field.getAttribute('data-detail-field')).toBe('content');
      expect(target?.heading).toBeUndefined();
    }
    // CONTROL: the body without the HTML block; `scope` is the drawn heading.
    const control = ['# Scope', '', 'y'].join('\n');
    expect(locateSection(document.body, sectionCandidates(FIELDS, { content: control }, 'scope'))?.heading?.id).toBe('real');
  });

  it('objectstack#37562 N6 — one unlisted same-titled heading plus one listed-but-undrawn heading opens the field, never a heading; CONTROL: the first Scope a paragraph line, the cited heading is marked', () => {
    // A setext `Scope` the outline does not list, and `# Scope` inside a raw
    // HTML block that the outline lists and the face does not draw: the face
    // draws two `Scope`s and the outline lists two, so the count agrees while
    // index 0 of the drawn ones is the setext heading, not the cited one.
    const body = ['Scope', '=====', '', 'x', '', '<div>', '# Scope', '</div>', '', '# Scope', '', 'y'].join('\n');
    expect(headingsOf(body, false).map((h) => h.anchor)).toEqual(['scope', 'scope-2']);
    document.body.innerHTML = row(
      'content',
      '<h1 id="setext">Scope</h1><p>x</p><div># Scope</div><h1 id="atx">Scope</h1><p>y</p>',
    );
    for (const anchor of ['scope', 'scope-2']) {
      const candidates = sectionCandidates(FIELDS, { content: body }, anchor);
      expect(candidates).toEqual([
        { field: 'content', face: 'markdown', reading: 'scope', ordinal: anchor === 'scope' ? 0 : 1, count: 2, unlisted: 1 },
      ]);
      const target = locateSection(document.body, candidates);
      expect(target?.field.getAttribute('data-detail-field')).toBe('content');
      expect(target?.heading).toBeUndefined();
    }
    // CONTROL: the first `Scope` a paragraph line, which no face draws as a
    // heading; with the HTML block gone the outline and the face agree.
    const control = ['Scope', '', 'x', '', '# Scope', '', 'y'].join('\n');
    expect(sectionCandidates(FIELDS, { content: control }, 'scope')).toEqual([
      { field: 'content', face: 'markdown', reading: 'scope', ordinal: 0, count: 1, unlisted: 0 },
    ]);
    document.body.innerHTML = row('content', '<p>Scope</p><p>x</p><h1 id="atx">Scope</h1><p>y</p>');
    expect(locateSection(document.body, sectionCandidates(FIELDS, { content: control }, 'scope'))?.heading?.id).toBe('atx');
  });

  it('objectstack#37562 N6 — counts every place a face draws a same-titled heading the outline does not list; CONTROL: other titles and fenced code count none', () => {
    const unlisted = (value: string, field = 'content'): number | undefined =>
      sectionCandidates(FIELDS, { [field]: value }, 'scope')[0]?.unlisted;
    const atx = '# Scope';
    expect(unlisted(['Scope', '-----', '', atx].join('\n'))).toBe(1);
    expect(unlisted(['Sco', 'pe', '===', '', atx].join('\n'))).toBe(1);
    expect(unlisted(['> # Scope', '', atx].join('\n'))).toBe(1);
    expect(unlisted(['- # Scope', '', atx].join('\n'))).toBe(1);
    expect(unlisted(['1. ## Scope', '', atx].join('\n'))).toBe(1);
    expect(unlisted(['   # Scope', '', atx].join('\n'))).toBe(1);
    expect(unlisted(['<h2>Scope</h2>', '', atx].join('\n'))).toBe(1);
    // An html body: a heading tag left unclosed, and one opened inside another.
    expect(unlisted('<h2>Scope</h2><p>x</p><h2>Scope', 'legal')).toBe(1);
    expect(unlisted('<h2>About <h2>Scope</h2><h2>Scope</h2>', 'legal')).toBe(1);
    // CONTROL: other titles, a rule under a blank line, a list item, fenced code.
    expect(unlisted(['Preface', '=======', '', '> # Intro', '', '---', '', '- Scope', '', atx].join('\n'))).toBe(0);
    expect(unlisted(['```', 'Scope', '===', '> # Scope', '```', '', atx].join('\n'))).toBe(0);
    expect(unlisted('<h2>Scope</h2><hr><header>Scope</header>', 'legal')).toBe(0);
  });

  it('a heading with no letter or digit opens the field; CONTROL: a titled heading beside it is marked', () => {
    const body = ['# ???', '', 'x', '', '# Intro', '', 'y'].join('\n');
    const [blank, intro] = headingsOf(body, false);
    document.body.innerHTML = row('content', '<h1>???</h1><h1></h1><p>x</p><h1 id="intro">Intro</h1>');
    const target = locateSection(document.body, sectionCandidates(FIELDS, { content: body }, blank.anchor));
    expect(target?.field.getAttribute('data-detail-field')).toBe('content');
    expect(target?.heading).toBeUndefined();
    expect(locateSection(document.body, sectionCandidates(FIELDS, { content: body }, intro.anchor))?.heading?.id).toBe('intro');
  });

  it('matches an html heading by its drawn text', () => {
    document.body.innerHTML = row('legal', '<h1>Intro</h1><h2 id="dp">Data &amp; <em>privacy</em></h2>');
    expect(locateSection(document.body, sectionCandidates(FIELDS, RECORD, 'data-privacy'))?.heading?.id).toBe('dp');
  });

  it('a heading the face does not draw answers the field alone; no drawn field answers nothing', () => {
    document.body.innerHTML = row('content', '<p>still loading</p>');
    const candidates = sectionCandidates(FIELDS, RECORD, 'scope');
    const target = locateSection(document.body, candidates);
    expect(target?.field.getAttribute('data-detail-field')).toBe('content');
    expect(target?.heading).toBeUndefined();
    document.body.innerHTML = row('summary', 'x');
    expect(locateSection(document.body, candidates)).toBeUndefined();
  });
});

describe('objectstack#37365 — focusRecordSection', () => {
  it('scrolls to the heading and marks it', () => {
    document.body.innerHTML = row('content', '<h1>Intro</h1><h2 id="s">Scope</h2><h2>Scope</h2>');
    const scroll = vi.fn();
    const heading = document.getElementById('s')!;
    heading.scrollIntoView = scroll;
    focusRecordSection(document.body, sectionCandidates(FIELDS, RECORD, 'scope'));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(heading.getAttribute(RECORD_SECTION_TARGET_ATTR)).toBe('true');
  });

  it('waits for the heading to be drawn', async () => {
    document.body.innerHTML = row('content', '<span>loading</span>');
    const candidates = sectionCandidates(FIELDS, RECORD, 'scope');
    focusRecordSection(document.body, candidates);
    const field = document.querySelector('[data-detail-field="content"]')!;
    const heading = document.createElement('h2');
    heading.textContent = 'Scope';
    const scroll = vi.fn();
    heading.scrollIntoView = scroll;
    const second = document.createElement('h2');
    second.textContent = 'Scope';
    field.append(heading, second);
    await new Promise((r) => setTimeout(r, 0));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(heading.getAttribute(RECORD_SECTION_TARGET_ATTR)).toBe('true');
  });

  it('a `textarea` body scrolls to the field at once, and marks nothing', () => {
    document.body.innerHTML = row('summary', '# Steps<br>Do it.');
    const field = document.querySelector<HTMLElement>('[data-detail-field="summary"]')!;
    const scroll = vi.fn();
    field.scrollIntoView = scroll;
    focusRecordSection(document.body, sectionCandidates(FIELDS, { ...RECORD, summary: '# Steps\n\nDo it.' }, 'steps'));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.querySelector(`[${RECORD_SECTION_TARGET_ATTR}]`)).toBeNull();
  });

  it('objectstack#37562 N7 — a heading that reads as nothing scrolls to the field at once; CONTROL: a titled heading not yet drawn still waits for the settle', () => {
    vi.useFakeTimers();
    const body = ['# ???', '', 'x', '', '# Intro', '', 'y'].join('\n');
    const [blank, intro] = headingsOf(body, false);
    document.body.innerHTML = row('content', '<p>loading</p>');
    const field = document.querySelector<HTMLElement>('[data-detail-field="content"]')!;
    const scroll = vi.fn();
    field.scrollIntoView = scroll;
    focusRecordSection(document.body, sectionCandidates(FIELDS, { content: body }, blank.anchor), 50);
    expect(scroll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.querySelector(`[${RECORD_SECTION_TARGET_ATTR}]`)).toBeNull();
    // CONTROL: `Intro` is not drawn yet, so the page waits for it until the settle.
    scroll.mockClear();
    focusRecordSection(document.body, sectionCandidates(FIELDS, { content: body }, intro.anchor), 50);
    expect(scroll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('a heading never drawn settles on the field, with no error', () => {
    vi.useFakeTimers();
    document.body.innerHTML = row('content', '<p>Scope is not a heading here</p>');
    const field = document.querySelector<HTMLElement>('[data-detail-field="content"]')!;
    const scroll = vi.fn();
    field.scrollIntoView = scroll;
    focusRecordSection(document.body, sectionCandidates(FIELDS, RECORD, 'scope'), 50);
    expect(scroll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.querySelector(`[${RECORD_SECTION_TARGET_ATTR}]`)).toBeNull();
  });

  it('a stale anchor moves nothing; CONTROL: the live anchor on the same page does', () => {
    vi.useFakeTimers();
    document.body.innerHTML = row('content', '<h1>Intro</h1><h2 id="s">Scope</h2><h2>Scope</h2>');
    const heading = document.getElementById('s')!;
    const field = document.querySelector<HTMLElement>('[data-detail-field="content"]')!;
    const scroll = vi.fn();
    heading.scrollIntoView = scroll;
    field.scrollIntoView = scroll;
    focusRecordSection(document.body, sectionCandidates(FIELDS, RECORD, 'renamed-heading'), 50);
    vi.advanceTimersByTime(60);
    expect(scroll).not.toHaveBeenCalled();
    expect(heading.hasAttribute(RECORD_SECTION_TARGET_ATTR)).toBe(false);
    focusRecordSection(document.body, sectionCandidates(FIELDS, RECORD, 'scope'), 50);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(heading.getAttribute(RECORD_SECTION_TARGET_ATTR)).toBe('true');
  });

  it('the cleanup takes the mark off, so a second section leaves only itself marked', () => {
    document.body.innerHTML = row('content', '<h1>Intro</h1><h2 id="a" class="rounded-md">Scope</h2><h2 id="b">Scope</h2>');
    const [a, b] = [document.getElementById('a')!, document.getElementById('b')!];
    a.scrollIntoView = vi.fn();
    b.scrollIntoView = vi.fn();
    const first = focusRecordSection(document.body, sectionCandidates(FIELDS, RECORD, 'scope'));
    expect(a.getAttribute(RECORD_SECTION_TARGET_ATTR)).toBe('true');
    expect(a.classList.contains('ring-4')).toBe(true);
    first();
    focusRecordSection(document.body, sectionCandidates(FIELDS, RECORD, 'scope-2'));
    expect(Array.from(document.querySelectorAll(`[${RECORD_SECTION_TARGET_ATTR}]`))).toEqual([b]);
    expect(a.classList.contains('ring-4')).toBe(false);
    // A class the heading carried before the mark is left on it.
    expect(a.classList.contains('rounded-md')).toBe(true);
  });

  it('the same section opened again scrolls and marks again', () => {
    document.body.innerHTML = row('content', '<h1>Intro</h1><h2 id="a">Scope</h2><h2>Scope</h2>');
    const a = document.getElementById('a')!;
    const scroll = vi.fn();
    a.scrollIntoView = scroll;
    const candidates = sectionCandidates(FIELDS, RECORD, 'scope');
    focusRecordSection(document.body, candidates)();
    expect(a.hasAttribute(RECORD_SECTION_TARGET_ATTR)).toBe(false);
    focusRecordSection(document.body, candidates);
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(a.getAttribute(RECORD_SECTION_TARGET_ATTR)).toBe('true');
  });
});
