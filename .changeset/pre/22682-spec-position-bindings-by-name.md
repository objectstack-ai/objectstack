---
"@objectstack/spec": minor
---

feat(spec)!: an approver `position` and a decision-output `position` are catalog names, listed from the metadata registry (ADR-0131 D4)

Clause-②: yes

<!-- adr-0087: not-required (no-migration-prescription) no authorable key, export or stored value changes: a position approver's value and a position decision output were names at run time and stay names; only the published picker binding changes shape -->

**BREAKING** for a renderer that derives its position picker from `APPROVER_VALUE_SOURCES`, shipped as `minor` under the repo's launch-window convention for breaking changes. Authored and stored metadata is untouched.

- **`APPROVER_VALUE_BINDINGS.position`** is a registry binding, `{ source: 'registry', type: 'position' }`. It was a record binding on `sys_position` rows that committed the row's `name`. `ApproverValueBinding` gains the `registry` member: the value is the machine name of an item of metadata `type`, and a catalog item has no other reference, so the member carries no `valueField`.
- **`APPROVER_VALUE_SOURCES.position`**, the same binding on the wire (the `xRef.sources` of the approval node schema's `approvers[].value`), reads `{ source: 'registry', type: 'position' }`. It read `{ source: 'data', object: 'sys_position', valueField: 'name' }`, and its type gains the `{ source: 'registry'; type: string }` member. A picker for a `registry` source lists `GET /api/v1/meta/position`, which serves the code-declared and the environment-authored positions alike, and commits the item's `name`. `user`, `team` and `department` still read `data`.
- **A `position` decision output collects position machine names**, the value the approver type of the same name takes. `DecisionOutputDef` said every picker collected record ids. The one reader that interprets a position output, an `expression` approver with `resolveAs: 'position'`, filters `sys_user_position.position` by name, so a `sys_position` id there routed the request to nobody. The `type` and `multiple` descriptions now say what each picker commits.
- **The runtime does not change.** The approvals engine routes a position approver, an escalation target and a `resolveAs: 'position'` value by name, as it did.

Why: positions are declared metadata (ADR-0131 D2), and every reference to one names it and resolves through the registry (D4). The `sys_position` table is a mirror that the ADR-0131 cutover retires, so a picker that lists its rows lists the mirror, not the catalog.
