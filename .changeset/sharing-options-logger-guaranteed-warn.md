---
"@objectstack/plugin-sharing": minor
---

⚠️ **Published-contract break for external hosts.** The `logger` option on the three
PUBLICLY EXPORTED options types — `SharingServiceOptions`, `ShareLinkServiceOptions` and
`SharingRuleServiceOptions` — now **requires** a `warn` channel, and its members carry real
signatures (`(msg: any, ...rest: any[]) => void`) instead of bare `Function`. A host that
constructs any of these services with `{ logger: { info, error } }` compiles today and stops
compiling after this release; add `warn` (or drop the `logger` option) to migrate. Nothing
about the services' runtime behaviour changes, and no call site inside this package moved:
the tightening was measured at ZERO compile errors within `plugin-sharing`, so the whole cost
falls on hosts, which is why it is declared here rather than shipped as a patch.

Why: #9754 rules that a sink declaring an optional `error` must declare a NON-optional
`warn`, so a durability report always has somewhere to land — an optional `error` beside an
optional `warn` is a contract that permits silence. These three sinks were red against that
rule from the day it was written and were only invisible to its checker until #11069 taught it
to read bare `Function` as a channel. The maintainer ruled on 2026-08-24 (#10556) that they
tighten rather than stay baselined, shipped `minor` with the break named here.

The bare-`Function` spelling was also its own defect: `Function` is not assignable to a
concrete signature, so `record-orphan-cleanup.ts` could not tighten its own `MinimalLogger`
while these producers stayed loose (#10692). That producer-side blocker is now clear.
