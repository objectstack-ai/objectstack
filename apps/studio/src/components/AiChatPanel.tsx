// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import {
  Bot, X, Send, Trash2, Sparkles,
  Wrench, CheckCircle2, XCircle, Loader2, ShieldAlert,
  ChevronDown, ChevronRight, Brain, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAiChatPanel, loadMessages, saveMessages } from '@/hooks/use-ai-chat-panel';
import { useAssistantContext } from '@/hooks/use-assistant-context';
import { useAssistantResolution, STUDIO_AGENT, type SkillSummary } from '@/hooks/use-assistant-skills';
import { getApiBaseUrl } from '@/lib/config';

const PANEL_WIDTH = 380;
const COLLAPSED_WIDTH = 48;

/** Endpoint used for the Universal Assistant ambient chat. */
export const ASSISTANT_CHAT_PATH = '/api/v1/ai/assistant/chat';

/** localStorage key for the most-recent forced skill (slash command). */
export const SKILL_OVERRIDE_KEY = 'objectstack:ai-chat-skill';

/**
 * Track active thinking/reasoning state during streaming.
 */
interface ThinkingState {
  reasoning: string[];
  activeSteps: Map<string, { stepName: string; startedAt: number }>;
  completedSteps: string[];
}

/**
 * Extract the text content from a UIMessage's parts array.
 */
function getMessageText(msg: UIMessage): string {
  return (msg.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/**
 * Convert a snake_case tool name to a human-readable label.
 */
function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Render a concise summary of tool input arguments.
 */
function formatToolArgs(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .slice(0, 4)
    .map(([k, v]) => {
      let val: string;
      try {
        val = typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v));
      } catch {
        val = String(v);
      }
      const display = val.length > 30 ? val.slice(0, 30) + '…' : val;
      return `${k}: ${display}`;
    })
    .join(', ');
}

/**
 * Type guard to check if a message part is a tool invocation (dynamic-tool).
 */
function isToolPart(part: UIMessage['parts'][number]): part is Extract<UIMessage['parts'][number], { type: 'dynamic-tool' }> {
  return part.type === 'dynamic-tool';
}

/**
 * Format tool output for display, truncating to a max length.
 */
function formatToolOutput(output: unknown, maxLen = 80): string {
  let raw: string;
  try {
    raw = typeof output === 'string' ? output : (JSON.stringify(output) ?? '');
  } catch {
    raw = String(output ?? '');
  }
  return raw.length > maxLen ? raw.slice(0, maxLen) + '…' : raw;
}

/**
 * Build the Universal Assistant chat URL.
 * @internal — exported for testing
 */
export function chatApiUrl(baseUrl: string): string {
  return `${baseUrl}${ASSISTANT_CHAT_PATH}`;
}

/**
 * Load the persisted slash-command skill override (if any).
 * @internal — exported for testing
 */
