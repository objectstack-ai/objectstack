---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): the AI approvals inbox is usable on a phone

Clause-②: no
Metadata-protocol: none

At phone width the AI approvals inbox drew its desktop table, whose fixed columns are far wider than the screen: Approve, Reject and View sat off-screen in a sideways scroller, and the first thing a row said was the internal tool name. Below the `md` breakpoint each pending action is now a stacked card that leads with the action, shows the object, the tool name and the time as its second line, and keeps Approve, Reject and View inside the card on 44 px buttons that wrap. From `md` up the table is unchanged.

The detail drawer takes the full width below `sm` (it was three quarters of the screen, and its Reject button ran past the right edge at 390 px), its decision buttons wrap instead of overflowing, and a long action or tool name in its title wraps instead of pushing the drawer sideways. From `sm` up it keeps its 560 px cap.

No props, exports or locale keys change; the component needs nothing from its host for this.
