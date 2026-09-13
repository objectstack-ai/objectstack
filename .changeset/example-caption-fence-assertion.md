---
"@objectstack/spec": patch
---

The reference-docs renderer now refuses an `@example CAPTION` with no code block beneath it,
instead of publishing an orphaned caption.

`@example CAPTION` is declared to be *the caption of the fence beneath it*, and the renderer
acts on that reading: it promotes the tag into a bold lead-in on the assumption that a fence
follows. Nothing asserted that one did. When a module header captioned a listing and wrote its
rows as bare prose, the promotion still fired and the rows below collapsed into a single run-on
paragraph — consecutive non-blank lines are one markdown paragraph, and the docs site loads no
`remark-breaks`. Two customer-facing reference pages shipped that way.

The assumption is now a precondition the generator checks before it emits anything. A module
description whose caption has no block under it fails the docs build with a message naming the
caption and the source-side fix, the way the renderer already refuses a heading it cannot
renumber. Deliberately a refusal in the generator rather than a separate gate: it makes the
wrong page impossible instead of detecting it afterwards, and it is scoped to the population
the renderer actually renders — module doc blocks — rather than to every `@example` line in the
package.

⛔ The check never asks whether a run of prose is "really" a table. Shape-sniffing is exactly
what this renderer refuses to do, and what an author writes instead of a fence is not knowable
from the text. It asks only the question the contract already states: is there a block beneath
the caption? An author who wants those words as ordinary prose writes them without the tag.

Both code kinds satisfy it. An indented block reaches the page as a fence — the render loop
re-emits it as one — so a caption above one captions a fence by the time a reader sees it. All
twelve captions in the corpus are fenced today and are unaffected; no schema behavior changes.
