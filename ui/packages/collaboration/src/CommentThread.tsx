/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useDisplayLocale } from '@object-ui/i18n';
import {
  useCollaborationTranslation,
  type CollaborationTranslate,
} from './useCollaborationTranslation.js';
import { isCommentAuthor } from './commentAuthorship.js';

export interface Comment {
  id: string;
  author: { id: string; name: string; avatar?: string };
  content: string;
  mentions: string[];
  createdAt: string;
  updatedAt?: string;
  parentId?: string;
  resolved?: boolean;
  reactions?: Record<string, string[]>;
}

export interface CommentThreadProps {
  /** Thread ID */
  threadId: string;
  /** Comments in the thread */
  comments: Comment[];
  /** Current user */
  currentUser: { id: string; name: string; avatar?: string };
  /** Available users for @mentions */
  mentionableUsers?: { id: string; name: string; avatar?: string }[];
  /** Callback when a new comment is posted */
  onAddComment?: (content: string, mentions: string[], parentId?: string) => void;
  /** Callback when a comment is edited */
  onEditComment?: (commentId: string, content: string) => void;
  /** Callback when a comment is deleted */
  onDeleteComment?: (commentId: string) => void;
  /** Callback when thread is resolved/reopened */
  onResolve?: (resolved: boolean) => void;
  /** Callback when a reaction is toggled */
  onReaction?: (commentId: string, emoji: string) => void;
  /** Callback when @mentions are detected — for notification delivery (email/push) */
  onMentionNotify?: (mentionedUserIds: string[], commentContent: string) => void;
  /** Whether the thread is resolved */
  resolved?: boolean;
  /** Additional className */
  className?: string;
}

/**
 * Absolute date for the >= 7d bucket, in the session's DISPLAY locale — the tag
 * `useDisplayLocale()` resolves, which the component hands in (objectui#10375).
 *
 * objectui#3441 first localized this branch with the session LANGUAGE, before
 * the display-locale contract existed. That tag is the UI language, so a
 * regional display locale never reached the date: an English UI with a `de-CH`
 * display locale read `3/4/2020`, not `4.3.2020`. The display locale falls back
 * to the UI language when the session declares no regional locale, so such a
 * session renders exactly as it did under objectui#3441.
 *
 * Has its OWN try/catch, deliberately not sharing `formatTimestamp`'s. The two
 * catches recover from different things and must recover differently:
 *
 *  - `formatTimestamp`'s outer catch is for an input it cannot make sense of,
 *    and its only honest fallback is to echo the raw `iso` back.
 *  - a throw from here says nothing about the *date* — it says the LOCALE TAG
 *    is malformed. `Date.prototype.toLocaleDateString(tag)` runs the tag through
 *    `CanonicalizeLocaleList`, which raises `RangeError` for anything not
 *    structurally well-formed per BCP 47 (`'en_US'`, `''`, `'zh CN'`). A
 *    well-formed but unknown tag such as `'xx-YY'` does NOT throw — it resolves
 *    to the runtime default — so only genuinely malformed tags reach the catch.
 *
 * Letting the tag's `RangeError` reach the outer catch is why this was left
 * undone in objectui#3424: a bad tag would have turned a readable date into the
 * raw `2026-08-01T09:30:00.000Z`, i.e. WORSE than the un-localized date it
 * replaced. Falling back to the no-argument call restores exactly the previous
 * behaviour (the runtime's own locale) for that path, so the worst case of
 * following the display locale is the status quo, never a regression.
 *
 * No date library, and no month/weekday copy in the locale packs: `Intl` is
 * already in the runtime and owns the per-locale ordering and separators.
 */
function formatAbsoluteDate(date: Date, locale: string): string {
  try {
    return date.toLocaleDateString(locale);
  } catch {
    return date.toLocaleDateString();
  }
}

