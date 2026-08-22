---
"create-objectstack": patch
---

Rewrite the scaffolded project's starter comments so a newcomer can actually
follow them (#10324). `objectstack.config.ts` and `src/objects/note.object.ts`
are the first two files opened after scaffolding, and between them they cited
four ADR identifiers, one bare issue number and the path of a release-time
script in this monorepo — none of which ship in, or are linked from, a
scaffolded project. `// per ADR-0097` read as a reference the reader was
failing to follow rather than as the context it was meant to be.

The explanations are kept and made self-contained; only the dead ends are
gone. Each now states the fact the identifier stood for — the protocol range
is checked before anything loads and was stamped to match the installed
version rather than hand-tuned; `automation` must stay whenever `plugins:`
lists a connector or the executors have nowhere to register; a declarative
`mcp` stdio transport is denied by default; the org-wide default is required
so the baseline is an authored decision — and points at the public docs page
that covers it in full. The blank `Dockerfile` likewise stops pointing at a
file in this repo and points at the self-hosting guide it already links.

A pin (`starter-comments-self-contained.test.ts`) keeps it that way from both
sides: no shipped template file may cite an ADR identifier, a bare issue
number or a repo script path, and the facts those references carried must
still be stated — so the comments cannot be "fixed" by deleting them. It also
resolves every canonical-origin docs URL in the shipped tree against
`content/docs`, because a link that 404s is the same defect one level out.
