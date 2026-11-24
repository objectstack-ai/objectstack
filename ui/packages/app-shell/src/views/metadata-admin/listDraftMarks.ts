// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata list's 「有未发布的改动」 mark (objectstack#36898, epic
 * objectstack#36890 decisions 2 and 14): a listed item with a pending draft
 * on the existing ledger, `GET /api/v1/meta/_drafts`, whoever wrote it and
 * whenever — a draft that existed before the list drew marks is marked too.
 *
 * ## The ledger
 *
 * Read through `usePendingDrafts`, the one reader every pending-changes
 * surface shares (`preview/usePendingDrafts.ts`): the environment-wide
 * ledger, re-read on the publish pulse, on a draft save that announces
 * itself, and when the tab comes back. So a publish takes the mark away, from
 * whichever door it came. The list may sit outside Studio's
 * `StudioPendingDraftsContext` (Setup's lists do), and that context's rows
 * carry no package or bundle member, so the list reads the ledger itself.
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
 * type is read once per ledger answer.
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
import { appPackageOf, usePendingDrafts, type PendingDraftEntry } from '../../preview/usePendingDrafts.js';
import { isAgentDraftSurface } from '../studio-design/StudioDraftMark.js';

/** The mark a row carries: an AI tool's unpublished draft, or anyone else's. */
export type ListDraftMarkKind = 'ai' | 'human';

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
export function draftEntryOf(
  entries: readonly PendingDraftEntry[],
  type: string,
  row: ListDraftRow,
): PendingDraftEntry | null {
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

function entryKey(entry: PendingDraftEntry): string {
  return JSON.stringify([entry.packageId, entry.name, entry.member ?? null]);
}

/** Each row's mark on `type`'s list; `null` for a row with no pending draft. */
export function useListDraftMarks(client: MetadataClient, type: string): (row: ListDraftRow) => ListDraftMarkKind | null {
  const { entries } = usePendingDrafts();
  // The AI verdict of each draft, re-judged on every ledger answer. Keyed on
  // the ledger's own answer (`entries`), never on a memoised derivation.
  const [kinds, setKinds] = React.useState<ReadonlyMap<string, ListDraftMarkKind>>(new Map());
  React.useEffect(() => {
    const ofType = entries.filter((entry) => canonicalMetaUrlType(entry.type) === type);
    if (ofType.length === 0) return;
    let cancelled = false;
    void Promise.all(
      ofType.map(async (entry): Promise<[string, ListDraftMarkKind]> => {
        try {
          const answer = await client.getDraft(type, entry.name, {
            ...(entry.packageId ? { packageId: entry.packageId } : {}),
            ...(entry.member ? { member: entry.member } : {}),
          });
          return [entryKey(entry), draftMarkKindOf(readDraftChanges(answer))];
        } catch {
          return [entryKey(entry), 'human'];
        }
      }),
    ).then((judged) => {
      if (!cancelled) setKinds(new Map(judged));
    });
    return () => {
      cancelled = true;
    };
  }, [client, type, entries]);

  return (row: ListDraftRow) => {
    const entry = draftEntryOf(entries, type, row);
    return entry ? (kinds.get(entryKey(entry)) ?? 'human') : null;
  };
}
