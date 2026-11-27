/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ChatbotEnhanced — composed on top of vendored Vercel AI Elements
 * (src/elements/, MIT). Public props remain backwards compatible with the
 * previous custom implementation; internally we now get:
 *  - multi-line auto-growing prompt input (PromptInput)
 *  - smart reverse-stick scroll (Conversation + useStickToBottom)
 *  - message action toolbar surface (Message.actions slot)
 *  - tool-call visualisation (Tool* family)
 *  - reasoning / chain-of-thought collapsible (Reasoning*)
 *  - inline citations / sources panel (Sources*)
 *  - suggestion chips on empty state (Suggestion; wrapped in a flex-wrap row)
 *  - streaming markdown via streamdown (used by Message internals)
 */
import * as React from 'react';
import { cn } from '@object-ui/components';
import { useObjectTranslation, useSafeTranslate } from '@object-ui/i18n';
import { Copy, Check, RefreshCw, CornerDownLeft, Bot, Clock3 } from 'lucide-react';
import type { ChatStatus } from 'ai';
import {
  isUnsentSendError,
  parseAiQuotaError,
} from './tool-display';
import type { StickToBottomContext } from 'use-stick-to-bottom';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './elements/conversation';
import {
  Message,
  MessageActions,
  MessageAction,
  MessageContent,
  MessageResponse,
  type MessageProps,
} from './elements/message';
import { ListLinkContext, RecordLinkContext } from './recordLink';
import { isHitlContinuation } from './hitlContinuation';
import {
  PromptInput,
  PromptInputBody,
  PromptInputHeader,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
  PromptInputAttachments,
  PromptInputAttachment,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  type PromptInputMessage,
} from './elements/prompt-input';
import { Suggestion } from './elements/suggestion';
import type { ToolStatusLabels } from './elements/tool';
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from './elements/reasoning';
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from './elements/sources';
import { detectPackageRemovedResult } from './mapMessages';
import { AnswerSourceBlock } from './AnswerSource';
import { RecordCitations } from './RecordCitations';
import type {
  ChatbotEnhancedMessage,
  ChatbotEnhancedProps,
} from './chat/types';
import { ModelPicker } from './chat/ModelPicker';
import { AssistantThinkingMessage, MessageAvatar, ThinkingDots } from './chat/liveness';
import {
  shouldRenderDetailedTool,
  ToolPhaseSummary,
} from './chat/toolSummary';
import { AnswerCharts, isToolCallPlaceholder, layoutAnswer } from './chat/answerLayout';
import { renderToolDetail, type ToolDetailContext } from './chat/toolDetail';
import {
  ComposerNotice,
  ErrorBanner,
  formatSizeLimit,
  SendErrorNotice,
} from './chat/composerNotices';

export type {
  ChatbotEnhancedMessage,
  ChatbotEnhancedToolInvocation,
  ChatChart,
  ChatSource,
  ChatbotLabels,
  ChatbotEnhancedProps,
  ChatbotProcessVisibility,
  ChatbotSurface,
  ChatbotModelOption,
  ToolDecisionState,
  TurnLiveness,
} from './chat/types';
export { getToolState } from './chat/toolSummary';

/**
 * The plain surface's left/right gutter, keyed to the chat's own width (the
 * root is an `@container`), never to the viewport: a 16px gutter on both
 * sides, shared by the message list and the composer so messages, cards and
 * the input align. The gutter drops only once the container is wide enough
 * (`@3xl`, 48rem) that the centred `max-w-2xl` (42rem) column already keeps
 * more than 16px of margin on each side — the full-page chat at full width.
 */
const PLAIN_SURFACE_GUTTER = 'px-4 @3xl:px-0';

/**
 * An assistant turn on the plain surface spans the column below `@3xl`, so its
 * prose, tables and cards end on the same 16px gutter as the composer; at
 * full width it keeps the bubble's usual 95% cap.
 */
const PLAIN_SURFACE_ASSISTANT_WIDTH = 'max-w-full @3xl:max-w-[95%]';

function formatMessageProps(role: ChatbotEnhancedMessage['role']): MessageProps['from'] {
  // The vendored Message only knows user/assistant — render system as assistant
  // (FloatingChatbotProvider already renders system messages inline elsewhere).
  return role === 'user' ? 'user' : 'assistant';
}

