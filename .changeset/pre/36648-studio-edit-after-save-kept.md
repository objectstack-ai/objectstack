---
'@object-ui/app-shell': patch
---

fix(studio): an edit typed right as a Save ends is kept, not replaced by the Save's re-read of the object

Clause-②: no
Metadata-protocol: none

A Save in the Data pillar makes the object live, and the object is read again from the server once the Save has ended, so the page shows what the server holds. An edit made while that read is out was already kept. An edit made in the moment between the Save ending and the read starting was not: the page marked the object unchanged as the read started, the read then replaced the object with the server's copy, and the edit and the top bar's Save disappeared with it. That edit is now kept the same way, and its Save sends it.
