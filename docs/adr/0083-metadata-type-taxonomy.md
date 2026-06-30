# ADR-0083: Metadata-type taxonomy — the Airtable 3, plus 3 (one categorization every surface derives from)

**Status**: Accepted (2026-07-01)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0046](./0046-package-docs-as-metadata.md) (docs are metadata — book/doc join the type set), [ADR-0063](./0063-two-kernel-agents-skills-are-the-extension-primitive.md)/[ADR-0064](./0064-tool-scoping-to-agent.md) (ask vs build agents — the build agent authors across these types), [ADR-0054](./0054-runtime-proof-for-authorable-surface.md) (the governed authorable-surface set), [ADR-0080](./0080-ai-authored-ui-jsx-source.md)/[ADR-0081](./0081-trusted-react-page-tier.md)/[ADR-0082](./0082-react-component-contract-governance.md) (the Interface pillar's page authoring).
**Consumers**: `@objectstack/spec` (a canonical `METADATA_CATEGORY` map — the single source of truth), `studio.app.ts` (Studio nav groups), `@objectstack/cli` `packages/cli/src/utils/format.ts` (the `os` stats sections), the docs metadata reference, and the showcase **Start Here** teaching index.

**Premise**: Airtable teaches its whole platform with three pillars — **Data · Automation · Interface** — and that clarity is most of why it's learnable. ObjectStack has a *superset* of Airtable's surface (~27 top-level metadata types, including security, AI, and integration types Airtable has no equivalent for), but no single mental model that expresses it. The result: the two places that DO group types disagree and are each internally muddled —

- **`os` stats** (`format.ts`) groups into **Data · UI · Logic · Security**, with `action` filed under UI (it's behavior) and `agent` buried in Logic (it's AI).
- **Studio nav** (`studio.app.ts`) groups into a Build section that **mixes Data (objects) with Interface (pages/dashboards/reports)**, then splits **Logic (actions/hooks)** from **Automation (flows)** — two names for one concern — and scatters AI / Developer / Integration.

A learner can't form a model from that, and the build agent has no canonical category to reason with. This ADR fixes the *model*, once, and makes every surface derive from it.

> **Trigger**: "Airtable categorizes as Data / Automation / Interface; I have more metadata types — how do I express and present them better?"

---

## TL;DR

1. **Keep Airtable's three** as the core, because they're universal and already understood: **Data · Automation · Interface**.
2. **Add the three Airtable lacks** — they ARE ObjectStack's superset, so present them as the differentiator, not as clutter: **Access** (governance), **Intelligence** (AI), and **Integration** (the connective edge).
3. **Six pillars, not 27 flat types and not 3 overstuffed ones.** Each pillar has one **anchor** type shown by default; the rest disclose progressively.
4. **Integration is a connective EDGE, not a peer pillar** — its types cross-cut Data and Automation, so it gets a primary home plus a documented secondary, avoiding "one type in two menus."
5. **One categorization is the source of truth** (`METADATA_CATEGORY` in spec). Studio nav, `os` stats, the docs reference, and the showcase Start Here all DERIVE from it — they stop disagreeing.

---

## The model

| Layer | Pillar | Anchor | Metadata types | One line |
|---|---|---|---|---|
| **Core (Airtable parity)** | **Data** | `object` | object · field · validation · state_machine · dataset | the model & records |
| | **Automation** | `flow` | flow · hook · action · trigger · job | behavior & logic |
| | **Interface** | `page` | app · page · view · form · dashboard · report · theme · (book · doc) | human surfaces |
| **Superset (beyond Airtable)** | **Access** | `role` | permission · role · profile · sharing | who can do what |
| | **Intelligence** | `agent` | agent · tool · skill | agents, tools & skills |
| **Edge (cross-cutting)** | **Integration** | `datasource` | datasource · connector · webhook | connect to the outside |

**Why 3 + 3 and not 3, or 6 flat.** Three is too few — it forces `role`/`agent`/`datasource` into pillars where they don't belong and hides exactly the capabilities that distinguish ObjectStack. Six *unranked* pillars lose the "everyone knows these three" anchor. Ranking them — **the familiar three, then the three that make it more than Airtable** — keeps the on-ramp and tells the positioning story in the same breath.

### Cross-cutting types (primary home + secondary)

A few types legitimately touch two pillars. Each gets ONE primary home (its place in nav/docs) and a documented secondary; **Integration is the secondary, never a duplicate listing**:

- `datasource` — primary **Integration** (it's a connection), extends **Data** (federated objects).
- `webhook` — primary **Integration** (an external endpoint), extends **Automation** (it fires/handles events).
- `connector` — primary **Integration**, extends **Automation** (actions call it).
- `book` / `doc` — primary **Interface** (human-facing content; ADR-0046), a "content" sub-shelf.

The rule: **primary home decides where it lives; the edge only narrates the connection.** No type appears in two menus.

---

## The single-source mandate

The taxonomy is encoded once and consumed everywhere:

- **Source of truth** — `@objectstack/spec` exports `METADATA_CATEGORY: Record<MetadataType, Pillar>` (plus optional `secondary`). This is the only place the mapping lives.
- **Studio nav** (`studio.app.ts`) — groups become the six pillars in this order; the current Build/Logic/Automation muddle is replaced. Operational views (API console, flow runs, packages) move to a separate "Operate" area, not mixed into the authoring pillars.
- **`os` stats** (`format.ts`) — the four ad-hoc sections become the six pillars; `action`→Automation, `agent`→Intelligence are corrected by construction.
- **Docs** — the metadata reference is ordered by pillar with the anchor first.
- **Showcase Start Here** — extends from "the 4 page kinds" (Interface only) to the full six-pillar map, so the showcase teaches the whole platform, with page authoring as the Interface pillar's deep-dive.

**Progressive disclosure is mandatory.** Default views show six pillars + the anchor type each; the full type list is one expand away. Never present 27 flat types.

---

## Consequences

- **One model, learnable in one breath** — "Airtable's three, plus Access, AI, and Integration." The on-ramp is familiar; the superset is the pitch.
- **Surfaces stop disagreeing** — Studio, CLI, docs, and the showcase derive from one map; `action`/`agent` can't be miscategorized in one place and not another.
- **The build agent gains a category to reason with** — "this is an Automation type" / "this is an Access type" is now a fact in the spec, not folklore.
- **Cost** — a one-time reclassification of two existing groupings (`format.ts`, `studio.app.ts`) and a new `METADATA_CATEGORY` export. Existing metadata is untouched (this is presentation, not schema).

## Alternatives considered

- **Force everything into Airtable's exact 3.** Rejected — it hides Access/AI/Integration (the differentiators) and mis-files `role`/`agent`/`datasource`.
- **Present all ~27 types flat** (today's Studio Build group, partially). Rejected — unlearnable; no model.
- **Let each surface group however it likes** (today's reality). Rejected — Studio and CLI already disagree; the build agent has no canonical category.
- **Make Integration a seventh peer pillar.** Rejected — its types cross-cut Data/Automation; a peer pillar forces duplicate listings. The connective-edge framing keeps a single home per type.
