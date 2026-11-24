// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ConnectionBanner — the content area's notice that the console is offline or
 * has lost its server connection (objectstack#36112: the desktop's top bar,
 * which carried the two chips, is gone). Silent while the browser is online
 * and the connection is up, and while the first connection is being made, so
 * an ordinary page load draws nothing.
 * @module
 */

import { cn } from '@object-ui/components';
import { Loader2, WifiOff } from 'lucide-react';
import { useOffline } from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import type { ConnectionState } from '@object-ui/data-objectstack';

export function ConnectionBanner({ state }: { state?: ConnectionState }) {
  const { t } = useObjectTranslation();
  const { isOnline } = useOffline();
  let label: string | undefined;
  let tone: 'warn' | 'error' = 'warn';
  let busy = false;
  if (!isOnline) {
    label = t('topbar.offline', { defaultValue: 'Offline' });
  } else if (state === 'reconnecting') {
    label = t('topbar.connection.reconnecting', { defaultValue: 'Reconnecting…' });
    busy = true;
  } else if (state === 'disconnected') {
    label = t('topbar.connection.disconnected', { defaultValue: 'Disconnected' });
  } else if (state === 'error') {
    label = t('topbar.connection.error', { defaultValue: 'Connection Error' });
    tone = 'error';
  }
  if (!label) return null;
  const Icon = busy ? Loader2 : WifiOff;
  return (
    <div
      role="status"
      data-testid="console-connection-banner"
      className={cn(
        'flex items-center gap-2 border-b px-4 py-1.5 text-xs font-medium',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-yellow-500/30 bg-yellow-50 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-100',
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', busy && 'animate-spin')} aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  );
}
