/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The drafts an ask turn saved, drawn under the answer from the turn's
 * `data-draft-review` part (`DraftReviewListSchema` in `@objectstack/spec/ai`).
 *
 * One row per draft: its label (or name), its type, the door's verdict as a
 * badge (will publish, N problems, or verdict withheld) and a Review link to
 * the draft's own review in Studio. The rows are grouped by package, in save
 * order, and each package carries one "Review and publish" link to its Changes
 * drawer. `omitted` is shown as "+N more".
 *
 * The card publishes and discards nothing: a person does that in Studio,
 * through the links. It receives only the list `extractDraftReview` lifted and
 * draws it as it is.
 */
import * as React from 'react';
import { Badge, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { FileClockIcon } from 'lucide-react';
import type { DraftReviewItemParsed, DraftReviewListParsed } from '@objectstack/spec/ai';

export interface DraftReviewCardProps {
  /** The turn's draft review list, as `extractDraftReview` read it. */
  review: DraftReviewListParsed;
  /**
   * The host's in-app navigation to a review route (a Console path such as
   * `/studio/<package>/data?changes=review`). Absent, a link is an ordinary
   * anchor and a click loads the address.
   */
  onOpenReviewLink?: (path: string) => void;
  /** The anchor href for a review route, e.g. with the router's basename joined. Absent, the path itself. */
  reviewLinkHref?: (path: string) => string;
  className?: string;
}

/** One package's drafts, in save order, with the package's Changes route. */
interface PackageGroup {
  name: string;
  changes: string;
  drafts: DraftReviewItemParsed[];
}

/** Group the rows by package, packages in the order their first draft was saved. */
export function groupDraftsByPackage(drafts: readonly DraftReviewItemParsed[]): PackageGroup[] {
  const groups = new Map<string, PackageGroup>();
  for (const draft of drafts) {
    const group = groups.get(draft.package);
    if (group) group.drafts.push(draft);
    else groups.set(draft.package, { name: draft.package, changes: draft.review.changes, drafts: [draft] });
  }
  return [...groups.values()];
}

/** A plain left click goes through the host's navigation; a modified or middle click keeps the browser's own. */
function isPlainLeftClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

const LINK_CLASS =
  'shrink-0 rounded-sm font-medium text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The drafts the turn saved, with their verdicts and Studio review links. */
export function DraftReviewCard({ review, onOpenReviewLink, reviewLinkHref, className }: DraftReviewCardProps) {
  const { t } = useObjectTranslation();
  const titleId = React.useId();
  const groups = groupDraftsByPackage(review.drafts);

  const link = (path: string, text: string, ariaLabel: string, testId: string) => (
    <a
      href={reviewLinkHref ? reviewLinkHref(path) : path}
      className={LINK_CLASS}
      aria-label={ariaLabel}
      data-testid={testId}
      onClick={
        onOpenReviewLink
          ? (event) => {
              if (!isPlainLeftClick(event)) return;
              event.preventDefault();
              onOpenReviewLink(path);
            }
          : undefined
      }
    >
      {text}
    </a>
  );

  const verdictBadge = (draft: DraftReviewItemParsed) => {
    if (!draft.verdict) {
      const reason = draft.verdictWithheld?.message ?? draft.verdictError?.message;
      return (
        <Badge variant="outline" className="text-muted-foreground" title={reason} data-testid="draft-review-verdict" data-verdict="withheld">
          {t('chatbot.draftReview.verdictWithheld', { defaultValue: 'Verdict withheld' })}
        </Badge>
      );
    }
    if (draft.verdict.publishable) {
      return (
        <Badge variant="secondary" data-testid="draft-review-verdict" data-verdict="publishable">
          {t('chatbot.draftReview.willPublish', { defaultValue: 'Will publish' })}
        </Badge>
      );
    }
    const count = draft.verdict.refusals.length;
    return (
      <Badge variant="destructive" data-testid="draft-review-verdict" data-verdict="refused">
        {t('chatbot.draftReview.problems', { count, defaultValue: count === 1 ? '{{count}} problem' : '{{count}} problems' })}
      </Badge>
    );
  };

  return (
    <section
      className={cn('not-prose mb-4 rounded-lg border bg-muted/20 p-3 text-xs', className)}
      aria-labelledby={titleId}
      data-testid="draft-review-card"
    >
      <div id={titleId} className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
        <FileClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
        {t('chatbot.draftReview.title', { defaultValue: 'Drafts saved in this turn' })}
      </div>
      <p className="mb-2 text-muted-foreground">
        {t('chatbot.draftReview.hint', { defaultValue: 'Nothing is published yet. Review the drafts and publish them in Studio.' })}
      </p>
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.name} className="min-w-0" data-testid="draft-review-package">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 break-all font-medium text-muted-foreground">
                {t('chatbot.draftReview.package', { name: group.name, defaultValue: 'Package {{name}}' })}
              </span>
              {link(
                group.changes,
                t('chatbot.draftReview.reviewAndPublish', { defaultValue: 'Review and publish' }),
                t('chatbot.draftReview.reviewAndPublishAria', {
                  name: group.name,
                  defaultValue: 'Review and publish the drafts of package {{name}} in Studio',
                }),
                'draft-review-changes-link',
              )}
            </div>
            <ul className="flex flex-col divide-y rounded-md border bg-background">
              {group.drafts.map((draft) => {
                const shown = draft.label ?? draft.name;
                return (
                  <li
                    key={`${draft.type}:${draft.name}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5"
                    data-testid="draft-review-row"
                  >
                    <span className="min-w-0 flex-1 basis-32">
                      <span className="block truncate font-medium text-foreground" title={shown}>{shown}</span>
                      <span className="block truncate text-muted-foreground" title={draft.type}>{draft.type}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {verdictBadge(draft)}
                      {draft.verdict && draft.verdictRead === 'save' ? (
                        <span className="text-muted-foreground" data-testid="draft-review-verdict-at-save">
                          {t('chatbot.draftReview.checkedAtSave', { defaultValue: 'checked when saved' })}
                        </span>
                      ) : null}
                      {link(
                        draft.review.item,
                        t('chatbot.draftReview.review', { defaultValue: 'Review' }),
                        t('chatbot.draftReview.reviewAria', { name: shown, defaultValue: 'Review the draft {{name}} in Studio' }),
                        'draft-review-item-link',
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {review.omitted ? (
          <div className="text-muted-foreground" data-testid="draft-review-omitted">
            {t('chatbot.draftReview.more', { count: review.omitted, defaultValue: '+{{count}} more' })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
