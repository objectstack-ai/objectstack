---
'@objectstack/scenarios': patch
---

fix(scenarios): the `asset_lifecycle` card's scrap request DR-0006 gives a reason that fits a near-new monitor, so approving it is unambiguous

Clause-②: no
Metadata-protocol: none

Operation `manager_approves_scrap` asks the Sales manager to approve DR-0006 and expects `applied`. The request scraps AST-0102, a monitor bought seven weeks before the card's date with a book value of 1,770 of 1,800, "because the repair quote exceeds the replacement cost" of a backlight failure. A careful approver rightly asks why a fault that early is not a warranty claim, so the expectation graded luck. The reason now reads "Dropped during the stock-room move; the panel is shattered. Accidental damage is not covered, and a new panel costs more than a new monitor." The asset, its dates, its depreciation and every truth are unchanged; the card ships in the package's `dist/library`.
