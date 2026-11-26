/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Opening a record at a cited section (`?section=ANCHOR`, ADR-0160 D9; the
 * param is `RECORD_SECTION_PARAM` in `../urlParams.ts`).
 *
 * An anchor names a heading of a record's body, as the server's body outline
 * issued it. The anchor is derived here by the same function the server uses,
 * the spec's `headingsOf` (`record-body-anchor.ts`), run on the raw value of
 * each long-text field the record holds, so a surface and the server never
 * disagree on which heading an anchor names. The first field, in the object's
 * field order, whose headings include the anchor is the body that is opened.
 *
 * The heading element is then found in that field's drawn face: among the
 * field's heading elements, the ones whose letters and digits read the same as
 * the outline's heading, counted in document order. Counting by reading rather
 * than by bare position keeps a heading of another title that the outline does
 * not list (a setext heading, an empty one, one inside a quote) from shifting
 * every later one onto the wrong section. The count is trusted only when the
 * face draws exactly as many headings of that reading as the outline lists,
 * and the body holds no place outside the outline that could draw a heading
 * of that reading: a same-titled heading the outline does not list, or a
 * listed one the face does not draw, would move the index onto another
 * heading, and one of each would leave the count equal while doing it, so then
 * the field is opened instead.
 *
 * - A `textarea` body draws no heading elements, so the field is scrolled to
 *   as soon as it is drawn. So is a heading with no letter or digit, which no
 *   reading tells apart: no drawing of the face can change that answer.
 * - A heading that is not drawn (the face has not rendered it, reads it
 *   differently, or draws a different number of same-titled headings than the
 *   outline lists) also scrolls to the field, with no error, once
 *   {@link RECORD_SECTION_SETTLE_MS} pass. So does a heading whose body holds
 *   a same-titled heading the outline does not list.
 * - An anchor no field resolves (a stale one: the heading was renamed or
 *   removed) opens the record at its top, as if no section were named.
 *
 * Nothing here re-verifies a citation: the anchor is only a place to open at.
 */
import { headingsOf, stripBodyTags, type BodyHeading } from '@objectstack/spec/ai';

/** The attribute a marked heading carries. */
export const RECORD_SECTION_TARGET_ATTR = 'data-record-section-target';

/** The attribute that names the field a detail row draws (`@object-ui/plugin-detail`'s `DetailSection`). */
export const DETAIL_FIELD_ATTR = 'data-detail-field';

/**
 * How a marked heading is drawn: the marking a linked comment takes
 * (`CommentItem`'s `targeted`), so one look means "the place a link named".
 */
export const RECORD_SECTION_MARK_CLASSES = ['rounded-md', 'bg-accent/60', 'ring-4', 'ring-accent/60'] as const;

/**
 * How long the page waits for the cited section to be drawn (the record's
 * read, the lazily loaded rich-text face) before it settles for the field, or
 * for the top.
 */
export const RECORD_SECTION_SETTLE_MS = 4000;

/**
 * The long-text field types a body can be, by how each one draws: markdown
 * headings drawn as elements, HTML headings drawn as elements, and a
 * `textarea` drawn as plain text, whose headings are never elements.
 */
const BODY_FACES: Readonly<Record<string, SectionFace>> = {
  markdown: 'markdown',
  html: 'html',
  richtext: 'html',
  textarea: 'text',
};

type SectionFace = 'markdown' | 'html' | 'text';

/** A field whose body holds the anchor, and which of its headings it names. */
export interface SectionCandidate {
  field: string;
  face: SectionFace;
  /** The heading's letters and digits, lowercased: how a drawn heading is matched. */
  reading: string;
  /** How many of the field's earlier headings read the same. */
  ordinal: number;
  /** How many of the field's headings, in all, read the same: what the drawn face must match. */
  count: number;
  /**
   * How many places of the body, outside the outline, could draw a heading
   * that reads the same (a setext heading, one in a quote or a list item, a
   * raw heading tag): any one leaves the count unable to say which drawn
   * heading is the cited one.
   */
  unlisted: number;
}

/** What a drawn section resolved to: the field's row, and the heading when it is drawn. */
export interface SectionTarget {
  field: HTMLElement;
  face: SectionFace;
  heading?: HTMLElement;
  /**
   * The field is the whole answer, whatever the face goes on to draw: it draws
   * no heading elements (`textarea`), or the heading reads as nothing.
   */
  fieldOnly?: true;
}

