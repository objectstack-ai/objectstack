---
"@objectstack/spec": minor
"@objectstack/lint": minor
---

fix(spec,lint): withdraw the `record:*` blocks from the react tier — no renderer read the props it published (#4413)

The react-tier contract published `objectName` / `recordId` on
`<RecordDetails>`, `<RecordHighlights>`, `<RecordRelatedList>` and
`<RecordPath>`, and no renderer read either prop. All ten `record:*` renderers
take their record from `useRecordContext()`, which only the record route
(`RecordDetailView`) and the metadata editor's preview (`PagePreview`) ever
mount; the `kind:'react'` page renderer wraps the page in a
`SchemaRendererProvider` alone. So the blocks rendered their "bind a record to
preview" placeholder — or, for `record:related_list` (the one that does read
`schema.objectName`), refused to fetch because the parent id never arrived. A
page authored exactly to contract came back EMPTY with nothing reported
anywhere, including by `os validate`, which resolved those props' field names
against the object they named: lint standing guard over a binding that never
ran.

Withdrawn rather than implemented. The contract was not merely unimplemented,
it was the wrong SHAPE: per-block bindings describe four independent fetches of
one record, which is exactly the coupling the shared record context exists to
prevent (`record:details` drops the fields a mounted `record:highlights`
registered; one inline-edit save bar commits them all under a single
`ifMatch`). Honoring the props would have fossilized that (Prime Directive
#12). The naming of that primitive — a record SCOPE an author wraps around the
family, one fetch, shared context — is the open design question, filed as #4444.

`@objectstack/spec` drops the four blocks from `REACT_BLOCKS` and gains the
ledger for why, plus the working replacement per type. The family is derived
from `ComponentPropsMap`, so a record component added later is gated the day it
lands — including the six that were never in the contract but are just as
reachable through the registry-built react scope.

`@objectstack/lint` gains `react-block-needs-record-context` (error), which
rejects them on a react page by tag and through `<Block type="record:…">`
alike, quoting the block that does work: `<ListView filters={['<lookup>', '=',
parentId]}>` for a related list, `<ObjectForm mode="view" recordId={…}>` for a
field panel. A locally-declared component of the same name shadows the injected
scope and is left alone.
