/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * FlowRefusalNotice — the Close-only notice for a flow LAUNCH that ended with
 * `outcome: 'refused'` without ever pausing at a screen (objectui#9973).
 *
 * The maintainer ruling on objectstack#14945 says a refused run is rendered
 * with Close only and no completion toast, and names
 * `AutomationResult.refusalMessage` as the carrier. `FlowRunner` honours that
 * on the paused route (objectui#7707), but a run that refuses straight away
 * never pauses, so it never reaches `FlowRunner`. The launch handlers judge it
 * through `judgeFlowLaunch` and open this instead.
 *
 * It renders what `FlowRunner` renders for the same event, minus the screen it
 * does not have:
 *
 * - the engine's sentence as a plain (NOT destructive) `Alert` — a refusal is
 *   the flow working, a successful evaluation that said no. The sentence is
 *   per-record prose the engine composed from the `end` node's template, so it
 *   is passed through verbatim and untranslated: data, not copy with a key;
 * - a single Close, through the existing `common.close` key.
 *
 * The title is the invoking action's own label: the thing the user clicked is
 * the thing that was refused. With an empty sentence the notice keeps that
 * title and its Close, with no invented copy — the objectui#9971 precedent. An
 * empty `refusalMessage` is refused at the authoring door by the spec's `end`
 * config, so it is an engine defect and not an authorable shape, and the
 * disposition is a fact about the STATUS rather than about whether the
 * sentence arrived.
 *
 * Internal to `@object-ui/app-shell`: mounted by the two console launch hosts
 * (`useConsoleActionRuntime` and `RecordDetailView`), deliberately not exported
 * from the package entry.
 *
 * Close flips `open` and KEEPS the other fields, the same shape the confirm and
 * param dialogs converged on (objectui#6034, objectui#6431): Radix holds the
 * content mounted through its exit animation, so blanking the state on close
 * would empty the notice while it fades.
 */
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';

export interface FlowRefusalState {
  open: boolean;
  /** The invoking action's label. */
  title?: string;
  /** The engine-rendered refusal sentence; `''` when the producer sent none. */
  message?: string;
}

export interface FlowRefusalNoticeProps {
  state: FlowRefusalState;
  /** The user dismissed the notice — the host flips `open` and keeps the rest. */
  onClose: () => void;
}

export function FlowRefusalNotice({ state, onClose }: FlowRefusalNoticeProps) {
  const { t } = useObjectTranslation();
  return (
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
        </DialogHeader>
        {state.message ? (
          <Alert>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.close', { defaultValue: 'Close' })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
