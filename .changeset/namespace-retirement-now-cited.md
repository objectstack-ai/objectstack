---
'@objectstack/spec': patch
---

The `namespace` rejection messages now cite the decision record that actually exists: ADR-0129 D3 (the enforced object-naming contract — `name` is the canonical id, module prefix embedded literally, no separate namespace declaration). The object tombstone's citation, removed when its previous spelling pointed at a decision letter no ADR declared, comes back pointing at the real record; the translation-contract rejection re-points the same way. The retirement itself is unchanged and still enforced.
