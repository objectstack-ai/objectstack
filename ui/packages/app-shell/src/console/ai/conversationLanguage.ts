// Copyright (c) 2026 ObjectStack. Licensed under the UNLICENSED license.
//
// The language an AI CONVERSATION is being held in — distinct from the console
// UI locale. A user chatting in Chinese under an English console must get
// Chinese canned messages and confirm-card SEND text, not have English spliced
// into their thread (cloud#772). The conversation's own language wins; the UI
// locale is the fallback until a thread establishes one.
//
// Scope, narrowly: this probe governs text that LEAVES the console for the
// agent. It does not govern anything RENDERED — labels, badges and progress
// chips follow the UI locale like the rest of the console, which is where every
// pack's translation of them becomes reachable (objectui#3837 removed the one
// label that had drifted in here).

/** A message shape both the floating panel and the full-page chat can supply. */
interface LangProbeMessage {
  role?: string;
  content?: unknown;
  parts?: unknown;
}

/** Pull plain user text from either a bare-string `content` or `parts[]`. */
function userText(m: LangProbeMessage): string {
  if (typeof m.content === 'string') return m.content;
  const parts = m.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((p) =>
        p && typeof p === 'object' && (p as { type?: string }).type === 'text'
          ? String((p as { text?: unknown }).text ?? '')
          : '',
      )
      .join(' ');
  }
  return '';
}

/**
 * The conversation's language from its latest user message, or `undefined`
 * when it can't tell (no user turn yet / non-CJK text). CJK unified ideographs
 * → Chinese; anything else defers to the caller's UI-locale fallback.
 */
export function detectConversationLanguage(
  msgs: ReadonlyArray<LangProbeMessage> | undefined,
): string | undefined {
  if (!Array.isArray(msgs)) return undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.role !== 'user') continue;
    const text = userText(m);
    if (!text.trim()) continue;
    return /[一-鿿]/.test(text) ? 'zh-CN' : undefined;
  }
  return undefined;
}

/** True when the conversation is being held in Chinese. */
export function isConversationZh(
  msgs: ReadonlyArray<LangProbeMessage> | undefined,
): boolean {
  return (detectConversationLanguage(msgs) ?? '').toLowerCase().startsWith('zh');
}
