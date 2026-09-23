---
"@objectstack/spec": minor
---

`record:details`, `record:highlights` and `record:related_list` accept `requiredPermissions`, the block-level capability gate objectui's detail renderers read, with the same shape and the same describe as `record:quick_actions` — whose published describe changes in this release (#18159).

Clause-②: yes (widening)

- **Additive.** All three blocks are `strictObject`s that refused the key by name. It is now declared optional, `z.array(z.string())`, with no schema default, so an absent key stays absent and nothing that parsed before stops parsing.
- **One key, one meaning, one text, on all four record blocks.** The names are ADR-0066 capabilities (what permission sets grant through `systemPermissions`), not object actions. The user must hold all of them; otherwise the block renders an insufficient-permissions notice in place of its content. It is presentation only: it authorises nothing, and the data API still serves the same data to the same user. A client that cannot resolve the user's capabilities renders the block as if they were held (fails open); a resolved empty set gates. To keep data from a user, gate the object, the field or the action.
- **⚠️ Published text changes: the describe of `record:quick_actions.requiredPermissions`.** It read "Hide the whole bar unless the current user holds every named permission on this object." Against the renderer the pinned console ships, "on this object" is false — the gate reads the user's capability set and is not object-scoped — and the sentence named no fail-open case. The shape is unchanged; only the text moves. If a page writes object actions there (`read`, `update`), the console reads them as capability names.
