---
"@objectstack/rest": minor
---

fix(rest): a public form that declares no fields now REFUSES the submit instead of accepting every key the caller sent (#6920)

`POST /api/v1/forms/:slug/submit` narrows a visitor's suppliable keys to the
fields the matched FormView's `sections` declare — and the filter read
`allowedFields.size === 0 || allowedFields.has(k)`. For a form with no declared
fields that limb degenerated, and not into "every field of the object": it
accepted **every key the caller sent**, minus the `#3022` server-managed anchors
and the three prototype keys. Measured on the real registered handler,
anonymously, against a `sections: []` form:

    submit accepted = ["email","internal_margin","internal_tier",
                       "not_even_a_field","status","subject"]

`not_even_a_field` is not declared on the target object at all. So an anonymous
visitor could set `status`, a workflow stage, an internal tier — anything, on
the one object the form targets. `publicFormGrant` (ADR-0056) keeps the insert
scoped to that object, so this was never a cross-object hole; it was an
unbounded **column** surface on one. The way in is an ordinary authoring
mid-state: the author creates the public form and wires its sections later.

**What changes.** A form whose sections declare no fields now answers
`400 VALIDATION_ERROR` and inserts nothing. The message names the empty
declaration and gives the author's fix ("wire the fields it collects into the
form's sections"); it names no object, field or slug, because this reply is
readable by anyone on the internet. The three authoring shapes that reach it —
`sections: []`, sections present but declaring no fields, and `sections` omitted
— are treated identically, and the refusal keys off the **declaration**, not the
body, so an empty POST is refused too rather than inserting a blank row.

`VALIDATION_ERROR` is the standard ADR-0112 catalog's generic validation
failure, and what `HttpStatusErrorCodeMap[400]` already names a bare 400. It is
deliberately not a newly minted `FORM_*` synonym of a condition the catalog
already covers.

**Why a refusal and not a silent drop.** Dropping the keys would have kept the
`201` and changed no wire status, but it would swallow data the caller believes
it wrote — a visitor is told their support ticket was filed and an empty row is
stored. Loud is also the only answer that reaches the author, who is the one who
can fix it.

**This is a behaviour change on a shipped success path.** A deployment that
today collects submissions through a section-less public form starts getting
`400`s. That form's read side already publishes nothing (`fields: {}`) since
`#6601`, so it cannot render either — the two planes now enforce the same rule,
"the form declares what it collects", on both. **Fix: declare the fields in the
form's `sections`.** Forms that already declare sections are entirely
unaffected — that path never consulted the removed limb.

`#3022`'s anchor guarantee is preserved unchanged: `owner_id`,
`organization_id`, `id` and the audit columns remain unsuppliable on this
surface, including when a FormView mis-declares one in a section.
