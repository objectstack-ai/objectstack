/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0067 — the package "Build history" timeline. Lists every commit an AI
 * build (or edit) landed, newest-first, with "Revert" per apply commit: undo
 * that change set (artifacts it created are soft-removed; ones it edited are
 * restored) as a NEW append-only revert commit. This is the history-not-confirm
 * surface — the user reviews and reverts instead of approving each publish.
 *
 * Sibling of DraftChangesPanel (which lists PENDING drafts before a publish);
 * this lists what already LANDED, and can undo it.
 */

import { useCallback, useEffect, useState } from 'react';
import { GitBranch, Undo2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import {
  fetchCommits,
  isCommitStoreUnreachable,
  revertCommit,
  type CommitEntry,
} from './commitHistory.js';

export interface CommitTimelineProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageId: string;
  /** Called after a successful revert so the host can refresh the app view. */
  onReverted?: () => void;
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export function CommitTimeline({ open, onOpenChange, packageId, onReverted }: CommitTimelineProps) {
  const { t } = useObjectTranslation();
  const [commits, setCommits] = useState<CommitEntry[] | null>(null);
  /**
   * objectui#3529 — the failure is kept whole, not flattened to its `.message`.
   * An unreachable commit store and a 404 used to read as the same bare status
   * code, and this panel is the surface an operator uses DURING an outage;
   * `unreachable` is what lets the copy below say "the read did not happen,
   * retry" instead of showing them a number.
   */
  const [error, setError] = useState<{ message: string; unreachable: boolean } | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCommits(null);
    setError(null);
    try {
      setCommits(await fetchCommits(packageId));
    } catch (e) {
      // Still fail-loud: `commits` stays null, so the empty-history copy below
      // is unreachable on an error path (ADR-0110 D3 / objectstack#5980).
      setError({ message: (e as Error).message, unreachable: isCommitStoreUnreachable(e) });
    }
  }, [packageId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const onRevert = async (commitId: string) => {
    setReverting(commitId);
    try {
      await revertCommit(packageId, commitId);
      toast.success(t('preview.history.reverted', { defaultValue: 'Reverted — the change has been undone.' }));
      onReverted?.();
      await load();
    } catch (e) {
      toast.error(
        // A WRITE that could not reach the store is not simply "try again": the
        // revert may or may not have landed (a proxy can shed a 503 after
        // forwarding), and re-issuing it appends a SECOND revert commit to an
        // append-only log. So this half's retryable copy tells the operator to
        // re-read the timeline first — same unreachable fact, honest disposition.
        isCommitStoreUnreachable(e)
          ? t('preview.history.revertUnavailable', {
              defaultValue:
                'Commit store temporarily unreachable — the revert may not have been applied. Reopen this history to check before retrying.',
            })
          : `${t('preview.history.revertFailed', { defaultValue: 'Revert failed' })}: ${(e as Error).message}`,
      );
    } finally {
      setReverting(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px]" data-testid="commit-timeline-panel">
        <SheetHeader>
          <SheetTitle>{t('preview.history.title', { defaultValue: 'Build history' })}</SheetTitle>
          <SheetDescription>
            {t('preview.history.description', {
              defaultValue:
                'Every change to this app, newest first. Revert any step to undo it — no publish confirmation needed.',
            })}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-2 overflow-y-auto px-4 pb-6">
          {error ? (
            <p className="text-sm text-destructive" data-testid="commit-history-error">
              {error.unreachable
                ? t('preview.history.loadFailedUnavailable', {
                    defaultValue:
                      'Commit store temporarily unreachable — this read did not happen, so no history is shown. Retry in a moment.',
                  })
                : `${t('preview.history.loadFailed', { defaultValue: 'Could not load history:' })} ${error.message}`}
            </p>
          ) : commits === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('preview.history.loading', { defaultValue: 'Loading history…' })}
            </div>
          ) : commits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('preview.history.empty', { defaultValue: 'No history yet for this app.' })}
            </p>
          ) : (
            commits.map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-2.5 rounded-md border px-2.5 py-2 text-sm"
                data-testid="commit-row"
              >
                <GitBranch
                  className={`mt-0.5 h-4 w-4 shrink-0 ${c.operation === 'revert' ? 'text-muted-foreground' : 'text-primary'}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {c.message ??
                      (c.operation === 'revert'
                        ? t('preview.history.revertLabel', { defaultValue: 'Reverted a change' })
                        : t('preview.history.applyLabel', { defaultValue: 'Build change' }))}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {c.operation === 'revert' ? (
                      <Badge variant="outline" className="border-muted-foreground/30">
                        {t('preview.history.revert', { defaultValue: 'revert' })}
                      </Badge>
                    ) : null}
                    {/*
                      objectui#9266 — ONE interpolated key, not a number glued to a
                      bare unit word. The old spelling composed the phrase here
                      (`{c.itemCount} {t('preview.history.items')}`), so the packs
                      could only supply a noun that had to agree with a number they
                      never saw: six of the ten rendered `1 Elemente` / `1 éléments`
                      / `1 elementos` / `1 itens` / `1 элементов` / `1 عناصر`.
                      Passing `count` lets each pack own BOTH the word order and the
                      agreement — the same repair, and the same reasoning, as
                      `fields.textarea.charactersRemaining`: a formulation whose
                      grammar does not bend on the number is correct at every count
                      without ten plural entries per pack. ⛔ A real `_one`/`_other`
                      family is NOT the fix here: `all-locales-key-parity.test.ts`
                      requires identical key sets across the ten packs, so `ru` can
                      have no `_few` and `ar` no `_two`/`_many`, and those categories
                      fall through to the base key — measured, `ru` would still read
                      `2 элементов` at the counts a build history most often shows.
                    */}
                    <span>
                      {t('preview.history.items', {
                        count: c.itemCount,
                        defaultValue: '{{count}} item(s)',
                      })}
                    </span>
                    {c.actor ? <span>· {c.actor}</span> : null}
                    {c.createdAt ? <span>· {relativeTime(c.createdAt)}</span> : null}
                  </p>
                  {c.memberItems ? (
                    // objectstack#23073 — the bundle member of each touched
                    // item that has one, so two languages of one template read
                    // as two items. A name-only item adds nothing here.
                    <ul className="mt-1 flex flex-col gap-0.5" data-testid="commit-member-items">
                      {c.memberItems.map((it) => (
                        <li
                          key={JSON.stringify([it.type, it.name, it.member])}
                          className="truncate font-mono text-xs text-muted-foreground"
                        >
                          {it.type}/{it.name} · {it.member}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {c.operation === 'apply' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    disabled={reverting !== null}
                    onClick={() => onRevert(c.id)}
                    data-testid="commit-revert"
                  >
                    {reverting === c.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <Undo2 className="mr-1 h-3.5 w-3.5" />
                        {t('preview.history.revertAction', { defaultValue: 'Revert' })}
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
