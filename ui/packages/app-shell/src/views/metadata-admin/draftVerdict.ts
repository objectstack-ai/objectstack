// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The server's verdict on the item this editor is editing (objectstack#26707).
 *
 * The edit page holds two server reads of one item: the layered read, whose
 * `_diagnostics` judge the PUBLISHED body, and the draft read, whose
 * `_diagnostics` judge the pending draft — the body the editor is actually
 * showing. Since objectstack#26707 the draft read's verdict is the publish's
 * own: the runtime authoring gate's refusal for that draft (`expression-invalid`
 * on a flow edge, a summary field with no operations, …), each entry carrying
 * the rule id as its `code` and the publish's message. So while a draft is
 * pending, the draft's verdict is the one to show; the layered one describes a
 * body the author is not looking at, and read `valid: true` for every draft the
 * publish then refused.
 *
 * ⛔ No verdict is computed here. The rules live on the server, run once there,
 * and this module only chooses which served verdict applies and merges it with
 * the live client parse.
 */

import * as React from 'react';

/** One `_diagnostics` entry, as served (`MetadataValidationResult`). */
export interface ServerDiagnosticEntry {
  path: string;
  message: string;
  code?: string;
}

/** A served `_diagnostics` envelope. */
export interface ServerDiagnostics {
  valid: boolean;
  errors?: ServerDiagnosticEntry[];
  warnings?: Array<{ path: string; message: string }>;
}

/**
 * The `_diagnostics` of a served draft envelope (`{ type, name, item }`), read
 * BEFORE `extractDraftBody` strips the read decorations off the body.
 * `undefined` when there is no pending draft or it carries none.
 */
export function draftEnvelopeDiagnostics(resp: unknown): ServerDiagnostics | undefined {
  if (!resp || typeof resp !== 'object') return undefined;
  const item = (resp as { item?: unknown }).item;
  if (!item || typeof item !== 'object') return undefined;
  const diagnostics = (item as { _diagnostics?: unknown })._diagnostics;
  if (!diagnostics || typeof diagnostics !== 'object') return undefined;
  return diagnostics as ServerDiagnostics;
}

/**
 * The verdict that describes the body on screen: the pending draft's when the
 * editor holds one, else the layered read's.
 */
export function editedItemDiagnostics(args: {
  hasDraft: boolean;
  draftDiagnostics: ServerDiagnostics | undefined;
  layered: unknown;
}): ServerDiagnostics | undefined {
  if (args.hasDraft && args.draftDiagnostics) return args.draftDiagnostics;
  const layered = args.layered as { _diagnostics?: ServerDiagnostics } | null | undefined;
  return layered?._diagnostics;
}

/**
 * The errors to show when a live client parse exists: the client's own (they
 * track every keystroke), plus each server error the client did not raise —
 * the publish-time rules the client parse does not run. An entry the client
 * already shows at the same path with the same message is not shown twice.
 */
export function withServerOnlyErrors<T extends { path: string; message: string }>(
  clientErrors: readonly T[],
  serverErrors: readonly ServerDiagnosticEntry[] | undefined,
): Array<T | ServerDiagnosticEntry> {
  const seen = new Set(clientErrors.map((e) => `${e.path}\n${e.message}`));
  const extra = (serverErrors ?? []).filter((e) => !seen.has(`${e.path}\n${e.message}`));
  return [...clientErrors, ...extra];
}

/**
 * objectstack#27799 — a served verdict as the flat, severity-tagged list a
 * canvas preview's Problems list reads (`MetadataPreviewProps.diagnostics`):
 * the errors, then the warnings, each at the path the server wrote. A page
 * that keeps the verdict and draws a flow hands it this, so the Problems list
 * says what the publish will refuse, as the inspectors already do.
 */
export function verdictPreviewEntries(
  diagnostics: ServerDiagnostics | undefined,
): Array<{ path?: string; message: string; severity: 'error' | 'warning' }> {
  return [
    ...(diagnostics?.errors ?? []).map((e) => ({ path: e.path || undefined, message: e.message, severity: 'error' as const })),
    ...(diagnostics?.warnings ?? []).map((w) => ({ path: w.path || undefined, message: w.message, severity: 'warning' as const })),
  ];
}

/**
 * objectstack#26858 — the served verdict on the body on screen, for a field
 * that edits one path of it. The page holding the draft read provides it
 * (`ResourceEditPage`, the permission-set editor); a field asks for the errors
 * at its own item-relative path with {@link useServerErrorsAt}. Absent outside
 * such a page, so a field mounted anywhere else reads none.
 */
export const DraftVerdictContext = React.createContext<ServerDiagnostics | undefined>(undefined);

const NO_ERRORS: readonly ServerDiagnosticEntry[] = [];

/**
 * The served errors located exactly at `path` — the dotted, item-relative
 * spelling `_diagnostics` uses (`rowLevelSecurity.0.using`, `edges.1.condition`).
 * Equality, never a prefix: a sibling's error (`edges.10.condition`, the same
 * policy's `check`) is not this field's. ⛔ Reads the path the server wrote;
 * no rule is restated here.
 */
export function serverErrorsAt(
  diagnostics: ServerDiagnostics | undefined,
  path: string | undefined,
): readonly ServerDiagnosticEntry[] {
  if (!path || !diagnostics?.errors?.length) return NO_ERRORS;
  const hits = diagnostics.errors.filter((e) => e.path === path);
  return hits.length ? hits : NO_ERRORS;
}

/** {@link serverErrorsAt} against the verdict the enclosing page provides. */
export function useServerErrorsAt(path: string | undefined): readonly ServerDiagnosticEntry[] {
  return serverErrorsAt(React.useContext(DraftVerdictContext), path);
}

/**
 * objectstack#27482 — the body the provided verdict JUDGED: the served draft
 * (or layered) body the `_diagnostics` were computed on. A verdict describes
 * that body and no other, so it may hold a save only while the field still
 * shows the text it judged. A page that provides no body holds nothing.
 */
export const DraftVerdictBodyContext = React.createContext<unknown>(undefined);

/**
 * The value at a dotted `_diagnostics` path (`rowLevelSecurity.0.using`) in a
 * served body; `undefined` when any segment is missing. A numeric segment
 * indexes an array, every other segment names an own key.
 */
export function valueAtPath(body: unknown, path: string): unknown {
  let cur: unknown = body;
  for (const seg of path.split('.')) {
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(seg)) return undefined;
      cur = cur[Number(seg)];
    } else if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, seg)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * The served errors at `path` that hold the save of a field showing `text`:
 * those errors while the judged body's value at `path` is that same text;
 * none once the author has edited it away (the verdict no longer describes
 * what is on screen, and only the save fetches the next one), and none
 * without a judged body. An absent value reads as empty text, the way the
 * editors show it. ⛔ No rule is restated: the server's errors are taken whole.
 */
export function serverHoldAt(
  diagnostics: ServerDiagnostics | undefined,
  judged: unknown,
  path: string | undefined,
  text: string,
): readonly ServerDiagnosticEntry[] {
  const hits = serverErrorsAt(diagnostics, path);
  if (hits.length === 0 || judged === undefined || !path) return NO_ERRORS;
  return (valueAtPath(judged, path) ?? '') === text ? hits : NO_ERRORS;
}

/** {@link serverHoldAt} against the verdict and judged body the enclosing page provides. */
export function useServerHoldAt(path: string | undefined, text: string): readonly ServerDiagnosticEntry[] {
  return serverHoldAt(React.useContext(DraftVerdictContext), React.useContext(DraftVerdictBodyContext), path, text);
}
