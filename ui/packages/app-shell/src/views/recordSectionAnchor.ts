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
 * than by bare position keeps a heading the outline does not list (a setext
 * heading, an empty one, one inside a quote) from shifting every later one onto
 * the wrong section.
 *
 * - A `textarea` body draws no heading elements, so the field is scrolled to.
 * - A heading that is not drawn (the face has not rendered it, or reads it
 *   differently) also scrolls to the field, with no error.
 * - An anchor no field resolves (a stale one: the heading was renamed or
 *   removed) opens the record at its top, as if no section were named.
 *
 * Nothing here re-verifies a citation: the anchor is only a place to open at.
 */
import { headingsOf } from '@objectstack/spec/ai';

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
}

/** What a drawn section resolved to: the field's row, and the heading when it is drawn. */
export interface SectionTarget {
  field: HTMLElement;
  face: SectionFace;
  heading?: HTMLElement;
}

/** `text`'s letters and digits of every script, lowercased. */
export function headingReading(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
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
    const ordinal = headings.slice(0, at).filter((h) => headingReading(h.heading) === reading).length;
    out.push({ field, face, reading, ordinal });
  }
  return out;
}

function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * The drawn place of the first candidate whose field is on the page: the
 * field's row, with the heading when the face draws it. `undefined` when no
 * candidate's field is drawn.
 */
export function locateSection(root: ParentNode, candidates: readonly SectionCandidate[]): SectionTarget | undefined {
  for (const candidate of candidates) {
    const field = root.querySelector<HTMLElement>(`[${DETAIL_FIELD_ATTR}="${escapeAttr(candidate.field)}"]`);
    if (!field) continue;
    const { face } = candidate;
    if (face === 'text') return { field, face };
    const heading = Array.from(field.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).filter(
      (el) => headingReading(el.textContent ?? '') === candidate.reading,
    )[candidate.ordinal];
    return heading ? { field, face, heading } : { field, face };
  }
  return undefined;
}

/** Marks `heading` as the cited section. */
export function markSection(heading: HTMLElement): void {
  heading.setAttribute(RECORD_SECTION_TARGET_ATTR, 'true');
  heading.classList.add(...RECORD_SECTION_MARK_CLASSES);
}

function scrollTo(el: HTMLElement): void {
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
}

/**
 * Opens the page at the cited section once it is drawn: the heading scrolled
 * to and marked, or the field scrolled to (a `textarea` body at once, any
 * other once {@link RECORD_SECTION_SETTLE_MS} pass without the heading). With
 * no candidate, or no candidate field drawn by then, nothing moves. Answers
 * the cleanup.
 */
export function focusRecordSection(
  root: HTMLElement,
  candidates: readonly SectionCandidate[],
  settleMs: number = RECORD_SECTION_SETTLE_MS,
): () => void {
  if (candidates.length === 0) return () => {};
  let done = false;
  let observer: MutationObserver | undefined;
  const pending: { timer?: ReturnType<typeof setTimeout> } = {};
  const finish = (): void => {
    done = true;
    observer?.disconnect();
    if (pending.timer !== undefined) clearTimeout(pending.timer);
  };
  const attempt = (): void => {
    if (done) return;
    const target = locateSection(root, candidates);
    if (target?.heading) {
      finish();
      markSection(target.heading);
      scrollTo(target.heading);
    } else if (target?.face === 'text') {
      finish();
      scrollTo(target.field);
    }
  };
  attempt();
  if (done) return finish;
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(attempt);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }
  pending.timer = setTimeout(() => {
    if (done) return;
    const target = locateSection(root, candidates);
    finish();
    if (target?.heading) {
      markSection(target.heading);
      scrollTo(target.heading);
    } else if (target) {
      scrollTo(target.field);
    }
  }, settleMs);
  return finish;
}
