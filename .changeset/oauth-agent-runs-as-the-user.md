---
"@objectstack/plugin-security": minor
"@objectstack/spec": minor
"@objectstack/mcp": minor
"@objectstack/runtime": minor
---

fix(security): an OAuth-connected MCP agent runs at its delegator's record depth — "you connect as yourself" becomes true (#16549)

Maintainer ruling, decision batch #81 item 1 (2026-09-08), option 1: **the OAuth agent runs with the user's own permissions; the ceiling only subtracts; the diagnostic lands regardless.**

**The defect, measured.** The Setup → Connect an Agent page promises, verbatim, *"you connect as yourself, and every call runs under your own permissions and row-level security."* It did not. The same sales manager, same questions, same server:

| identity path | `crm_account` | `crm_opportunity` | `crm_task` |
|:--|--:|--:|--:|
| API key, `principalKind: human` | 9 | 23 | 45 |
| OAuth, `principalKind: agent`, `onBehalfOf` = same user | **5** | **0** | **0** |

The agent read `own` scope where the human read `viewAllRecords`, so any profile whose visibility comes from `viewAllRecords` — every manager-type profile — collapsed to *own + explicit shares*. And it was **silent**: the MCP tools answered `total: 0` with no note, so the agent reported "there are no opportunities this quarter" as a fact about the data.

**The mechanism, in one line.** `mcp_agent_data_read` / `mcp_agent_data_write` are pure CAPABILITY ceilings — a `'*'` grant with no `readScope` and no `viewAllRecords`, whose own doc says *"NO row-level security … all row/owner/tenant narrowing comes from the delegating user"*. `PermissionEvaluator.getEffectiveScope` nevertheless answered `'own'` for them, because its owner-only default turns a granting-but-silent set into an owner-scoped one. That default is correct for a principal standing on its own and wrong as an input to an intersection: it made the ADR-0090 D10 fold subtract with an opinion nobody declared.

**(1) Parity.** A new `PermissionEvaluator.getDeclaredScope` answers the depth a set actually *declares*, or `undefined` when every granting set is silent; `intersectDelegatedScope` reads that silence as **no opinion**, so the delegated principal's own leg contributes no owner narrowing and the delegator's depth stands — `agent ∩ user = user` for visibility. A ceiling that *does* declare a depth keeps its full subtractive force. The explain engine's `depth` layer folds through the identical function, so a report cannot describe an intersection the query did not have.

⛔ **Only visibility depth moved.** Each ceiling's remaining subtractions are now written down explicitly beside the sets themselves (`objects/default-permission-sets.ts`): `data:read` still cannot write, create, delete, export or `allowTransfer`; `data:write` still cannot `allowTransfer` or export, and `sys_*` / better-auth-managed identity tables stay read-only; neither reaches a `private`-posture object nor carries any `systemPermissions`; a dangling delegator still fails CLOSED; and share-MANAGEMENT authority is still not delegated (`hasWriteBypass` → `false`, `resolveWriteScope` → `'own'` for any on-behalf-of context). Putting `viewAllRecords` / `modifyAllRecords` on the ceiling — the ruling's other permitted route — would have granted `allowTransfer` (`MODIFY_ALL_WRITE_KEYS` covers it) and reached `private` objects through the superuser wildcard, both explicitly fenced off, which is why the fix lands on the intersection instead.

**(2) The diagnostic, independent of (1).** `ISecurityService.describeDelegationNarrowing` (optional) reports whether the agent ceiling narrowed a delegated read, resolved from the same two evaluator calls the CRUD middleware stashes as `__readScope`. `McpDataBridge.diagnoseDelegation` (optional) carries it to the transport, and MCP `query_records` serves a narrowed result with `delegationNarrowed: true` plus a `warning` sentence naming the D10 intersection — the `partial` / `warning` shape `list_objects` already uses. The rows are still served; what is added is the fact the payload could not previously carry: *this count describes the ceiling, not the object.* An un-narrowed read, a non-delegated read, a bridge with no probe and a throwing probe all render exactly what they rendered before.

**(3)** The Setup page's promise is untouched — it is now true rather than rewritten.

Purely additive on every published surface: two new optional members, one new exported type (`DelegationNarrowing`), and one new evaluator method. No existing member changed shape, and the only behavioural change is on the delegated path with a ceiling that declares no depth.

`DelegationNarrowing` is a **discriminated union** on `narrowed`, not one shape with three optional fields, because the two shapes are not symmetric once released:

| direction, after release | consumer cost |
|:--|:--|
| ship optional fields, later tighten them to required | a compile break |
| ship discriminated, later loosen it (a new union member, or an optional field on the `true` arm) | none |

The loose shape buys nothing and forecloses the tightening. It also removes the very failure mode the method exists to prevent: `statement` is the sentence an AI consumer renders, so left optional, a consumer that forgets the `narrowed` check silently renders `undefined` — the same silence the table above measures. The five-member scope ladder it reports names the alias that already exists for it, `ObjectAccessScope` (ADR-0057 D1, `@objectstack/spec/security`), rather than minting a second declaration of one ladder; `resolveWriteScope` now names it too, so the union is spelled once instead of three times and no export is added beyond `DelegationNarrowing` itself.
