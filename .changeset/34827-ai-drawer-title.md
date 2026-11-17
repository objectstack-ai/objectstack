---
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

fix(i18n): the AI drawer is titled with the top-bar button's name in every language

Clause-②: no
Metadata-protocol: none

The top-bar button that opens the AI drawer is named "AI Assistant" (zh-Hans 「AI 助手」), but the drawer's title, in the side panel, in the window-filling form and on the phone sheet, read only "Assistant" (「助手」). `console.ai.dock.title` now carries the same value as `topbar.aiAssistant` in all eleven built-in packs, so the button and the panel it opens use one name. The drawer's inline English fallback for that key reads "AI Assistant" too.
