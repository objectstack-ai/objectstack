/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Button, Textarea } from '@object-ui/components';
import { Pencil, Trash2 } from 'lucide-react';
import type { FeedItem } from '@object-ui/types';
import { useDetailTranslation } from './useDetailTranslation';

/**
 * Whether a feed row offers its author's controls (objectui#12268).
 *
 * Only a `comment` row can: it is a `sys_comment` row, which its author may
 * edit and delete. Whose comment it is, the timeline never decides. The host
 * that read the row answers it as `FeedItem.authoredByViewer`, through
 * `@object-ui/collaboration`'s `isCommentAuthor`, the one rule `CommentThread`
 * gates its own Edit and Delete on. A row read from `sys_activity` offers
 * neither, for the reason `canTakeReply` gives in `RecordActivityTimeline`.
 */
function offersAuthorControls(item: FeedItem): boolean {
  return item.type === 'comment' && item.authoredByViewer === true;
}

/** Not exported from the package entry: the timeline's and the reply list's shared part. */
export interface CommentBodyProps {
  item: FeedItem;
  /**
   * Stores the edited text. Offered only on a row {@link offersAuthorControls}
   * accepts; the host hands it over only under the caller's update grant on
   * `sys_comment`. A rejection means nothing was stored.
   */
  onEditComment?: (itemId: string | number, text: string) => void | Promise<void>;
  /** Deletes the comment, on the same rows; the host confirms first. */
  onDeleteComment?: (itemId: string | number) => void | Promise<void>;
  /** The body paragraph's classes: the timeline row and a reply each keep their own. */
  bodyClassName: string;
}

/**
 * A feed comment's text, and its author's Edit and Delete (objectui#12268).
 *
 * Edit turns the text into an editor in place, holding a draft of it. Save
 * hands the trimmed draft to the host and closes the editor once the host's
 * promise resolves. A REJECTED promise means the server did not store the
 * edit: the editor stays open with the draft, and the text behind it is
 * unchanged, because the host replaces a row's text only after the write
 * answers. Reporting why is the host's job, as for the composers. Delete hands
 * the row's id to the host, which asks for confirmation and removes the row
 * once the server has deleted it.
 *
 * A row that offers neither control renders exactly the body paragraph it
 * always rendered.
 */
export const CommentBody: React.FC<CommentBodyProps> = ({
  item,
  onEditComment,
  onDeleteComment,
  bodyClassName,
}) => {
  const { t } = useDetailTranslation();
  const own = offersAuthorControls(item);
  const edit = own ? onEditComment : undefined;
  const remove = own ? onDeleteComment : undefined;
  // `null` while the text is shown; the draft while the editor is open.
  const [draft, setDraft] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const editing = draft !== null && !!edit;
  const trimmed = draft?.trim() ?? '';
  // An empty draft has nothing to store, and an unchanged one nothing to edit.
  const canSave = trimmed !== '' && trimmed !== (item.body ?? '').trim();

  const handleSave = async () => {
    if (!edit || !canSave) return;
    setSaving(true);
    try {
      await edit(item.id, trimmed);
      setDraft(null);
    } catch {
      // Not stored: keep the draft, so the user can retry without retyping.
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!remove) return;
    setDeleting(true);
    try {
      await remove(item.id);
    } catch {
      // Not deleted: the row stays, and the host has said why.
    } finally {
      setDeleting(false);
    }
  };

  if (editing) {
    return (
      <div className="mt-1 space-y-1.5" data-testid="comment-editor">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(null);
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void handleSave();
            }
          }}
          aria-label={t('detail.editComment')}
          disabled={saving}
          autoFocus
          className="min-h-[60px] text-sm"
        />
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => void handleSave()} disabled={saving || !canSave}>
            {t('detail.save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
            {t('detail.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {item.body && <p className={bodyClassName}>{item.body}</p>}
      {(edit || remove) && (
        <div className="mt-1 flex items-center gap-0.5">
          {edit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              onClick={() => setDraft(item.body ?? '')}
              aria-label={t('detail.editComment')}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
          {remove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              onClick={() => void handleDelete()}
              disabled={deleting}
              aria-label={t('detail.deleteComment')}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}
    </>
  );
};
