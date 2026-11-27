---
'@object-ui/app-shell': patch
---

feat(app-shell): the assistant's entry is an outlined 「Ask AI」 button at the end of every page's top-right group, and a route with no page header gets it in its corner

Clause-②: no
Metadata-protocol: none

The assistant's one standing entry was a 32 px transparent robot icon named only by its tooltip. It is now an outlined button with a chat-bubble icon and the words 「Ask AI」 (「问 AI」 in Chinese), read from the string Home's own 「Ask AI」 button already carries in every built-in pack (`home.askAI`), so no language pack changes. The words are the platform's; no app renames them.

- **Where it sits.** Last in the page's top-right button group (comments, help, Ask AI), so it ends the page header's row and the record page's navigation row; after help on Home's bar and in the phone's top bar. A route whose page draws no button group (search results, a component page, the app editor) gets the same button pinned at the content's top-right corner, and loses it as soon as its page draws a group.
- **When the header runs out of room.** The console page header now measures whether its title (and, on a page that offers the folded actions, its description) still fits beside the words; when it does not, the words are hidden first and the icon stays, before the page's own actions fold and before the title is cut. They come back once there is room again, after any fold has opened. The decision reads the header's own width, never a breakpoint, so a longer translation hides its words sooner.
- **Phone.** The icon alone, a 44 px target.
- **Accessibility.** With its words shown the words are the button's accessible name; with the icon alone `aria-label` carries the same words. On a Mac the tooltip shows ⌘⇧I and the button declares `aria-keyshortcuts="Meta+Shift+I"`; on other platforms, where Ctrl+Shift+I opens the browser's developer tools, no shortcut is shown or declared.
- **Home.** Home's 「Ask AI」 opens the drawer through the same entry hook as the page's button (`useAskAiEntry`), still on the ask agent.

`useShellPageActionsSlot()`'s render function takes one more optional prop, `assistantIconOnly`, which a header that measures its own width passes; a header that passes nothing gets the button with its words, as before. The drawer keeps its title for now.
