---
---

Docs-only: curate the v17 platform release page (`content/docs/releases/v17.mdx`)
and wire it into the releases nav — the layer-3 "big picture" the
releases-maintenance playbook requires for every major, sourced from the pending
changesets (backend) and the four bundled `@objectstack/console` refresh entries
(frontend).

Leads with breaking changes + migration (Node 22 floor, the opt-in export axis,
the `ApiMethod` shrink, user-less flow runs refused, the three retired authorable
aliases, `agent.tools[]`, approval-request visibility, sharing `full`/`group`,
membership grade, better-auth 1.7 account identity, the deleted SDK surface, the
GraphQL removal, the `ObjectStackProtocol` alias, datasource fail-fast, per-tenant
`unique`, the i18n contract fixes and the dead-spec-cluster prune), then the new
capabilities (ADR-0104 files-as-records, dynamic approver routing, the reconciled
SDK surface, write observability, analytics correctness), a Console section, and
an upgrade checklist.

Also corrects the plugin manifest `compatibility` example in
`content/docs/protocol/kernel/plugin-spec.mdx`, which showed keys the schema does
not declare (`objectstack` / `node` instead of `minObjectStackVersion` /
`maxObjectStackVersion` / `nodeVersion`) and a Node 18 floor that #3825 retired.

Releases nothing.
