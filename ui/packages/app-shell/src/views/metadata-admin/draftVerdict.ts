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
