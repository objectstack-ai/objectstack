/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Turn liveness: the elapsed and quiet-turn indicator, the offline probe, and
 * the assistant avatar and thinking placeholder.
 */
import * as React from 'react';
import { cn } from '@object-ui/components';
import { Bot, Clock3, WifiOff } from 'lucide-react';
import { Message, MessageContent } from '../elements/message';
import type { TurnLiveness } from './types';

/**
 * Compact circular avatar shown beside a message when `showAvatars` is on.
 * Assistant → bot glyph (or image); user → initial (or image).
 */
export function MessageAvatar({
  isUser,
  url,
  fallback,
}: {
  isUser: boolean;
  url?: string;
  fallback?: string;
}) {
  return (
    <div
      className={cn(
        'mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-medium',
        isUser ? 'bg-secondary text-secondary-foreground' : 'bg-primary/10 text-primary',
      )}
      aria-hidden="true"
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : isUser ? (
        (fallback?.trim()?.charAt(0)?.toUpperCase() || 'U')
      ) : (
        <Bot className="size-4" />
      )}
    </div>
  );
}

export function AssistantThinkingMessage({
  showAvatar,
  assistantAvatarUrl,
  assistantAvatarFallback,
  waitingLabel,
  stalledLabel,
  offlineLabel,
}: {
  showAvatar: boolean;
  assistantAvatarUrl?: string;
  assistantAvatarFallback?: string;
  waitingLabel: string;
  stalledLabel: string;
  offlineLabel: string;
}) {
  return (
    <Message from="assistant" aria-live="polite">
      <div className={cn('flex w-full gap-2.5', showAvatar ? 'flex-row items-start' : 'flex-col')}>
        {showAvatar ? (
          <MessageAvatar
            isUser={false}
            url={assistantAvatarUrl}
            fallback={assistantAvatarFallback}
          />
        ) : null}
        <MessageContent className="rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <ThinkingDots />
            {/* No server bytes yet for this turn → `pending`: shows a neutral
                "waiting" that escalates to amber if the first token never comes,
                never a false "receiving". */}
            <LivenessIndicator
              active
              pending
              activityKey={0}
              waitingLabel={waitingLabel}
              stalledLabel={stalledLabel}
              offlineLabel={offlineLabel}
            />
          </span>
        </MessageContent>
      </div>
    </Message>
  );
}

export function ThinkingDots() {
  return (
    <>
      <span className="sr-only">Assistant is responding</span>
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-current animate-pulse" />
        <span className="size-1.5 rounded-full bg-current animate-pulse" />
        <span className="size-1.5 rounded-full bg-current animate-pulse" />
      </span>
    </>
  );
}

/** Format an elapsed-seconds count as `m:ss` (e.g. 42 → "0:42", 95 → "1:35"). */
export function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * After this many seconds with no new bytes from the server, a running turn is
 * treated as "quiet" — we genuinely have not heard back, so the indicator says
 * so instead of implying progress. During an app build the server streams
 * `data-build-progress` parts every few seconds, so a healthy build stays under
 * this threshold; only real silence (pre-first-token wait, a stalled/dropped
 * stream) crosses it.
 */
const LIVENESS_QUIET_AFTER_SECONDS = 6;

/**
 * Liveness derived from REAL stream activity, not a free-running clock.
 *
 * `activityKey` must change whenever actual data arrives from the server (a
 * streamed token, a tool delta, a `data-build-progress` update). We stamp the
 * arrival time when it changes; `live` is then a genuine "the server sent us
 * something in the last few seconds" signal — it goes false during true silence
 * (a stalled or dropped stream), so the UI can stop pretending the turn is
 * progressing. A 1s ticker keeps `quietSeconds` current between arrivals.
 * Everything freezes once `active` turns false, leaving the final duration.
 */
