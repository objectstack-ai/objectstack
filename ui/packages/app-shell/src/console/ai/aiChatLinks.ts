// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console addresses the AI chat opens: a list link, a record (with an
 * optional body section), and the history-state stamp a section opening
 * carries. Split out of `AiChatPage.tsx` move-only (objectstack#37730).
 */

import { RECORD_SECTION_PARAM } from '../../urlParams.js';

/**
 * objectstack#31869 — the console address of the list a chat list link names:
 * `/apps/APP/OBJECT`, plus `view` and the Filter panel conditions under the
 * list route's own `uf__filter` param when the link carried them. Built from
 * the parsed values, so nothing of the href's own query string is forwarded.
 */
export function listLinkTarget(
  app: string,
  target: { objectName: string; view?: string; filter?: { logic: 'and' | 'or'; conditions: unknown[] } },
): string {
  const params = new URLSearchParams();
  if (target.view) params.set('view', target.view);
  if (target.filter) {
    params.set('uf__filter', JSON.stringify({ logic: target.filter.logic, conditions: target.filter.conditions }));
  }
  const query = params.toString();
  return `/apps/${encodeURIComponent(app)}/${encodeURIComponent(target.objectName)}${query ? `?${query}` : ''}`;
}

/**
 * cloud#1658, ADR-0160 D9 — the console address of a record the chat opens:
 * `/apps/APP/OBJECT/record/ID`, plus `?section=ANCHOR` (`RECORD_SECTION_PARAM`)
 * when a record citation names a section of the record's body. A link with no
 * anchor (an `open_record` hand-off, a record link in an answer) opens the
 * record as before.
 */
export function recordOpenTarget(
  app: string,
  target: { objectName: string; recordId: string; anchor?: string },
): string {
  const path = `/apps/${encodeURIComponent(app)}/${encodeURIComponent(target.objectName)}/record/${encodeURIComponent(target.recordId)}`;
  if (!target.anchor) return path;
  return `${path}?${new URLSearchParams({ [RECORD_SECTION_PARAM]: target.anchor }).toString()}`;
}

let sectionOpenings = 0;

/** A history-state value no earlier chip click of this page load carried. */
export function nextSectionOpening(): string {
  sectionOpenings += 1;
  return `${Date.now().toString(36)}.${sectionOpenings}`;
}
