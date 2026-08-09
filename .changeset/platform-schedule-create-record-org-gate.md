---
"@objectstack/metadata-protocol": patch
---

feat(metadata-protocol): publishing a platform-level scheduled `create_record` flow is refused on a multi-organization deployment unless it declares `organization_id` (#6285)

A scheduled flow that creates records now has to say which organization those
records belong to — but only where the answer matters, and only where nothing
else can supply it.

## What was open

`ScheduleTrigger` builds its context as
`{ event: 'schedule', params: { jobId, flowName, schedule } }` — no `tenantId`.
PR #6153 closed the engine half of #5494 on the rule "stamp what the engine
KNOWS": a run whose trigger resolved an organization carries it through, and the
driver's tenant machinery fills `organization_id` on rows that omit it. A
schedule resolves none, so nothing fills anything — and the dominant production
shape of the whole issue is a nightly sweep, which fires on a schedule and not
by hand. Every row it created was born `organization_id` NULL.

That is not a cosmetic NULL. A `(organization_id, …)` unique index does not
constrain across NULL and an org-scoped query does not see the row, so the
damage is duplicate and invisible records — hotcrm#698's duplicate numbering —
in a stored shape no later fix can retroactively repartition.

## What now happens

At the runtime publish gate, this exact combination is refused with the existing
422 `INVALID_METADATA` envelope (`code` + `status` + `issues[]`, ADR-0112):

- the deployment enforces an organization wall
  (`postureEnforcesWall(resolveTenancyPosture())` — `group` or `isolated`,
  ADR-0105 D1), **and**
- the flow is platform-level (the write carries no organization), **and**
- it binds to the **schedule** trigger, **and**
- it contains a `create_record` node, **and**
- that node declares no `fields.organization_id`.

Every limb's negation still publishes: a single-organization deployment, an
org-scoped write, any other trigger, a flow that creates nothing, and — the
fix an author actually applies — a node that declares
`config.fields.organization_id`. That key is not new: `CreateRecordConfigSchema`
has always carried `fields`, and #6153's fill-only stamping already guarantees
an author-supplied value wins over any engine fill. One issue is reported per
offending node, including nodes nested inside `loop` / `try_catch` / `parallel`
regions, each addressed at the key the author must write.

Drafts are never gated (#4463 D1) and the draft to active promotion is, so the
draft door is not a bypass. `OS_ALLOW_UNLINTED_METADATA_WRITES=1` degrades the
refusal to a loud log exactly as it does for the 26 shared rules, and
`os migrate meta --stored` stays carved out.

## Where the judgement lives, and why

Runtime publish gate only; `os validate` / `os build` / `os lint` do **not**
judge this. Both inputs the rule needs are facts about the **deployment**, and
the CLI runs on a build machine — a shared rule would sentence every
single-organization repository on whatever `OS_TENANCY_POSTURE` happened to be
exported in CI. The gate's caller performs the two readings and passes them as
arguments, so the judgement itself stays a pure function of its inputs.

Migration note for a multi-organization deployment: an existing scheduled flow
keeps running untouched — the gate blocks new writes only, never stored rows —
but the next time one is republished it will be refused until the
`organization_id` is declared, which is the same edit that stops it writing
outside the organization partition.
