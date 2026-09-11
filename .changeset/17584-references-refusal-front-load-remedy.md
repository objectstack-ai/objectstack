---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the `/references` refusal front-loads its ADR-0110 D3 prescription, so the #5423 bound cannot cut the remedy (#17584)

`GET /api/v1/meta/:type/:name/references` refuses an unanswerable target type
(`field`, addressed by the composite key `<object>.<field>` that no reference
site can hold) with a prescriptive 501: it names the question that IS
answerable, `GET /api/v1/meta/object/<owner>/references`. That clause is the
half ADR-0110 D3 exists to deliver — the admin "Used by" panel renders an empty
answer as *"Nothing in the metadata graph points at this item. Safe to delete."*
to an operator whose next click is a delete.

Since #16146 the refusal crosses the REST boundary through the shared #5423
bound (`CLIENT_MESSAGE_MAX`, 500 characters), which truncates the **tail**. The
sentence back-loaded the prescription and interpolates the object name twice, so
it grew about three characters per character of name and the remedy was the
first thing a long name cost. Measured through the real route on the unrepaired
sentence: a 37-character object name beside a 37-character field name composed
502 characters and arrived as `…/api/v1/meta/object/<obj>/referenc…` — the
opener still readable, the URL cut mid-path, an instruction that 404s if
followed. `crm_opportunity_line_item_snapshot_v2` is 37 characters, and nothing
caps a metadata name near that (the ceiling is the storing column's
`maxLength`; the widest is `sys_metadata.name` at 255).

The clauses are re-ordered so truncation costs the **explanation** instead. No
behaviour moves: the refusal decides exactly what it decided before, the same
`NOT_IMPLEMENTED` / `501` / `refusal` declaration is raised for exactly the same
targets, and the bound is untouched. Callers matching on the message's opening
words will see the new order; matching on `error.code` is unaffected.

FROM: `References to a 'field' item cannot be computed. … Ask the owning object
instead: GET /api/v1/meta/object/<owner>/references.`
TO:   `Ask the owning object instead: GET /api/v1/meta/object/<owner>/references.
References to a 'field' item cannot be computed, because …`
