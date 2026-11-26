---
'@object-ui/app-shell': patch
---

fix(studio): a permission set's review link shows what its draft changes

Clause-②: no
Metadata-protocol: none

A review link on a permission-set draft opened the set's matrix page with nothing on it saying what the draft changed. Two places write such a link: the Packages page's list of a package's pending drafts, and the chat's 「Review N change(s)」 button. Both now open the matrix with the draft review the other metadata pages show: a side sheet listing what the pending draft adds, changes and removes against the published set. Studio's permission-set page opens it the same way. The matrix stays editable under the sheet and after it closes, and the link's `?review=1` leaves the address once the review is open, so a refresh or Back does not open it again.

A set with no pending draft opens no review, and a permission-set page opened without a review link reads and shows exactly what it did before. The review links of flows, objects and every other type are unchanged. No locale keys, props or entry exports change.
