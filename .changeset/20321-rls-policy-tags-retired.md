---
'@objectstack/spec': minor
---

feat(spec)!: retire `rowLevelSecurity[].tags` — no mainstream platform tags a row-level policy, and nothing here ever read one (#20321)

Clause-②: yes (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner, the `(narrowing)` arm above and the ADR-0087 disposition below).

`tags` is removed from the row-level security policy (`RowLevelSecurityPolicySchema`,
the entries of a permission set's `rowLevelSecurity`). ADR-0049
enforce-or-remove, graded RETIRE by the maintainer's criterion for
declared-but-unenforced families — does a mainstream platform have the
capability? None does: Salesforce sharing rules, Dataverse security roles and
PostgreSQL RLS policies carry no tag attribute, and compliance reporting there
keys on the rule itself.

The key promised "categorization and reporting" for governance and compliance.
Nothing ever read it. Measured before removal, each against a lit control: the
RLS compiler reads a policy's `name`, `object`, `operation`, `positions`,
`enabled` and predicates, never `tags`; objectui's permission preview renders
the policy COUNT and its policy editor neither seeds nor reads the key; cloud
has no reader. No example, default permission set or cloud source wrote it.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `rowLevelSecurity[].tags` | delete the key. To limit whom a policy applies to, list the positions in `positions` — a tag never did that. To say why a policy exists, use `description`. |

**The one-line fix: delete `tags:` from every row-level security policy.**
`os migrate meta --from 17` lists the mechanical edits for existing sources;
apply them by hand.

⚠️ Runtime behaviour is deliberately **unchanged**. No access decision ever
depended on a tag, so removing the key removes no behaviour. What changes is the
answer an author gets: a policy carrying `tags` is now refused at parse, with the
prescription, instead of being stored with no effect. An author who wrote a tag
such as `managers_only` believing it scoped the policy now learns that only
`positions` does.

### The retirement kit

- **A `retiredKey()` tombstone** on `RowLevelSecurityPolicySchema` (the
  `priority` posture one key over): `tsc` types the key `never`, and every parse
  raises the prescription rather than a bare unknown-key verdict. The shape's
  did-you-mean never offers it: a near-miss `tag` is refused as unknown.
- **D2 conversion `permission-rls-tags-removed`** (step 18, retired from the load
  path): a lossless delete over `permissions[].rowLevelSecurity[]`, so a stored
  permission row that still carries the key replays clean through the
  rehydration seam, while a live author is refused rather than rewritten.
- **`RETIRED_KEYS_BY_MAJOR[18]`**: `security/RowLevelSecurityPolicy:tags`, and
  the family's D3 entry `permission-rls-tags-retired`, which states what the
  strip cannot decide — any report, audit filter or review process built on the
  belief that policy tags were read needs another path.
- **The liveness row stays**, `dead`, under its tombstone (the key is still in
  the walked shape); `authorable-surface/security.json` carries it as
  `security/RowLevelSecurityPolicy:tags [RETIRED]`, and the generated reference
  pages print the prescription in place of the old describe.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec`
is published, so this is breaking for consumers no telemetry was consulted for.

<!-- adr-0087: registered permission-rls-tags-removed, permission-rls-tags-retired -->
