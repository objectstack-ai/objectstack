/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import type { DiscussionMentionSuggestion } from '@object-ui/react';
import { RichTextCommentInput } from '../RichTextCommentInput';

export interface CommentComposerProps {
  /** Writes the comment (or the reply). A rejection means nothing was written: the draft stays. */
  onSubmit: (text: string) => void | Promise<void>;
  placeholder?: string;
  mentionSuggestions?: DiscussionMentionSuggestion[];
  onMentionSuggestionsWanted?: () => void;
  /**
   * Moves the caret into the box each time it changes to a new value above
   * zero: a press on 「回复」 lands the caret here, the draft kept.
   */
  focusSignal?: number;
  /** `phone`: the phone's box, its toolbar under the text (`RichTextCommentInput`). */
  layout?: 'default' | 'phone';
  className?: string;
}

/**
 * The comment box (objectstack#36075): one line until used, the record
 * timeline's composer in full once focused — the same toolbar, mentions and
 * send as everywhere else. The desktop panel docks it at its foot; a thread
 * draws one under its replies.
 */
export const CommentComposer: React.FC<CommentComposerProps> = ({
  onSubmit,
  placeholder,
  mentionSuggestions,
  onMentionSuggestionsWanted,
  focusSignal = 0,
  layout,
  className,
}) => {
  const boxRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (focusSignal > 0) boxRef.current?.querySelector('textarea')?.focus();
  }, [focusSignal]);
  const [text, setText] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const submit = React.useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setText('');
    } catch {
      // Not written: the host reports why; the draft stays for another try.
    } finally {
      setSubmitting(false);
    }
  }, [text, submitting, onSubmit]);
  return (
    <div ref={boxRef} className="contents">
    <RichTextCommentInput
      className={cn('bg-background', className)}
      value={text}
      onChange={setText}
      onSubmit={submit}
      placeholder={placeholder}
      mentionSuggestions={mentionSuggestions}
      onMentionSuggestionsWanted={onMentionSuggestionsWanted}
      disabled={submitting}
      compact
      layout={layout}
    />
    </div>
  );
};