export function loadSkillOverride(): string | null {
  try {
    return localStorage.getItem(SKILL_OVERRIDE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist a slash-command skill override.
 * @internal — exported for testing
 */
export function saveSkillOverride(skill: string | null): void {
  try {
    if (skill) localStorage.setItem(SKILL_OVERRIDE_KEY, skill);
    else localStorage.removeItem(SKILL_OVERRIDE_KEY);
  } catch {
    // silently ignore
  }
}

/**
 * Parse a slash-command from the input. Returns the skill name if the
 * input begins with `/<skill>` followed by whitespace or end-of-input.
 */
function parseSlashCommand(text: string): { skill: string; rest: string } | null {
  const m = /^\/([a-z][a-z0-9_]*)(?:\s+(.*))?$/is.exec(text.trim());
  if (!m) return null;
  return { skill: m[1].toLowerCase(), rest: (m[2] ?? '').trim() };
}

// ── Tool Invocation State Labels ────────────────────────────────────

/**
 * Display reasoning/thinking information in a collapsible section.
 */
interface ReasoningDisplayProps {
  reasoning: string[];
}

function ReasoningDisplay({ reasoning }: ReasoningDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (reasoning.length === 0) return null;

  return (
    <div
      data-testid="reasoning-display"
      className="flex flex-col gap-1 rounded-md border border-border/30 bg-muted/30 px-2.5 py-2 text-xs"
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-left text-muted-foreground hover:text-foreground transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Brain className="h-3 w-3 shrink-0" />
        <span className="font-medium">Thinking</span>
        <span className="text-[10px] opacity-60">
          ({reasoning.length} step{reasoning.length !== 1 ? 's' : ''})
        </span>
      </button>
      {isExpanded && (
        <div className="mt-1 space-y-1 pl-5 text-muted-foreground italic border-l-2 border-border/30">
          {reasoning.map((step, idx) => (
            <p key={idx} className="text-[11px] leading-relaxed">
              {step}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Display active step progress indicators.
 */
interface StepProgressProps {
  activeSteps: Map<string, { stepName: string; startedAt: number }>;
  completedSteps: string[];
}

function StepProgress({ activeSteps, completedSteps }: StepProgressProps) {
  if (activeSteps.size === 0) return null;

  const totalSteps = completedSteps.length + activeSteps.size;
  const currentStep = completedSteps.length + 1;

  return (
    <div
      data-testid="step-progress"
      className="flex flex-col gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/5 px-2.5 py-2 text-xs"
    >
      <div className="flex items-center gap-2">
        <Zap className="h-3 w-3 shrink-0 text-blue-600 dark:text-blue-400" />
        <span className="font-medium text-blue-700 dark:text-blue-300">
          Step {currentStep} of {totalSteps}
        </span>
      </div>
      {Array.from(activeSteps.values()).map((step, idx) => (
        <div key={idx} className="flex items-center gap-2 pl-5">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
          <span className="text-blue-700 dark:text-blue-300">{step.stepName}</span>
        </div>
      ))}
    </div>
  );
}

// ── Tool Invocation State Labels ────────────────────────────────────

interface ToolInvocationDisplayProps {
  part: Extract<UIMessage['parts'][number], { type: 'dynamic-tool' }>;
  onApprove?: (approvalId: string) => void;
  onDeny?: (approvalId: string) => void;
}

/**
 * Renders a single tool invocation part with appropriate status indicator.
 */
function ToolInvocationDisplay({ part, onApprove, onDeny }: ToolInvocationDisplayProps) {
  const toolLabel = formatToolName(part.toolName);
  const argsText = formatToolArgs(part.input);

  switch (part.state) {
    case 'input-streaming':
      return (
        <div
          data-testid="tool-invocation-planning"
          className="flex items-start gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-2.5 py-2 text-xs"
        >
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
          <div className="min-w-0">
            <span className="font-medium text-blue-700 dark:text-blue-300">Planning to call {toolLabel}</span>
            {argsText && (
              <p className="mt-0.5 truncate text-blue-600/80 dark:text-blue-300/80">{argsText}</p>
            )}
          </div>
        </div>
      );

    case 'input-available':
      return (
        <div
          data-testid="tool-invocation-calling"
          className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/50 px-2.5 py-2 text-xs"
        >
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          <div className="min-w-0">
            <span className="font-medium">Calling {toolLabel}</span>
            {argsText && (
              <p className="mt-0.5 truncate text-muted-foreground">{argsText}</p>
            )}
          </div>
        </div>
      );

    case 'approval-requested':
      return (
        <div
          data-testid="tool-invocation-confirm"
          className="flex flex-col gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-2 text-xs"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <div className="min-w-0">
              <span className="font-medium">Confirm: {toolLabel}</span>
              {argsText && (
                <p className="mt-0.5 text-muted-foreground">{argsText}</p>
              )}
            </div>
          </div>
          {part.approval && onApprove && onDeny && (
            <div className="flex gap-2 pl-5">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => onApprove(part.approval!.id)}
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => onDeny(part.approval!.id)}
              >
                <XCircle className="mr-1 h-3 w-3" />
                Deny
              </Button>
            </div>
          )}
        </div>
      );

    case 'output-available':
      return (
        <div
          data-testid="tool-invocation-result"
          className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-2.5 py-2 text-xs"
        >
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
          <div className="min-w-0">
            <span className="font-medium">{toolLabel}</span>
            <p className="mt-0.5 text-muted-foreground truncate">
              {formatToolOutput(part.output)}
            </p>
          </div>
        </div>
      );

    case 'output-error':
      return (
        <div
          data-testid="tool-invocation-error"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs"
        >
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <span className="font-medium">{toolLabel} failed</span>
            <p className="mt-0.5 text-destructive/80">{part.errorText}</p>
          </div>
        </div>
      );

    case 'output-denied':
      return (
        <div
          data-testid="tool-invocation-denied"
          className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/50 px-2.5 py-2 text-xs"
        >
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium text-muted-foreground">{toolLabel} — denied</span>
        </div>
      );

    default:
      return (
        <div
          data-testid="tool-invocation-unknown"
          className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/50 px-2.5 py-2 text-xs"
        >
          <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium">{toolLabel}</span>
        </div>
      );
  }
}

export function AiChatPanel() {
  const { isOpen, setOpen, toggle } = useAiChatPanel();
  const [input, setInput] = useState('');
  const [skillOverride, setSkillOverride] = useState<string | null>(loadSkillOverride);
  const [showPalette, setShowPalette] = useState(false);
  const [thinkingState, setThinkingState] = useState<ThinkingState>({
    reasoning: [],
    activeSteps: new Map(),
    completedSteps: [],
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const baseUrl = getApiBaseUrl();

  // Universal Assistant context derived from the current Studio route.
  const context = useAssistantContext();
  const { agent: resolvedAgent, skills: activeSkills, loading: assistantLoading } =
    useAssistantResolution(context);

  const initialMessages = useMemo(() => loadMessages() as UIMessage[], []);

  // Single chat entry point — no agent picker. Context + optional
  // skill override are injected per-request via prepareSendMessagesRequest.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: chatApiUrl(baseUrl),
        credentials: 'include',
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...body,
            messages,
            context,
            agent: STUDIO_AGENT,
            ...(skillOverride ? { skill: skillOverride } : {}),
          },
        }),
      }),
    [baseUrl, context, skillOverride],
  );

  const { messages, sendMessage, setMessages, status, error, addToolApprovalResponse } = useChat({
    transport,
    messages: initialMessages,
    onFinish: () => {
      // Reset thinking state when stream completes
      setThinkingState({
        reasoning: [],
        activeSteps: new Map(),
        completedSteps: [],
      });
    },
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

  // Extract reasoning and step progress from the latest assistant message parts
  useEffect(() => {
    if (!isStreaming || messages.length === 0) return;

    // Get the latest message
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant') return;

    // Process message parts for reasoning and steps
    const reasoning: string[] = [];
    const activeSteps = new Map<string, { stepName: string; startedAt: number }>();
    const completedSteps: string[] = [];

    (lastMessage.parts || []).forEach((part: any) => {
      if (part.type === 'reasoning-delta' || part.type === 'reasoning') {
        reasoning.push(part.text);
      } else if (part.type === 'step-start') {
        activeSteps.set(part.stepId, {
          stepName: part.stepName,
          startedAt: Date.now(),
        });
      } else if (part.type === 'step-finish') {
        completedSteps.push(part.stepName);
      }
    });

    setThinkingState({ reasoning, activeSteps, completedSteps });
  }, [messages, isStreaming]);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(messages);
    }
  }, [messages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const clearHistory = () => {
    setMessages([]);
    saveMessages([]);
  };

  const clearSkillOverride = useCallback(() => {
    setSkillOverride(null);
    saveSkillOverride(null);
  }, []);

  const applySkillOverride = useCallback((skillName: string) => {
    setSkillOverride(skillName);
    saveSkillOverride(skillName);
    setShowPalette(false);
    inputRef.current?.focus();
  }, []);

  // Filter palette suggestions on the partial slash command.
  const slashQuery = input.startsWith('/') ? input.slice(1).toLowerCase() : '';
  const filteredSkills: SkillSummary[] = useMemo(() => {
    if (!showPalette) return [];
    return activeSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(slashQuery) ||
        s.label.toLowerCase().includes(slashQuery),
    );
  }, [activeSkills, slashQuery, showPalette]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    // Slash command: `/skill_name [optional message]`
    const slash = parseSlashCommand(text);
    if (slash) {
      // Validate against active skills; silently fall back to free chat
      // if the user typed an unknown skill.
      const known = activeSkills.find((s) => s.name === slash.skill);
      if (known) {
        applySkillOverride(known.name);
        if (!slash.rest) {
          // Just `/skill_name` with no payload — keep the input cleared
          // so the user can compose the actual prompt next.
          setInput('');
          return;
        }
        setInput('');
        setShowPalette(false);
        sendMessage({ text: slash.rest });
        return;
      }
    }

    setInput('');
    setShowPalette(false);
    sendMessage({ text });
  };

  // Handle Enter to submit, Shift+Enter for newline; Escape closes palette.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && showPalette) {
      e.preventDefault();
      setShowPalette(false);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    setShowPalette(value.startsWith('/'));
  };

  // ── Collapsed: no floating button. Toggle lives in the topbar
  //    (see StudioShell rightSlot). Keeps the canvas free of overlays.
  if (!isOpen) {
    return null;
  }

  // ── Expanded panel ──
  return (
    <aside
      data-testid="ai-chat-panel"
      className={cn(
        'fixed right-0 top-0 z-50 h-full',
        'flex flex-col border-l border-border',
        'bg-background shadow-xl',
        'animate-in slide-in-from-right duration-200',
      )}
      style={{ width: PANEL_WIDTH }}
    >
      {/* ── Header ── */}
      <div className="shrink-0 border-b">
        <div className="flex h-12 items-center justify-between px-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="h-4 w-4 text-primary" />
            AI Chat
          </div>
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearHistory}>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">Clear chat</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Clear history</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </div>
        {/* ── Universal Assistant status row ── */}
        <div className="px-3 pb-2" data-testid="assistant-status">
          {assistantLoading ? (
            <div className="flex h-7 items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Resolving assistant…
            </div>
          ) : resolvedAgent ? (
            <div className="flex h-7 items-center gap-1.5 overflow-hidden text-xs">
              <Bot className="h-3 w-3 shrink-0 text-primary" />
              <span className="font-medium" data-testid="assistant-agent-label">
                {resolvedAgent.label}
              </span>
              {activeSkills.length > 0 && (
                <span
                  className="truncate text-muted-foreground"
                  data-testid="assistant-active-skills"
                  title={activeSkills.map((s) => s.label).join(', ')}
                >
                  · {activeSkills.length} skill{activeSkills.length === 1 ? '' : 's'}
                </span>
              )}
              {skillOverride && (
                <span
                  className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary"
                  data-testid="assistant-skill-override"
                >
                  /{skillOverride}
                  <button
                    onClick={clearSkillOverride}
                    className="hover:text-primary/70"
                    aria-label="Clear skill override"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}
            </div>
          ) : (
            <div className="flex h-7 items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldAlert className="h-3 w-3" />
              No assistant available
            </div>
          )}
        </div>
      </div>

      {/* ── Messages ── */}
      <ScrollArea className="flex-1 overflow-hidden">
        <div ref={scrollRef} className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
          {messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <Sparkles className="h-8 w-8 opacity-40" />
              <p className="text-sm">Ask anything about your project.</p>
              <p className="text-xs opacity-60">
                <kbd>⌘⇧I</kbd> to toggle this panel
              </p>
            </div>
          )}
          {messages.map((msg) => {
            const text = getMessageText(msg);
            const toolParts = (msg.parts ?? []).filter(isToolPart);
            const hasContent = !!text || toolParts.length > 0;
            if (!hasContent && msg.role !== 'user') return null;
            return (
              <div
                key={msg.id}
                className={cn(
                  'flex flex-col gap-1.5 rounded-lg px-3 py-2 text-sm',
                  msg.role === 'user'
                    ? 'ml-8 bg-primary text-primary-foreground'
                    : 'mr-8 bg-muted text-foreground',
                )}
              >
                <span className="text-[10px] font-medium opacity-60 uppercase">
                  {msg.role === 'user' ? 'You' : 'Assistant'}
                </span>
                {text && <div className="whitespace-pre-wrap break-words">{text}</div>}
                {toolParts.map((toolPart) => (
                  <ToolInvocationDisplay
                    key={toolPart.toolCallId}
                    part={toolPart}
                    onApprove={(approvalId) =>
                      addToolApprovalResponse({ id: approvalId, approved: true })
                    }
                    onDeny={(approvalId) =>
                      addToolApprovalResponse({
                        id: approvalId,
                        approved: false,
                        reason: 'User denied the operation',
                      })
                    }
                  />
                ))}
              </div>
            );
          })}
          {isStreaming && (
            <>
              {/* Show reasoning if available */}
              {thinkingState.reasoning.length > 0 && (
                <div className="mr-8">
                  <ReasoningDisplay reasoning={thinkingState.reasoning} />
                </div>
              )}
              {/* Show step progress if available */}
              {thinkingState.activeSteps.size > 0 && (
                <div className="mr-8">
                  <StepProgress
                    activeSteps={thinkingState.activeSteps}
                    completedSteps={thinkingState.completedSteps}
                  />
                </div>
              )}
              {/* Default thinking indicator when no detailed state available */}
              {thinkingState.reasoning.length === 0 && thinkingState.activeSteps.size === 0 && (
                <div className="mr-8 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                  Thinking…
                </div>
              )}
            </>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Chat Error</p>
                <p className="mt-0.5 text-xs opacity-80">
                  {error.message || 'Something went wrong'}
                </p>
                {error.message && /unexpected|json|parse|stream/i.test(error.message) && (
                  <p className="mt-1 text-xs opacity-70">
                    The server may not be returning the expected Vercel AI Data Stream format.
                    Ensure the backend endpoint supports SSE streaming.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* ── Input ── */}
      <div className="shrink-0 border-t p-3 relative">
        {/* ── Slash command palette ── */}
        {showPalette && (
          <div
            data-testid="skill-palette"
            className="absolute bottom-full left-3 right-3 mb-1 max-h-56 overflow-auto rounded-md border border-border bg-popover shadow-lg"
          >
            {filteredSkills.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No matching skills for the current context.
              </div>
            ) : (
              filteredSkills.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  data-testid={`skill-palette-item-${s.name}`}
                  onClick={() => applySkillOverride(s.name)}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-border/50 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-accent"
                >
                  <span className="font-medium">/{s.name}</span>
                  <span className="text-muted-foreground">{s.label}</span>
                  {s.description && (
                    <span className="line-clamp-2 text-[10px] opacity-70">{s.description}</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            data-testid="ai-chat-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={skillOverride ? `Ask /${skillOverride}…` : 'Ask AI… (type / for skills)'}
            rows={1}
            className={cn(
              'flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm',
              'placeholder:text-muted-foreground',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              'max-h-32 min-h-[36px]',
            )}
          />
          <Button
            type="button"
            size="icon"
            className="h-9 w-9 shrink-0"
            disabled={!input.trim() || isStreaming}
            onClick={handleSend}
          >
            <Send className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </div>
    </aside>
  );
}
