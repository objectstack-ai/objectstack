---
'@objectstack/spec': patch
---

fix(spec): every protocol-18 retirement family now carries its D3 entry, including the 25 whose data repair is a lossless D2 conversion (#20201)

Clause-②: no

ADR-0087 D3 requires one semantic (D3) entry per retirement family, even when a
lossless D2 conversion already repairs the data: D2 carries the mechanical repair
only, and the D3 entry says what the consumer still has to decide. Twenty-five
protocol-18 families shipped a D2 conversion and no D3 entry, some of them
justified by "lossless, so no semantic residue". `MIGRATIONS_BY_MAJOR[18].semantic`
gains one entry per family, so `os migrate meta` lists each as a TODO on the
17 → 18 hop, with its reason and acceptance criteria. Among them:

- the seven duration renames (`hook.timeout`, `job.timeout`, `apis[].cacheTtl`,
  `dashboard.refreshInterval`, the connector health / trigger durations, the memory
  driver's `autoSaveInterval` and the turso `timeout`). The rename keeps the value,
  so only the author can say whether it was ever written in the unit the new key
  names.
- `object.tenancy.organizationField`, `view.owner` / `view.hidden`,
  `permission.objects.*.allowRestore` / `allowPurge` and the list-view `page` mount.
  Each delete is lossless, and each leaves a belief the author held that the
  platform never honoured.

No accept set moves and no conversion changes. The registry's own test now fails
when a protocol-18-or-later step graduates a conversion that no D3 entry of that
step names. The prose that justified the missing entries is corrected, and the
protocol-17 docblock no longer calls that step's `semantic` list empty.
