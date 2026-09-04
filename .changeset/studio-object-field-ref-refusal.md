---
"@objectstack/lint": minor
"@objectstack/metadata-protocol": minor
---

A publish now refuses an object whose `highlightFields` names a field that does not exist on it — the same gate that refuses a code-authored stack.

`list-view-field-unknown` inspects `view.columns`, and Studio's app builder mints no `view` items at all, so the reference-integrity family had nothing to inspect on the only artifacts the click path authors. What it authors is the **object**, and an object-level field-name list was covered by nothing that could refuse: measured on `origin/main`, `runtimeAuthoringRulesFor('object')` dispatched seven rules with no reference-integrity rule among them, while the object-level existence check that did exist (`semantic-role-field-unknown`) is `warning`, advisory-tier and CLI-only. So `os validate` exited 0 on a dangling reference and the runtime publish door — the only door a Studio, REST `/meta` or MCP author has — said nothing at all.

The reproduction is the natural click order, not a contrived one: click-create a field (Studio mints it as `field_10`), add it to `highlightFields`, then give it a label — the API name auto-derives to `health_score` and `highlightFields` keeps `field_10`. Anyone who names a field after placing it produces this.

- **New rule `object-field-ref-unknown` (`error`)**, in `@objectstack/lint`, over the object-level field-name **lists** that no rule owned: `highlightFields` (ADR-0085) and `publicSharing.redactFields`. It resolves through the same `object-graph` seam as the rest of the family, so the three shared skips hold — an object outside the stack, an object with no readable field map (ADR-0015 `external`), and a registry-injected system column resolved **per object** (`highlightFields: ['owner_id']` is a live pointer on an owned object and a real miss under `ownership: 'none'`).
- **It runs on the runtime publish door.** The reference-integrity suite entry's `runtimeTypes` gains `object`, and the suite's per-member declaration keeps the crossing narrow: this is the only member that judges an object snapshot; every other member keeps `['flow', 'view']` or the frozen `['flow']` default.
- **`validateSemanticRoles` keeps the provenance question** at the same position (`semantic-role-field-unprovisioned`, still `warning`) and no longer restates existence — one finding per path, at one tier.
- **`probes.checked` gained an `objects` counter.** Its absence was the tell: a receipt reading `{seeds: 0, views: 0, widgets: 0}` was accurate while the objects the package published were probed by nothing.

## Migration

**A publish that used to succeed can now be refused (HTTP 422, `INVALID_METADATA`).** The receipt names the rule id `object-field-ref-unknown` and the offending path, name-keyed on the wire — for example `objects.proj_task.highlightFields[1]` — plus the string that was written and the fields the object actually has.

To fix a dangling reference, do one of:

- rewrite the entry to the field's current API name (after a Studio label edit the derived name is the one to use — `field_10` becomes `health_score`); or
- drop the entry from the list.

`os validate` / `os build` / `os lint` report the same finding at `error`, so a stack can be repaired before it reaches a publish. If an object legitimately points at a platform-injected system column, no change is needed — the rule resolves those per object and stays silent where the platform really provisions them.
