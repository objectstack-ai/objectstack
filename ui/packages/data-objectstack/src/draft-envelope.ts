// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { stripReadDecorations } from '@objectstack/spec/kernel';
import type { GetMetaItemResponse } from '@objectstack/spec/api';

/**
 * Take the body out of a served draft envelope (`{ type, name, item }`) and
 * remove the framework's own READ DECORATIONS from it — or answer `null` when
 * there is nothing pending.
 *
 * ## Why this function exists at all (objectui#8181)
 *
 * It was implemented three separate times — once in `ResourceEditPage`, once in
 * `StudioDesignSurface`, once in `PackageOwdOverviewPanel` — plus a fourth
 * hand-rolled copy in `ObjectHooksPanel` under a different name. objectui#7603
 * taught exactly ONE of those copies to strip. That is the defect this file
 * closes, and it is a different defect from "N consumers forgot": four
 * byte-identical copies of a rule mean the next copy is free to omit it again,
 * so the cure is one function rather than four strips.
 *
 * ## Why it lives HERE and not in `app-shell`
 *
 * Next to the {@link MetadataClient.getDraft} that produces the envelope this
 * decodes. `getDraft` deliberately hands back the wire envelope rather than the
 * body (objectui#4271), so the unwrap is part of that method's contract, not a
 * detail of any one view. `app-shell` already depends on this package, and the
 * one non-app-shell consumer (`updateView`, in this package) is a caller too.
 *
 * ## The verdict runs BEFORE the strip, never after
 *
 * What counts as a pending draft is `getDraft`'s answer. A draft whose only
 * keys are decorations is still a served draft, so the emptiness verdict is
 * taken on the body as it arrived; the strip may return an EMPTY object, but it
 * may never turn a served draft into "no draft". Pinned in
 * `draft-envelope.test.ts`.
 *
 * ## Which keys, and which keys deliberately survive
 *
 * The list is the SPEC'S (`METADATA_READ_DECORATIONS`), reached through its own
 * exported helper — the same one `MetadataService.saveFields` uses on the write
 * side. Never a second hand-maintained `['_diagnostics', '_draft']` in this
 * repo: a local copy goes stale the next time the framework adds a decoration,
 * and a decoration this code does not know to remove is precisely the defect.
 *
 * The ADR-0010 protection envelope (`_lock`, `_provenance`, `_packageId`,
 * `_packageVersion`, ...) shares the underscore spelling and is deliberately
 * NOT on that list: those keys are declared by the closed schemas so provenance
 * survives a re-parse. This strip leaves them alone, and doing otherwise would
 * be the same "drop whatever looks internal" pass AGENTS.md #0.1 bans.
 *
 * ## Not a lenient fallback
 *
 * It removes exactly the two keys the framework ADDS AT READ TIME and never
 * stores. A genuinely unrecognized key still fails loudly at whichever gate
 * sees it next.
 *
 * @param resp the value `MetadataClient.getDraft()` resolved to.
 * @returns the decoration-free draft body, or `null` for "nothing pending".
 */
export function extractDraftBody(resp: unknown): Record<string, unknown> | null {
  if (!resp || typeof resp !== 'object') return null;
  const env = resp as Record<string, unknown>;
  if (!('item' in env)) return null;
  const body = env.item;
  if (!body || typeof body !== 'object') return null;
  if (Object.keys(body as object).length === 0) return null;
  return stripReadDecorations(body) as Record<string, unknown>;
}

/**
 * One entry of a pending draft's per-key provenance (objectui#12725): which
 * authoring surface last changed one key path of the draft body, under which
 * actor, and when. DERIVED from `@objectstack/spec`'s
 * `GetMetaItemResponseSchema.draftChanges` (objectstack#24298), never
 * restated: `path` is the key path inside `item` (an array value is one leaf,
 * `[]` the whole body), `by` is `copilot | studio | api`, `at` an ISO instant.
 */
export type DraftChange = NonNullable<GetMetaItemResponse['draftChanges']>[number];

/**
 * The `draftChanges` of a served draft envelope — the value
 * {@link MetadataClient.getDraft} resolved to — or `null` when the read
 * recorded none.
 *
 * The strict draft read (`?state=draft`) serves the key beside `item`, and
 * leaves it ABSENT, never `[]`, when nothing was recorded (a draft row saved
 * before the framework's writer, objectstack#24395). So `null` here means
 * "not recorded", and it is never folded into an empty list a caller would read
 * as "nothing changed".
 *
 * @param resp the value `MetadataClient.getDraft()` resolved to.
 */
export function readDraftChanges(resp: unknown): DraftChange[] | null {
  if (!resp || typeof resp !== 'object') return null;
  const changes = (resp as { draftChanges?: unknown }).draftChanges;
  return Array.isArray(changes) ? (changes as DraftChange[]) : null;
}

/** Whether `prefix` is `path` or one of its ancestors, segment by segment. */
function isPathPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== path[i]) return false;
  return true;
}

/**
 * The entry that answers for the key at `path`: of the entries whose path is
 * `path` or one of its ancestors, the LONGEST — the framework's own rule, since
 * a draft save replaces every entry at or under each path it changes, so the
 * deepest recorded ancestor is the last write that changed this key. `[]` (the
 * whole body) is everyone's ancestor. `null` when no entry is an ancestor, and
 * when `changes` is `null` ("not recorded").
 *
 * Paths compare segment by segment, never as a joined string: a segment may
 * itself contain a dot (a permission set's `fields` map is keyed
 * `object.field`).
 */
export function governingDraftChange(
  changes: readonly DraftChange[] | null | undefined,
  path: readonly string[],
): DraftChange | null {
  let best: DraftChange | null = null;
  for (const change of changes ?? []) {
    if (!isPathPrefix(change.path, path)) continue;
    if (!best || change.path.length > best.path.length) best = change;
  }
  return best;
}

/**
 * The entries strictly UNDER `path`: changes to keys inside the value at
 * `path` (`["fields", "x", "label"]` under `["fields", "x"]`). The governing
 * entry ({@link governingDraftChange}) answers for the value as a whole; these
 * answer for its parts, which a later write may have changed through another
 * surface.
 */
export function draftChangesUnder(
  changes: readonly DraftChange[] | null | undefined,
  path: readonly string[],
): DraftChange[] {
  return (changes ?? []).filter((change) => change.path.length > path.length && isPathPrefix(path, change.path));
}
