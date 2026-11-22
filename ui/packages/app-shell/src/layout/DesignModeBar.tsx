// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design mode's bar (objectstack#36362): 「Design mode」 at its left,
 * 「Cancel」 and 「Save」 at its right, and nothing else (no app name, no
 * explanation, no way to Studio). `ConsoleLayout` draws it in the app shell's
 * top slot, across the whole window, while the mode is on (`designMode.tsx`).
 */

import { PencilRuler } from 'lucide-react';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import type { DesignModeValue } from './designMode.js';

export function DesignModeBar({ mode }: { mode: DesignModeValue }) {
  const { t } = useObjectTranslation();
  const title = t('designMode.title', { defaultValue: 'Design mode' });
  return (
    <div
      role="region"
      aria-label={title}
      data-testid="design-mode-bar"
      // Fills the shell's top slot edge to edge: the slot pads its content.
      className="-mx-2 flex h-full min-w-0 flex-1 items-center gap-2 bg-primary px-3 text-primary-foreground sm:-mx-4 sm:px-4"
    >
      <PencilRuler className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate text-sm font-semibold">{title}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
          disabled={mode.saving}
          onClick={mode.cancel}
          data-testid="design-mode-cancel"
        >
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8"
          disabled={!mode.dirty || mode.saving}
          onClick={() => void mode.save()}
          data-testid="design-mode-save"
        >
          {t('common.save', { defaultValue: 'Save' })}
        </Button>
      </div>
    </div>
  );
}
