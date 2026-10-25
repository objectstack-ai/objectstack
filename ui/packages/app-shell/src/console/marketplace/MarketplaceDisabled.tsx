// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Marketplace turned off on this runtime (objectui#5504).
 *
 * A CONFIGURATION CONCLUSION, not a load failure. `OS_CLOUD_URL=off` is the
 * shipped default of the EE deploy template, so a stock self-hosted stack
 * lands here by following its own instructions -- and until this state
 * existed it landed on a red "Failed to load marketplace / Not found" card
 * whose hint claimed the runtime "points at the public ObjectStack cloud by
 * default" and advised setting `OS_CLOUD_URL`. Both were false for exactly
 * the deployment reading them: the operator had not left the default, and
 * the advice pointed back at the template that told them to set `off`.
 *
 * So: informational styling (muted, never `destructive`), it states what is
 * true of the runtime, and its hint is addressed to the one person who can
 * change it -- the operator -- naming the action rather than the diagnosis.
 *
 * Reached only when the server itself reported the capability absent
 * (`features.marketplace === false`); see `isMarketplaceEnabled()` for why
 * that is never inferred from a failed request.
 */

import { Card, CardContent, Button } from '@object-ui/components';
import { Store } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useObjectTranslation } from '@object-ui/i18n';

export function MarketplaceDisabled() {
  const navigate = useNavigate();
  const { appName } = useParams();
  const { t } = useObjectTranslation();
  const home = appName ? `/apps/${appName}` : '/';
  return (
    <div className="container mx-auto max-w-2xl px-6 py-16" data-testid="marketplace-disabled">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="rounded-full bg-muted p-3">
            <Store className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t('marketplace.disabled.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('marketplace.disabled.description')}
            </p>
            <p
              className="mt-3 text-xs text-muted-foreground"
              data-testid="marketplace-disabled-hint"
              // Contains an inline <code> tag, from OUR OWN bundle -- no
              // request data reaches this string. Same justification the
              // load-failure hint carried before it was split.
              dangerouslySetInnerHTML={{ __html: t('marketplace.disabled.hint') }}
            />
          </div>
          <Button variant="outline" onClick={() => navigate(home)}>
            {t('marketplace.action.backHome')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
