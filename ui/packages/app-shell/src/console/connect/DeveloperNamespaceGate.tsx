// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The frame for the developer surfaces' own strings (objectstack#32225).
 *
 * The `console.developer.*` and `connectAgent.*` keys are not in the
 * console's eager language pack: they are `@object-ui/i18n`'s lazy `developer`
 * namespace, fetched when a surface that reads them mounts (the namespace
 * module's header says why). This frame renders its children only once the
 * namespace answers `ready` for the instance's language, so a visitor sees a
 * copy-free load skeleton, never an English sentence in a translated console
 * nor a raw key. A language switch shows the skeleton again until that
 * language's catalogue has arrived.
 *
 * A catalogue that cannot be fetched is said once, in the console's own error
 * words (resident pack keys, which need no fetch), with a Try again that asks
 * for it again — never a skeleton that waits forever, and never a retry loop.
 *
 * ⛔ Every component that reads one of those keys renders under this frame:
 * the console's Developer pages (`apps/console/src/pages/developer/`) wrap
 * their bodies in it, and so do this directory's two widgets
 * (`ConnectAgent`, `ManagedPersonAssistants`). `PACK_NAMESPACE_FRAMES` in
 * `ui/scripts/check-i18n-call-site-keys.mjs` refuses a read of a key only the
 * namespace defines anywhere outside those two directories.
 */

import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Empty, EmptyTitle, Skeleton } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useDeveloperNamespace } from '@object-ui/i18n/namespaces/developer';

export function DeveloperNamespaceGate({ children }: { children: ReactNode }) {
  const namespace = useDeveloperNamespace();
  if (namespace.status === 'ready') return <>{children}</>;
  if (namespace.status === 'failed') return <DeveloperNamespaceFailed onRetry={namespace.retry} />;
  return (
    <div className="flex w-full flex-col gap-4 p-4 sm:p-6" data-testid="developer-namespace-loading" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function DeveloperNamespaceFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useObjectTranslation();
  return (
    <div className="flex w-full items-center justify-center p-8" data-testid="developer-namespace-failed">
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
