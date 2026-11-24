// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata list's 「有未发布的改动」 mark (objectstack#36898, epic
 * objectstack#36890 decisions 2 and 14): a listed item with a pending draft
 * on the existing ledger, `GET /api/v1/meta/_drafts`, whoever wrote it and
 * whenever — a draft that existed before the list drew marks is marked too.
 *
 * ## The ledger
 *
 * Read through the list's own metadata client (`listDrafts`, the read the
 * client's draft reads already ask first), so it is scoped exactly as the
 * list's items are. Re-read with the list, and on the publish pulse
 * (`emitMetadataRefresh`, which every publish path sends), so a publish takes
 * the mark away from whichever door it came. The list may sit outside
 * Studio's `StudioPendingDraftsContext` (Setup's lists do), and that
 * context's rows carry no package or bundle member, so the list does not
 * read it.
 *
 * A ledger that cannot be read (no authoring grant, a kernel without drafts)
 * marks nothing: the list does not know, and says nothing.
 *
 * ## AI or a person
 *
 * Who drafted it is the draft's own per-key provenance (`draftChanges`, the
 * strict draft read), judged by the rule the item pages' AI line uses
 * (`StudioAiDraftNotice`, `isAgentDraftSurface`): a draft with any entry
 * written by the AI copilot or through the MCP build door is the AI's; any
 * other draft — a person's, one that recorded no provenance, or one whose
 * read failed — carries the plain mark. The draft of each marked item of the
 * type is read once per ledger read.
 *
 * ## Which row
 *
 * A ledger row marks a listed row of the same type (stored spellings folded
 * as every `/meta` reader folds them) and name; where both name a package,
 * the same app's — a base and its `.custom` pair are one app, since an edit
 * to a code-shipped item is drafted into the pair (`appPackageOf`); where
 * both name a bundle member, the same member.
 */

import * as React from 'react';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { readDraftChanges, type DraftChange, type MetadataClient } from '@object-ui/data-objectstack';
import { appPackageOf } from '../../preview/usePendingDrafts.js';
import { subscribeMetadataRefresh } from '../../assistant/assistantBus.js';
import { isAgentDraftSurface } from '../studio-design/StudioDraftMark.js';

/** The mark a row carries: an AI tool's unpublished draft, or anyone else's. */
export type ListDraftMarkKind = 'ai' | 'human';

/** A ledger row, as far as matching reads it. */
export interface ListDraftEntry {
  type: string;
  name: string;
  packageId: string | null;
  member?: string;
}

/** What the list knows of a row, for matching it to a ledger row. */
export interface ListDraftRow {
  name: string;
  packageId?: string;
  member?: string;
}

/** The kind a draft's provenance gives: `ai` when any entry is an AI tool's. */
export function draftMarkKindOf(changes: readonly DraftChange[] | null | undefined): ListDraftMarkKind {
  return (changes ?? []).some((change) => isAgentDraftSurface(change.by)) ? 'ai' : 'human';
}

function samePackage(entry: string | null, row: string | undefined): boolean {
  if (!entry || !row || row === 'sys_metadata') return true;
  return appPackageOf(entry) === appPackageOf(row);
}

/** The ledger row that marks `row` of `type`, or `null` — see the module docblock. */
export function draftEntryOf<E extends ListDraftEntry>(entries: readonly E[], type: string, row: ListDraftRow): E | null {
  return (
    entries.find(
      (entry) =>
        entry.name === row.name &&
        canonicalMetaUrlType(entry.type) === type &&
        (!entry.member || !row.member || entry.member === row.member) &&
        samePackage(entry.packageId, row.packageId),
    ) ?? null
  );
}

interface JudgedEntry extends ListDraftEntry {
  kind: ListDraftMarkKind;
}

/**
 * Each row's mark on `type`'s list; `null` for a row with no pending draft.
 * `refreshKey` re-reads the ledger with the list.
 */
export function useListDraftMarks(
  client: MetadataClient,
  type: string,
  refreshKey: unknown,
): (row: ListDraftRow) => ListDraftMarkKind | null {
  const [pulse, setPulse] = React.useState(0);
  React.useEffect(() => subscribeMetadataRefresh(() => setPulse((n) => n + 1)), []);

  const [judged, setJudged] = React.useState<{ type: string; entries: JudgedEntry[] } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let ofType: ListDraftEntry[];
      try {
        ofType = (await client.listDrafts()).filter((entry) => canonicalMetaUrlType(entry.type) === type);
      } catch {
        ofType = [];
      }
      const entries = await Promise.all(
        ofType.map(async (entry): Promise<JudgedEntry> => {
          try {
            const answer = await client.getDraft(type, entry.name, {
              ...(entry.packageId ? { packageId: entry.packageId } : {}),
              ...(entry.member ? { member: entry.member } : {}),
            });
            return { ...entry, kind: draftMarkKindOf(readDraftChanges(answer)) };
          } catch {
            return { ...entry, kind: 'human' };
          }
        }),
      );
      if (!cancelled) setJudged({ type, entries });
    })();
    return () => {
      cancelled = true;
    };
  }, [client, type, refreshKey, pulse]);

  const entries = judged?.type === type ? judged.entries : NONE;
  return (row: ListDraftRow) => draftEntryOf(entries, type, row)?.kind ?? null;
}

const NONE: readonly JudgedEntry[] = [];
