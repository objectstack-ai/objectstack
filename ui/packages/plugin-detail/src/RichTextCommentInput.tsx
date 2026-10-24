/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Button } from '@object-ui/components';
import {
  Bold,
  Italic,
  List,
  Code,
  AtSign,
  Eye,
  Edit,
  Send,
} from 'lucide-react';
import { useDetailTranslation } from './useDetailTranslation';

export interface MentionSuggestion {
  id: string;
  label: string;
  avatarUrl?: string;
}

export interface RichTextCommentInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void | Promise<void>;
  mentionSuggestions?: MentionSuggestion[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Optional content rendered inside the bordered container, between the
   *  editor and the toolbar. Used by hosts to inject an attachment panel
   *  without modifying the composer's text/toolbar contract. */
  extraSlot?: React.ReactNode;
  /** When true, the Send button is enabled even if the text value is empty.
   *  Hosts pass this when attachments-only submits should be allowed. */
  canSubmitEmpty?: boolean;
}

/** Render minimal markdown to HTML for preview. */
function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (```)
    .replace(/```([\s\S]*?)```/g, '<pre class="bg-muted rounded p-2 text-xs font-mono my-1 overflow-x-auto">$1</pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-muted rounded px-1 py-0.5 text-xs font-mono">$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // @mentions
    .replace(/@(\w+)/g, '<span class="text-primary font-medium">@$1</span>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Line breaks
    .replace(/\n/g, '<br/>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(
    /(<li[^>]*>.*?<\/li>(?:<br\/>)?)+/g,
    (match) => `<ul class="my-1">${match.replace(/<br\/>/g, '')}</ul>`,
  );

  return html;
}

export const RichTextCommentInput: React.FC<RichTextCommentInputProps> = ({
  value,
  onChange,
  onSubmit,
  mentionSuggestions = [],
  placeholder,
  className,
  disabled = false,
  extraSlot,
  canSubmitEmpty = false,
}) => {
  const { t } = useDetailTranslation();
  const [isPreview, setIsPreview] = React.useState(false);
  const [showMentions, setShowMentions] = React.useState(false);
  const [mentionQuery, setMentionQuery] = React.useState('');
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const filteredMentions = React.useMemo(() => {
    if (!mentionQuery) return mentionSuggestions;
    const query = mentionQuery.toLowerCase();
    return mentionSuggestions.filter((s) =>
      s.label.toLowerCase().includes(query),
    );
  }, [mentionQuery, mentionSuggestions]);

  const insertAtCursor = React.useCallback(
    (before: string, after: string = '') => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = value.slice(start, end);
      const newValue =
        value.slice(0, start) + before + selected + after + value.slice(end);
      onChange(newValue);
      // Restore cursor after the insertion
      requestAnimationFrame(() => {
        textarea.focus();
        const cursorPos = start + before.length + selected.length;
        textarea.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [value, onChange],
  );

  const handleBold = React.useCallback(() => insertAtCursor('**', '**'), [insertAtCursor]);
  const handleItalic = React.useCallback(() => insertAtCursor('*', '*'), [insertAtCursor]);
  const handleList = React.useCallback(() => insertAtCursor('\n- ', ''), [insertAtCursor]);
  const handleCode = React.useCallback(() => insertAtCursor('`', '`'), [insertAtCursor]);

  const handleMentionTrigger = React.useCallback(() => {
    insertAtCursor('@', '');
    setShowMentions(true);
    setMentionQuery('');
    setMentionIndex(0);
  }, [insertAtCursor]);

  const handleSelectMention = React.useCallback(
    (suggestion: MentionSuggestion) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursorPos = textarea.selectionStart;
      // Find the last '@' before cursor to replace the partial query
      const textBefore = value.slice(0, cursorPos);
      const atIndex = textBefore.lastIndexOf('@');
      if (atIndex !== -1) {
        const newValue =
          value.slice(0, atIndex) + `@${suggestion.label} ` + value.slice(cursorPos);
        onChange(newValue);
      }
      setShowMentions(false);
      setMentionQuery('');
      requestAnimationFrame(() => textarea.focus());
    },
    [value, onChange],
  );

  const handleTextChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      // Detect @mention trigger
      const cursorPos = e.target.selectionStart;
      const textBefore = newValue.slice(0, cursorPos);
      const lastAtIndex = textBefore.lastIndexOf('@');

      if (lastAtIndex !== -1) {
        const textAfterAt = textBefore.slice(lastAtIndex + 1);
        // Only show if @ is at start or preceded by whitespace and no space in query
        const charBeforeAt = lastAtIndex > 0 ? textBefore[lastAtIndex - 1] : ' ';
        if (/\s/.test(charBeforeAt) && !/\s/.test(textAfterAt)) {
          setShowMentions(true);
          setMentionQuery(textAfterAt);
          setMentionIndex(0);
          return;
        }
      }
      setShowMentions(false);
    },
    [onChange],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showMentions && filteredMentions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((prev) =>
            prev < filteredMentions.length - 1 ? prev + 1 : 0,
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((prev) =>
            prev > 0 ? prev - 1 : filteredMentions.length - 1,
          );
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          handleSelectMention(filteredMentions[mentionIndex]);
          return;
        }
        if (e.key === 'Escape') {
          setShowMentions(false);
          return;
        }
      }

      // Ctrl+Enter to submit
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onSubmit?.();
      }
    },
    [showMentions, filteredMentions, mentionIndex, handleSelectMention, onSubmit],
  );

  return (
    <div className={cn('border rounded-md', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b bg-muted/30">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleBold}
          disabled={disabled || isPreview}
          title={t('detail.bold')}
        >
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleItalic}
          disabled={disabled || isPreview}
          title={t('detail.italic')}
        >
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleList}
          disabled={disabled || isPreview}
          title={t('detail.listFormat')}
        >
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleCode}
          disabled={disabled || isPreview}
          title={t('detail.inlineCode')}
        >
          <Code className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleMentionTrigger}
          disabled={disabled || isPreview}
          title={t('detail.mentionSomeone')}
        >
          <AtSign className="h-3.5 w-3.5" />
        </Button>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setIsPreview(!isPreview)}
          title={isPreview ? t('detail.edit') : t('detail.preview')}
        >
          {isPreview ? (
            <Edit className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </Button>

        {onSubmit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onSubmit}
            disabled={disabled || (!canSubmitEmpty && !value.trim())}
            title={t('detail.submitComment')}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Editor / Preview */}
      <div className="relative">
        {isPreview ? (
          <div
            className="min-h-[80px] px-3 py-2 text-sm prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
          />
        ) : (
          <>
            <textarea
              ref={textareaRef}
              className="w-full min-h-[80px] px-3 py-2 text-sm bg-transparent resize-none focus:outline-none placeholder:text-muted-foreground"
              placeholder={placeholder ?? t('detail.writeComment')}
              value={value}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              disabled={disabled}
            />

            {/* @mention dropdown */}
            {showMentions && filteredMentions.length > 0 && (
              <div className="absolute left-2 bottom-full mb-1 w-56 bg-popover border rounded-md shadow-md z-50 max-h-40 overflow-y-auto">
                {filteredMentions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-accent transition-colors',
                      index === mentionIndex && 'bg-accent',
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectMention(suggestion);
                    }}
                  >
                    {suggestion.avatarUrl ? (
                      <img
                        src={suggestion.avatarUrl}
                        alt={suggestion.label}
                        className="h-5 w-5 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium">
                        {suggestion.label.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span>{suggestion.label}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Extra slot — typically an attachment panel rendered by the host */}
      {extraSlot && (
        <div className="border-t px-2 py-2 bg-muted/20">
          {extraSlot}
        </div>
      )}
    </div>
  );
};
