/**
 * ReadRateBanner — the environment admin's standing read-rate report
 * (objectui#9954; ruling on cloud#2333, batch #164 item 3).
 *
 * ## What raises it
 *
 * `readRate.state === 'anomalous'` on `GET /api/v1/usage/storage`, and nothing
 * else. The control plane took that judgement once, in its own
 * `read-rate-anomaly` module; this component READS the verdict and never
 * re-derives it from the ratio and the threshold. Every other case — no reading
 * at all, a reading that is under the line, an endpoint that could not be read —
 * renders `null`, and {@link classifyReadRate} keeps those three apart so
 * "nobody measured it" can never be rendered, logged or reasoned about as
 * "measured and fine".
 *
 * ## Two anomalous cases, two sets of words
 *
 * An ABSENT `readsPerWrite` is not a missing number: it means the environment
 * made no writes at all, so the ratio has no upper bound — the most severe
 * reading there is, and the exact shape of the incident behind this work
 * (cloud#2179: 101.16 billion rows read in nine days, unnoticed). Rendering it
 * as an em dash, or hiding the banner because a number was missing, would hide
 * the worst case. It gets its own title, its own sentence and the heavier tone.
 *
 * The threshold in both sentences comes from `ratioThreshold` on the wire.
 * There is ⛔ no copy of the line in this repo.
 *
 * ## It is a REPORT, and may never become anything else
 *
 * Verbatim from the landed cloud module this reads:
 *
 *   > Nothing downstream may turn this into a refusal, a throttle or a degraded
 *   > read. Option B was rejected on the record (cloud#2179), and this endpoint
 *   > is read-only in any case — but the banner it feeds must not become an
 *   > argument for the guardrail beside it.
 *
 * So: no gate, no throttle, no upgrade CTA, no disabled control. The copy says
 * in as many words that nothing is limited or blocked.
 *
 * ## Where it mounts, and who sees it
 *
 * `ConsoleShell`, beside `ImpersonationBanner` — the one provider stack every
 * console route passes through, so `/home` carries it too. `ConsoleLayout` was
 * the alternative and is wrong here for the reason that module already records:
 * it wraps only `/apps/*`, and an admin sitting on home would see nothing. The
 * notification banner host (`ConsoleNotificationBanners`) was the other
 * candidate and is wrong for a different reason — it renders notifications
 * RAISED through the spec notification system, and this reading is neither a
 * notification nor raised by anything in this app.
 *
 * The audience is the environment's own admin — the only person who can act on
 * their own app's read pattern. Gated on `useWorkspaceAdminStatus`, which also
 * keeps the request itself off every ordinary session rather than spending a
 * 403 per page load. The request is gated as well on
 * {@link isStorageUsageServed} — the runtime's own `features.storageUsage`,
 * the one boolean `StorageUsageBanner` reads too — so a runtime that does not
 * serve the endpoint is not spent a 404 per page load either (objectui#11002).
 */
import { TriangleAlert } from 'lucide-react';
import { cn } from '@object-ui/components';
import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { useObjectTranslation, useDisplayLocale, formatDisplayNumber } from '@object-ui/i18n';
import { useReadRateReading, classifyReadRate } from '../hooks/useReadRateReading.js';
import { isStorageUsageServed } from '../runtime-config.js';

export interface ReadRateBannerProps {
  /** Override the resolved tenant runtime base (e.g. `/api/v1`). */
  apiBase?: string;
  className?: string;
}

export function ReadRateBanner({ apiBase, className }: ReadRateBannerProps) {
  const { t } = useObjectTranslation();
  const locale = useDisplayLocale();
  const { isAdmin } = useWorkspaceAdminStatus();
  // Asked only when the runtime serves the endpoint (objectui#11002): the one
  // boolean `StorageUsageBanner` gates on too, so neither banner probes a
  // runtime that would answer 404.
  const snapshot = useReadRateReading({ apiBase, enabled: isAdmin && isStorageUsageServed() });

  const bannerCase = classifyReadRate(snapshot);
  const reading = snapshot.status === 'measured' ? snapshot.reading : null;

  // Below every hook, so hook order is stable as the reading arrives.
  if (!reading || (bannerCase !== 'anomalous-no-writes' && bannerCase !== 'anomalous-ratio')) {
    return null;
  }

  // `anomalous-no-writes` IS the absent ratio. Narrowed on the value itself so
  // the number that reaches the copy is a real one, never a fallback standing in
  // for a missing measurement.
  const { readsPerWrite } = reading;
  const noWrites = readsPerWrite === undefined;
  const threshold = formatDisplayNumber(reading.ratioThreshold, { locale, maximumFractionDigits: 1 });

  const title = noWrites
    ? t('console.readRate.noWritesTitle', {
        defaultValue: 'Reads with no writes at all in this system',
      })
    : t('console.readRate.ratioTitle', { defaultValue: 'Unusual read volume in this system' });

  const body = noWrites
    ? t('console.readRate.noWrites', {
        defaultValue:
          'Rows are being read while none at all are being written, so the read rate has no upper bound. This is the most severe reading. The platform flags anything above {{threshold}}. Nothing is limited or blocked; this is a report so the read pattern can be reviewed.',
        threshold,
      })
    : t('console.readRate.ratio', {
        defaultValue:
          'Reads are running at {{ratio}} rows for every row written. The platform flags anything above {{threshold}}. Nothing is limited or blocked; this is a report so the read pattern can be reviewed.',
        ratio: formatDisplayNumber(readsPerWrite, { locale, maximumFractionDigits: 1 }),
        threshold,
      });

  return (
    <div
      role="status"
      data-testid="read-rate-banner"
      data-read-rate-case={bannerCase}
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-1 border-b px-4 py-2 text-sm',
        noWrites
          ? 'border-red-300/70 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-100'
          : 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-100',
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{title}</span> <span className="opacity-90">{body}</span>
      </p>
    </div>
  );
}

ReadRateBanner.displayName = 'ReadRateBanner';
