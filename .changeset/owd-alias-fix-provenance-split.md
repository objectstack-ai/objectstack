---
"@objectstack/lint": patch
---

`security-owd-alias` no longer tells authors that `sharingModel: 'public'` is a retired ADR-0090 D4 alias. It never was one — no shipped schema ever accepted it — and the map that said so is now split along the two histories it was conflating.

`OWD_ALIAS_FIX` carried four keys under one comment, `[ADR-0090 D4] Legacy alias → canonical fix-it mapping`, while D4 names three: "The legacy aliases `read`, `read_write`, `full` are **removed from the zod enum**". Those three have a retirement behind them — the `owd-legacy-read-aliases` ADR-0087 stored-row conversion for the two `read*` spellings, the `13.owd-full-alias-removed` semantic entry for `full`. `public` has neither, and correctly so: a conversion rewrites a spelling some shipped schema once took, and this one never was taken, so its stored population is zero by construction. The missing conversion was the mislabel's shadow, not a gap.

- **Two maps, one union.** `OWD_RETIRED_ALIAS_FIX` holds the three D4 aliases; `OWD_WRONG_LAYER_FIX` holds `public`; `OWD_ALIAS_FIX` stays as their union, so every key still earns the same rule id, the same path and the same fix-it. No accept set moves and no value starts or stops being reported.
- **The `public` fix-it is KEPT.** It catches a real authoring mistake: three neighbouring keys on the same `ObjectSchema` take `'public'` legally — `access.default` (`z.enum(['public', 'private'])`, ADR-0066) and `publicSharing.allowedAudiences` (`z.enum(['public', 'link_only', 'signed_in', 'email'])`) — and off-schema so does the sharing runtime's own internal vocabulary, `effectiveSharingModel(): 'private' | 'read' | 'public'`. `sharingModel` is the one neighbour that refuses it, and it fails CLOSED to `private` with no notice on the read path, so this fix-it is the author's only signal.
- **The message says which group it is in.** One shared clause, used by both the `sharingModel` and the `externalSharingModel` branch. A retired alias still reads `is a retired alias (ADR-0090 D4)`; `public` now reads that it is not an OWD value and never was, and names the neighbouring keys that do take it. The fix-it text, severity, rule id and path are byte-identical either way.

Why the wording mattered enough to change: a diagnostic that credits `public` to D4 sends its reader looking for the conversion and the semantic entry that would exist if the acceptance had happened, and finding them absent reads as a data-fidelity defect in the conversion registry. It is not one.