function useTurnLiveness(active: boolean, activityKey: string | number): TurnLiveness {
  const startRef = React.useRef<number>(0);
  const lastActivityRef = React.useRef<number>(0);
  const [seconds, setSeconds] = React.useState({ elapsed: 0, quiet: 0 });

  // Establish the time origin once, in an effect — keeps Date.now() out of
  // render so the derived seconds stay pure for the renderer. Runs before the
  // activity/tick effects below (effects fire in declaration order).
  React.useEffect(() => {
    const now = Date.now();
    startRef.current = now;
    lastActivityRef.current = now;
  }, []);

  // Real data arrived (activityKey changed) → stamp the arrival and zero the
  // quiet timer. Refs/Date.now() are touched only inside this effect, never
  // during render.
  React.useEffect(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    setSeconds({ elapsed: Math.floor((now - startRef.current) / 1000), quiet: 0 });
  }, [activityKey]);

  React.useEffect(() => {
    if (!active) return;
    const tick = () => {
      const now = Date.now();
      setSeconds({
        elapsed: Math.floor((now - startRef.current) / 1000),
        quiet: Math.floor((now - lastActivityRef.current) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);

  return {
    elapsedSeconds: seconds.elapsed,
    quietSeconds: seconds.quiet,
    live: seconds.quiet < LIVENESS_QUIET_AFTER_SECONDS,
  };
}

/**
 * True when the browser reports it is offline. Reads `navigator.onLine` and
 * tracks the window `online`/`offline` events, so a real network drop surfaces
 * IMMEDIATELY — before the stream-quiet timeout would otherwise infer it.
 */
export function useIsOffline(): boolean {
  const [offline, setOffline] = React.useState<boolean>(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return offline;
}

/**
 * Honest connection cue beside a running spinner. A LIVE `m:ss` timer is ALWAYS
 * shown (counting up from the first second, not only once bytes arrive) so the
 * user can always see the turn is progressing and for how long. Four states,
 * each a real fact about the stream:
 *
 *  - **offline** (red WifiOff) — `navigator.onLine` is false: the browser has
 *    no network. Surfaced instantly via the online/offline events.
 *  - **receiving** (emerald pulse) — bytes arrived from the server recently.
 *  - **waiting** (muted) — request in flight, nothing back yet (`pending`,
 *    e.g. before the first token). Neutral, never claims "receiving".
 *  - **stalled** (amber) — the stream has gone quiet past the threshold; the
 *    honest "we have not heard back for Ns" signal.
 *
 * A hard disconnect/error also surfaces via the chat error banner (with Retry).
 * `pending` selects waiting-vs-receiving wording: pass it when no server bytes
 * have been observed for this turn yet (the bare thinking state).
 */
function LivenessIndicator({
  active,
  activityKey,
  pending = false,
  waitingLabel,
  stalledLabel = 'Still working…',
  offlineLabel = 'Connection lost — reconnecting…',
}: {
  active: boolean;
  activityKey: string | number;
  pending?: boolean;
  waitingLabel: string;
  stalledLabel?: string;
  offlineLabel?: string;
}) {
  const { elapsedSeconds, quietSeconds, live } = useTurnLiveness(active, activityKey);
  const offline = useIsOffline();
  const tier: 'offline' | 'stalled' | 'receiving' | 'waiting' = offline
    ? 'offline'
    : !live
      ? 'stalled'
      : pending
        ? 'waiting'
        : 'receiving';
  const elapsed = formatElapsed(elapsedSeconds);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs tabular-nums',
        tier === 'offline'
          ? 'text-red-600 font-medium'
          : tier === 'stalled'
            ? 'text-amber-600 font-medium'
            : 'font-normal text-muted-foreground',
      )}
      aria-live="polite"
      data-liveness-tier={tier}
      title={
        tier === 'offline'
          ? `${offlineLabel} · ${elapsed} elapsed`
          : tier === 'receiving'
            ? `Receiving from server · ${elapsed} elapsed`
            : tier === 'stalled'
              ? `${stalledLabel} (${quietSeconds}s with no response) · ${elapsed} elapsed`
              : `${waitingLabel} · ${elapsed} elapsed`
      }
    >
      {tier === 'offline' ? (
        <WifiOff className="size-3 shrink-0" aria-hidden />
      ) : (
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            tier === 'receiving'
              ? 'bg-emerald-500 animate-pulse'
              : tier === 'stalled'
                ? 'bg-amber-500'
                : 'bg-muted-foreground/50 animate-pulse',
          )}
        />
      )}
      {/* The live count-up timer is ALWAYS visible (the "倒计时"): a turn never
          looks frozen, even before the first server byte. */}
      <Clock3 className="size-3 shrink-0" aria-hidden />
      <span>{elapsed}</span>
      {/* A short status label accompanies the timer in every state except the
          calm "receiving" one (where the green pulse already says data is
          flowing) — so "waiting", "still working" and "connection lost" read
          plainly instead of as a bare number. */}
      {tier === 'receiving' ? null : (
        <span>
          · {tier === 'offline' ? offlineLabel : tier === 'stalled' ? stalledLabel : waitingLabel}
        </span>
      )}
    </span>
  );
}
