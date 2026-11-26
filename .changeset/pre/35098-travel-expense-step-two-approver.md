---
'@objectstack/scenarios': patch
---

fix(scenarios): the `travel_expense` build prompt names who approves a claim's second step

Clause-②: no
Metadata-protocol: none

The detailed prompt said a claim goes to "the department manager first (a manager's own claim goes to the finance manager), then Finance". Finance has two members, and the same sentence calls one of them the finance manager, so a build could route the second step to that manager, while every seeded step-2 row and the `manager_approves_step_one` operation name the Finance officer. The prompt now says the second step goes to a Finance officer (Finance staff other than the finance manager), in English and Chinese. The expected approver, the seed rows and the operation are unchanged.
