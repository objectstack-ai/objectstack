---
'@object-ui/console': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): on a desktop the Studio refusal's way home and the AI-unreachable sentence name the app start page

Clause-②: yes (widening) — one new published language-pack key, console.ai.unavailableErrorDesktop, in all eleven packs
Metadata-protocol: none

From 768 px up the platform home page is retired, and the way home opens an app's start page. Two desktop texts still named a home page:

- A caller without Studio access who opens `/studio` sees a refusal with a 「Back to home」 button. On a desktop it now reads 「Back to app start page」 (zh: 返回应用起始页), the app pill's row label, as the console's other way-home buttons do.
- When the AI service cannot be reached, the `/ai` screen's sentence ended 「…try again, or head back home.」 while its button already read 「Back to app start page」. On a desktop the sentence now ends 「…try again, or go back to the app start page.」, in every language.

A phone, whose Home is still its app list, keeps 「Back to home」 and 「…or head back home.」. No targets change. The new sentence is the language-pack key `console.ai.unavailableErrorDesktop`, added in all eleven packs; no key is removed or renamed, and no props or exports change.
