/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The composer's model picker and the cost-multiplier rule it shows.
 */
import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@object-ui/components';
import { formatNumber, useObjectTranslation } from '@object-ui/i18n';
import type { ChatbotModelOption } from './types';

/** The item a selected model none of the offered models carries is shown by. */
const OUTSIDE_MODELS = 'outside';

/** objectstack#33660 — a pick whose DRAWN cost multiplier is this or above asks before it applies. */
const EXPENSIVE_MODEL_MULTIPLIER = 20;

/**
 * objectstack#33660 — a model's cost multiplier as the picker draws it, or
 * `undefined` when it has none to draw (absent, non-finite or not positive).
 * At 1 and above it is rounded to two decimals; below 1 to two significant
 * digits, so a small positive multiplier never reads ×0. The ×20 question
 * compares this drawn value, so what the person reads and whether they are
 * asked always agree.
 */
function drawnMultiplierOf(model: ChatbotModelOption): number | undefined {
  const n = model.costMultiplier;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined;
  return n >= 1 ? Math.round(n * 100) / 100 : Number(n.toPrecision(2));
}

/**
 * objectui#11865 — the composer's model picker, drawn with the shared `Select`,
 * the control the rest of the console picks with. It used to be a
 * browser-native `<select>`. What a pick writes is unchanged: `onPick` receives
 * the picked model's `id`, the string the native control's `change` carried,
 * and its accessible name is the same `aria-label`. Re-picking the current
 * model writes nothing, as it did there.
 *
 * - Items carry the model's INDEX, not its id, as the card's other pickers do.
 * - A selected id none of the offered models carries gets an item of its own,
 *   labelled with the id, so the trigger shows the model the host holds. The
 *   native control showed the first model there. Picking that item writes
 *   nothing.
 * - objectstack#33660: a model's `costMultiplier` is drawn as `×N` beside its
 *   label (none drawn when it has none). A pick whose drawn multiplier is
 *   {@link EXPENSIVE_MODEL_MULTIPLIER} or above asks once before it is written;
 *   Cancel writes nothing, and a model that leaves the list while asked is
 *   dropped. Every chat host renders this picker, so none can skip the question.
 * - objectstack#35445: the closed trigger shows the model's label alone. The
 *   multiplier stays on the list rows, where the choice is made.
 * - objectstack#35578: a model that carries a `tierLabel` shows it on the closed
 *   trigger in place of its label (the tier name alone); the label stays
 *   the trigger's title and the list row's text. Without one, the label as above.
 */
