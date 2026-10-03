// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #21504 — `ui/AIChatWindowProps` (`mode`, `agentId`, `context`, `aria`) leaves
// with the `ai:chat_window` page element it described (ADR-0049
// enforce-or-remove; triage ruling 5963897014, the `user:profile` precedent of
// #14159). No renderer for the element ever shipped, so none of the four keys
// was read anywhere. Its only carrier, the `ComponentPropsMap['ai:chat_window']`
// row, is kept as a whole-bag refusal (`retiredComponentProps`) that answers
// with the element's retirement prescription, and the node itself is refused by
// name at `PageComponentSchema.type`. Upgraders get the D3 semantic entry
// `ui-ai-chat-window-retired`.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look.
export const entry = 'ui/AIChatWindowProps';
