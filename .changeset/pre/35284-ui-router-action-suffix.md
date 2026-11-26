---
'@objectstack/skills': patch
---

docs(skills): the objectstack-ui router names action files by the suffix the platform writes

Clause-②: no
Metadata-protocol: none

The Actions row of the `objectstack-ui` routing table pointed at `src/actions/*.actions.ts`. The metadata type registry declares `**/*.action.ts` for actions and `os generate action` writes `src/actions/NAME.action.ts`, so an agent reading a project's actions by that glob missed every generated file. The row now names `src/actions/*.action.ts` first and `*.actions.ts` second: a project loads its actions through the barrel its `objectstack.config.ts` imports, so a plural file the barrel names loads as well.

Trap 3 keeps its pointer to the Dashboards rule and drops the list of widgets, datasets and charts after it, which the routing table already sends to that rule.
