---
"@objectstack/service-automation": minor
"@objectstack/lint": patch
---

feat(automation): opt-in single-hop lookup expansion for record-change flow templates (#3475)

A record-change flow can now declare `expand: ['<lookup_field>', …]` on its start
node config so node templates resolve `{record.<lookup>.<field>}` (e.g.
`{record.account.name}` in a notify title, closing the #3426 gap for lookups).

The engine re-reads the declared relations AFTER identity resolution, as the
run's OWN principal — `resolveRunDataContext` honors `runAs`, so a `runAs:'user'`
run reads the referenced object as the **triggering user** (its RLS/FLS enforced)
rather than system-elevated. This is what made expansion unsafe to do in the
trigger's re-read (which has no resolved grants) and is why it lives in the
engine (new `AutomationEngine.setRecordExpander`, bridged by the plugin to the
same data engine the CRUD nodes use).

Only the declared relation keys are grafted onto the run record, so bare lookup
ids and `multiple` lookup arrays (#1872) on other relations — and the formula
fields the trigger already hydrated — are untouched. Opt-in ⇒ zero cost when
unused; best-effort ⇒ a re-read failure leaves the record unexpanded and never
breaks the flow.

The `os validate` lint rule `flow-template-lookup-traversal` (#3426/#3472) is now
suppressed for a relation once the flow declares it in `config.expand`.