/**
 * Relative age of a comment: the words in the session language, the absolute
 * date in the display locale.
 *
 * `t` and `locale` are threaded in as parameters rather than read from a
 * hook: this runs once per rendered comment from inside `renderComment`, and
 * the buckets are unchanged — only the words moved into the locale packs.
 * Counts are interpolated as STRINGS on purpose, so i18next skips its own
 * plural resolution (`needsPluralHandling` is false for a string `count`) and
 * cannot silently start looking for `_one`/`_other` variants this repo does not
 * ship.
 *
 * The >= 7d bucket is a DATE, not words, so it takes the display locale
 * (objectui#10375), not the language `t` speaks. It was first localized under
 * objectui#3441 — a `zh` session used to read "6 天前" for a six-day-old
 * comment and `8/1/2026` for an eight-day-old one, because that branch called
 * `toLocaleDateString()` with no argument and got the *runtime's* locale. See
 * {@link formatAbsoluteDate} for why the tag gets its own guard instead of
 * being handed straight in.
 */
function formatTimestamp(iso: string, t: CollaborationTranslate, locale: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t('collaboration.justNow');
    // NUMBER counts: these are count families (objectui#11445), and i18next
    // plural-selects only for a number — `ar` needs its own noun form at 3-10.
    if (minutes < 60) return t('collaboration.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('collaboration.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t('collaboration.daysAgo', { count: days });
    return formatAbsoluteDate(date, locale);
  } catch {
    return iso;
  }
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Parse @mentions from text content */
function parseMentions(
  content: string,
  users: { id: string; name: string }[],
): string[] {
  const mentions: string[] = [];
  const mentionPattern = /@(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = mentionPattern.exec(content)) !== null) {
    const matchStr = match[1];
    const mentioned = users.find(
      u => u.name.toLowerCase().replace(/\s+/g, '') === matchStr.toLowerCase()
        || u.id === matchStr
    );
    if (mentioned && !mentions.includes(mentioned.id)) {
      mentions.push(mentioned.id);
    }
  }
  return mentions;
}

const styles = {
  thread: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '14px',
    lineHeight: '1.5',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #e2e8f0',
    backgroundColor: '#f8fafc',
    fontSize: '12px',
    color: '#64748b',
  },
  resolveBtn: {
    background: 'none',
    border: '1px solid #cbd5e1',
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '12px',
    cursor: 'pointer',
    color: '#475569',
  },
  commentList: {
    maxHeight: '400px',
    overflowY: 'auto' as const,
  },
  comment: {
    display: 'flex',
    gap: '8px',
    padding: '10px 12px',
    borderBottom: '1px solid #f1f5f9',
  },
  reply: {
    paddingLeft: '32px',
  },
  avatar: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 600,
    color: '#fff',
    backgroundColor: '#94a3b8',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
  },
  commentHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '2px',
  },
  authorName: {
    fontWeight: 600,
    fontSize: '13px',
    color: '#1e293b',
  },
  timestamp: {
    fontSize: '12px',
    color: '#94a3b8',
  },
  content: {
    color: '#334155',
    wordBreak: 'break-word' as const,
  },
  mention: {
    color: '#3b82f6',
    fontWeight: 500,
  },
  actions: {
    display: 'flex',
    gap: '8px',
    marginTop: '4px',
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    fontSize: '12px',
    color: '#64748b',
    cursor: 'pointer',
    padding: 0,
  },
  sortSelect: {
    background: 'none',
    border: '1px solid #e2e8f0',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '11px',
    color: '#64748b',
    cursor: 'pointer',
    outline: 'none',
  },
  reactionBar: {
    display: 'flex',
    gap: '4px',
    marginTop: '4px',
    flexWrap: 'wrap' as const,
  },
  reactionBtn: {
    background: 'none',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '1px 6px',
    fontSize: '12px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    lineHeight: '1.5',
  },
  reactionBtnActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
  },
  reactionPicker: {
    background: 'none',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '1px 6px',
    fontSize: '12px',
    cursor: 'pointer',
    color: '#94a3b8',
    lineHeight: '1.5',
  },
  inputArea: {
    display: 'flex',
    gap: '8px',
    padding: '10px 12px',
    borderTop: '1px solid #e2e8f0',
    position: 'relative' as const,
  },
  textarea: {
    flex: 1,
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '13px',
    fontFamily: 'inherit',
    resize: 'none' as const,
    outline: 'none',
    minHeight: '36px',
    maxHeight: '120px',
    lineHeight: '1.5',
  },
  submitBtn: {
    alignSelf: 'flex-end',
    backgroundColor: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  submitBtnDisabled: {
    backgroundColor: '#cbd5e1',
    cursor: 'default',
  },
  mentionPopup: {
    position: 'absolute' as const,
    bottom: '100%',
    left: '12px',
    backgroundColor: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,.1)',
    maxHeight: '150px',
    overflowY: 'auto' as const,
    zIndex: 10,
    minWidth: '180px',
  },
  mentionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#1e293b',
  },
  mentionItemHighlighted: {
    backgroundColor: '#f1f5f9',
  },
} as const;

