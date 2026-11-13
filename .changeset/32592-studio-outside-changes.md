---
'@object-ui/app-shell': patch
---

fix(app-shell): an open Studio shows drafts and publishes made outside its tab without a reload

Clause-②: no
Metadata-protocol: none

A draft an agent stages over MCP, a REST publish, or a change made in another tab used to stay invisible in an open Studio (no number on the Changes button, no draft line on the item header, no draft marks) until the browser was reloaded, so a change that worked looked like one that failed. The pending-drafts ledger is now read again when the tab becomes visible or the window gains focus, and every 30 seconds while the tab stays visible. When the answer differs from what the tab last read, the tab sends its own metadata-refresh signal, so the Changes count, the item header line, the pillars' draft marks and the console's metadata all catch up together; an unchanged answer costs that one read. A hidden tab sends no request at all, so a background Studio does not keep a scale-to-zero backend awake. The home banner, the chat bar and the draft preview bar read the same ledger and catch up the same way.
