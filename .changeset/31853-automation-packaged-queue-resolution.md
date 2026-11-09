---
'@objectstack/skills': patch
---

docs(skills): objectstack-automation says which queue a packaged assignment rule or approval step names, and what a refusal does

Clause-②: no
Metadata-protocol: none

`skills/objectstack-automation/SKILL.md` § Assignment rules now teaches how a packaged rule's `assignTo: { type: 'queue', value }` resolves (ADR-0150 D3): the package's own queue, else the one holder in its declared `dependencies` closure plus `sys`. Otherwise the name is refused, `outside-closure` (only an undeclared package or the environment declares it) or `ambiguous-in-closure` (two holders in the closure), and the row is written ownerless, in no queue, with a warning in the server log once per rule and organization. An organization's `sys_assignment_rule` row and a rule no package ships still read environment-wide (two package holders: `ambiguous-in-environment`). A name no `queues` entry declares still reads the organization's `sys_queue` row.

`references/state-machines-and-approvals.md` teaches the same for a packaged flow's `queue` approver, read from the package whose flow body runs: a refusal leaves the node unopened with `APPROVER_DIRECTORY_UNREADABLE` naming every candidate, `retryable: false`, and no fallback slate. A deployment-authored flow or a `.custom` override reads environment-wide. The automation evals gain a case whose package declares the dependency on the queue's package.

Paid down first by cutting eight restatements, each keeping its other home:

1. SKILL.md, the `api` flow-type row's "needs a start-node `secretRef`": § Inbound webhook triggers, the `secretRef` / `secret` row.
2. SKILL.md, the `approval` node row's "suspends the run … `approve` / `reject` branch": the reference's § Approvals (Flow Nodes) opening paragraph.
3. SKILL.md, § Assignment rules' `approvers: [{ type: 'queue', value: 'crm_support_intake' }]` literal: the reference's Approver Types `queue` row, which the kept link reaches.
4. SKILL.md, § Trigger Configuration's "This is the start node alone, not a whole flow": the section heading ("on the `start` node").
5. The reference's "e.g. `previous.status != 'escalated' && record.status == 'escalated'`": SKILL.md § Trigger Configuration's start-node example.
6. The reference's "approval flows live in your normal `flows: [...]`": § Approvals (Flow Nodes), "authored as an Approval node on an ordinary flow".
7. The reference's "— you opt in, edge by edge": the same item's "This is the only thing that legalizes the cycle".
8. The reference's "(flow conditions: the trigger snapshot; hook conditions: the stored record overlaid with the write's payload)": the time-word cheat sheet's flow-condition row, and objectstack-data `references/data-hooks.md` for hook conditions.

The remainders move the ceilings under the standing ruling 「A:先削重复,余额按实测提高」 (ruling record 6513306068, letter B), pinned at the measurement: SKILL.md 6568 -> 6687 (+119), the reference 5825 -> 5916 (+91).
