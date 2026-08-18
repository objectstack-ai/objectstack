---
"@objectstack/service-automation": patch
---

`service-automation`'s README labels its two docs links with the pages they land on (#9668)

Two entries in the README's See Also list named artifacts that are not what the link
resolves to. `Flow Builder Guide` lands on the Automation **section index**
(`content/docs/automation/index.mdx`, `title: Automation`); `Trigger Reference` lands on
the automation **schema** reference index (`content/docs/references/automation/index.mdx`,
`title: Automation Protocol`), which lists every automation schema — approval, flow,
state-machine, webhook and eleven more — not triggers. Both destinations resolve and both
are the right section-level target for a package README, so the mismatch is on the label
axis, not the destination axis, and only the labels changed.

Each new label is the destination page's own `title` frontmatter, with a gloss compressed
from that page's own `description`, so the label is checkable against the page rather than
invented. **No URL changed**, and in particular the plausible-looking
`references/studio/flow-builder` was not adopted: it is a **Studio** reference, not the
automation service's.

The third docs link in this README — `Flows`, at the end of the flow-node section — was
verified and left alone. It points at a specific page (`content/docs/automation/flows.mdx`,
`title: Flow Metadata`), and that page does carry the per-node `config` reference, loop and
parallel containers, subflows, waits and error handling that the sentence promises.

Documentation only: no API, behaviour or type surface changes.
