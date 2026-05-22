// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * HmrStatusBadge — small indicator in the top bar showing whether the
 * metadata HMR SSE connection to the backend is live. When connected,
 * pulses briefly each time a file-change event arrives so the user has
 * visual confirmation that the loop is working.
 */

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Loader2, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useMetadataHmr } from '@/hooks/useMetadataHmr';

const STATE_CONFIG = {
  connecting: {
    label: 'HMR',
    icon: Loader2,
    badgeClass: 'border-blue-200 text-blue-700 bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:bg-blue-950/50',
    dotClass: 'bg-blue-500',
    animate: true,
  },
  connected: {
    label: 'HMR',
    icon: Wifi,
    badgeClass: 'border-emerald-200 text-emerald-700 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:bg-emerald-950/50',
    dotClass: 'bg-emerald-500',
    animate: false,
  },
  disconnected: {
    label: 'HMR off',
    icon: WifiOff,
    badgeClass: 'border-gray-200 text-gray-600 bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:bg-gray-900',
    dotClass: 'bg-gray-400',
    animate: false,
  },
  disabled: {
    label: 'HMR off',
    icon: WifiOff,
    badgeClass: 'border-gray-200 text-gray-600 bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:bg-gray-900',
    dotClass: 'bg-gray-400',
    animate: false,
  },
  error: {
    label: 'HMR err',
    icon: WifiOff,
    badgeClass: 'border-red-200 text-red-700 bg-red-50 dark:border-red-800 dark:text-red-400 dark:bg-red-950/50',
    dotClass: 'bg-red-500',
    animate: false,
  },
} as const;

export function HmrStatusBadge() {
  const { state, version, lastEvent, lastEventAt } = useMetadataHmr();
  const [pulsing, setPulsing] = useState(false);

  // Pulse for ~700ms each time a new event arrives.
  useEffect(() => {
    if (version === 0) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 700);
    return () => clearTimeout(t);
  }, [version]);

  const cfg = STATE_CONFIG[state];
  const Icon = pulsing ? Zap : cfg.icon;
  const lastAtLabel = lastEventAt
    ? new Date(lastEventAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`gap-1.5 text-[10px] font-normal cursor-default hidden md:inline-flex ${cfg.badgeClass} ${pulsing ? 'ring-2 ring-emerald-400/50' : ''}`}
          >
            <span className="relative flex h-1.5 w-1.5">
              {state === 'connected' && (
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dotClass} opacity-40`} />
              )}
              <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${cfg.dotClass}`} />
            </span>
            <Icon className={`h-3 w-3 ${cfg.animate ? 'animate-spin' : ''}`} />
            <span className="font-mono">{cfg.label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <div className="space-y-1">
            <p className="font-medium">Metadata HMR</p>
            <p className="text-muted-foreground">State: {state}</p>
            <p className="text-muted-foreground">Events: {version}</p>
            <p className="text-muted-foreground">Last: {lastAtLabel}</p>
            {lastEvent && (
              <p className="text-muted-foreground">
                {lastEvent.type} {lastEvent.metadataType}/{lastEvent.name}
              </p>
            )}
            {state !== 'connected' && state !== 'connecting' && (
              <p className="text-muted-foreground">
                Source edits won't auto-refresh previews.
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default HmrStatusBadge;
