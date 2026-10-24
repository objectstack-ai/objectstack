// ADR-0013 D2: pure decision helper for "reconcile on stream-transport failure".
//
// The agent runtime persists the FINAL assistant reply BEFORE it streams it, so a
// transport drop after completion leaves a complete reply in the conversation. On
// a chat stream error the client re-fetches the conversation and asks: did this
// turn actually finish? If so it renders the persisted reply instead of a scary
// "Response failed / Retry" (which would blindly re-run and risk re-planning).
//
// "Finished" = the last message is an assistant message that carries non-empty
// TEXT (not merely tool calls). A thread that ends on a tool result, or on an
// assistant turn that only emitted tool calls, did NOT produce a final reply →
// genuine failure → show the banner.

export interface ReconcileMessageLike {
  role: string;
  parts: Array<{ type: string; text?: unknown }>;
}

export function isReconcilableCompletedTurn(
  messages: ReconcileMessageLike[] | undefined,
): boolean {
  if (!messages || messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return false;
  return last.parts.some(
    (part) => part.type === 'text' && String(part.text ?? '').trim().length > 0,
  );
}