export function ModelPicker({
  label,
  models,
  value,
  onPick,
  allowanceUsedFraction,
}: {
  label: string;
  models: ReadonlyArray<ChatbotModelOption>;
  value: string;
  onPick: (modelId: string) => void;
  allowanceUsedFraction?: number;
}) {
  const { t, language } = useObjectTranslation();
  // The id a ×20-or-above pick is waiting to apply; `null` while nothing is asked.
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  // Read from the CURRENT list, so Confirm writes a model that is still offered
  // and the question states the multiplier the list draws for it now.
  const listed = confirmingId !== null ? models.find((m) => m.id === confirmingId) : undefined;
  const listedDrawn = listed ? drawnMultiplierOf(listed) : undefined;
  const confirming =
    listedDrawn !== undefined && listedDrawn >= EXPENSIVE_MODEL_MULTIPLIER ? listed : undefined;
  // The asked-about model left the list while the question was open, or the list
  // now draws it below the threshold or with no multiplier: drop the pick.
  if (confirmingId !== null && confirming === undefined) setConfirmingId(null);
  const at = models.findIndex((m) => m.id === value);
  // The model in force's full name (the title, and the list row's text) and what
  // the closed trigger shows: its tier name alone when it carries one.
  const inForce = at !== -1 ? (models[at].label ?? models[at].id) : value;
  const shown = at !== -1 ? (models[at].tierLabel ?? inForce) : value;
  // The drawn value is already rounded (drawnMultiplierOf); this only spells it,
  // with as many decimals as that rounding kept.
  const multiplierText = (n: number) =>
    formatNumber(n, {
      locale: language,
      maximumFractionDigits: n >= 1 ? 2 : Math.min(20, 1 - Math.floor(Math.log10(n))),
    });
  // The share of the allowance left, as the console's usage ring reads it; only
  // with usage served and a multiplier to set it against (rule D5: a fraction, never a count).
  const allowanceLeft =
    typeof allowanceUsedFraction === 'number' &&
    Number.isFinite(allowanceUsedFraction) &&
    models.some((m) => drawnMultiplierOf(m) !== undefined)
      ? formatNumber(Math.min(1, Math.max(0, 1 - allowanceUsedFraction)), {
          locale: language,
          style: 'percent',
          maximumFractionDigits: 0,
        })
      : undefined;
  return (
    <>
      <Select
        value={at !== -1 ? String(at) : OUTSIDE_MODELS}
        onValueChange={(token) => {
          // `undefined` for the outside item: it is the host's own model, so there is nothing to write.
          const picked = models[Number(token)];
          if (!picked) return;
          if ((drawnMultiplierOf(picked) ?? 0) >= EXPENSIVE_MODEL_MULTIPLIER) setConfirmingId(picked.id);
          else onPick(picked.id);
        }}
      >
        <SelectTrigger
          aria-label={label}
          title={inForce}
          className="h-7 w-auto min-w-0 max-w-[10rem] gap-1 px-2 text-xs text-muted-foreground hover:text-foreground focus:ring-1 focus:ring-offset-0"
        >
          {/* objectstack#35445 — the closed picker names the model in force and
              nothing else: no provider, no cost figure (the list, where the
              choice is made, carries those). Truncated, with the name on its title. */}
          <SelectValue>
            <span className="truncate" data-testid="model-picker-value">{shown}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {at === -1 && <SelectItem value={OUTSIDE_MODELS}>{value}</SelectItem>}
          {models.map((m, i) => {
            const drawn = drawnMultiplierOf(m);
            return (
              <SelectItem key={`${i}:${m.id}`} value={String(i)}>
                {m.label ?? m.id}
                {m.provider ? ` · ${m.provider}` : ''}
                {drawn !== undefined ? (
                  <span className="ml-1.5 tabular-nums text-muted-foreground" data-testid="model-cost-multiplier">
                    ×{multiplierText(drawn)}
                  </span>
                ) : null}
              </SelectItem>
            );
          })}
          {allowanceLeft !== undefined ? (
            <p
              className="mt-1 max-w-64 border-t px-2 pb-1 pt-1.5 text-[11px] leading-snug text-muted-foreground"
              data-testid="model-allowance-note"
            >
              {t('chatbot.modelPicker.allowanceNote', {
                left: allowanceLeft,
                defaultValue:
                  '{{left}} of your AI allowance is left. A model marked ×N uses it N times as fast as the default model.',
              })}
            </p>
          ) : null}
        </SelectContent>
      </Select>
      <AlertDialog open={confirming !== undefined} onOpenChange={(open) => { if (!open) setConfirmingId(null); }}>
        {confirming ? (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('chatbot.modelPicker.confirmTitle', {
                  model: confirming.label ?? confirming.id,
                  defaultValue: 'Switch to {{model}}?',
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('chatbot.modelPicker.confirmBody', {
                  multiplier: multiplierText(listedDrawn ?? 0),
                  defaultValue:
                    'Each message on this model uses {{multiplier}} times as much of your AI allowance as one on the default model.',
                })}
                {allowanceLeft !== undefined
                  ? ` ${t('chatbot.modelPicker.confirmAllowance', {
                      left: allowanceLeft,
                      multiplier: multiplierText(listedDrawn ?? 0),
                      defaultValue: '{{left}} of it is left, and on this model it runs out {{multiplier}} times as fast.',
                    })}`
                  : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('chatbot.modelPicker.confirmCancel', { defaultValue: 'Cancel' })}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onPick(confirming.id);
                  setConfirmingId(null);
                }}
              >
                {t('chatbot.modelPicker.confirmAction', { defaultValue: 'Switch model' })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </>
  );
}
