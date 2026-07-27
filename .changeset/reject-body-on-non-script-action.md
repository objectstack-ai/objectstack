---
"@objectstack/spec": patch
---

feat(spec): reject a `body` on a non-script action — it would never run (#3530)

`Action.body` is documented as "only meaningful when `type === 'script'`", but
nothing enforced it. A `type: 'modal'` action authored with `params` and a
`body` — expecting the modal to collect the input and the body to write the
record on submit — passed validation, passed shape tests, and shipped a button
that opened a modal and silently wrote nothing. Non-script types all dispatch on
`target` (the page to open, the URL, the flow, the endpoint); there is no point
at which a renderer would invoke the body.

This is the same invisible-failure shape as the existing rule that rejects a
`script` action with neither `body` nor `target` (#2169), so it is enforced the
same way: a parse-time error that names the fix — `type: 'script'` collects the
same `params` and does run the body, and a modal that only opens a page should
drop the `body` and keep `target` naming the page.
