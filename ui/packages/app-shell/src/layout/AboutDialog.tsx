// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AboutDialog — the help menu's About entry (objectui#12970, objectstack#35280).
 *
 * Two rows, the version first:
 *
 *  1. **ObjectStack version** — the `version` the runtime's discovery document
 *     answers (`DiscoverySchema`'s System Identity field, resolved server-side
 *     by `resolveDiscoveryVersion()`; an operator's `OS_RUNTIME_VERSION` stamp
 *     where one is set). It is read through the shell's adapter
 *     (`getDiscovery()`), which hands back the document its `connect()` already
 *     holds from the console's one shared discovery read — no second request.
 *     The value is shown exactly as discovery answers it, never trimmed.
 *  2. **Console build** — the build this console was compiled from: the shared
 *     build identity (`buildIdentity.ts`), the same read Sentry's release falls
 *     back to, so a deployment can still be traced to a commit.
 *
 * Neither field is ever left empty: while the read is in flight the version
 * row says it is loading, a discovery that cannot be read or answers no
 * version says so in words, and a console built without an identity says so
 * too.
 * @module
 */

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAdapter } from '../providers/AdapterProvider.js';

export interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The console's build identity, or `null` when the build named none. */
  build: string | null;
}

/** The discovery document's `version`, or `null` when it names none. */
function discoveryVersion(discovery: unknown): string | null {
  const version = (discovery as { version?: unknown } | null)?.version;
  return typeof version === 'string' && version !== '' ? version : null;
}

/**
 * The runtime's version as discovery answers it, read each time the dialog
 * opens: `undefined` before the first answer, `null` when discovery could not
 * be read or named no version. A later open keeps the last answer on screen
 * while it reads again.
 */
function useRuntimeVersion(open: boolean): string | null | undefined {
  const adapter = useAdapter();
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    if (!adapter) {
      setVersion(null);
      return;
    }
    let cancelled = false;
    // `getDiscovery()` answers `null` when the adapter cannot connect; it does
    // not reject.
    void adapter.getDiscovery().then((discovery) => {
      if (!cancelled) setVersion(discoveryVersion(discovery));
    });
    return () => {
      cancelled = true;
    };
  }, [open, adapter]);
  return version;
}

export function AboutDialog({ open, onOpenChange, build }: AboutDialogProps) {
  const { t } = useObjectTranslation();
  const version = useRuntimeVersion(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="overlay:about">
        <DialogHeader>
          <DialogTitle>{t('help.aboutTitle', { defaultValue: 'About this console' })}</DialogTitle>
          <DialogDescription>
            {t('help.aboutDescription', {
              defaultValue: 'The ObjectStack version this console runs on, and the build it was compiled from.',
            })}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 pt-2 text-sm">
          <dt className="text-muted-foreground">
            {t('help.aboutVersion', { defaultValue: 'ObjectStack version' })}
          </dt>
          <dd data-testid="about:runtime-version" className="min-w-0 break-all">
            {version ? (
              <code className="font-mono">{version}</code>
            ) : (
              <span className="text-muted-foreground">
                {version === undefined
                  ? t('common.loading', { defaultValue: 'Loading…' })
                  : t('help.aboutVersionUnknown', {
                      defaultValue: 'Unknown version (the server did not report one)',
                    })}
              </span>
            )}
          </dd>
          <dt className="text-muted-foreground">
            {t('help.aboutBuild', { defaultValue: 'Console build' })}
          </dt>
          <dd data-testid="about:console-build" className="min-w-0 break-all">
            {build ? (
              <code className="font-mono">{build}</code>
            ) : (
              <span className="text-muted-foreground">
                {t('help.aboutBuildUnknown', {
                  defaultValue: 'Unknown build (no version was set when this console was built)',
                })}
              </span>
            )}
          </dd>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
