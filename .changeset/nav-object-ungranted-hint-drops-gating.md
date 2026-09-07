---
"@objectstack/lint": patch
---

`nav-object-ungranted`'s hint no longer tells you to gate the nav entry with `requiredPermissions`/`visible` — that never cleared the finding, because the rule never reads either key. Gating restricts who can see the entry; it doesn't grant the object read, so a holder who clears the gate could still hit permission-denied, and the warning kept firing anyway. The hint (and the module doc-block) now name the two remedies that actually clear it: grant read on the object in a permission set (`allowRead: true` or `viewAllRecords`), or drop the nav entry. No behavior change — the rule fires and stays silent on exactly the same inputs as before; only the wording of the hint moved.
