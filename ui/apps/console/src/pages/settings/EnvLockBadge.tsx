/**
 * <EnvLockBadge> — small chip indicating the value is pinned by env.
 *
 * The chip and its fallback title are the settings page's own copy, so both
 * read `console.settingsView.*` in the session's language (objectui#12821).
 * A served `reason` is the server's text (`ResolvedSettingValue.lockedReason`)
 * and is shown as served.
 */

import { Lock } from 'lucide-react';
import { Badge } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';

export interface EnvLockBadgeProps {
  /** The reason string carried in ResolvedSettingValue.lockedReason. */
  reason?: string;
  className?: string;
}

export function EnvLockBadge({ reason, className }: EnvLockBadgeProps) {
  const { t } = useObjectTranslation();
  return (
    <Badge
      variant="outline"
      className={`gap-1 border-amber-300 bg-amber-50 text-amber-900 ${className ?? ''}`}
      title={reason ?? t('console.settingsView.envLockBadgeTitle')}
    >
      <Lock className="h-3 w-3" />
      {t('console.settingsView.envLockBadge')}
    </Badge>
  );
}
