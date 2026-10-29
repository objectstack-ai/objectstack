---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

objectui: the guides teach only what ships. `guides/project-setup.md`'s sample
`package.json` no longer installs `@object-ui/plugin-ai` (retired; `18.2.0` was its
last release), the AI row of `guides/page-builder.md`'s plugin catalog lists
`plugin-chatbot` alone, and the README's package snapshot drops `plugin-ai` from the
plugin list (18, not 19) and `vscode-extension` from the tooling line (the extension
left the workspace). `evals/project-setup.json` case 1 (the full Vite + React setup)
now fails an answer that installs the retired package.
