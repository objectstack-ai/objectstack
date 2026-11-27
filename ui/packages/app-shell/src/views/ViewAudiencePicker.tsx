// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "Who sees this view" — the audience picker of the in-place create card's
 * shared scope (objectstack#34908, ruling 7103739693 letter B).
 *
 * It sets the view's existing, server-enforced gate, `requiredPermissions`: a
 * list of capabilities, every one required. The list it offers is CLOSED — the
 * capabilities the environment knows ({@link CapabilityAudience}), each shown
 * with the permission sets granting it — so a reader cannot type a name that
 * matches nothing. There is no free-text fallback: when the catalog cannot be
 * read, nothing can be added (a name already picked, such as the open view's
 * gate, stays and can be removed). Under the list it previews, read-only,
 * which positions the picked set reaches (the sets each position grants in
 * force, as the server serves them), and says the gate applies to the creator
 * too. It grants nothing: granting stays in Setup.
 */

import { useId } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { positionsReached, type CapabilityAudience } from './capabilityAudience.js';
import type { LoadState } from './metadata-admin/loadState.js';

export interface ViewAudiencePickerProps {
  /** The catalog: capabilities, the sets granting each, the positions holding them. */
  audience: LoadState<CapabilityAudience>;
  /** The picked capabilities, in the order they were added. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function ViewAudiencePicker({ audience, value, onChange, disabled }: ViewAudiencePickerProps) {
  const { t } = useObjectTranslation();
  const labelId = useId();
  const loaded = audience.status === 'loaded' ? audience.data : null;
  const options = loaded?.capabilities ?? [];
  const remaining = options.filter((c) => !value.includes(c.name));
  const optionOf = (name: string) => options.find((c) => c.name === name);

  let preview: string;
  if (value.length === 0) {
    preview = t('view.switcher.audienceEveryone', { defaultValue: 'Everyone who can see this list' });
  } else if (!loaded) {
    preview = '';
  } else if (loaded.positions === null) {
    preview = t('view.switcher.audiencePositionsUnread', {
      defaultValue: 'The positions could not be read, so who will see this view is not shown',
    });
  } else {
    const reached = positionsReached(value, loaded.positions) ?? [];
    preview = reached.length === 0
      ? t('view.switcher.audienceNoPosition', {
        defaultValue: 'No single position holds every picked capability: only people who hold all of them, directly or through several positions, will see this view',
      })
      : t('view.switcher.audiencePositions', {
        defaultValue: '{{positions}} will see this view',
        positions: reached.map((p) => p.label ?? p.name).join(', '),
      });
  }

  return (
    <div className="space-y-1.5" role="group" aria-labelledby={labelId} data-testid="view-audience-picker">
      <span id={labelId} className="text-xs font-medium text-muted-foreground">
        {t('view.switcher.audienceLabel', { defaultValue: 'Who sees this view' })}
      </span>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((name) => {
            const option = optionOf(name);
            return (
              <li
                key={name}
                className="inline-flex items-center gap-1.5 rounded border border-input bg-muted px-2 py-0.5 text-xs"
                data-testid={`view-audience-picked-${name}`}
              >
                {option?.label && option.label !== name && <span>{option.label}</span>}
                <code className="font-mono">{name}</code>
                {!disabled && (
                  <button
                    type="button"
                    aria-label={t('view.switcher.audienceRemove', { defaultValue: 'Remove {{name}}', name })}
                    onClick={() => onChange(value.filter((v) => v !== name))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {audience.status === 'error' ? (
        <p className="text-xs text-destructive" data-testid="view-audience-load-failed">
          {t('view.switcher.audienceLoadFailed', {
            defaultValue: 'The capabilities could not be loaded, so none can be added: {{message}}',
            message: audience.message,
          })}
        </p>
      ) : loaded && options.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="view-audience-none">
          {t('view.switcher.audienceNone', {
            defaultValue: 'No capability is defined yet. Capabilities are granted on permission sets, in Setup.',
          })}
        </p>
      ) : (
        <Select value="" onValueChange={(name) => onChange([...value, name])} disabled={disabled || !loaded || remaining.length === 0}>
          <SelectTrigger className="h-8 text-sm max-sm:h-11" data-testid="view-audience-add" aria-labelledby={labelId}>
            <SelectValue
              placeholder={!loaded
                ? t('view.switcher.audienceLoading', { defaultValue: 'Loading capabilities…' })
                : remaining.length > 0
                  ? t('view.switcher.audienceAdd', { defaultValue: 'Limit to a capability…' })
                  : t('view.switcher.audienceAllAdded', { defaultValue: 'All capabilities added' })}
            />
          </SelectTrigger>
          <SelectContent>
            {remaining.map((c) => (
              <SelectItem key={c.name} value={c.name} data-testid={`view-audience-option-${c.name}`}>
                <span className="flex flex-col">
                  <span className="flex items-center gap-2">
                    {c.label && c.label !== c.name && <span>{c.label}</span>}
                    <code className="text-xs text-muted-foreground">{c.name}</code>
                  </span>
                  {c.grantedBy.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {t('view.switcher.audienceGrantedBy', { defaultValue: 'Granted by {{sets}}', sets: c.grantedBy.join(', ') })}
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {preview && (
        <p className="text-xs text-muted-foreground" data-testid="view-audience-preview">
          {preview}
        </p>
      )}
      {/* The gate refuses a view item whole, its creator included, and the card
          opens the view once it is created: say so while a gate is picked. */}
      {value.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="view-audience-self">
          {t('view.switcher.audienceSelf', {
            defaultValue: 'This applies to you too: if you do not hold every capability picked, the view leaves your own list once it is created',
          })}
        </p>
      )}
    </div>
  );
}
