// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AboutDialog — the help menu's About entry (objectui#12970).
 *
 * Names the build this console was compiled from, so a reviewer can tell which
 * objectui build a deployment serves. The value is the shared build identity
 * (`buildIdentity.ts`), the same read Sentry's release falls back to. A console
 * built without one says so in words; the field is never left empty.
 *
 * The runtime's own build identity is deliberately not shown here: the shell
 * has no request that reads it today, and adding one is outside this dialog.
 * @module
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';

export interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The console's build identity, or `null` when the build named none. */
  build: string | null;
}

export function AboutDialog({ open, onOpenChange, build }: AboutDialogProps) {
  const { t } = useObjectTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="overlay:about">
        <DialogHeader>
          <DialogTitle>{t('help.aboutTitle', { defaultValue: 'About this console' })}</DialogTitle>
          <DialogDescription>
            {t('help.aboutDescription', { defaultValue: 'The build this console was compiled from.' })}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 pt-2 text-sm">
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
