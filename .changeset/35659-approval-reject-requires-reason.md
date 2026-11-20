---
'@objectstack/plugin-approvals': patch
---

fix(approvals): rejecting through the `approval_reject` action requires a reason

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is one param declaration in this plugin's own object metadata: approval_reject's comment goes from optional to required, so a call to that action without a reason is refused. No stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller of the `approval_reject` action on `sys_approval_request` that sends no `comment`: the call used to reject the request and is now refused before the approvals route runs. It ships `patch` because it is a non-protocol breaking change (AGENTS.md Post-Task Checklist step 3): the declaration belongs to this plugin, and nothing a metadata author writes changes, so `Metadata-protocol` is `none`.

`approval_reject` declares its `comment` param `required: true`, so a rejection always carries its reason. The declared param contract judges the call before the target route runs, and it counts an empty or whitespace-only string as missing: the REST action door (`POST /api/v1/actions/sys_approval_request/approval_reject`) and MCP `run_action` answer `400` with the param contract's refusal naming `comment`, and the console's param dialog holds Confirm until a reason is typed. A reject with a reason runs as before. The action's AI tool description now says the reason is required. The `POST /api/v1/approvals/requests/:id/reject` route itself is unchanged.

Fix for a caller: send the reason as `params.comment` when you run `approval_reject`.
