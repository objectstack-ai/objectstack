/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Notices around the composer: send errors, quota and rate-limit copy, and the
 * error banner.
 */
import * as React from 'react';
import { useObjectTranslation, useSafeTranslate } from '@object-ui/i18n';
import { AlertCircle, RefreshCw, XCircle, TriangleAlert } from 'lucide-react';
import { isRateLimitError, parseAiQuotaError, summarizeChatError } from '../tool-display';

/**
 * Inline notice for a message that couldn't be SENT (rejected before reaching
 * the model — rate-limit 429 / network / 5xx). Distinct from {@link ErrorBanner}
 * (a streamed response that failed): here the typed text has been restored to
 * the composer, so the copy reassures the user it isn't lost rather than
 * offering a Retry that would regenerate the wrong (rolled-back) turn. A
 * rate-limit gets the "you're sending too quickly" wording; anything else the
 * generic one.
 */
export function SendErrorNotice({
  error,
  rateLimitedLabel,
  genericLabel,
}: {
  error: Error;
  rateLimitedLabel: string;
  genericLabel: string;
}) {
  const text = React.useMemo(
    () => (isRateLimitError(error) ? rateLimitedLabel : genericLabel),
    [error, rateLimitedLabel, genericLabel],
  );
  return <ComposerNotice text={text} testId="chat-send-error" />;
}

/**
 * The amber band above the composer that tells the user why something they
 * did there did not go through — an unsent message ({@link SendErrorNotice})
 * or a refused attachment (objectstack#34463). `onClose` adds a close button.
 */
export function ComposerNotice({
  text,
  testId,
  closeLabel,
  onClose,
}: {
  text: string;
  testId: string;
  closeLabel?: string;
  onClose?: () => void;
}) {
  return (
    <div className="border-t bg-background px-3 py-2 text-sm" role="alert" data-testid={testId}>
      <div className="rounded-md border border-amber-300/40 bg-amber-50/60 px-3 py-2 text-foreground dark:bg-amber-950/20">
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 break-words leading-snug">{text}</div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * A byte count as the user's locale spells a size, in the largest binary unit
 * it reaches (`10 * 1024 * 1024` → "10 MB"), for the composer's size-limit notice.
 */
export function formatSizeLimit(bytes: number, locale: string): string {
  const units = [
    ['gigabyte', 1024 ** 3],
    ['megabyte', 1024 ** 2],
    ['kilobyte', 1024],
  ] as const;
  const spell = (unit: string, value: number) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: 1 }).format(value);
  for (const [unit, size] of units) {
    if (bytes >= size) return spell(unit, bytes / size);
  }
  return spell('byte', bytes);
}

/**
 * The server-owned AI-quota refusal copy, resolved for the console's ACTIVE
 * language, plus the verb its next step calls for. `null` when the error is not
 * a quota refusal.
 *
 * Shared by the composer banner and the confirm card's blocked state
 * (objectui#7253) so one 429 can never be described by two different sentences
 * on the same screen. The server sends both a localized `message` (zh) and
 * `messageEn`; that pair is server-owned, so we still choose between them — by
 * the in-app locale, not `navigator.language`, which ignored the locale
 * switcher entirely (objectui#2871).
 *
 * The title and the action follow the refusal's own next-step flags, never a
 * default: `topUp` offers a credit pack, `upgrade` offers the plan upgrade, and
 * a refusal with neither (a paid plan's five-hour pace, a developer
 * organization) gets a neutral title and NO action — waiting is the only exit,
 * and the server's sentence already says when it frees up.
 */
function useAiQuotaCopy(
  error: unknown,
): { title: string; text: string; cta: string | null } | null {
  const { language } = useObjectTranslation();
  const tt = useSafeTranslate();
  const quota = React.useMemo(() => parseAiQuotaError(error), [error]);
  if (!quota) return null;
  const isZh = language.toLowerCase().startsWith('zh');
  return {
    text:
      (isZh ? quota.message : quota.messageEn ?? quota.message) ||
      tt('chatbotQuota.fallbackMessage', 'You have reached your AI quota.'),
    title:
      quota.upgrade && !quota.topUp
        ? tt('chatbotQuota.title', 'Upgrade needed')
        : tt('chatbotQuota.limitTitle', 'AI limit reached'),
    cta: quota.topUp
      ? tt('chatbotQuota.buyCredits', 'Buy a credit pack')
      : quota.upgrade
        ? tt('chatbotQuota.upgradePlan', 'Upgrade plan')
        : null,
  };
}

export function ErrorBanner({
  error,
  onReload,
  onUpgrade,
}: {
  error: Error;
  onReload?: () => void;
  onUpgrade?: () => void;
}) {
  // `tt` (not the bare `t`) because this banner is the surface that renders
  // when things are already broken, including in hosts that mount the chat
  // WITHOUT an I18nProvider — where a bare `t(key)` returns the raw key and the
  // user would read "chatbotError.title" instead of an error message.
  const tt = useSafeTranslate();
  const quota = useAiQuotaCopy(error);
  const { summary, details } = React.useMemo(() => summarizeChatError(error), [error]);
  const [expanded, setExpanded] = React.useState(false);

  // AI quota refusal (429 from the cloud token guardrail) -> an amber notice
  // with the upgrade / top-up action the refusal names (none when it names
  // neither) instead of a red "Response failed" banner. Copy resolved by the
  // shared helper, which the confirm card's blocked state reads too.
  if (quota) {
    const { title, text, cta } = quota;
    return (
      <div className="border-t bg-background px-3 py-2 text-sm" role="alert">
        <div className="rounded-md border border-amber-300/40 bg-amber-50/60 px-3 py-2 text-foreground dark:bg-amber-950/20">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium leading-snug text-foreground">{title}</div>
              <div className="mt-0.5 break-words leading-snug text-muted-foreground">{text}</div>
            </div>
            {onUpgrade && cta ? (
              <button
                type="button"
                onClick={onUpgrade}
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-amber-400/50 bg-background px-2 text-xs font-medium text-amber-700 hover:bg-amber-100/60 dark:text-amber-300"
              >
                {cta}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="border-t bg-background px-3 py-2 text-sm"
      role="alert"
    >
      <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-foreground">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="font-medium leading-snug text-destructive">
              {tt('chatbotError.title', 'Response failed')}
            </div>
            <div className="mt-0.5 break-words leading-snug text-muted-foreground">
              {summary || tt('chatbotError.fallbackDetail', 'Something went wrong. Please try again.')}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {details ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-foreground"
                aria-expanded={expanded}
              >
                {expanded
                  ? tt('chatbotError.hide', 'Hide')
                  : tt('chatbotError.details', 'Details')}
              </button>
            ) : null}
            {onReload ? (
              <button
                type="button"
                onClick={onReload}
                className="inline-flex h-7 items-center rounded-md border border-destructive/30 bg-background px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                {tt('chatbotError.retry', 'Retry')}
              </button>
            ) : null}
          </div>
        </div>
        {expanded && details ? (
          <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border bg-background px-2 py-1 font-mono text-[11px] leading-snug text-muted-foreground">
            {details}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