/** `text`'s letters and digits of every script, lowercased. */
export function headingReading(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

const isBlank = (c: string | undefined): boolean => c === ' ' || c === '\t';

/** Whether `line` opens or closes a fenced code block, as the spec's outline reads one. */
function isFence(line: string): boolean {
  let i = 0;
  while (i < line.length && isBlank(line[i])) i++;
  return line.startsWith('```', i) || line.startsWith('~~~', i);
}

/** A setext underline: up to three blanks, a run of `=` or of `-`, trailing blanks. */
function isSetextUnderline(line: string): boolean {
  let i = 0;
  while (i < 3 && line[i] === ' ') i++;
  const mark = line[i];
  if (mark !== '=' && mark !== '-') return false;
  while (line[i] === mark) i++;
  while (isBlank(line[i])) i++;
  return i === line.length;
}

/**
 * The text of an ATX heading behind a container prefix (blanks, `>` quotes,
 * list markers), or `undefined` when `line` is no such heading. A forward
 * scan: a body is author-written, so no pattern that can backtrack.
 */
function containedAtxText(line: string): string | undefined {
  let i = 0;
  for (;;) {
    while (isBlank(line[i])) i++;
    if (line[i] === '>') {
      i++;
      continue;
    }
    if ((line[i] === '-' || line[i] === '*' || line[i] === '+') && isBlank(line[i + 1])) {
      i++;
      continue;
    }
    let j = i;
    while (j - i < 9 && line[j] !== undefined && line[j] >= '0' && line[j] <= '9') j++;
    if (j > i && (line[j] === '.' || line[j] === ')') && isBlank(line[j + 1])) {
      i = j + 1;
      continue;
    }
    break;
  }
  let level = 0;
  while (line[i + level] === '#') level++;
  if (level < 1 || level > 6) return undefined;
  const after = line[i + level];
  return after === undefined || isBlank(after) ? line.slice(i + level) : undefined;
}

/** A raw heading tag's opener (`<h1` to `<h6`, not `<hr>` or `<header>`) at `at` of `lower`. */
function isHeadingOpener(lower: string, at: number): boolean {
  const level = lower.charCodeAt(at + 2) - 48;
  return lower.startsWith('<h', at) && level >= 1 && level <= 6 && !/^[a-z0-9_]$/.test(lower[at + 3] ?? '');
}

/** The entities the spec's outline decodes, each one a character no reading keeps. */
function blankEntities(text: string): string {
  return text.replace(/&(?:nbsp|lt|gt|quot|amp|#39);/g, ' ');
}

/**
 * The texts of every place in `value` that a face could draw as a heading the
 * outline (`headings`) does not list. Markdown: a setext heading, an ATX
 * heading behind a quote, a list marker or a blank, and a line holding a raw
 * heading tag; fenced code draws none. HTML: a heading tag the outline does
 * not list (one left unclosed, or opened inside another).
 */
function unlistedHeadingTexts(value: string, html: boolean, headings: readonly BodyHeading[]): string[] {
  const listed = new Set(headings.map((h) => h.start));
  const out: string[] = [];
  if (html) {
    // Every search remembers where it landed and starts no earlier than an
    // earlier one, so the scan stays linear however many openers are unclosed.
    const lower = value.toLowerCase();
    let gt = -2;
    let closer = -2;
    for (let at = lower.indexOf('<h'); at >= 0; at = lower.indexOf('<h', at + 1)) {
      if (listed.has(at) || !isHeadingOpener(lower, at)) continue;
      if (gt !== -1 && gt < at) gt = lower.indexOf('>', at);
      if (gt < 0) break;
      if (closer !== -1 && closer < gt) closer = lower.indexOf('</h', gt);
      let end = closer < 0 ? lower.length : closer;
      for (let next = lower.indexOf('<h', gt); next >= 0 && next < end; next = lower.indexOf('<h', next + 1)) {
        if (isHeadingOpener(lower, next)) {
          end = next;
          break;
        }
      }
      out.push(blankEntities(stripBodyTags(value.slice(gt + 1, end))));
    }
    return out;
  }
  let inFence = false;
  let offset = 0;
  let paragraph: string[] = [];
  for (const raw of value.split('\n')) {
    const start = offset;
    offset += raw.length + 1;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (isFence(line)) {
      inFence = !inFence;
      paragraph = [];
      continue;
    }
    if (inFence || listed.has(start) || line.trim() === '') {
      paragraph = [];
      continue;
    }
    if (paragraph.length > 0 && isSetextUnderline(line)) {
      out.push(paragraph.join(' '));
      paragraph = [];
      continue;
    }
    const atx = containedAtxText(line);
    const lower = line.toLowerCase();
    let tag = false;
    for (let at = lower.indexOf('<h'); at >= 0 && !tag; at = lower.indexOf('<h', at + 1)) tag = isHeadingOpener(lower, at);
    if (atx !== undefined || tag) {
      out.push(stripBodyTags(atx ?? line));
      paragraph = [];
      continue;
    }
    paragraph.push(line);
  }
  return out;
}

/**
 * The fields of `record` whose body holds `anchor`, in `fields`' order. Empty
 * when the anchor is stale, or names no long-text field the record holds.
 */
export function sectionCandidates(
  fields: Readonly<Record<string, { type?: unknown } | null | undefined>> | null | undefined,
  record: Readonly<Record<string, unknown>> | null | undefined,
  anchor: string | null | undefined,
): SectionCandidate[] {
  if (!anchor || !fields || !record) return [];
  const out: SectionCandidate[] = [];
  for (const [field, def] of Object.entries(fields)) {
    const face = typeof def?.type === 'string' ? BODY_FACES[def.type] : undefined;
    const value = record[field];
    if (!face || typeof value !== 'string' || value.length === 0) continue;
    const headings = headingsOf(value, face === 'html');
    const at = headings.findIndex((h) => h.anchor === anchor);
    if (at < 0) continue;
    const reading = headingReading(headings[at].heading);
    const readings = headings.map((h) => headingReading(h.heading));
    const ordinal = readings.slice(0, at).filter((r) => r === reading).length;
    const count = readings.filter((r) => r === reading).length;
    const unlisted =
      face === 'text' || reading === ''
        ? 0
        : unlistedHeadingTexts(value, face === 'html', headings).filter((t) => headingReading(t) === reading).length;
    out.push({ field, face, reading, ordinal, count, unlisted });
  }
  return out;
}

function escapeAttr(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * The drawn place of the first candidate whose field is on the page: the
 * field's row, with the heading when the face draws it, draws as many
 * headings of its reading as the outline lists, and the body holds no
 * same-titled heading the outline does not list. `undefined` when no
 * candidate's field is drawn.
 */
export function locateSection(root: ParentNode, candidates: readonly SectionCandidate[]): SectionTarget | undefined {
  for (const candidate of candidates) {
    const field = root.querySelector<HTMLElement>(`[${DETAIL_FIELD_ATTR}="${escapeAttr(candidate.field)}"]`);
    if (!field) continue;
    const { face } = candidate;
    if (face === 'text' || candidate.reading === '') return { field, face, fieldOnly: true };
    const drawn = Array.from(field.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).filter(
      (el) => headingReading(el.textContent ?? '') === candidate.reading,
    );
    const counted = candidate.unlisted === 0 && drawn.length === candidate.count;
    const heading = counted ? drawn[candidate.ordinal] : undefined;
    return heading ? { field, face, heading } : { field, face };
  }
  return undefined;
}

/**
 * Marks `heading` as the cited section. Answers the unmark, which takes off
 * the attribute and only the classes the mark added.
 */
export function markSection(heading: HTMLElement): () => void {
  const added = RECORD_SECTION_MARK_CLASSES.filter((c) => !heading.classList.contains(c));
  heading.setAttribute(RECORD_SECTION_TARGET_ATTR, 'true');
  heading.classList.add(...added);
  return () => {
    heading.removeAttribute(RECORD_SECTION_TARGET_ATTR);
    heading.classList.remove(...added);
  };
}

function scrollIntoStart(el: HTMLElement): void {
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
}

/**
 * Opens the page at the cited section once it is drawn: the heading scrolled
 * to and marked, or the field scrolled to (at once when the field is the whole
 * answer — a `textarea` body, or a heading that reads as nothing — and
 * otherwise once {@link RECORD_SECTION_SETTLE_MS} pass without the heading). With
 * no candidate, or no candidate field drawn by then, nothing moves. Answers
 * the cleanup, which also takes the mark off: a page opened at another
 * section, or at the same one again, marks only the section it opens.
 * `mayScroll` is asked at the moment the page would move; when it answers
 * false the heading is still marked and nothing moves: the page is redrawn at
 * a section it already opened (objectstack#37487 S5).
 */
export function focusRecordSection(
  root: HTMLElement,
  candidates: readonly SectionCandidate[],
  settleMs: number = RECORD_SECTION_SETTLE_MS,
  mayScroll: () => boolean = () => true,
): () => void {
  const scrollTo = (el: HTMLElement): void => {
    if (mayScroll()) scrollIntoStart(el);
  };
  if (candidates.length === 0) return () => {};
  let done = false;
  let observer: MutationObserver | undefined;
  const pending: { timer?: ReturnType<typeof setTimeout>; unmark?: () => void } = {};
  const finish = (): void => {
    done = true;
    observer?.disconnect();
    if (pending.timer !== undefined) clearTimeout(pending.timer);
  };
  const cleanup = (): void => {
    finish();
    pending.unmark?.();
    pending.unmark = undefined;
  };
  const attempt = (): void => {
    if (done) return;
    const target = locateSection(root, candidates);
    if (target?.heading) {
      finish();
      pending.unmark = markSection(target.heading);
      scrollTo(target.heading);
    } else if (target?.fieldOnly) {
      finish();
      scrollTo(target.field);
    }
  };
  attempt();
  if (done) return cleanup;
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(attempt);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }
  pending.timer = setTimeout(() => {
    if (done) return;
    const target = locateSection(root, candidates);
    finish();
    if (target?.heading) {
      pending.unmark = markSection(target.heading);
      scrollTo(target.heading);
    } else if (target) {
      scrollTo(target.field);
    }
  }, settleMs);
  return cleanup;
}
