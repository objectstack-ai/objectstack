// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The marketplace pages' frame for their own strings (objectstack#30588).
 *
 * The `marketplace.*` keys these pages read are not in the console's eager
 * language pack: they are `@object-ui/i18n`'s lazy `marketplace` namespace,
 * fetched when a page here mounts (the namespace module's header says why).
 * This frame renders the page only once the namespace answers `ready` for the
 * instance's language, so a visitor sees the copy-free load skeleton the pages
 * already use (`MarketplaceResolving`), never an English sentence in a
 * translated console nor a raw key. A language switch while a page is open
 * shows the skeleton again until that language's catalogue has arrived.
 *
 * A catalogue that cannot be fetched is said once, in the console's own error
 * words (resident pack keys, which need no fetch), with a Try again that asks
 * for it again — never a skeleton that waits forever, and never a retry loop.
 *
 * ⛔ Every component in this directory that reads a `marketplace.*` key renders
 * under this frame: the two pages wrap their bodies in it. The two families a
 * page outside this route reads (`marketplace.install.dependencyMissing`,
 * `marketplace.install.protocolCheckSkipped`) stayed in the packs for that
 * reason, so `dependencyMissing.ts` and `protocolCheckSkipped.ts` need no frame.
 */

import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Empty, EmptyTitle } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useMarketplaceNamespace } from '@object-ui/i18n/namespaces/marketplace';
import { MarketplaceResolving } from './MarketplaceResolving.js';

export function MarketplaceNamespaceGate({ children }: { children: ReactNode }) {
  const namespace = useMarketplaceNamespace();
  if (namespace.status === 'ready') return <>{children}</>;
  if (namespace.status === 'failed') return <MarketplaceNamespaceFailed onRetry={namespace.retry} />;
  return <MarketplaceResolving />;
}

function MarketplaceNamespaceFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useObjectTranslation();
  return (
    <div
      className="mx-auto flex w-full max-w-6xl items-center justify-center p-8"
      data-testid="marketplace-namespace-failed"
    >
      <Empty>
        <EmptyTitle>{t('console.errors.somethingWentWrong')}</EmptyTitle>
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-4 gap-2">
          <RotateCcw className="h-4 w-4" />
          {t('console.errors.tryAgain')}
        </Button>
      </Empty>
    </div>
  );
}
