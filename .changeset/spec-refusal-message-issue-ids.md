---
"@objectstack/spec": patch
---

Strip internal tracker ids from the refusal messages an author actually reads (#12124)

Fifteen zod refusal messages across nine `packages/spec/src` files ended a sentence with
an internal issue id. Those strings are printed **at** the author, verbatim, the moment
their metadata is refused — by `os validate`, by a publish gate, by a parse — and the
reader has no tracker to open. A `#NNNN` there is a citation-shaped token that resolves to
nothing, in the one place the sentence most needs to be actionable.

```text
before: A field condition's keys are field names, never $-prefixed operators (#7711).
after:  A field condition's keys are field names, never $-prefixed operators.

before: ... refused at authoring time because the query path refuses it too
        (400 INVALID_FILTER, #5869).
after:  ... refused at authoring time because the query path refuses it too
        (400 INVALID_FILTER).
```

Where a customer-resolvable anchor already carried the meaning it was kept and the id
dropped beside it: the second example above keeps `400 INVALID_FILTER`, which is the token
an author can actually match their query-path error against. Where the reference is
load-bearing for an *internal* reader only, it moved to an adjacent `//` comment (four
sites: the endpoint publish gate's two `#5040` section pointers, the summary-field rule's
founding incident, and the interim renderer precedence behind the doubled-redirect
refusal). Elsewhere it is simply gone — git history keeps the anchor.

Text only. **No accept/reject behaviour changes**: the same inputs are refused on the same
schemas with the same issue `code`, `path` and error shape; only the sentence changes.
Test twins that pinned the old wording now pin the new text plus a negative assertion that
the message carries no issue id at all.

The convention is held mechanically from here — `check:doc-authoring` gained a third rule
that parses `packages/spec/src` and reds on an id in any refusal-message string. It parses
rather than scanning lines because refusal prose here is written as multi-line string
concatenation: a single-line `message:.*#[0-9]{3,5}` grep sees 1 of the 16 literals.
