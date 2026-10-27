---
'@object-ui/app-shell': patch
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

fix(app-shell,plugin-chatbot,i18n): the AI build page's preview header names the app by its label and says what the build card says about publishing; the progress panel shows labels

Clause-②: no
Metadata-protocol: none

- **Preview header.** The Live Canvas header named the app by its machine name and said "unlisted until published" (「未发布 · 仅自己可见」) for any materialized build, even one the build card beside it called live, and never changed. It now reads the build card's own answer: the label the card names the app by (`checklist.app.label`, else the build's label) and whether the card says the app is live. A live build reads "Live app — LABEL" (「运行预览 · LABEL」), and the header follows the card when the build is published. A materialized build the card does not call live keeps the unlisted note.
- **`ChatbotEnhanced`.** New optional prop `onBuildResult({ appName, label, live })`, fired by a build card when it has an app and again when its label or live state changes. Additive; hosts that do not pass it see no change.
- **Listed materialized builds are live.** A build envelope that says `materialized: true` and `appHidden: false` (the app is already listed, ADR-0045 publish = live and visible) now reads "Built and live" on the card. The draft review carries `appHidden` when the envelope says it.
- **Progress items.** `ChatBuildProgress.items` entries gain an optional `label`; the panel shows it in place of the machine name, and falls back to the name when a frame carries none.
- **Footnote.** The finished card's posture line names Publish in the chat instead of Studio, in every shipped locale.
- **i18n.** New key `console.ai.liveCanvasLive` in every locale; `chatbot.build.draftPosture` reworded.
