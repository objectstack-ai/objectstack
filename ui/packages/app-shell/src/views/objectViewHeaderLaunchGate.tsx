/**
 * The list header's launch gate on the Console `ObjectView` (objectstack#27831):
 * each schema-driven header action is drawn the way a launch of it would end.
 *
 * The verdict is the action runner's own, never a rule of this file:
 * `ActionRunner.launchRefusal` is the early refusal `execute` gives before the
 * confirmation and the param dialog — the dispatch handler's
 * `refuseBeforeInput`, which for the console's `script` and `flow` handlers is
 * `@object-ui/core`'s `resolveServerActionRecordId` — in the session's
 * language. Asked against the runner's live context, it answers for the row
 * selection the grid publishes there:
 *
 * - a refusal draws the action disabled, with the refusal as its reason (the
 *   `disabled` / `disabledReason` pair the `action:*` renderers already draw,
 *   tooltip and accessible description included);
 * - a refusal where the list says its rows cannot be selected
 *   (`selectionAvailable: false`) leaves the action out, since no selection
 *   can ever lift it;
 * - no refusal leaves the action exactly as it was.
 *
 * A host callback (`onClick`, such as Import in the folded menu) never reaches
 * the runner, so it is never asked. The runner's early refusal stays the
 * backstop for a launch that still reaches `execute` — a `?runAction=` deep
 * link, or a surface that does not draw through this gate.
 *
 * Mount it under the page's `ActionProvider`: the runner and its context are
 * that provider's.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { SchemaRenderer, useAction } from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import type { ActionBarSchema, UIActionSchema } from '@object-ui/types';

/** `actions`, each drawn the way a launch of it would end now. */
function useListHeaderLaunchGate(actions: readonly UIActionSchema[] | undefined): UIActionSchema[] {
    const { runner } = useAction();
    const subscribe = useCallback((listener: () => void) => runner.subscribeContext(listener), [runner]);
    // Redraw when the context facts the verdict reads change: the selection
    // the grid publishes (its own array, a stable snapshot) and whether its
    // rows can be selected at all. An unrelated context write redraws nothing.
    useSyncExternalStore(subscribe, () => runner.getContext().selectedRecords);
    const selectionAvailable = useSyncExternalStore(subscribe, () => runner.getContext().selectionAvailable);
    // The runner translates the refusal, so a language switch redraws too.
    useObjectTranslation();

    const gated: UIActionSchema[] = [];
    for (const action of actions ?? []) {
        const refusal = typeof action.onClick === 'function'
            ? undefined
            : runner.launchRefusal(action as Parameters<typeof runner.launchRefusal>[0]);
        if (refusal === undefined) {
            gated.push(action);
        } else if (selectionAvailable !== false) {
            gated.push({ ...action, disabled: true, disabledReason: refusal });
        }
    }
    return gated;
}

/** An `action:bar` of list header actions, drawn through {@link useListHeaderLaunchGate}. */
export function ListHeaderActionBar({ schema }: { schema: ActionBarSchema }) {
    const actions = useListHeaderLaunchGate(schema.actions);
    return <SchemaRenderer schema={{ ...schema, actions }} />;
}
