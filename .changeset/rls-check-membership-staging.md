---
"@objectstack/plugin-security": patch
---

An RLS `check` clause that reads a membership-resolver key now resolves on a bare insert.

An app that registers an `IRlsMembershipResolver` (ADR-0105 D11) and authors `using` + `check` twins reading its key — `record.employer_org in current_user.employer_org_ids` — saw reads resolve the key and every bare insert refused with `PERMISSION_DENIED` ("would violate a row-level CHECK"), whether or not the payload carried the value the policy wanted. The membership sets were staged onto the request context only inside the read-filter computation; `computeWriteCheckFilter` compiled the `check` clause against a context in which the key had never been staged, so the variable was unresolved, the policy dropped, and the write failed closed. The two write shapes that passed — a by-id update and an insert of a `controlled_by_parent` child — passed only because an earlier read on the same context (the pre-image, the master read) happened to stage it first.

The write path now stages the resolver's sets itself, immediately before the `check` clause compiles, so a `check` resolves exactly the variables its `using` twin resolves regardless of whether the request read first. Staging is memoized per request context, so the read-first shapes still consult the resolver once. Nothing is relaxed: with no resolver registered, a resolver that throws, or a key the resolver does not publish, the policy still drops out and the write is still refused.
