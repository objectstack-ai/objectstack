/**
 * The ONE source of the "this modal target does not resolve" diagnostic.
 *
 * Three surfaces refuse a `type: 'modal'` action whose string `target` names no
 * page, and each used to spell the refusal itself:
 *
 * - `hooks/useActionModal.tsx` — `modalHandler`, the ActionProvider `onModal`
 *   path;
 * - `hooks/useConsoleActionRuntime.tsx` — `modalActionHandler`, what a list
 *   page / SDUI page / declared-actions bar dispatches through;
 * - `views/RecordDetailView.tsx` — `modalActionHandler`, the record page's own
 *   copy of the same rule.
 *
 * They drifted (objectui#4767). PR #4764 retired the object fallback and
 * rewrote only the FIRST one, so the two a console user actually reaches kept
 * saying the target "names no page or object to open" and pointed at
 * `type: 'script'` — the "or object" half describing a limb that no longer
 * exists, and no mention of `type: 'form'`, which is the replacement the
 * retirement handed authors. Three hand-written copies of one fact is a fact
 * that goes stale two-thirds of the time; this module makes it one.
 *
 * The refusal itself is decided by the callers (each already knows whether
 * `resolveModalTarget` returned `null`) — this module only says it. Keeping the
 * wording here and the judgement there is deliberate: a message helper that
 * also decided would be a fourth place to disagree about the contract.
 *
 * Not i18n'd, on purpose and unchanged by this module: all three sites emit
 * hard-coded English today. These are AUTHORING diagnostics — they name a
 * metadata key and a spec type and are read by whoever wrote the action, not by
 * an end user in their own language. Translating them is a separate decision
 * with its own card; this module only stops the English from disagreeing with
 * itself.
 */

/**
 * What a modal `target` IS, plus the validated way to do the thing the retired
 * object fallback used to do.
 *
 * Verbatim from PR #4764's `modalHandler` message (maintainer ruling on
 * objectstack#6739): a `type: 'modal'` action's string `target` names a PAGE,
 * only. The spec TSDoc (`packages/spec/src/ui/action.zod.ts`), the published
 * docs (`content/docs/ui/actions.mdx`) and `defineStack`'s cross-reference walk
 * (`packages/spec/src/stack.zod.ts`) all agree, and the walk REJECTS a
 * registered modal action whose target is not a declared page.
 *
 * Opening an object's form from an action is `type: 'form'` with an
 * `object.view` FORM-view target — the same capability, validated end-to-end.
 */
const MODAL_TARGET_CONTRACT =
  "a modal action's `target` names a PAGE, only. " +
  "To open an object's form, use `type: 'form'` with an `<object>.<view>` target.";

/**
 * The other way out, for the author who wanted to collect input and then run
 * something server-side rather than to open a form.
 *
 * Only the console runtimes offer it, because only they sit on the dispatch
 * path a `type: 'script'` action would take instead (objectstack#3959 removed
 * the server fallthrough that used to swallow this case silently).
 */
const SERVER_HANDLER_HINT =
  "Or use `type: 'script'` with `params` to collect input and run a handler.";

export interface ModalTargetRefusalOptions {
  /**
   * The refused target, exactly as authored. `undefined`/`null`/`''` means the
   * action carried no target at all — a distinct authoring mistake, reported
   * distinctly.
   */
  target?: unknown;
  /**
   * The action's `name`, when the caller has one. The console runtimes dispatch
   * a whole `ActionDef` and can say WHICH button misbehaved; `modalHandler` is
   * handed the bare target and cannot.
   */
  actionName?: string;
  /** Append {@link SERVER_HANDLER_HINT}. The console runtimes pass `true`. */
  serverHandlerHint?: boolean;
}

/**
 * Build the refusal message for a modal target that resolved to no page.
 *
 * Every variant carries the same two facts — the refused target by name, and
 * `type: 'form'` as the way to open an object's form — because those are what
 * objectui#4767 found missing from the copies users actually read.
 */
export function modalTargetRefusalMessage(options: ModalTargetRefusalOptions = {}): string {
  const { target, actionName, serverHandlerHint } = options;
  const name = target == null ? '' : String(target);

  if (!name) {
    // No target to name, so no contract sentence to attach it to: the fix is
    // "declare one", not "declare a different one".
    return actionName
      ? `Action "${actionName}" is type:'modal' but has no target to open.`
      : 'Modal action has no target to open.';
  }

  const lead = actionName
    ? `Action "${actionName}" is type:'modal' but its target "${name}" names no page`
    : `Modal target "${name}" names no page`;

  return `${lead} — ${MODAL_TARGET_CONTRACT}${serverHandlerHint ? ` ${SERVER_HANDLER_HINT}` : ''}`;
}
