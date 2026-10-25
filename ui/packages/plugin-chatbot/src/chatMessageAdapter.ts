/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `@object-ui/types` <-> `@object-ui/plugin-chatbot` chat-message seam
 * (objectui#4399).
 *
 * Two chat-message types meet in `renderer.tsx`, both on purpose:
 *
 *   - `@object-ui/types`' `ChatMessage` is the **authoring** contract — the
 *     JSON an SDUI schema declares (`ChatMessageSchema` in
 *     `packages/types/src/zod/complex.zod.ts`), so it is deliberately wider:
 *     a `'tool'` role and a `Date` timestamp are authorable.
 *   - `./ChatbotEnhanced`'s `ChatbotEnhancedMessage` is the **runtime**
 *     contract — what the React components actually render, so it is
 *     deliberately narrower (three roles, string timestamps) and carries
 *     render-only keys the authoring surface has no business declaring
 *     (`buildProgress`, `charts`).
 *
 * Until this module they met as three `messages as any` casts, which erased
 * ALL of the drift rather than the parts that are intentional: a new authored
 * role or a newly required runtime key would have kept compiling and surfaced
 * as rendering behaviour instead of a type error. This module is that seam,
 * written down — one conversion, each narrowing decision named and tested.
 *
 * ## Narrowing decisions
 *
 * | key                    | authoring                                | runtime                     | decision |
 * |------------------------|------------------------------------------|-----------------------------|----------|
 * | `role`                 | `'user'\|'assistant'\|'system'\|'tool'`  | `'user'\|'assistant'\|'system'` | `'tool'` renders as an **assistant** bubble — see {@link toRuntimeRole} |
 * | `timestamp`            | `string \| Date`                         | `string`                    | `Date` -> ISO 8601 — see {@link toRuntimeTimestamp} |
 * | `toolInvocations[].state` | v6 states **minus** the three approval states, **+ legacy** `'partial-call'\|'call'\|'result'` | v6 states only | legacy -> v6, per the authoring type's own doc comment — see {@link toRuntimeToolState}. The approval states are runtime-only (objectui#10018): the seam's INPUT admits them for API-mode values — see {@link SeamToolInvocation} |
 * | `metadata`             | `any`                                    | *not declared*              | passed through untouched (see "Pass-through" below) |
 * | everything else        | same shape on both sides                 | —                           | passed through untouched |
 *
 * ## Pass-through — why this is a conversion and not a reconstruction
 *
 * The adapter narrows the drifting fields **by name** and spreads the rest. It
 * deliberately does NOT rebuild the message field-by-field, because the values
 * arriving here are not always plain authored ones: in API mode they are
 * RUNTIME messages carrying `buildProgress`, `blueprintProgress`, `charts` and
 * tool invocations bearing the HITL / draft-review extensions. A field-by-field
 * rebuild would silently drop the approval cards, the "Review N changes"
 * affordance and the build panel.
 *
 * What changed in objectui#4424: those keys are no longer preserved *by faith*.
 * The hook used to declare its output as the authoring type and reach the
 * runtime values through `uiMessagesToChatMessages(...) as OuiChatMessage[]`,
 * so this module could only ever have SPREAD keys it could not see. The hook
 * now declares {@link ObjectChatMessage} — the truth about both of its modes —
 * and this seam accepts {@link SeamChatMessage}, which names the runtime-only
 * keys as optional members. The spread therefore carries them as DECLARED
 * properties: `tsc` can see what survives, and the pass-through tests type
 * their API-mode fixture directly instead of casting it into place.
 *
 * The compile-time value of the seam is unaffected by that: a new authored
 * `role` makes {@link toRuntimeRole} unassignable, and a newly REQUIRED runtime
 * key makes {@link authoredToRuntimeMessage}'s return type red. Both are the
 * type error the cast used to swallow.
 *
 * ## Why the seam's INPUT is wider than the hook's OUTPUT
 *
 * {@link SeamChatMessage} keeps authoring's `timestamp?: string | Date`, while
 * {@link ObjectChatMessage} narrows it to `string`. That is not an oversight:
 * both hook modes absorb the `Date` before they emit (via
 * {@link toRuntimeTimestamp}), but this module is exported from the barrel for
 * hosts holding raw authored messages — the `Date` still has to die somewhere,
 * and this is the somewhere. `AuthoredChatMessage` remains assignable to
 * `SeamChatMessage`, so every existing caller is untouched.
 */

import type {
  ChatMessage as AuthoredChatMessage,
  ChatToolInvocation as AuthoredToolInvocation,
} from '@object-ui/types';
import type {
  ChatbotEnhancedMessage as RuntimeChatMessage,
  ChatbotEnhancedToolInvocation as RuntimeToolInvocation,
} from './ChatbotEnhanced';

/**
 * The render-only MESSAGE keys — declared by the runtime contract, never by the
 * authoring one. Named here (rather than spelled out at each use) so that
 * adding a render-only key to `ChatbotEnhancedMessage` and forgetting this
 * list is a one-line fix in one place. objectui#4424.
 */
type RuntimeOnlyMessageKeys = Pick<
  RuntimeChatMessage,
  'buildProgress' | 'blueprintProgress' | 'charts'
>;

/**
 * The render-only TOOL-INVOCATION keys — the HITL approval id, the ADR-0033
 * draft review, the proposed plan / changes cards and the ADR-0057 P4 builder
 * handoff. `mapMessages.ts` lifts every one of them out of a tool result; the
 * authoring contract declares none of them. objectui#4424.
 */
type RuntimeOnlyToolInvocationKeys = Pick<
  RuntimeToolInvocation,
  | 'pendingActionId'
  | 'draftReview'
  | 'proposedPlan'
  | 'proposedChanges'
  | 'builderHandoff'
  | 'replayOutcome'
>;

/**
 * One tool invocation as it actually crosses this seam: the authoring contract,
 * plus the render-only extensions it may ALREADY be carrying when it arrives
 * from API mode.
 *
 * `state` is the union of both vocabularies, DERIVED from the two contracts
 * rather than listed (objectui#10018). The authoring union sheds the AI SDK's
 * three approval states — an author may not claim one — but an API-mode value
 * crossing this seam is a RUNTIME value and does carry them: `mapMessages`
 * promotes `approval-requested` from a pending-action result, and app-shell's
 * hydrated history hands the persisted approval states back in. Typing this
 * input as the authoring state alone would make the runtime's own values
 * unassignable to the seam that exists to carry them.
 *
 * `AuthoredToolInvocation` stays assignable to this (its state vocabulary is a
 * subset, and every added key is optional), so a host holding plain authored
 * invocations is unaffected.
 */
export type SeamToolInvocation = Omit<AuthoredToolInvocation, 'state'> & {
  state?: AuthoredToolInvocation['state'] | RuntimeToolInvocation['state'];
} & Partial<RuntimeOnlyToolInvocationKeys>;

/**
 * One message as it actually crosses this seam — the seam's INPUT contract.
 *
 * The authoring shape (`role: 'tool'`, `timestamp: Date`, legacy tool states —
 * all still narrowed below) widened by the render-only keys an API-mode value
 * already carries. This is what lets the pass-through spread preserve those
 * keys as declared properties rather than as invisible runtime baggage
 * (objectui#4424); see "Pass-through" in the module doc.
 *
 * `AuthoredChatMessage` is assignable to it, and so is the hook's
 * `ObjectChatMessage` — the two callers this seam serves.
 */
export type SeamChatMessage = Omit<AuthoredChatMessage, 'toolInvocations'> & {
  toolInvocations?: SeamToolInvocation[];
} & Partial<RuntimeOnlyMessageKeys>;

/**
 * `timestamp: string | Date` -> `string | undefined`.
 *
 * The authoring schema declares `z.union([z.string(), z.date()])`, and the
 * runtime renders `{message.timestamp}` straight into a React child — a `Date`
 * there is the classic "Objects are not valid as a React child" throw.
 *
 * This is the SINGLE expression of that absorption in the package: it was
 * inlined in `useObjectChat`'s `normalizeMessages`, which now calls this
 * function instead (objectui#4399). `normalizeMessages` keeps applying it
 * because the hook's own `messages` output — and the `onSend(content,
 * messages)` callback it feeds — has always handed hosts an ISO string, not a
 * `Date`; the absorption is expressed once here and consumed at both points.
 *
 * The `instanceof` check (rather than an unconditional `.toISOString()`) is
 * deliberate: authored JSON is not type-checked at runtime, so a value that is
 * neither `string` nor `Date` must be dropped rather than thrown on. That is
 * the behaviour the inlined version had.
 */
export function toRuntimeTimestamp(
  timestamp: AuthoredChatMessage['timestamp'],
): string | undefined {
  if (typeof timestamp === 'string') return timestamp;
  return timestamp instanceof Date ? timestamp.toISOString() : undefined;
}

/**
 * `role: 'user' | 'assistant' | 'system' | 'tool'` -> the runtime's three roles.
 *
 * **The named decision (objectui#4399): an authored `'tool'` message renders as
 * an assistant bubble, with its content shown.** That was already the outcome
 * before this module existed — the cast let `'tool'` reach `<ChatbotEnhanced>`,
 * whose `formatMessageProps` maps everything that is not `'user'` to the
 * assistant bubble — but it was an implicit fallthrough that nothing recorded
 * and nothing tested. It is now a decision this seam makes, by name.
 *
 * Note this is NOT the same decision as `formatMessageProps`: that one maps a
 * runtime role to one of the vendored `<Message>` element's two BUBBLE styles
 * (and folds `'system'` in as well). This one answers a different question —
 * which runtime role an authored `'tool'` message IS. `'system'` keeps its own
 * runtime role here and still renders as the centred system pill in
 * `<Chatbot>`.
 *
 * Changing the rendering of tool messages (a transcript-style tool block, say)
 * is a UX card, not this one; it would start here.
 */
export function toRuntimeRole(
  role: AuthoredChatMessage['role'],
): RuntimeChatMessage['role'] {
  return role === 'tool' ? 'assistant' : role;
}

/**
 * Tool-invocation `state` -> the runtime's AI SDK v6 lifecycle states.
 *
 * The authoring type accepts three extra legacy values and its own doc comment
 * already declares the mapping: "the legacy `partial-call`/`call`/`result`
 * values are kept for back-compat; the AI SDK v6 lifecycle states map cleanly
 * to `input-streaming`/`input-available`/`output-available`". This implements
 * exactly that sentence — the fourth drift the `as any` was hiding, which the
 * issue's table did not list.
 *
 * Rendered-output note: an authored legacy state used to reach `getToolState`
 * unrecognised, which fell through to `'running'` and rendered a status badge
 * with no label. Only schema-authored `toolInvocations` can carry the legacy
 * spelling (API-mode messages come from `mapMessages`, which emits v6 states
 * already), so this is the one place where the seam's honesty changes a
 * rendered result — from a blank badge to the state the author declared.
 */
export function toRuntimeToolState(
  state: SeamToolInvocation['state'],
): RuntimeToolInvocation['state'] {
  switch (state) {
    case 'partial-call':
      return 'input-streaming';
    case 'call':
      return 'input-available';
    case 'result':
      return 'output-available';
    default:
      // Every remaining member of the seam's union IS a runtime state, so the
      // compiler proves the narrowing here rather than a cast asserting it.
      return state;
  }
}

/**
 * One authored tool invocation -> one runtime tool invocation.
 *
 * Only `state` drifts; everything else is spread through, which is what keeps
 * the runtime-only extensions (`pendingActionId`, `draftReview`,
 * `proposedPlan`, `proposedChanges`, `builderHandoff`) alive on the API-mode
 * path. Since objectui#4424 the parameter names them ({@link
 * SeamToolInvocation}), so `passthrough` carries them as declared properties
 * instead of as keys the compiler cannot see — see the module doc.
 */
export function toRuntimeToolInvocation(
  tool: SeamToolInvocation,
): RuntimeToolInvocation {
  const { state, ...passthrough } = tool;
  return { ...passthrough, state: toRuntimeToolState(state) };
}

/**
 * One chat message -> the message shape the chat components render.
 *
 * This is the seam. The three `messages as any` casts in `renderer.tsx` are
 * this function now.
 *
 * The parameter is {@link SeamChatMessage} rather than the bare authoring type
 * (objectui#4424): both are accepted — `AuthoredChatMessage` is assignable to
 * it — but naming the render-only keys is what makes the pass-through
 * compiler-visible instead of a documented act of faith.
 */
export function authoredToRuntimeMessage(
  message: SeamChatMessage,
): RuntimeChatMessage {
  const { role, timestamp, toolInvocations, ...passthrough } = message;
  return {
    ...passthrough,
    role: toRuntimeRole(role),
    timestamp: toRuntimeTimestamp(timestamp),
    toolInvocations: toolInvocations?.map(toRuntimeToolInvocation),
  };
}

/**
 * Array form of {@link authoredToRuntimeMessage} — what the three registered
 * renderers call.
 *
 * Call sites memoize on the input array (`useMemo(..., [messages])`) so the
 * runtime array's identity stays exactly as stable as the hook's own output:
 * local mode holds its messages in state, and the chat components key effects
 * and memos off the `messages` prop.
 */
export function toRuntimeMessages(
  messages: readonly SeamChatMessage[] | undefined,
): RuntimeChatMessage[] {
  return (messages ?? []).map(authoredToRuntimeMessage);
}
