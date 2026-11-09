---
'@objectstack/scenarios': patch
---

fix(scenarios): the scorer's bare-name Build check judges only the names ADR-0150 keeps on the literal prefix, and the build prompt asks for the prefix only there

Clause-②: no
Metadata-protocol: none

The scorer (`gradeItemNames`, `./score`) used to fail every non-object item a build named without the app's namespace, and the build and iterate prompts told the agent to prefix every item. ADR-0150 identifies flows, actions, jobs, tools, skills, agents, apps, pages, dashboards, permission sets and every other behavioural type by (package, name), so a build that names them plainly is correct.

- **Judged now:** views, docs and positions named `<namespace>_<short>`, and capabilities named `<namespace>.<short>`. A bare one is still a failing Build check `bare-name:<type>:<name>`, and a capability spelled `<namespace>_<short>` now fails too. Objects stay judged by `defineStack`.
- **No longer judged:** every other collection. A build whose only finding was a bare flow, action, dashboard or permission set name now passes its Build half.
- **Prompts:** the naming rule names the prefixed types and says every other item needs no prefix, while the names the prompt states (persona permission sets, dashboards, agent actions) are still used exactly.