const ChatbotEnhanced = React.forwardRef<HTMLDivElement, ChatbotEnhancedProps>(
  (
    {
      className,
      messages = [],
      placeholder = 'Type your message...',
      onSendMessage,
      onClear,
      onStop,
      onReload,
      onUpgrade,
      disabled = false,
      readOnly = false,
      isLoading = false,
      error,
      unsentText,
      showTimestamp = false,
      showAvatars = false,
      userAvatarUrl,
      userAvatarFallback = 'You',
      assistantAvatarUrl,
      assistantAvatarFallback = 'AI',
      hideClearBar = false,
      maxHeight = '500px',
      enableMarkdown: _enableMarkdown = true,
      enableFileUpload = false,
      // Spreadsheets included (cloud#797 WS3): the AI build panel parses
      // .xlsx/.xlsm/.csv/.tsv attachments locally and briefs the agent — an
      // accept list without them made that whole flow unreachable from the UI
      // (the composer's type filter rejected the file before anything ran).
      acceptedFileTypes = 'image/*,.pdf,.doc,.docx,.txt,.csv,.tsv,.xlsx,.xlsm',
      maxFileSize = 10 * 1024 * 1024,
      suggestions,
      labels,
      models,
      selectedModelId,
      onModelChange,
      allowanceUsedFraction,
      headerSlot,
      promptOverlaySlot,
      promptHeaderSlot,
      onInputChange,
      onToolApprove,
      toolApproveLabel = 'Approve',
      toolDenyLabel = 'Deny',
      toolDenyReason = 'User denied the operation',
      toolDecisions,
      recordHandoffTitleLabel = 'Open this record',
      recordHandoffOpenLabel = 'Open record →',
      onOpenRecordForm,
      recordWriteCreateTitle = (objectLabel) => `New ${objectLabel}`,
      recordWriteUpdateTitle = (objectLabel) => `Change ${objectLabel}`,
      recordWriteConfirmLabel = 'Confirm',
      recordWriteOpenFormLabel = 'Open the full form',
      recordWriteCancelLabel = 'Cancel',
      recordWriteCancelReason = 'Cancelled from the card',
      recordWriteOpenFormReason = 'Opened the full form instead',
      recordWriteDroppedLabel = 'Not included',
      recordWriteSubmittingLabel = 'Writing…',
      recordWriteWrittenLabel = 'Written',
      recordWriteCancelledLabel = 'Cancelled',
      sampleDataCleanupTitleLabel = 'Remove the sample data',
      sampleDataCleanupIrreversibleLabel = 'Removed rows cannot be recovered.',
      sampleDataCleanupAbsentLabel = (count) =>
        `${count} recorded ${count === 1 ? 'row is' : 'rows are'} not listed: you cannot see ${count === 1 ? 'it' : 'them'}, or ${count === 1 ? 'it is' : 'they are'} already gone.`,
      sampleDataCleanupEditedLabel = (count) =>
        `${count} ${count === 1 ? 'row' : 'rows'} edited since being seeded ${count === 1 ? 'stays' : 'stay'}.`,
      packageRemovalTitleLabel = (packageLabel) => `Delete the package ${packageLabel}`,
      packageRemovalRowsLabel = (count) => `${count} ${count === 1 ? 'record' : 'records'}`,
      packageRemovalDraftLabel = 'Draft, no table',
      packageRemovalRowsUnknownLabel = 'Record count unavailable',
      packageRemovalItemTypeLabel = (type) => type,
      packageRemovalTotalLabel = (count) => `${count} ${count === 1 ? 'record' : 'records'} in total`,
      packageRemovalUncountedLabel = (count) =>
        `The total leaves out ${count} ${count === 1 ? 'object whose records' : 'objects whose records'} could not be counted.`,
      packageRemovalPermanentLabel = 'The tables are dropped permanently, with every record in them. Dropped tables do not go to the recycle bin and cannot be restored.',
      packageRemovalKeptLabel = 'The database tables and every record in them are kept; only the package is removed.',
      packageRemovalRemovedLabel = 'The package was deleted.',
      packageRemovalPartialLabel = (failed) =>
        `The package was partly deleted: ${failed} ${failed === 1 ? 'item was' : 'items were'} not removed.`,
      onOpenRecord,
      onOpenList,
      surfaceContextLabel,
      surfaceContextTitle,
      promptInputHeaderSlot,
      processVisibility = 'summary',
      surface = 'card',
      ...props
    },
    ref
  ) => {
    const promptStatus: ChatStatus = isLoading ? 'streaming' : 'ready';
    const isPlainSurface = surface === 'plain';
    const [copiedId, setCopiedId] = React.useState<string | null>(null);
    // Last text submitted from the composer — used to RESTORE it when a send is
    // rejected before it reaches the model (rate-limit / network), so the user
    // never loses what they typed. Set on submit, read by the restore effect.
    const lastSubmittedRef = React.useRef<string>('');
    // Guards the restore effect so it fires once per failure (not on every
    // re-render while the error sits in state).
    const restoredErrorRef = React.useRef<unknown>(null);

    // objectui#7254 — the pack lookup for every string this component owns.
    // `useSafeTranslate` is provider-safe: with no I18nProvider (tests,
    // standalone hosts) each call returns the English fallback passed beside
    // it, so nothing below can render a raw key.
    const tt = useSafeTranslate();
    // A confirmed write a host policy holds for an approver outside the
    // conversation (decision state `held`): both approval cards read this,
    // never success wording. Borrowed from the inbox's status label so the
    // badge and the card say the same words.
    const heldForApprovalLabel = tt('aiApprovals.statusHeld', 'Waiting for approval');
    // objectstack#32984 — a message typed during a running turn waits here.
    const queuedLabel = tt('chatbot.composer.queued', 'Sends when the current reply finishes');
    const queuedCancelLabel = tt('chatbot.composer.queuedCancel', 'Cancel');
    const { t: tCount, language: composerLanguage } = useObjectTranslation();

    // Resolve localizable strings once. Precedence is host `labels` prop ->
    // locale pack -> the English default this component always shipped, so a
    // console that already translates a string keeps winning and a host that
    // passes nothing now gets the user's language instead of English.
    const L = React.useMemo(
      () => ({
        emptyTitle: labels?.emptyTitle ?? 'Start a conversation',
        emptyDescription:
          labels?.emptyDescription ??
          'Ask anything — the assistant has access to your current app context.',
        clear: labels?.clear ?? 'Clear',
        sendHint: labels?.sendHint ?? 'to send',
        newlineHint: labels?.newlineHint,
        agentActivity: labels?.agentActivity ?? tt('chatbot.toolState.agentActivity', 'Agent activity'),
        toolCompleted: labels?.toolCompleted ?? tt('chatbot.toolState.completed', 'Completed'),
        toolRunning: labels?.toolRunning ?? tt('chatbot.toolState.running', 'Running'),
        toolAwaitingApproval:
          labels?.toolAwaitingApproval ?? tt('chatbot.toolState.awaitingApproval', 'Awaiting approval'),
        toolFailed: labels?.toolFailed ?? tt('chatbot.toolState.failed', 'Failed'),
        // The vendored `ToolHeader` badge's own vocabulary (objectui#7254). It
        // carried a private English table, so a fully Chinese conversation
        // still read "Awaiting Approval" / "Completed" on every card header
        // while the summary chips beside it were translated.
        toolPending: tt('chatbot.toolState.pending', 'Pending'),
        toolResponded: tt('chatbot.toolState.responded', 'Responded'),
        toolDenied: tt('chatbot.toolState.denied', 'Denied'),
        toolError: tt('chatbot.toolState.error', 'Error'),
        toolDetailsHidden:
          labels?.toolDetailsHidden ??
          'Detailed tool inputs and outputs are hidden in this view.',
        copy: labels?.copy ?? 'Copy',
        copied: labels?.copied ?? 'Copied',
        regenerate: labels?.regenerate ?? 'Regenerate',
        model: labels?.model ?? 'Model',
        // objectui#12145 — the composer's send / stop button and an
        // attachment's remove button are icon-only, so these are their
        // accessible names. With no host `labels` they read the pack: the
        // console's own keys for the two names it already passes, and the
        // record attachment list's key for the third — one key per name.
        submit: labels?.submit ?? tt('console.ai.submit', 'Submit'),
        uploadFiles: labels?.uploadFiles ?? 'Upload files',
        stopResponse: labels?.stopResponse ?? tt('console.ai.stopResponse', 'Stop response'),
        removeAttachment: tt('detail.removeAttachment', 'Remove attachment'),
        // objectstack#35445 — the composer's icon-only 「+」 (the attachment
        // menu) and the menu's one item are named for what they do.
        addAttachment: tt('chatbot.composer.addAttachment', 'Add attachment'),
        sendFailedRateLimited:
          labels?.sendFailedRateLimited ??
          "You're sending messages too quickly. Your message is kept below — wait a moment and try again.",
        sendFailedGeneric:
          labels?.sendFailedGeneric ??
          "Couldn't send your message. It's kept below — please try again.",
        trace: labels?.trace ?? 'trace',
        viewTrace: labels?.viewTrace ?? 'View trace',
        connectionWaiting: labels?.connectionWaiting ?? 'Waiting for server…',
        connectionStalledLabel: labels?.connectionStalledLabel ?? 'Still working…',
        connectionOfflineLabel: labels?.connectionOfflineLabel ?? 'Connection lost — reconnecting…',
      }),
      [labels, tt],
    );

    // The vendored `ToolHeader`'s badge vocabulary, keyed by the AI-SDK state
    // it renders. Same strings as the activity chips read from `L`, so the two
    // surfaces can no longer disagree about what "Completed" is called.
    const toolStatusLabels: ToolStatusLabels = React.useMemo(
      () => ({
        'input-streaming': L.toolPending,
        'input-available': L.toolRunning,
        'approval-requested': L.toolAwaitingApproval,
        'approval-responded': L.toolResponded,
        'output-available': L.toolCompleted,
        'output-error': L.toolError,
        'output-denied': L.toolDenied,
      }),
      [L],
    );

    /**
     * The thread's stick-to-bottom controls, reached from OUTSIDE the
     * `<Conversation>` subtree (the composer and the cards live beside it, so
     * `useStickToBottomContext()` is not available to them). `contextRef` is
     * the library's own escape hatch, which keeps `elements/conversation.tsx`
     * — a vendored ai-elements file — untouched.
     */
    const stickToBottomRef = React.useRef<StickToBottomContext | null>(null);

    /**
     * objectui#7480 — follow the thread to the bottom because the user just
     * SENT something.
     *
     * `StickToBottom` only auto-follows while the view is at the bottom: read a
     * long reply, and the lock is escaped. In the wide full-page maker a reply
     * usually still ends on screen, so the next send looks like it scrolls; in
     * the narrow assistant rail the same reply is two or three times taller, so
     * the lock is almost always escaped by the time the user types — and the
     * new user bubble, the tool steps and the streaming reply all land below
     * the fold with no sign the agent started. Same component, opposite
     * behaviour, purely because of the rail's width.
     *
     * Sending is an explicit request to see what happens next, so every send
     * path re-arms the lock here. This is deliberately NOT hooked to message
     * APPENDS: once re-armed, `StickToBottom` follows the stream on its own and
     * releases the moment the user scrolls up — so a user reading back through
     * the thread mid-answer is never yanked to the bottom.
     */
    const followThreadToBottom = React.useCallback(() => {
      stickToBottomRef.current?.scrollToBottom({ animation: 'smooth' });
    }, []);

    // The send a typed message makes once nothing holds it back.
    const sendTyped = React.useCallback(
      (text: string, files: File[] | undefined) => {
        // Remember the text so a rejected send can restore it (the composer's
        // own form.reset clears the box optimistically). A fresh attempt also
        // clears any prior send-failure restore guard.
        lastSubmittedRef.current = text;
        restoredErrorRef.current = null;
        onSendMessage?.(text, files);
        followThreadToBottom();
      },
      [onSendMessage, followThreadToBottom]
    );

    // objectstack#32984 — a message typed while a turn is running. The
    // composer used to go dead for the whole turn, and a message the user
    // pressed Enter on in that window was cleared from the box with nothing
    // sent and nothing shown. It now QUEUES: the composer stays live, the
    // message shows above it as waiting, and it is sent the moment the turn
    // ends (one per turn, in the order typed). 取消 puts it back in the box.
    const [queuedSends, setQueuedSends] = React.useState<
      ReadonlyArray<{ id: number; text: string; files?: File[] }>
    >([]);
    const queuedSeqRef = React.useRef(0);
    // objectstack#34463 — a picked, pasted or dropped file the composer
    // refuses for size is named to the user with the limit, instead of only
    // reaching `console.warn` while the file silently fails to attach. Cleared
    // by the next send or the notice's close button; a later refusal replaces it.
    // A file whose type `acceptedFileTypes` does not admit is named the same way,
    // with the accepted list. Refusals reported by ONE pick (a wrong-type file
    // and an over-size one) all show: the sentences of the same tick are joined.
    const [attachmentNotice, setAttachmentNotice] = React.useState<string | null>(null);
    const attachmentNoticeTickRef = React.useRef<string[] | null>(null);
    const handlePromptInputError = React.useCallback(
      (e: { code: string; message: string; files?: File[] }) => {
        let sentence: string | null = null;
        if (e.code === 'max_file_size' && e.files?.length) {
          sentence = tCount('chatbot.composer.fileTooLarge', {
            files: e.files.map((f) => f.name).join(', '),
            limit: formatSizeLimit(maxFileSize, composerLanguage),
            defaultValue: 'Not attached, over the {{limit}} limit: {{files}}',
          });
        } else if (e.code === 'accept' && e.files?.length) {
          const allowed = acceptedFileTypes
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .join(', ');
          sentence = tCount('fields.file.typeNotAccepted', {
            name: e.files.map((f) => f.name).join(', '),
            accept: allowed,
            defaultValue: '"{{name}}" is not an accepted file type ({{accept}})',
          });
        }
        if (sentence === null) {
          console.warn('[plugin-chatbot] prompt-input error', e);
          return;
        }
        if (attachmentNoticeTickRef.current === null) {
          const tick: string[] = [];
          attachmentNoticeTickRef.current = tick;
          queueMicrotask(() => {
            if (attachmentNoticeTickRef.current === tick) attachmentNoticeTickRef.current = null;
          });
        }
        attachmentNoticeTickRef.current.push(sentence);
        setAttachmentNotice(attachmentNoticeTickRef.current.join(' '));
      },
      [tCount, maxFileSize, composerLanguage, acceptedFileTypes],
    );
    const handleSubmit = React.useCallback(
      (payload: PromptInputMessage) => {
        const hasText = Boolean(payload.text?.trim());
        const files = payload.files
          ?.map((f) => (f as unknown as { file?: File }).file)
          .filter(Boolean) as File[] | undefined;
        const hasFiles = Boolean(files && files.length > 0);
        if (!(hasText || hasFiles)) return;
        const text = payload.text?.trim() ?? '';
        setAttachmentNotice(null);
        if (isLoading) {
          queuedSeqRef.current += 1;
          const id = queuedSeqRef.current;
          setQueuedSends((prev) => [...prev, { id, text, ...(hasFiles ? { files } : {}) }]);
          return;
        }
        sendTyped(text, files);
      },
      [isLoading, sendTyped]
    );
    // The turn ended: send the oldest queued message. Its own turn holds the
    // rest until it ends too. On the next task, so a StrictMode effect re-run
    // (or a turn that restarts at once) cannot send it twice.
    React.useEffect(() => {
      if (isLoading || queuedSends.length === 0) return;
      const next = queuedSends[0];
      const timer = window.setTimeout(() => {
        setQueuedSends((prev) => (prev[0]?.id === next.id ? prev.slice(1) : prev));
        sendTyped(next.text, next.files);
      }, 0);
      return () => window.clearTimeout(timer);
    }, [isLoading, queuedSends, sendTyped]);
    const unqueueSend = React.useCallback(
      (id: number) => {
        const text = queuedSends.find((q) => q.id === id)?.text ?? '';
        setQueuedSends((prev) => prev.filter((q) => q.id !== id));
        // Back into the box, unless the user has typed something new there.
        const textarea = promptInputWrapRef.current?.querySelector('textarea');
        if (textarea && text && textarea.value.trim() === '') {
          textarea.value = text;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.focus();
        }
      },
      [queuedSends],
    );

    const handleSuggestionClick = React.useCallback(
      (text: string) => {
        // Not typed by the user — nothing to restore if this send is rejected
        // (see the send-failure effect below).
        lastSubmittedRef.current = '';
        onSendMessage?.(text);
        followThreadToBottom();
      },
      [onSendMessage, followThreadToBottom]
    );

    const promptInputWrapRef = React.useRef<HTMLDivElement>(null);

    // Restore the composer text when a send was REJECTED before reaching the
    // model (rate-limit / network — `notSent`). The composer's own form.reset
    // clears the box optimistically and the optimistic user bubble was rolled
    // back (useObjectChat), so without this the typed message would just vanish.
    // Runs once per failure and never clobbers text the user has since typed.
    React.useEffect(() => {
      if (!error || !isUnsentSendError(error)) return;
      if (restoredErrorRef.current === error) return;
      restoredErrorRef.current = error;
      // What is restored is what was NOT sent, never an older delivered prompt.
      // On its own the composer knows only text the user TYPED here:
      // `lastSubmittedRef` is written by `handleSubmit` alone and cleared by
      // every card-driven send (a suggestion chip), because those
      // send a canned message — leaving the ref stale refilled the composer
      // with the user's PREVIOUS prompt, a message that had already been
      // delivered and answered, reading as "resend this" (objectui#7253).
      // A host that held the message itself names it as `unsentText`
      // (objectstack#33562), and that text is restored too, whichever way it
      // was sent: what the composer last submitted may be only part of it,
      // and a suggestion chip's text the host held for a create that then
      // failed is the message that was not sent, not a stale one.
      const text = unsentText ?? lastSubmittedRef.current;
      if (!text) return;
      const textarea = promptInputWrapRef.current?.querySelector('textarea');
      if (textarea && textarea.value.trim() === '') {
        textarea.value = text;
        // Nudge the auto-grow sizing + any onInputChange listener.
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
      }
    }, [error, unsentText]);

    const handleCopy = React.useCallback((message: ChatbotEnhancedMessage) => {
      void navigator.clipboard?.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((prev) => (prev === message.id ? null : prev)), 1500);
    }, []);

    const toolDetailCtx: ToolDetailContext = {
      toolDecisions,
      onToolApprove,
      processVisibility,
      tt,
      L,
      toolStatusLabels,
      heldForApprovalLabel,
      toolApproveLabel,
      toolDenyLabel,
      toolDenyReason,
      sampleDataCleanupTitleLabel,
      sampleDataCleanupIrreversibleLabel,
      sampleDataCleanupEditedLabel,
      sampleDataCleanupAbsentLabel,
      packageRemovalTitleLabel,
      packageRemovalRowsLabel,
      packageRemovalDraftLabel,
      packageRemovalRowsUnknownLabel,
      packageRemovalItemTypeLabel,
      packageRemovalTotalLabel,
      packageRemovalUncountedLabel,
      packageRemovalPermanentLabel,
      packageRemovalKeptLabel,
      packageRemovalRemovedLabel,
      packageRemovalPartialLabel,
      detectPackageRemovedResult,
      recordWriteCreateTitle,
      recordWriteUpdateTitle,
      recordWriteDroppedLabel,
      recordWriteSubmittingLabel,
      recordWriteWrittenLabel,
      recordWriteCancelledLabel,
      recordWriteConfirmLabel,
      recordWriteOpenFormLabel,
      recordWriteOpenFormReason,
      recordWriteCancelLabel,
      recordWriteCancelReason,
      onOpenRecordForm,
      onOpenRecord,
      recordHandoffTitleLabel,
      recordHandoffOpenLabel,
    };

    return (
      <div
        ref={ref}
        className={cn(
          // The plain surface is a size container: its gutters follow the
          // width the chat is GIVEN (a ~420px dock or a full page), never the
          // viewport — see PLAIN_SURFACE_GUTTER.
          isPlainSurface
            ? '@container flex min-h-0 flex-col overflow-hidden bg-background'
            : 'flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background',
          className
        )}
        style={{ maxHeight }}
        {...props}
      >
        {onClear && !hideClearBar && messages.length > 0 && (
          <div
            className={cn(
              'flex items-center justify-end px-4 py-2',
              isPlainSurface ? 'bg-background' : 'border-b bg-muted/30',
            )}
          >
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {L.clear}
            </button>
          </div>
        )}

        {headerSlot ? (
          <div className={cn('shrink-0', !isPlainSurface && 'border-b bg-background/50')}>
            {headerSlot}
          </div>
        ) : null}

        <Conversation className="flex-1 min-h-0" contextRef={stickToBottomRef}>
          <ConversationContent
            className={cn(
              'space-y-4',
              isPlainSurface
                ? cn('mx-auto w-full max-w-2xl py-8', PLAIN_SURFACE_GUTTER)
                : 'px-4 py-3',
            )}
          >
            {messages.length === 0 ? (
              <ConversationEmptyState className="gap-3 px-0 py-8">
                <div className="flex size-9 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                  {assistantAvatarUrl ? (
                    <img
                      src={assistantAvatarUrl}
                      alt=""
                      className="size-full rounded-md object-cover"
                    />
                  ) : (
                    <Bot className="size-4" />
                  )}
                </div>
                <div className="w-full max-w-full space-y-1">
                  <h3 className="text-sm font-medium text-foreground/90 break-words">{L.emptyTitle}</h3>
                  <p className="text-sm text-muted-foreground break-words">
                    {L.emptyDescription}
                  </p>
                </div>
                {suggestions && suggestions.length > 0 ? (
                  <div className="flex w-full max-w-full flex-wrap justify-center gap-2">
                    {suggestions.map((s) => (
                      <Suggestion
                        key={s}
                        className="h-auto min-h-8 min-w-0 max-w-full whitespace-normal break-words rounded-full border-border/60 bg-background/80 px-3 py-1 text-left text-xs font-medium text-foreground/90 shadow-none hover:bg-muted/60"
                        suggestion={s}
                        onClick={handleSuggestionClick}
                      />
                    ))}
                  </div>
                ) : null}
              </ConversationEmptyState>
            ) : (
              messages.map((message) => {
                const isUser = message.role === 'user';
                // objectstack#30223 — the follow-up turn `useHitlInChat` sends
                // the model after 确认 / 取消 is not the person's words, so it
                // draws no bubble: live, after a reload, or on a shared
                // transcript. The model still received it.
                if (isUser && isHitlContinuation(message.content)) return null;
                const tools = message.toolInvocations ?? [];
                const reasoning = message.reasoning?.trim();
                const sources = message.sources ?? [];
                const summaryTools =
                  !isUser && processVisibility === 'summary'
                    ? tools.filter((tool) => !shouldRenderDetailedTool(tool))
                    : [];
                const detailedTools =
                  !isUser && processVisibility === 'debug'
                    ? tools
                    : !isUser && processVisibility !== 'debug'
                      ? tools.filter(shouldRenderDetailedTool)
                      : [];
                // Real, showable prose for this turn. Whitespace-only text and the
                // persisted "(called …)" tool-call placeholder are NOT visible
                // prose: the placeholder is a hydrated-history affordance (renders
                // as the quiet 执行过程 note only once the turn has ENDED), and a
                // lone whitespace part must never paint a blank bubble mid-stream.
                const hasVisibleProse =
                  !isUser &&
                  message.content.trim().length > 0 &&
                  !isToolCallPlaceholder(message.content);
                // Nothing is visible for this streaming turn yet → show the live
                // thinking indicator instead of dead air. Covers the ask-decline
                // wait (tool-call latency before `suggest_builder` lands): no
                // prose, no rendered tool row (summary chip / detailed card), no
                // shown reasoning (only surfaced in debug).
                const reasoningVisible = processVisibility === 'debug' && Boolean(reasoning);
                const isEmptyAssistantStreaming =
                  !isUser &&
                  Boolean(message.streaming) &&
                  !hasVisibleProse &&
                  summaryTools.length === 0 &&
                  detailedTools.length === 0 &&
                  !reasoningVisible;
                // objectui#10899 — does this turn already SHOW its activity (a
                // tool row, a build/design panel)? Then the quiet 执行过程 note
                // a hydrated tool-call placeholder turn falls back to says
                // nothing the row above it does not, and a reloaded multi-step
                // build printed it under every step. The note stays for a
                // placeholder turn with nothing else on screen (#772).
                const showsActivity =
                  summaryTools.length > 0 ||
                  detailedTools.length > 0;
                // objectui#13492 — the answer body in stream order; the
                // streaming cursor rides the last text run, where it sat when
                // the charts always trailed the text.
                const answerBlocks = isUser ? undefined : layoutAnswer(message.content, message.charts);
                let lastTextBlock = -1;
                answerBlocks?.forEach((block, i) => {
                  if (block.kind === 'text') lastTextBlock = i;
                });
                return (
                  <Message
                    key={message.id}
                    from={formatMessageProps(message.role)}
                    className={isPlainSurface && !isUser ? PLAIN_SURFACE_ASSISTANT_WIDTH : undefined}
                  >
                    <div
                      className={cn(
                        'flex w-full gap-2.5',
                        showAvatars
                          ? isUser
                            ? 'flex-row-reverse items-start'
                            : 'flex-row items-start'
                          : 'flex-col',
                      )}
                    >
                      {showAvatars ? (
                        <MessageAvatar
                          isUser={isUser}
                          url={isUser ? userAvatarUrl : assistantAvatarUrl}
                          fallback={isUser ? userAvatarFallback : assistantAvatarFallback}
                        />
                      ) : null}
                      <div
                        className={cn(
                          'flex min-w-0 flex-col gap-2',
                          showAvatars && !isUser && 'flex-1',
                        )}
                      >
                    <MessageContent>
                      {/* objectui#12724 — the phase line leads the turn, above
                          the design / build panel it summarizes. */}
                      {!isUser && processVisibility === 'summary' && summaryTools.length > 0 ? (
                        <ToolPhaseSummary
                          phaseKey={message.id}
                          streaming={Boolean(message.streaming)}
                          phaseTools={tools}
                          summaryTools={summaryTools}
                          translateToolTitle={tt}
                          labels={L}
                        />
                      ) : null}
                      {!isUser && processVisibility === 'debug' && reasoning ? (
                        <Reasoning
                          isStreaming={Boolean(message.streaming) && !message.content}
                          className="mb-2"
                        >
                          <ReasoningTrigger />
                          <ReasoningContent>{reasoning}</ReasoningContent>
                        </Reasoning>
                      ) : null}
                      {!isUser && detailedTools.length > 0
                        ? detailedTools.map((tool) => renderToolDetail(tool, toolDetailCtx))
                        : null}
                      {isUser ? (
                        message.content ? (
                          <div className="whitespace-pre-wrap break-words">
                            {message.content}
                          </div>
                        ) : null
                      ) : isEmptyAssistantStreaming ? (
                        <ThinkingDots />
                      ) : !hasVisibleProse &&
                        !message.streaming &&
                        !showsActivity &&
                        isToolCallPlaceholder(message.content) ? (
                        // #772: a re-hydrated tool-call-only turn is persisted with
                        // an internal placeholder ("(called todo_write,
                        // propose_blueprint)"); render a quiet localized activity
                        // note instead of leaking it as prose. Only once the turn
                        // has ENDED — mid-stream the live tool row / ThinkingDots
                        // carry the status, so the static note never flashes.
                        <span
                          className="text-xs italic text-muted-foreground/70"
                          title={message.content}
                        >
                          {L.agentActivity}
                        </span>
                      ) : null}
                      {answerBlocks ? (
                        // objectui#13492 — the answer's text and charts in
                        // stream order (see `layoutAnswer`). A turn with no
                        // showable prose still draws its charts here, so a
                        // chart drawn before the first word keeps its place
                        // (and its mounted chart) once the text arrives.
                        // objectui#13032 — a long answer folds only once its
                        // stream has ended; the streaming flag tells it when.
                        // objectui#13037 — a record link in the answer opens
                        // the record through the same host opener as the
                        // `open_record` card.
                        // objectstack#31869 — a list link the same way,
                        // through the host's list opener.
                        <RecordLinkContext.Provider value={onOpenRecord ?? null}>
                        <ListLinkContext.Provider value={onOpenList ?? null}>
                          {answerBlocks.map((block, i) =>
                            block.kind === 'charts' ? (
                              <AnswerCharts key={i} charts={block.charts} />
                            ) : hasVisibleProse ? (
                              <React.Fragment key={i}>
                                <MessageResponse isAnimating={Boolean(message.streaming)}>
                                  {block.text}
                                </MessageResponse>
                                {message.streaming && i === lastTextBlock ? (
                                  <span
                                    aria-hidden
                                    className="ml-0.5 inline-block w-[2px] h-4 align-middle bg-current animate-pulse"
                                  />
                                ) : null}
                              </React.Fragment>
                            ) : null,
                          )}
                        </ListLinkContext.Provider>
                        </RecordLinkContext.Provider>
                      ) : null}
                      {!isUser ? (
                        <AnswerSourceBlock
                          sources={tools.flatMap((tool) =>
                            tool.answerSource
                              ? [{ key: tool.toolCallId, source: tool.answerSource }]
                              : [],
                          )}
                        />
                      ) : null}
                      {/* ADR-0160 D9 — the records the answer rests on. */}
                      {!isUser && message.recordCitations ? (
                        <RecordCitations citations={message.recordCitations} onOpenRecord={onOpenRecord} />
                      ) : null}
                      {!isUser && sources.length > 0 ? (
                        <Sources>
                          <SourcesTrigger count={sources.length} />
                          <SourcesContent>
                            {sources.map((s, i) => (
                              <Source
                                key={s.id ?? s.url ?? i}
                                href={s.url}
                                title={s.title ?? s.url}
                              />
                            ))}
                          </SourcesContent>
                        </Sources>
                      ) : null}
                      {showTimestamp && message.timestamp ? (
                        <div className="text-[10px] opacity-70 mt-1">{message.timestamp}</div>
                      ) : null}
                    </MessageContent>
                    {/* objectui#10899 — the copy / regenerate bar acts on this
                        turn's PROSE. A prose-less turn (a hydrated tool step
                        whose only text is the "(called …)" placeholder) has
                        nothing to copy — Copy would hand the user the internal
                        placeholder — and the invisible bar still took its full
                        height, which is the blank gap a reloaded build showed
                        under every step. */}
                    {!isUser && !isEmptyAssistantStreaming && hasVisibleProse ? (
                      <MessageActions className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                        <MessageAction
                          label={copiedId === message.id ? L.copied : L.copy}
                          tooltip={copiedId === message.id ? L.copied : L.copy}
                          onClick={() => handleCopy(message)}
                        >
                          {copiedId === message.id ? (
                            <Check className="size-3.5" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </MessageAction>
                        {onReload ? (
                          <MessageAction
                            label={L.regenerate}
                            tooltip={L.regenerate}
                            onClick={onReload}
                          >
                            <RefreshCw className="size-3.5" />
                          </MessageAction>
                        ) : null}
                        {processVisibility === 'debug' && message.traceId ? (
                          <a
                            href={`#trace/${message.traceId}`}
                            data-trace-id={message.traceId}
                            className="text-[10px] text-muted-foreground hover:text-foreground ml-1 underline"
                            title={L.viewTrace}
                          >
                            {L.trace}
                          </a>
                        ) : null}
                      </MessageActions>
                    ) : null}
                      </div>
                    </div>
                  </Message>
                );
              })
            )}
            {isLoading && !messages.some((message) => message.streaming) ? (
              <AssistantThinkingMessage
                showAvatar={showAvatars}
                assistantAvatarUrl={assistantAvatarUrl}
                assistantAvatarFallback={assistantAvatarFallback}
                waitingLabel={L.connectionWaiting}
                stalledLabel={L.connectionStalledLabel}
                offlineLabel={L.connectionOfflineLabel}
              />
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {error ? (
          // A never-sent failure (rate-limit / network) gets a friendly "your
          // message is kept" notice — the input was restored above, so a
          // "Response failed / Retry" banner (which regenerates the wrong turn
          // after rollback) would mislead. Quota 429s still use ErrorBanner so
          // its upgrade / top-up CTA shows; mid-stream failures keep Retry.
          isUnsentSendError(error) && !parseAiQuotaError(error) ? (
            <SendErrorNotice
              error={error}
              rateLimitedLabel={L.sendFailedRateLimited}
              genericLabel={L.sendFailedGeneric}
            />
          ) : (
            <ErrorBanner error={error} onReload={onReload} onUpgrade={onUpgrade} />
          )
        ) : null}

        {attachmentNotice && !readOnly ? (
          <ComposerNotice
            text={attachmentNotice}
            testId="chat-attachment-refused"
            closeLabel={tt('common.close', 'Close')}
            onClose={() => setAttachmentNotice(null)}
          />
        ) : null}

        {readOnly ? null : (
        <div
          ref={promptInputWrapRef}
          className={cn(
            'relative',
            isPlainSurface && cn('mx-auto w-full max-w-2xl pb-4', PLAIN_SURFACE_GUTTER),
          )}
        >
          {/* objectui#12978 — in flow, so it pushes the conversation up instead
              of covering the input; `empty:hidden` keeps a slot whose content
              renders nothing from leaving a gap above the input. */}
          {promptHeaderSlot ? (
            <div className="mb-2 flex empty:hidden" data-testid="prompt-header-slot">
              {promptHeaderSlot}
            </div>
          ) : null}
          {promptOverlaySlot ? (
            <div className="absolute bottom-full left-0 right-0 z-10 px-3 pb-1">
              {promptOverlaySlot}
            </div>
          ) : null}
          {queuedSends.length > 0 ? (
            <div className="mb-2 flex flex-col gap-1" data-testid="composer-queued">
              {queuedSends.map((q) => (
                <div
                  key={q.id}
                  className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 px-2.5 py-1.5 text-xs"
                  data-testid="composer-queued-item"
                  role="status"
                >
                  <Clock3 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[11px] font-medium text-muted-foreground">{queuedLabel}</span>
                    <span className="whitespace-pre-wrap break-words text-foreground/90">{q.text}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => unqueueSend(q.id)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    data-testid="composer-queued-cancel"
                  >
                    {queuedCancelLabel}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <PromptInput
            accept={acceptedFileTypes}
            fileInputLabel={L.uploadFiles}
            maxFileSize={maxFileSize}
            onSubmit={handleSubmit}
            onError={handlePromptInputError}
          >
            {/* objectstack#35445 — the page in view sits on the input's top
                edge, inside its frame: it belongs to what the next message
                carries, and it never lies over the conversation. */}
            {/* objectstack#37861 — the host's own context row takes that
                place, at the start of the line inside the frame. */}
            {promptInputHeaderSlot ? (
              <PromptInputHeader className="px-3 pt-2 pb-0" data-testid="prompt-input-header-slot">
                {promptInputHeaderSlot}
              </PromptInputHeader>
            ) : surfaceContextLabel ? (
              <PromptInputHeader className="px-3 pt-2 pb-0" data-testid="surface-context-chip">
                <span
                  className="inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                  title={surfaceContextTitle}
                >
                  {surfaceContextLabel}
                </span>
              </PromptInputHeader>
            ) : null}
            {enableFileUpload ? (
              <PromptInputBody>
                <PromptInputAttachments>
                  {(attachment) => <PromptInputAttachment data={attachment} removeLabel={L.removeAttachment} />}
                </PromptInputAttachments>
              </PromptInputBody>
            ) : null}
            <PromptInputTextarea
              placeholder={placeholder}
              // objectstack#32984 — live during a turn: Enter queues (see
              // `queuedSends`) instead of going nowhere.
              disabled={disabled}
              onChange={
                onInputChange
                  ? (e) => onInputChange(e.currentTarget.value)
                  : undefined
              }
            />
            <PromptInputFooter>
              <PromptInputTools className="min-w-0">
                {enableFileUpload ? (
                  <PromptInputActionMenu>
                    <PromptInputActionMenuTrigger
                      aria-label={L.addAttachment}
                      title={L.addAttachment}
                      data-testid="composer-add-attachment"
                    />
                    <PromptInputActionMenuContent>
                      <PromptInputActionAddAttachments label={L.addAttachment} />
                    </PromptInputActionMenuContent>
                  </PromptInputActionMenu>
                ) : null}
                {/* Only a real CHOICE warrants a picker: free / single-model
                    envs (the backend returns one entry) get no dropdown — the
                    lone model is still sent via `selectedModelId`. */}
                {models && models.length > 1 ? (
                  <ModelPicker
                    label={L.model}
                    models={models}
                    value={selectedModelId ?? models[0].id}
                    onPick={(modelId) => onModelChange?.(modelId)}
                    allowanceUsedFraction={allowanceUsedFraction}
                  />
                ) : null}
                {/* #2458 UX#7 — the composer sends on PLAIN Enter (Shift+Enter =
                    newline); the old `⌘` glyph implied Cmd+Enter and misled users.
                    Show the real keys. */}
                {/* objectstack#35445 — one line: the hint never wraps, it gives way
                    (shrink-0 keeps it whole) and the model picker truncates. */}
                <span
                  className="hidden shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-muted-foreground sm:inline-flex"
                  aria-hidden="true"
                  data-testid="composer-key-hint"
                >
                  <CornerDownLeft className="h-3 w-3" />
                  <span className="opacity-70">{L.sendHint}</span>
                  {L.newlineHint ? (
                    <>
                      <span className="opacity-40">·</span>
                      <span className="opacity-70">Shift+</span>
                      <CornerDownLeft className="h-3 w-3" />
                      <span className="opacity-70" data-testid="composer-newline-hint">
                        {L.newlineHint}
                      </span>
                    </>
                  ) : null}
                </span>
              </PromptInputTools>
              <PromptInputSubmit
                aria-label={promptStatus === 'streaming' ? L.stopResponse : L.submit}
                status={promptStatus}
                disabled={disabled}
                onClick={promptStatus === 'streaming' ? onStop : undefined}
                type={promptStatus === 'streaming' ? 'button' : 'submit'}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
        )}

      </div>
    );
  }
);

ChatbotEnhanced.displayName = 'ChatbotEnhanced';

export { ChatbotEnhanced };
