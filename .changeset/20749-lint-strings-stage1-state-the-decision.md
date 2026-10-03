---
'@objectstack/lint': patch
---

Flow, hook, action, approval and expression rule findings no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Some findings these rules show to authors through `os validate`, `os lint` and `os build`, and the startup-registry findings a plugin author reads, pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- Flow patterns: the record-change date-equality hint and the date-equality filter hint name the declarative alternative, a `schedule` flow whose start node carries a `config.timeRelative` descriptor; the unscoped `runAs` hint says `runAs` is enforced, so a run with no trigger user has its data operations refused rather than run unscoped; the unbounded bulk-write hint says `multi: true` is how a flow declares bulk intent and that the engine admits a whole-object write declared that way; the revise-target hint says the run-resume route continues a pause on a service-owned node type only through the service that owns it; the two interpolation hints say a flow node value is a string template in which only single-brace tokens resolve.
- Startup-registry findings: the open-vocabulary notes say the engine judges node types only once the vocabulary is sealed at `kernel:bootstrapped`; the prescription describes the lazy cache resolution and the ADR-0104 attestation by what each does; the assertive-wording finding describes its two incidents, and how each was fixed, in words.
- Expression findings: the field-level `visibleWhen` consequence names the `current_user` binding ADR-0089 D1 gives every runtime record surface; the retired `script` keys finding says spec 17 made `script` a call to a registered function and nothing else.
- Trigger readiness: the array `triggerType` hint says multi-event arrays are deferred until two independent projects need a combination other than created-or-updated.
- Body writes, readonly writes and approvals: the discarded `ctx.record` write says the snapshot stays read-only by design and an action writes through `ctx.api`; the `readonlyWhen` write finding says a bulk update strips the field from every matched row once any one of them is locked; the `queue` approver finding says the type was deprecated rather than built; the empty-slate hint says the admin override may act on any pending request, so that one nobody in its slate can decide never stays stuck.
- The other findings drop a citation the sentence already explained.

Text only: no rule id, severity, condition or finding moves. A tool or test that matches the old text (for example a tracker-number suffix) needs the new spelling.
