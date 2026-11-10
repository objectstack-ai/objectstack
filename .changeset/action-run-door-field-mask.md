---
'@objectstack/runtime': patch
---

fix(runtime)!: an action the metadata does not show a caller is one that caller cannot run, on every run door (ADR-0106 D1)

Clause-②: no (narrowing) — every door that runs an action by name in a caller's context (`POST /api/v1/actions/...`, bare and addressed, MCP `run_action`, a host's `dispatchAction`, and the action that admits an MCP `resume_run`) now runs for a caller only an action the `/meta` projection serves that caller, and answers any other exactly as it answers a name nothing declares. ADR-0106 D1 already promises that a field the caller cannot read does not exist for that caller, so no stated contract is narrowed; what narrows is the run a caller with a `readable: false` field holds. Nothing is widened: no answer member, error code or status is added.
Metadata-protocol: none
Skills-docs: no move — `skills/**` teaches the run doors only for actions a caller is shown; `content/docs/ai/connect-mcp.mdx` states the rule.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema and no stored shape changes: the run doors judge a caller by the projection the metadata doors already apply. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller with a `readable: false` field, on `POST /api/v1/actions/...`, on `dispatchAction`, and on MCP `run_action` and `resume_run` over HTTP (`/api/v1/mcp`).

- **The rule.** An action is run for a caller only where the `/meta` doors show it to that caller: the same judgement, asked through `projectMetaActionForCaller` (`@objectstack/rest`), against the object the door runs the action under. A param binding a field the caller cannot read — on that object, or on the object its `objectOverride` names — withholds the action.
- **The answer.** A withheld action is answered byte for byte as the same door answers a name nothing declares: the bare `/actions` arm's `404` (and `dispatchAction`'s), the addressed arm's `404` for its namespace or the environment, `run_action`'s not-found refusal, and for `resume_run` the refusal a run no flow action could have started receives. It is asked before every gate that reads the action's declaration on the caller's behalf (its capability gate, its activation switch, its param contract), so nothing is read or run.
- **Declared narrowing.** A caller who holds the action, and its capability, but cannot read a field one of its params binds can no longer run it. That includes an action on a field the caller may write but not read, such as one that sets a secret. To keep such a run, grant the caller read on every field the action's params bind, or give the action an inline param (`name` and `type`) in place of the field binding.
- **Refusal.** Where the caller's field visibility cannot be evaluated, or the projection would leave the action's object with no field, the run is refused as the `/meta` object door refuses the read: `FIELD_VISIBILITY_UNRESOLVED` / 503, fail-closed. Nothing runs.
- **Unchanged.** The system context, a D4-exempt caller (`manage_metadata`), and a deployment with no `security` service or with the mask switched off run every action as before; so does every caller for an action whose params bind only fields that caller reads, or none.
