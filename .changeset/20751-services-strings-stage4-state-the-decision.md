---
'@objectstack/service-automation': patch
'@objectstack/plugin-audit': patch
---

Automation refusals, prescriptions, log lines and run-object field help, and the activity type help, no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Some strings these two packages show to flow authors, operators and administrators pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- `@objectstack/service-automation`: the refusal for a `fieldValues` write map says a runtime alias for it was rejected by design, so the node keeps one strict `fields` key; the refusal for a screen field's `visibleIf` says a predicate under any other key is never read, so the field always shows, and a `required` field meant to stay hidden then blocks the screen from ever being submitted; the undeclared-config-key refusal says the built-in node types were reconciled so that every key their executors read is declared; the unknown-function error in a flow value expression says such a name is refused rather than evaluated to null, which would write the field as undefined; the inert-connector warning says entries without a `provider` are catalog descriptors, while an entry that names a `provider` is a connector instance that provider's installed executor materializes; the `sys_automation_run` field help says the paused node's type decides who may continue a run (an approval pause only through its owning service), that rows written before run history recorded its trigger were not backfilled, and that a finished run's bounded step log keeps its per-node detail across a restart; three bridge debug lines say what each bridge provides. The bulk-intent guidance, the degraded-connector dispatch error and retry lines, the user-less `runAs` warning and refusal, the unclaimed-branch warning, the script-function and node-config refusals and the `sys_flow_dispatch` description drop their citations.
- `@objectstack/plugin-audit`: the `sys_activity` `type` help, whose English text all four shipped locale bundles carry, says the vocabulary is open by decision, not a gap awaiting enforcement.

Text only: no status, error code, field, route or control flow moves. A client or log filter that matches the old text (for example a tracker-number suffix) needs the new spelling.
