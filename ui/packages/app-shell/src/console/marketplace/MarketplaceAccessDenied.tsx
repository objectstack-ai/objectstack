/**
 * Marketplace access guard.
 *
 * App Marketplace install actions require owner/admin on the active
 * organization. Non-admin members shouldn't see the catalog at all —
 * there's nothing they can do with it. This component renders a
 * minimal "no access" empty state for the marketplace surface.
 */

import { Card, CardContent, Button } from '@object-ui/components';
import { Lock } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useObjectTranslation } from '@object-ui/i18n';

export function MarketplaceAccessDenied() {
  const navigate = useNavigate();
  const { appName } = useParams();
  const { t } = useObjectTranslation();
  const home = appName ? `/apps/${appName}` : '/';
  return (
    <div className="container mx-auto max-w-2xl px-6 py-16">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="rounded-full bg-muted p-3">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{t('marketplace.accessDenied.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('marketplace.accessDenied.description')}
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate(home)}>
            {t('marketplace.action.backHome')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
