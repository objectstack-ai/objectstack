---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a flow save that skipped canonicalization says so (#4580)

`saveMetaItem` canonicalizes flow bodies before the schema gate (#4542). When the
canonicalizer throws — it is stricter than the gate: strict parse, cycle
detection, control-flow region validation — the save falls back to the raw body
so a work-in-progress draft with a temporary cycle stays saveable. That fallback
is correct and unchanged. It was also completely silent.

Of the four postures at this seam, three announce themselves: a clean
canonicalization heals the row, a refused rename fails with `409
FLOW_CONVERSION_CONFLICT` naming the token, and a host with no automation service
is reported by `os migrate meta --stored`. The throw-fallback said nothing, so a
save that skipped canonicalization was indistinguishable from one that healed the
row — and a body that is *both* a legacy dialect and unparseable by the strict
canonicalizer re-persisted verbatim. That is the exact #4542 symptom, arriving
silently, while the boot warning for legacy stored rows tells the author that
re-saving is the remedy.

The fallback now emits a `console.warn` naming the flow and the canonicalizer's
own error, deduped once per flow per process (the `convertStoredItem` pattern —
Studio autosaves the same draft repeatedly, and a WIP cycle throws on every
write). This aligns the write seam with ADR-0087 D2's "loud" posture, where
conversions emit notices, reads warn once per row, and `migrateStoredMetadata`
reports `failed` with the message.

No behavior change: the body still saves, the schema gate stays the arbiter, and
`registerFlow` still refuses to arm a malformed flow. Refusing the save in
publish mode was considered and rejected — publish is the default mode, so it
would silently tighten validation for every existing caller, and it could only be
enforced on hosts that have an automation service, making the same body saveable
on a control-plane host and a 422 on an automation host.
