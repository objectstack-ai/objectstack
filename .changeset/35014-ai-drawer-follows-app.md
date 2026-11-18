---
'@object-ui/app-shell': patch
---

fix(app-shell): the AI assistant drawer's conversation follows the app

Clause-②: no
Metadata-protocol: none

The console's AI drawer kept showing a conversation after you moved to another app. Once the drawer had been pointed at a thread (a history row, "New chat", the app switcher, "Edit with AI"), that thread stayed on screen in every app you opened next, while the drawer's scope already named the new app. A request typed there could land in the previous app.

The drawer now records the app it was in when it was pointed at a thread, and shows that thread only in that app, or in the app the thread names. Anywhere else it shows that app's own build thread, or its blank start page. The switch is automatic; there is no prompt. Going back to the first app shows its thread again, with any unpublished plan still in it. Home and the built-in apps keep their app-less thread, as before. The Studio copilot and the drawer inside the same app still show one thread.

The `ask` thread is not split per app (ui ADR-0057 Amendment A2: `ask` stays ambient), so it reads the same in every app.

An old `/ai…` link still opens the conversation it names, in the app it lands in.
