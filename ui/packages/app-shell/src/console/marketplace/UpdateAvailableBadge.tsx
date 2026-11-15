// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Update available → vX": the one badge the package page header and the
 * catalog card draw for an install the latest listed version updates
 * (`updateTarget` in `installState.ts` decides when; objectstack#33831).
 */

import { Badge, cn } from '@object-ui/components';
import { ArrowUpCircle } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';

export function UpdateAvailableBadge({
  version,
  className,
  'data-testid': testId,
}: {
  version: string;
  className?: string;
  'data-testid'?: string;
}) {
  const { t } = useObjectTranslation();
  return (
    <Badge
      variant="default"
      className={cn('bg-amber-500 hover:bg-amber-500 gap-1', className)}
      data-testid={testId}
    >
      <ArrowUpCircle className="h-3 w-3" aria-hidden="true" />
      {t('marketplace.detail.updateAvailable', { defaultValue: 'Update available' })} → v{version}
    </Badge>
  );
}
