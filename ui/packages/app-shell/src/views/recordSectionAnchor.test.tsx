// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37365 (ADR-0160 D9) — `?section=ANCHOR` names a heading of the
 * record's body by the anchor the server's body outline issued. The surface
 * derives it with the same spec function (`headingsOf`), and finds the heading
 * element among the field's drawn headings by reading, counting repeats.
 *
 * The DOM here is written by hand, so the matching is pinned apart from any
 * renderer: a heading the outline does not list (a setext heading) must not
 * shift a later one onto the wrong section.
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
      { field: 'content', face: 'markdown', reading: 'scope', ordinal: 0 },
    ]);
    expect(sectionCandidates(FIELDS, RECORD, 'scope-2')).toEqual([
      { field: 'content', face: 'markdown', reading: 'scope', ordinal: 1 },
    ]);
  });

  it('reads an html body as html', () => {
    expect(headingsOf(HTML, true).map((h) => h.anchor)).toContain('data-privacy');
    expect(sectionCandidates(FIELDS, RECORD, 'data-privacy')).toEqual([
      { field: 'legal', face: 'html', reading: 'dataprivacy', ordinal: 0 },
    ]);
  });

  it('a `textarea` body is a candidate drawn as text', () => {
    const record = { ...RECORD, summary: '# Steps\n\nDo it.' };
    expect(sectionCandidates(FIELDS, record, 'steps')).toEqual([
      { field: 'summary', face: 'text', reading: 'steps', ordinal: 0 },
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
    document.body.innerHTML = row('content', '<h1>Intro</h1><h2 id="s">Scope</h2>');
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
    field.appendChild(heading);
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
    document.body.innerHTML = row('content', '<h1>Intro</h1><h2 id="s">Scope</h2>');
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
});
