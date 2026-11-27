---
'@object-ui/app-shell': patch
---

feat(app-shell): opening the assistant from 「Ask AI」 after closing it starts a new conversation, and the drawer's header names the conversation (ui ADR-0057 Amendment A5)

Clause-②: no
Metadata-protocol: none

- **What an opening from the entry shows.** The entry is the top bar's 「Ask AI」 button, the keyboard toggle (Ctrl/Cmd+Shift+I), Home's 「Ask AI」 and the record pane's 「Ask AI」. After the user closes the drawer (×, the entry or the toggle again, dismissing the phone sheet), and the first time in a browser tab, it opens a new conversation; the last one stays in history. After the console closed the phone sheet because the page under it moved (a link in an answer, Back), it shows the same conversation. While a write the AI proposed waits for the user's approval in the conversation shown at the close, it shows that conversation. A build conversation (the `build` agent, a package, an app whose `defaultAgent` is `build`) opens as before. A named conversation (a history row, an `/ai…` address), a reload, the assistant bus and filling the window are unchanged.
- **A new conversation leaves no empty row.** It is started with `forceNew`: nothing is created until the first message is sent.
- **The header.** One row in the side panel, the full window and the phone sheet: the conversation's label as the history list shows it ("New conversation" before the first send), then ＋ (a new conversation), the history as an icon button (side panel and sheet; the full window shows the history beside the chat), 「···」 and ×. The drawer is no longer titled "AI Assistant".
- **Writes awaiting approval reach the assistant bus.** The chat now records, per conversation, an AI-proposed write that waits for the user's approval, so the entry's amber marker also shows for it while the chat is closed.
- **The record pane's assistant button** reads 「Ask AI」 with the chat-bubble icon, like the top bar's, and opens as the entry does.
