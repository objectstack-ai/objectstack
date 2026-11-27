/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Tool-call summaries: tool state and its ranking, the phase summary and its
 * elapsed clock, the activity summary, and the tool output renderer.
 */
import * as React from 'react';
import { cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { Clock3, CheckCircle2, ChevronDown, XCircle, WifiOff } from 'lucide-react';
import { humanizeToolName, type ToolTitleTranslator } from '../tool-display';
import { MessageResponse } from '../elements/message';
import { ToolOutput } from '../elements/tool';
import type { ChatbotEnhancedToolInvocation } from './types';
import { formatElapsed, useIsOffline } from './liveness';

/**
 * Heuristic: does a tool/output string look like JSON we should syntax-highlight
 * (object / array literal) rather than render as markdown? Plain prose, code
 * fences, and inline backticks should NOT be rendered as JSON.
 */
function looksLikeJson(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  if (!(t.endsWith('}') || t.endsWith(']'))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

type ToolSummaryState = 'running' | 'awaiting' | 'completed' | 'failed';

interface ToolSummaryGroup {
  key: string;
  title: string;
  rawName: string;
  count: number;
  state: ToolSummaryState;
  errorText?: string;
}

export function getToolState(tool: ChatbotEnhancedToolInvocation): ToolSummaryState {
  const state =
    tool.state ??
    (tool.errorText
      ? 'output-error'
      : tool.result !== undefined
        ? 'output-available'
        : 'input-available');

  if (state === 'output-error' || state === 'output-denied') {
    return 'failed';
  }
  if (state === 'approval-requested' || state === 'approval-responded') {
    return 'awaiting';
  }
  if (state === 'output-available') {
    return 'completed';
  }
  return 'running';
}

export function shouldRenderDetailedTool(tool: ChatbotEnhancedToolInvocation): boolean {
  const state = getToolState(tool);
  return (
    state === 'awaiting' ||
    state === 'failed' ||
    Boolean(tool.pendingActionId) ||
    Boolean(tool.recordHandoff)
  );
}

function getToolStateRank(state: ToolSummaryState): number {
  switch (state) {
    case 'failed':
      return 4;
    case 'awaiting':
      return 3;
    case 'running':
      return 2;
    case 'completed':
      return 1;
  }
}

function summarizeTools(
  tools: ChatbotEnhancedToolInvocation[],
  /**
   * objectui#7254 — the activity chips name the same tools the detailed cards
   * do, so they take the same `chatbot.tool.*` lookup. Optional so a
   * provider-less caller keeps the English title-caser it always had.
   */
  translateToolTitle?: ToolTitleTranslator,
): ToolSummaryGroup[] {
  const groups = new Map<string, ToolSummaryGroup>();

  for (const tool of tools) {
    const state = getToolState(tool);
    const key = `${tool.toolName}:${state}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.errorText = existing.errorText ?? tool.errorText;
      continue;
    }
    groups.set(key, {
      key,
      title: humanizeToolName(tool.toolName, translateToolTitle) || tool.toolName,
      rawName: tool.toolName,
      count: 1,
      state,
      errorText: tool.errorText,
    });
  }

  return Array.from(groups.values()).sort((a, b) => {
    const byRank = getToolStateRank(b.state) - getToolStateRank(a.state);
    if (byRank !== 0) return byRank;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Compact elapsed-timer + offline cue for a tool that is currently RUNNING
 * (issue #432) — e.g. the "Propose blueprint · Running" header. Counts up from
 * when the running card mounts so a long tool call (a blueprint can take tens of
 * seconds) shows a visible "倒计时" instead of a static "Running", and flips to a
 * red offline cue the moment the browser loses the network. Unlike the
 * stream-liveness indicator it never escalates to amber on quiet — a running
 * tool legitimately produces no client bytes while the server works.
 */
export function ToolRunningTimer({ offlineLabel }: { offlineLabel: string }) {
  const [elapsed, setElapsed] = React.useState(0);
  const offline = useIsOffline();
  React.useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs tabular-nums',
        offline ? 'text-red-600 font-medium' : 'text-muted-foreground',
      )}
      aria-live="polite"
      data-tool-running-timer
    >
      {offline ? (
        <WifiOff className="size-3 shrink-0" aria-hidden />
      ) : (
        <Clock3 className="size-3 shrink-0" aria-hidden />
      )}
      <span>{formatElapsed(elapsed)}</span>
      {offline ? <span>· {offlineLabel}</span> : null}
    </span>
  );
}

/**
 * objectui#12724 — one step of a phase's collapsed line: a tool, folded over
 * every call of it in the turn, in the order the turn first called it.
 */
interface ToolPhaseStep {
  title: string;
  count: number;
}

/**
 * objectui#13038 — tools that are the agent's own plumbing, not a step the user
 * asked for: the phase line neither shows nor counts them. `load_tools` attaches
 * a deferred tool family to the build agent's call; on build every data question
 * pays one, so it read as "Load more tools" among the steps and inflated the count.
 *
 * A client list because nothing declares the role: the tool definition carries
 * only name, label, description and parameters, and the stream's tool part
 * carries no marker either. Module-private on purpose — it is this line's
 * presentation rule, not a contract another surface may read.
 */
const PLUMBING_TOOL_NAMES: ReadonlySet<string> = new Set(['load_tools']);

function isPlumbingTool(tool: ChatbotEnhancedToolInvocation): boolean {
  return PLUMBING_TOOL_NAMES.has(tool.toolName);
}

/** Fold a turn's tool calls into one step per tool, in first-call order. */
function foldToolPhaseSteps(
  tools: ChatbotEnhancedToolInvocation[],
  translateToolTitle?: ToolTitleTranslator,
): ToolPhaseStep[] {
  const steps = new Map<string, ToolPhaseStep>();
  for (const tool of tools) {
    if (isPlumbingTool(tool)) continue;
    const step = steps.get(tool.toolName);
    if (step) step.count += 1;
    else
      steps.set(tool.toolName, {
        title: humanizeToolName(tool.toolName, translateToolTitle) || tool.toolName,
        count: 1,
      });
  }
  return [...steps.values()];
}

/**
 * Wall-clock span of each phase, keyed by its message id. Measured here, while
 * the turn streams, because no producer persists a duration: a turn reopened
 * from history has no entry, and its line simply omits the time. Module-scoped
 * so a pane remount mid-turn keeps the clock it started.
 */
const phaseClock = new Map<string, { start: number; end?: number }>();

function usePhaseElapsed(key: string, running: boolean): number | undefined {
  // The clock is read in effects only (render stays pure); `now` is the last
  // reading, refreshed once a second while the phase runs.
  const [now, setNow] = React.useState<number | undefined>(undefined);
  React.useEffect(() => {
    if (!running) {
      const entry = phaseClock.get(key);
      if (entry && entry.end === undefined) entry.end = Date.now();
      setNow(Date.now());
      return undefined;
    }
    const entry = phaseClock.get(key);
    if (!entry) phaseClock.set(key, { start: Date.now() });
    else entry.end = undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [key, running]);
  const entry = phaseClock.get(key);
  if (!entry || now === undefined) return undefined;
  return Math.max(0, Math.floor(((entry.end ?? now) - entry.start) / 1000));
}

/**
 * objectui#12724 — a turn's tool activity as ONE collapsed line per phase
 * (「设计方案 · 4 步 · 0:48 · 读取编写规范 · 列出对象 ×3 …」), with a chevron
 * that expands the per-tool rows (`ToolActivitySummary`). Repeated calls of a
 * tool fold into one step with a count. The line opens on its step count. The rows open on their
 * own while a step runs, waits or failed, so a live timer or an error is never
 * hidden behind the chevron; the user's own toggle wins after that.
 */
export function ToolPhaseSummary({
  phaseKey,
  streaming,
  phaseTools,
  summaryTools,
  translateToolTitle,
  labels,
}: {
  phaseKey: string;
  streaming: boolean;
  /** Every tool the turn called — the phase's name, steps and state. */
  phaseTools: ChatbotEnhancedToolInvocation[];
  /** The tools the summary strip shows — the expanded rows. */
  summaryTools: ChatbotEnhancedToolInvocation[];
  translateToolTitle?: ToolTitleTranslator;
  labels: ToolActivitySummaryLabels;
}) {
  const { t } = useObjectTranslation();
  // The line's steps speak for the whole turn — every tool it called,
  // including the ones that render their own card below (the plan, a draft, an
  // approval) — while its state and the expanded rows are the summary strip's:
  // a step that waits on the user already says so on its own card (the plan's
  // 等待确认), so it does not hold the line open. A turn whose every tool has
  // its own card draws no line (the host gates on the summary strip), so a lone
  // card is never named twice.
  // A plumbing call (objectui#13038) is no step of the user's: it leaves the
  // expanded rows as well as the line, so it is shown nowhere in the phase.
  const groups = summarizeTools(
    summaryTools.filter((tool) => !isPlumbingTool(tool)),
    translateToolTitle,
  );
  const steps = foldToolPhaseSteps(phaseTools, translateToolTitle);
  const has = (state: ToolSummaryState) => groups.some((g) => g.state === state);
  const lineState: ToolSummaryState = has('failed')
    ? 'failed'
    : has('awaiting')
      ? 'awaiting'
      : has('running')
        ? 'running'
        : 'completed';
  const [toggled, setToggled] = React.useState<boolean | null>(null);
  const expanded = toggled ?? lineState !== 'completed';
  const elapsed = usePhaseElapsed(phaseKey, streaming || lineState === 'running');
  const headline = [
    t('chatbot.phase.stepCount', { count: steps.length, defaultValue: '{{count}} steps' }),
    ...(elapsed !== undefined ? [formatElapsed(elapsed)] : []),
  ].join(' · ');
  const stepText = steps
    .map((step) => (step.count > 1 ? `${step.title} ×${step.count}` : step.title))
    .join(' · ');
  // The host draws this line only when the summary strip has a row; with the
  // plumbing gone that gate is re-read here. A phase that so far called only
  // plumbing (or plumbing beside tools with their own card) draws no line,
  // rather than "0 steps" over an empty step list or a lone card named twice.
  // Hooks above still ran, so the phase clock started with the turn.
  if (groups.length === 0) return null;
  return (
    <div className="not-prose mb-2" data-testid="tool-phase">
      <div
        className="flex min-h-6 min-w-0 items-center gap-2 text-xs text-muted-foreground"
        data-testid="tool-phase-line"
      >
        <ToolSummaryIcon state={lineState} />
        {!expanded ? <span className="sr-only">{getToolSummaryStatus(lineState, labels)}</span> : null}
        <span className="shrink-0 font-medium text-foreground" data-testid="tool-phase-headline">
          {headline}
        </span>
        <span className="min-w-0 truncate" title={stepText} data-testid="tool-phase-steps">
          {stepText}
        </span>
        {groups.length > 0 ? (
        <button
          type="button"
          onClick={() => setToggled(!expanded)}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t('chatbot.phase.collapse', { defaultValue: 'Hide steps' })
              : t('chatbot.phase.expand', { defaultValue: 'Show steps' })
          }
          className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
          data-testid="tool-phase-toggle"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
        </button>
        ) : null}
      </div>
      {expanded && groups.length > 0 ? (
        <div className="mt-1" data-testid="tool-phase-steps-expanded">
          <ToolActivitySummary groups={groups} labels={labels} />
        </div>
      ) : null}
    </div>
  );
}

interface ToolActivitySummaryLabels {
  toolCompleted: string;
  toolRunning: string;
  toolAwaitingApproval: string;
  toolFailed: string;
  connectionOfflineLabel: string;
}

function ToolActivitySummary({
  groups,
  labels,
}: {
  groups: ToolSummaryGroup[];
  labels: ToolActivitySummaryLabels;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="not-prose mb-2 border-l border-border/70 pl-3">
      <div className="space-y-1">
        {groups.map((group) => (
          <div
            key={group.key}
            className="flex min-h-6 items-center justify-between gap-3 text-xs"
          >
            <div className="flex min-w-0 items-center gap-2">
              <ToolSummaryIcon state={group.state} />
              <span className="truncate font-medium text-foreground">
                {group.title}
              </span>
              {group.count > 1 ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  x{group.count}
                </span>
              ) : null}
            </div>
            {group.state === 'running' ? (
              // A running tool shows a LIVE elapsed timer instead of a static
              // "Running", and a red offline cue if the network drops (issue #432).
              <ToolRunningTimer offlineLabel={labels.connectionOfflineLabel} />
            ) : (
              <span
                className={cn(
                  'shrink-0 text-[10px] font-medium',
                  group.state === 'failed'
                    ? 'text-destructive'
                    : group.state === 'completed'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-muted-foreground',
                )}
              >
                {getToolSummaryStatus(group.state, labels)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolSummaryIcon({ state }: { state: ToolSummaryState }) {
  if (state === 'failed') {
    return <XCircle className="size-3.5 shrink-0 text-destructive" />;
  }
  if (state === 'completed') {
    return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />;
  }
  return <Clock3 className="size-3.5 shrink-0 text-muted-foreground" />;
}

function getToolSummaryStatus(
  state: ToolSummaryState,
  labels: ToolActivitySummaryLabels,
) {
  switch (state) {
    case 'failed':
      return labels.toolFailed;
    case 'awaiting':
      return labels.toolAwaitingApproval;
    case 'running':
      return labels.toolRunning;
    case 'completed':
      return labels.toolCompleted;
  }
}

/**
 * Tool result renderer. The vendored `<ToolOutput>` blindly wraps every string
 * in a JSON-highlighted `<CodeBlock>`, which mangles plain text / markdown
 * results from tools (e.g. "Created task 42" or a bullet list). This wrapper
 *
 *  - renders plain-text / markdown strings via `<MessageResponse>` (streamdown)
 *  - falls through to the vendored `<ToolOutput>` for real JSON objects/arrays
 *    and for strings that actually look like JSON literals
 *  - preserves error rendering unchanged
 */
export function SmartToolOutput({
  output,
  errorText,
}: {
  output: unknown;
  errorText?: string;
}) {
  if (errorText) {
    return <ToolOutput output={undefined} errorText={errorText} />;
  }
  if (output == null || output === '') return null;
  if (typeof output === 'string' && !looksLikeJson(output)) {
    return (
      <div className="space-y-2 p-4">
        <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Result
        </h4>
        <div className="overflow-x-auto rounded-md bg-muted/40 px-3 py-2 text-sm text-foreground">
          <MessageResponse>{output}</MessageResponse>
        </div>
      </div>
    );
  }
  return <ToolOutput output={output as never} errorText={undefined} />;
}
