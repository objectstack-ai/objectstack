/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#28104 — how an AI chat draft reaches the New form.
 *
 * "Open the full form" on a record-write card (cloud#3565) opens the object's
 * New page on the card's values. They travel in the ROUTER STATE of that one
 * navigation, never in the query string: a draft pasted from a chat carries
 * names, phone numbers and e-mail addresses, and a URL is copied, shared,
 * logged by proxies and kept in the browser history's address list.
 *
 * Router state lives in the tab's history entry (`history.state`), so it is
 * read again when that same entry is reloaded or revisited with Back, and is
 * absent everywhere else: a copied link, a new tab, another device all open
 * an empty form. Nothing here saves anything: the page opens unsaved and the
 * person presses Save.
 */

/** The key the draft rides under in `location.state`. */
const AI_DRAFT_KEY = 'recordFormAiDraft';

/** The `state` "Open the full form" navigates with. */
export interface RecordFormAiDraftState {
  [AI_DRAFT_KEY]: { values: Record<string, unknown> };
}

/** An empty value is left out: the form's own default fills that field. */
function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * The router state for a card's fields, or `undefined` when no field carries
 * a value. Values keep their type (a number stays a number, a multi-select
 * stays a list): unlike a query string, router state is not flattened.
 */
export function recordFormAiDraftState(
  fields: ReadonlyArray<{ name: string; value: unknown }>,
): RecordFormAiDraftState | undefined {
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.name && !isEmptyValue(f.value)) values[f.name] = f.value;
  }
  return Object.keys(values).length > 0 ? { [AI_DRAFT_KEY]: { values } } : undefined;
}

/**
 * The draft values a New page was opened with, or `undefined` when its
 * `location.state` carries none (or anything that is not a draft).
 */
export function readRecordFormAiDraft(state: unknown): Record<string, unknown> | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const draft = (state as Record<string, unknown>)[AI_DRAFT_KEY];
  if (!draft || typeof draft !== 'object') return undefined;
  const values = (draft as { values?: unknown }).values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
    if (name && !isEmptyValue(value)) out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Where "Open the full form" on a record-write card goes, given the app the
 * object belongs to. A create opens the New page with the card's values in
 * `state` and nothing after the path; an update opens the record's edit page
 * on the stored record (the card already showed old → new).
 */
export function recordWriteFormTarget(
  write: {
    operation: 'create' | 'update';
    objectName: string;
    recordId?: string;
    fields: ReadonlyArray<{ name: string; value: unknown }>;
  },
  app: string,
): { to: string; state?: RecordFormAiDraftState } {
  const base = `/apps/${encodeURIComponent(app)}/${encodeURIComponent(write.objectName)}`;
  if (write.operation === 'update' && write.recordId) {
    return { to: `${base}/record/${encodeURIComponent(write.recordId)}/edit` };
  }
  const state = recordFormAiDraftState(write.fields);
  return state ? { to: `${base}/new`, state } : { to: `${base}/new` };
}
