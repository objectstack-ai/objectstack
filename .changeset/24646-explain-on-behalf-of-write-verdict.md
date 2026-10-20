---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `security.explain` answers an on-behalf-of caller's by-id update and delete the way the write itself does

For a principal acting on behalf of a user (an OAuth agent), explain's record-grained `update` / `delete` verdict now composes what the by-id PATCH / DELETE composes (ADR-0090 D10):

- record sharing's per-record gate is asked twice, as the write asks it: as the delegated principal at its agent-leg write depth, then as the delegator at the delegator's own write depth;
- the delegator's own row-level write filter is ANDed beside the principal's, as the write's pre-image check ANDs it.

Before, explain asked the gate once at owner-only depth and left the delegator's write filter out, so it could refuse a row the write admits and admit a row the write refuses. Ordinary (non-delegated) callers are unaffected, and so is the delegated read verdict.
