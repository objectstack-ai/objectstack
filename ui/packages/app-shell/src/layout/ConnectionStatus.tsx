/**
 * ConnectionStatus
 *
 * Displays the current ObjectStack connection state in the header area.
 * Silent when connected (objectui#12891): a healthy connection is the normal
 * case and draws nothing, from the first frame. The chip only appears while
 * connecting, reconnecting, disconnected or in error state.
 */

import type { ConnectionState } from '@object-ui/data-objectstack';
import { cn } from '@object-ui/components';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';

interface ConnectionStatusProps {
  state: ConnectionState;
  className?: string;
}

const statusConfig: Record<Exclude<ConnectionState, 'connected'>, { labelKey: string; defaultValue: string; color: string; icon: typeof Wifi }> = {
  connecting: { labelKey: 'topbar.connection.connecting', defaultValue: 'Connecting…', color: 'text-yellow-500', icon: Loader2 },
  reconnecting: { labelKey: 'topbar.connection.reconnecting', defaultValue: 'Reconnecting…', color: 'text-yellow-500', icon: Loader2 },
  disconnected: { labelKey: 'topbar.connection.disconnected', defaultValue: 'Disconnected', color: 'text-muted-foreground', icon: WifiOff },
  error: { labelKey: 'topbar.connection.error', defaultValue: 'Connection Error', color: 'text-destructive', icon: WifiOff },
};

export function ConnectionStatus({ state, className }: ConnectionStatusProps) {
  const { t } = useObjectTranslation();
  if (state === 'connected') return null;

  const config = statusConfig[state];
  const label = t(config.labelKey, { defaultValue: config.defaultValue });
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-opacity duration-300',
        config.color,
        state === 'error' && 'bg-destructive/10',
        state === 'reconnecting' && 'bg-yellow-500/10',
        className
      )}
      title={label}
    >
      <Icon className={cn('h-3.5 w-3.5', (state === 'connecting' || state === 'reconnecting') && 'animate-spin')} />
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}
