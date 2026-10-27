---
'@object-ui/i18n': patch
---

fix(i18n): the zh chatbot build header separates the verb from the app name

Clause-②: no
Metadata-protocol: none

- **zh `chatbot.build.built`** reads `已构建 · APP` instead of `已构建APP`, and **zh `chatbot.build.building`** reads `正在构建 · APP…` instead of `正在构建APP…`. A name pasted straight onto the verb ran on into one word, most visibly with a Latin-script name (「已构建Library Lending Management」). The separator is the ` · ` the sibling `chatbot.build.builtAndLive` (`已搭建并上线 · APP`) already used.
- The unnamed-build stand-in goes through the same frame, so it now reads `正在构建 · 你的应用…`, the same shape `builtAndLive` already had for an unnamed build.
- Values only: no key is added, removed or renamed. `ja` (name first, then a particle) and `ko` (already spaced) did not run on and are unchanged; the Latin-script packs are untouched.
