---
'@objectstack/runtime': patch
'@objectstack/plugin-security': patch
'@objectstack/spec': patch
---

fix(runtime,plugin-security): the declared-webhook activation door switches one of two holders the namespace address cannot tell apart, and the upgrade report names every withheld holder

Clause-②: yes (widening)
Metadata-protocol: none

Two holders of one declared webhook name that the namespace address cannot tell apart, two packages co-owning one namespace or a package that declares no namespace beside another holder, are both dispatched, but neither could be switched: `POST /api/v1/security/_activation/webhook/NAME` and `.../webhook/NS/NAME` both answered `409` naming both. The bare address now takes `?package=PKG`, the exact qualifier `/meta` reads, and switches exactly PKG's declaration, writing PKG's own activation row and no other.

- FROM `400 VALIDATION_ERROR` (unknown query parameter) TO `200` writing PKG's row, `data.packageId` = PKG, for `POST /security/_activation/webhook/NAME?package=PKG` when PKG declares NAME and is enabled.
- A PKG that does not serve NAME (a disabled package included) answers `409 RESOURCE_CONFLICT` naming the holders that do, or `404` when no enabled package declares it. Nothing is written.
- `package` is the only query parameter of the bare webhook address; the namespace address takes none, and an empty or repeated `package` is `400`, as on the permission-set door.

The upgrade-impact report's withheld-webhook finding now reports each holder of the name, a disabled second holder included: FROM one finding (the holder the bare artifact lookup answered) TO one finding per holder. Its log lines name each finding's switch, `POST /api/v1/security/_activation/webhook/NAME?package=PKG`, where they named the namespace address. A withheld-webhook finding whose package is disabled is marked `packageDisabled: true` (an added optional field), and the line says to enable that package first: its address answers `409` until then.

The `webhook` liveness ledger's `name` evidence (`@objectstack/spec`, text only) names one slot per served `(package, name)` holder and its `declared:PKG/NAME` reference.