/** Render comment content with highlighted @mentions */
function renderContent(content: string): React.ReactNode {
  const parts = content.split(/(@\w+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return React.createElement('span', { key: i, style: styles.mention }, part);
    }
    return part;
  });
}

/**
 * Comment thread component with @mentions support.
 *
 * Renders a list of comments with author avatars, timestamps,
 * reply functionality, and an @mention suggestions popup.
 *
 * Every user-visible string resolves through `useCollaborationTranslation`
 * (objectstack#5506): the session locale under an `I18nProvider`, and the
 * English `COLLAB_DEFAULT_TRANSLATIONS` map with no provider mounted. There is
 * deliberately no `formatter`/label prop escape hatch — a host that wants
 * different copy overrides the locale keys, so one thread cannot end up half
 * translated by the bundle and half by props.
 */
export function CommentThread({
  threadId,
  comments,
  currentUser,
  mentionableUsers = [],
  onAddComment,
  onEditComment,
  onDeleteComment,
  onResolve,
  onReaction,
  onMentionNotify,
  resolved = false,
  className,
}: CommentThreadProps): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('oldest');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useCollaborationTranslation();
  // The >= 7d timestamp is a date, so it reads the DISPLAY locale, never the
  // UI language: a regional locale (`de-CH` under an English UI) must reach it
  // (objectui#10375). Provider-safe like `t`: with no provider mounted the
  // hook answers the same UI-language tag this branch used before.
  const displayLocale = useDisplayLocale();

  const filteredMentions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return mentionableUsers.filter(
      u => u.name.toLowerCase().includes(query) || u.id.toLowerCase().includes(query),
    );
  }, [mentionQuery, mentionableUsers]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputValue(value);

    // Detect @mention trigger
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }, []);

  const insertMention = useCallback((user: { id: string; name: string }) => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = inputValue.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      const before = textBeforeCursor.slice(0, mentionMatch.index);
      const after = inputValue.slice(cursorPos);
      const mentionText = `@${user.name.replace(/\s+/g, '')}`;
      setInputValue(`${before}${mentionText} ${after}`);
    }
    setMentionQuery(null);
  }, [inputValue]);

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || !onAddComment) return;

    const mentions = parseMentions(trimmed, mentionableUsers);
    onAddComment(trimmed, mentions, replyTo ?? undefined);

    // Trigger notification delivery for mentioned users
    if (mentions.length > 0 && onMentionNotify) {
      onMentionNotify(mentions, trimmed);
    }

    setInputValue('');
    setReplyTo(null);
    setMentionQuery(null);
  }, [inputValue, onAddComment, mentionableUsers, replyTo, onMentionNotify]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(prev => Math.min(prev + 1, filteredMentions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMentions[mentionIndex]);
      } else if (e.key === 'Escape') {
        setMentionQuery(null);
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [mentionQuery, filteredMentions, mentionIndex, insertMention, handleSubmit]);

  const handleEdit = useCallback((commentId: string) => {
    const comment = comments.find(c => c.id === commentId);
    if (comment) {
      setEditingId(commentId);
      setEditValue(comment.content);
    }
  }, [comments]);

  const handleEditSave = useCallback(() => {
    if (editingId && editValue.trim() && onEditComment) {
      onEditComment(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  }, [editingId, editValue, onEditComment]);

  // Keep mention index in bounds
  useEffect(() => {
    if (mentionIndex >= filteredMentions.length) {
      setMentionIndex(Math.max(0, filteredMentions.length - 1));
    }
  }, [filteredMentions.length, mentionIndex]);

  const rootComments = useMemo(
    () => {
      const roots = comments.filter(c => !c.parentId);
      if (sortOrder === 'newest') {
        return [...roots].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      return roots;
    },
    [comments, sortOrder],
  );
  const replies = useMemo(
    () => comments.filter(c => c.parentId),
    [comments],
  );

  const renderComment = (comment: Comment, isReply = false) => {
    const isEditing = editingId === comment.id;
    // The one owner rule, shared with the console's record feed (objectui#12268).
    const isOwner = isCommentAuthor(comment.author.id, currentUser.id);

    return React.createElement('div', {
      key: comment.id,
      style: { ...styles.comment, ...(isReply ? styles.reply : {}) },
      'data-comment-id': comment.id,
    },
      // Avatar
      React.createElement('div', { style: styles.avatar },
        comment.author.avatar
          ? React.createElement('img', {
              src: comment.author.avatar,
              alt: comment.author.name,
              style: styles.avatarImg,
            })
          : getInitials(comment.author.name),
      ),
      // Body
      React.createElement('div', { style: styles.commentBody },
        // Header
        React.createElement('div', { style: styles.commentHeader },
          React.createElement('span', { style: styles.authorName }, comment.author.name),
          React.createElement('span', { style: styles.timestamp }, formatTimestamp(comment.createdAt, t, displayLocale)),
          comment.updatedAt
            ? React.createElement('span', { style: styles.timestamp }, t('collaboration.edited'))
            : null,
        ),
        // Content or edit input
        isEditing
          ? React.createElement('div', { style: { display: 'flex', gap: '4px' } },
              React.createElement('textarea', {
                value: editValue,
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setEditValue(e.target.value),
                style: { ...styles.textarea, flex: 1 },
                rows: 2,
              }),
              React.createElement('button', {
                onClick: handleEditSave,
                style: { ...styles.submitBtn, padding: '4px 10px', fontSize: '12px' },
              }, t('common.save')),
              React.createElement('button', {
                onClick: () => { setEditingId(null); setEditValue(''); },
                style: { ...styles.actionBtn },
              }, t('common.cancel')),
            )
          : React.createElement('div', { style: styles.content }, renderContent(comment.content)),
        // Reactions display
        !isEditing && comment.reactions && Object.keys(comment.reactions).length > 0 && React.createElement('div', { style: styles.reactionBar },
          Object.entries(comment.reactions).map(([emoji, userIds]) =>
            React.createElement('button', {
              key: emoji,
              style: {
                ...styles.reactionBtn,
                ...(userIds.includes(currentUser.id) ? styles.reactionBtnActive : {}),
              },
              onClick: () => onReaction?.(comment.id, emoji),
              // A dedicated count family — `detail.reactionCount` interpolates
              // an `{{emoji}}` this tooltip has no value for (the emoji is the
              // button's visible label), so reusing it would leave a literal
              // `{{emoji}}` in the accessible name under every locale. The
              // count is a NUMBER so i18next plural-selects (objectui#11445).
              title: t('collaboration.reactionCount', { count: userIds.length }),
            }, `${emoji} ${userIds.length}`),
          ),
          // The reaction-bar picker (objectui#3478). Its content is the literal
          // `'+'`, so the `title` objectstack#5506 gave it could never become
          // its accessible name — name-from-content (accname §2F) is resolved
          // before the `title` tooltip (§2I) gets a turn, and a screen reader
          // announced "plus button". The copy was localized and correct and
          // reached nobody who could not see the glyph. `aria-label` (§2C)
          // outranks content, so it is what actually names the control.
          //
          // The `title` STAYS: `+` tells a sighted mouse user nothing either,
          // so the hover hint does real work of its own. Both attributes read
          // the SAME key, so name and tooltip cannot drift apart. (The 👍/❤️
          // buttons below had no `title` to keep — hence `aria-label` alone.)
          //
          // Still `addThumbsUp`: the button dispatches `onReaction(id, '👍')`
          // unconditionally today, and the name describes that, not what
          // `styles.reactionPicker` hints it might one day become. The chips
          // above stay content-named — `${emoji} ${count}` already describes
          // them.
          onReaction && React.createElement('button', {
            style: styles.reactionPicker,
            onClick: () => onReaction(comment.id, '👍'),
            'aria-label': t('collaboration.addThumbsUp'),
            title: t('collaboration.addThumbsUp'),
          }, '+'),
        ),
        // Actions
        !isEditing && React.createElement('div', { style: styles.actions },
          React.createElement('button', {
            style: styles.actionBtn,
            onClick: () => setReplyTo(comment.id),
          }, t('collaboration.reply')),
          // Quick reactions (objectui#3441). Their only content is the emoji,
          // and for a `button` the accessible name comes from CONTENT before it
          // ever reaches `title` (accname §2F outranks §2I) — so these two were
          // announced as the bare glyph: "thumbs up" / "red heart" at best,
          // nothing at all where the SR has no name for the codepoint. Hence
          // `aria-label`, which overrides content. (The `+` picker above had
          // only a `title` and was announced as "plus" for exactly the same
          // reason, until objectui#3478 gave it an `aria-label` too.)
          //
          // Their own key pair, NOT a reuse of `collaboration.addThumbsUp`: the
          // `+` above happens to fire the same `onReaction(id, '👍')` today, but
          // it is the reaction PICKER's entry point (`styles.reactionPicker`)
          // whose copy follows the picker if it ever picks. Sharing one key
          // would now be worse than when #3441 wrote this down — since #3478
          // both controls carry a real accessible name, so on a comment that
          // already has reactions a shared key means two visibly different
          // controls announcing themselves identically.
          onReaction && React.createElement('button', {
            style: styles.actionBtn,
            onClick: () => onReaction(comment.id, '👍'),
            'aria-label': t('collaboration.reactThumbsUp'),
          }, '👍'),
          onReaction && React.createElement('button', {
            style: styles.actionBtn,
            onClick: () => onReaction(comment.id, '❤️'),
            'aria-label': t('collaboration.reactHeart'),
          }, '❤️'),
          isOwner && onEditComment && React.createElement('button', {
            style: styles.actionBtn,
            onClick: () => handleEdit(comment.id),
          }, t('common.edit')),
          isOwner && onDeleteComment && React.createElement('button', {
            style: styles.actionBtn,
            onClick: () => onDeleteComment(comment.id),
          }, t('common.delete')),
        ),
      ),
    );
  };

  return React.createElement('div', {
    style: styles.thread,
    className,
    'data-thread-id': threadId,
  },
    // Header
    React.createElement('div', { style: styles.header },
      React.createElement('span', null,
        // An i18next count family instead of an English `s` glued on at
        // render time: the old `` `${n} comment${n !== 1 ? 's' : ''}` ``
        // compiled the plural RULE into the component. A NUMBER count, so
        // i18next selects each pack's own CLDR slot (objectui#11445).
        t('collaboration.commentCount', { count: comments.length }),
        resolved ? t('collaboration.resolvedSuffix') : '',
      ),
      React.createElement('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        React.createElement('select', {
          value: sortOrder,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setSortOrder(e.target.value as 'newest' | 'oldest'),
          style: styles.sortSelect,
          'aria-label': t('collaboration.sortComments'),
        },
          React.createElement('option', { value: 'oldest' }, t('collaboration.sortOldest')),
          React.createElement('option', { value: 'newest' }, t('collaboration.sortNewest')),
        ),
        onResolve && React.createElement('button', {
          style: styles.resolveBtn,
          onClick: () => onResolve(!resolved),
        }, resolved ? t('collaboration.reopen') : t('collaboration.resolve')),
      ),
    ),
    // Comments list
    React.createElement('div', { style: styles.commentList },
      rootComments.map(comment => React.createElement(React.Fragment, { key: comment.id },
        renderComment(comment),
        replies
          .filter(r => r.parentId === comment.id)
          .map(r => renderComment(r, true)),
      )),
    ),
    // Reply indicator
    replyTo && React.createElement('div', {
      style: { padding: '4px 12px', fontSize: '12px', color: '#64748b', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between' },
    },
      // Two whole sentences rather than one sentence plus a translatable word
      // standing in for a name: languages that inflect around the addressee
      // cannot build the no-author case out of the `{{name}}` form.
      React.createElement('span', null, (() => {
        const replyToName = comments.find(c => c.id === replyTo)?.author.name;
        return replyToName
          ? t('collaboration.replyingTo', { name: replyToName })
          : t('collaboration.replyingToComment');
      })()),
      // Dismisses the banner and clears the reply target (objectui#3441). Its
      // content is U+2715 MULTIPLICATION X — a math symbol, not an icon with a
      // name — so name-from-content gave a screen reader either nothing or
      // "multiplication x". `aria-label` overrides it; `cancelReply` rather
      // than the generic `common.cancel` because an accessible name has to say
      // WHAT is being cancelled (the composer keeps its text either way).
      React.createElement('button', {
        style: styles.actionBtn,
        onClick: () => setReplyTo(null),
        'aria-label': t('collaboration.cancelReply'),
      }, '✕'),
    ),
    // Input area
    React.createElement('div', { style: styles.inputArea },
      // Mention popup
      mentionQuery !== null && filteredMentions.length > 0 && React.createElement('div', { style: styles.mentionPopup },
        filteredMentions.map((user, idx) =>
          React.createElement('div', {
            key: user.id,
            style: { ...styles.mentionItem, ...(idx === mentionIndex ? styles.mentionItemHighlighted : {}) },
            onMouseDown: (e: React.MouseEvent) => {
              e.preventDefault();
              insertMention(user);
            },
            onMouseEnter: () => setMentionIndex(idx),
          },
            user.avatar
              ? React.createElement('img', {
                  src: user.avatar,
                  alt: user.name,
                  style: { width: '20px', height: '20px', borderRadius: '50%' },
                })
              : React.createElement('span', {
                  style: { ...styles.avatar, width: '20px', height: '20px', fontSize: '9px' },
                }, getInitials(user.name)),
            user.name,
          ),
        ),
      ),
      React.createElement('textarea', {
        ref: inputRef,
        value: inputValue,
        onChange: handleInputChange,
        onKeyDown: handleKeyDown,
        placeholder: t('collaboration.commentPlaceholder'),
        style: styles.textarea,
        rows: 1,
      }),
      React.createElement('button', {
        onClick: handleSubmit,
        disabled: !inputValue.trim(),
        style: {
          ...styles.submitBtn,
          ...(!inputValue.trim() ? styles.submitBtnDisabled : {}),
        },
      }, t('collaboration.send')),
    ),
  );
}
