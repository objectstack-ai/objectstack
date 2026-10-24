/**
 * StorageUsageBanner — the environment admin's storage-capacity banner
 * (objectui#10439; the objectui half of cloud#2135).
 *
 * The product adjudication (2026-09-08) it renders, quoted verbatim:
 *
 *   > 提醒：≥ 80% 环境管理员横幅「已用 X / Y」；≥ 100% 横幅升级为「已满，上传与
 *   > 导入已暂停」+ 升级入口。
 *
 * ## What raises it
 *
 * The tenant runtime's own verdict on `GET /api/v1/usage/storage`, and nothing
 * else — the same verdict its upload / bulk-import guardrail refuses with, so
 * what this banner says is what will block an upload. `blocked` raises the
 * "storage is full" banner with the upgrade entry; otherwise `warn` raises the
 * used-of-limit banner. Every other answer (`ok`, `unknown`, `unlimited`, an
 * endpoint that could not be read) renders `null`. ⛔ This component never
 * compares the two numbers with each other or with a line; see
 * {@link classifyStorageUsage}.
 *
 * ## The upgrade entry
 *
 * Only the full banner carries it, as the adjudication orders. It is not gated
 * on a plan: the guardrail's refusal envelope for the same verdict declares its
 * upgrade flag as the literal `true`, and a plan with no limit never reaches
 * `blocked`. It links to {@link cloudConsoleUrl} — the control plane's origin,
 * the most specific destination a tenant runtime is told about — and is left
 * out when this runtime names no upstream cloud, the rule the AI usage
 * indicator's call to action already follows.
 *
 * ## Where it mounts, and who sees it
 *
 * `ConsoleShell`, beside `ReadRateBanner`, for the same reason that banner is
 * there: chrome for every console route, `/home` included. The audience is the
 * environment's administrator, gated on `useWorkspaceAdminStatus` — the same
 * gate the read-rate report uses — which also keeps the request itself off every
 * ordinary session. Both banners read one response (`readStorageUsage`).
 *
 * Neither asks a runtime that does not serve that response: the request is
 * also gated on {@link isStorageUsageServed}, the runtime's own
 * `features.storageUsage`, which only the cloud distribution that mounts the
 * endpoint sends (objectui#11002). One boolean for both banners, off by
 * default, so a self-hosted admin's page load issues no request at all.
 */
import { HardDrive } from 'lucide-react';
import { cn } from '@object-ui/components';
import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { useObjectTranslation, useDisplayLocale, formatDisplayNumber } from '@object-ui/i18n';
import { useStorageUsageReading, classifyStorageUsage } from '../hooks/useStorageUsageReading.js';
import { cloudConsoleUrl } from '../console/marketplace/marketplaceApi.js';
import { isStorageUsageServed } from '../runtime-config.js';

export interface StorageUsageBannerProps {
  /** Override the resolved tenant runtime base (e.g. `/api/v1`). */
  apiBase?: string;
  className?: string;
}

export function StorageUsageBanner({ apiBase, className }: StorageUsageBannerProps) {
  const { t } = useObjectTranslation();
  const locale = useDisplayLocale();
  const { isAdmin } = useWorkspaceAdminStatus();
  // Asked only when the runtime serves the endpoint (objectui#11002): the one
  // boolean `ReadRateBanner` gates on too, so neither banner probes a runtime
  // that would answer 404.
  const snapshot = useStorageUsageReading({ apiBase, enabled: isAdmin && isStorageUsageServed() });

  const view = classifyStorageUsage(snapshot);
  // Below every hook, so hook order is stable as the reading arrives.
  if (view.case !== 'warning' && view.case !== 'blocked') return null;

  const blocked = view.case === 'blocked';
  const used = formatDisplayNumber(view.usedMb, { locale, maximumFractionDigits: 1 });
  const limit = formatDisplayNumber(view.limitMb, { locale, maximumFractionDigits: 1 });
  const upgradeUrl = blocked ? cloudConsoleUrl() : '';

  const title = blocked
    ? t('console.storageUsage.blockedTitle', {
        defaultValue: 'Storage is full: uploads and imports are paused',
      })
    : t('console.storageUsage.warningTitle', { defaultValue: 'Storage is filling up' });

  const body = blocked
    ? t('console.storageUsage.blocked', {
        defaultValue:
          '{{used}} MB of {{limit}} MB used. Existing data is untouched, and reading, exporting and editing single records still work.',
        used,
        limit,
      })
    : t('console.storageUsage.warning', {
        defaultValue: '{{used}} MB of {{limit}} MB used. Uploads and imports pause once storage is full.',
        used,
        limit,
      });

  return (
    <div
      role="status"
      data-testid="storage-usage-banner"
      data-storage-usage-case={view.case}
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-1 border-b px-4 py-2 text-sm',
        blocked
          ? 'border-red-300/70 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-100'
          : 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-100',
        className,
      )}
    >
      <HardDrive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{title}</span> <span className="opacity-90">{body}</span>
      </p>
      {upgradeUrl ? (
        <a
          href={upgradeUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="storage-usage-upgrade"
          className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
        >
          {t('console.storageUsage.upgrade', { defaultValue: 'Upgrade to continue' })}
        </a>
      ) : null}
    </div>
  );
}

StorageUsageBanner.displayName = 'StorageUsageBanner';
