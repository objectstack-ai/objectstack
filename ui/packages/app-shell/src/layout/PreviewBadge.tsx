/**
 * PreviewBadge — a compact "Preview" / "Beta" chip shown next to the product
 * wordmark in the top bar while the whole platform is pre-GA.
 *
 * The stage is server-pushed through runtime-config (`branding.stage`, default
 * `'preview'`), so operators flip it to `'ga'` at launch — via
 * `OS_PRODUCT_STAGE` / `RuntimeConfigPlugin` — and the badge disappears with no
 * code change. Renders nothing at GA. See ../runtime-config.
 *
 * @module
 */

import { Badge, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { getPlatformStage } from '../runtime-config.js';

export interface PreviewBadgeProps {
  /** Extra classes — e.g. responsive visibility / spacing from the caller. */
  className?: string;
}

/**
 * Read the platform stage from runtime-config and render the matching chip.
 * `getPlatformStage()` is a module singleton populated before first paint
 * (main.tsx awaits `initRuntimeConfig`), so this reads it directly at render
 * time — the same non-reactive pattern the wordmark uses via `getProductName()`.
 */
export function PreviewBadge({ className }: PreviewBadgeProps) {
  const { t } = useObjectTranslation();
  const stage = getPlatformStage();

  // Nothing to advertise once the platform reaches general availability.
  if (stage !== 'preview' && stage !== 'beta') return null;

  const label =
    stage === 'beta'
      ? t('topbar.stage.beta', { defaultValue: 'Beta' })
      : t('topbar.stage.preview', { defaultValue: 'Preview' });
  const tooltip = t('topbar.stage.tooltip', {
    defaultValue: 'This platform is in preview — features may change.',
  });

  return (
    <Badge
      variant="secondary"
      title={tooltip}
      aria-label={tooltip}
      data-testid="platform-preview-badge"
      className={cn(
        'shrink-0 cursor-default select-none rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        className,
      )}
    >
      {label}
    </Badge>
  );
}
