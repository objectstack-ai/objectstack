---
'@objectstack/lint': minor
---

**BREAKING for runtime metadata writes** — the ADR-0090 D3 vocabulary freeze (`security-role-word`) now runs at the runtime publish gate for all six collections it judges, so `position` and `app` writes are gated for the first time (#19370)

Clause-②: no (narrowing)

`validateSecurityRoleWord` moves from `surfaces: ['cli']` to
`['cli', 'runtime-publish']` and declares
`runtimeTypes: ['object', 'permission', 'book', 'position', 'app']` — the write
type of every collection it judges. `position` and `app` join
`TYPE_TO_STACK_KEY` in `runtime-gate.ts` so the gate can build a per-write
snapshot for them.

**The refusal set grows.** A runtime metadata write — Studio's designer, REST
`/meta`, an MCP/AI author — that carries the reserved word `role` in a
security-relevant identifier or label is now refused with the 422 lint envelope
instead of stored. Concretely, these used to succeed at that door and no longer
do:

- an object, field, action or field-group header named or labelled for `role`;
- a permission set named or labelled for `role` (e.g. `role_manager`);
- a documentation book named or labelled for `role`;
- a **position** named or labelled for `role` (e.g. `sales_role`);
- an **app** named or labelled for `role` (e.g. `role_hub`).

The platform vocabulary the rule freezes is unchanged and so is its fix-it text:
`permission_set` for capability, `position` for distribution, `business_unit`
for hierarchy. Nothing is renamed, retired or added — this is the same rule,
with the same rule id and the same findings, now enforced at the fourth door as
well as by `os validate` / `os build` / `os lint`.

**Nothing changes for the three CLI commands.** Both security entries have run
on all three since the #8310 split, and their union is byte-identical to before.

**Stored rows are untouched** (#4463 D4: the gate blocks new writes, never the
read path), and `OS_ALLOW_UNLINTED_METADATA_WRITES=1` remains the migration-window
escape hatch for a tenant that authored one of these names before this landed.

Why the two types were held back until now, and why the wait ended: `position`
and `app` are `allowRuntimeCreate: true`, so a position called `sales_role` could
be minted through the one entrance a tenant has while an object of that name was
refused. Under #7220 one rule id sits on ONE side of the wall, so the rule was
split out and held back whole rather than wired for a subset of its collections.
Mapping the two write types is what lets it cross, also whole.

Deliberately NOT done: carrying `positions` / `apps` as `RuntimeStackContext`
collections. A collection joins that context because some rule resolves
references into it; this rule resolves nothing — it judges each identifier and
label on its own — so a sibling position tells it nothing about the written one
and its finding cancels in the gate's differential either way. Carrying them
would cost the publish door one indexed `sys_metadata` read per write for no
verdict change.

<!-- adr-0087: not-required (no-migration-prescription) nothing is retired, renamed or added: no authorable key changes, no stored shape is rewritten, and `objectstack migrate meta` has nothing to reach. The rule, its rule id, its vocabulary and its fix-it text are unchanged since ADR-0090 D3; only the surface it runs on widens. An affected tenant renames its own metadata, which is tenant data rather than a spec migration. -->
