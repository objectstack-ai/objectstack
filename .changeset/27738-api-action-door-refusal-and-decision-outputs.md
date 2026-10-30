---
'@objectstack/runtime': patch
---

fix(runtime): a forwarded `type: 'api'` action keeps the target's whole refusal, and an approve or reject carrying decision outputs passes the param check

Clause-②: yes (widening)
Metadata-protocol: none

Both action doors (`POST /api/v1/actions/:object/:action` and the MCP `run_action` tool) forward a same-origin `type: 'api'` action to its declared `target`. Two parts of that forward lost what a direct call to the target keeps:

- **The target's refusal is relayed whole.** When the target answers a non-2xx with the ObjectStack envelope (`{ success: false, error: { code, message, … } }`), the REST door now answers the same `code` and `message` and every member beside them, unchanged: `details` (a flow endpoint's `innerRefusal` and run `summary`; an entitlement refusal's `upgrade_url`, `contact_url`, `plan`, `current`, `limit`), `userMessage`, `declaredCode`. It used to rebuild the envelope from `code` alone, so those were dropped. At `run_action` the envelope's `details` ride the thrown refusal and render beside its code. A refusal the target did not envelope (a stock better-auth `{ code, message }`, a non-JSON body) is answered as before.
- **`outputs.<key>` params pass the ADR-0104 D2 param check on a forwarded `type: 'api'` action.** These are the approval decision outputs, one param per output the approval node declares, which the request already folds into its body's `outputs` object. Their keys belong to the pending request, so no action can declare them, and an Approve or Reject that carried one was refused with `400 Unknown action param`. The check now leaves undeclared `outputs.<key>` params out when the action's request folds them (`type: 'api'`, not a declarative update, no `bodyShape.wrap`); the target judges their values. Every other undeclared key is refused as before, and the family stays refused on every other action. A declared param is judged as declared, whatever its name. ADR-0104 D2 records the amendment (2026-10-30).

No export of the package changes. Patch, not minor: the metadata an author writes is unchanged (`Metadata-protocol: none`), and a change that does not move the metadata protocol ships `patch` whatever its arm.
