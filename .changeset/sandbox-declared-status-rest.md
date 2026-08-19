---
"@objectstack/rest": patch
---

A sandboxed hook/action body that declares its own HTTP status (`e.status = 403; throw e`) is now served with that status on the `/api/v1/data` routes, instead of an unconditional 400 — the same #7867 declared-status rule the custom-action route already applies. The unwrapped business message stays the body text for a declared 4xx; a declared 5xx keeps the status and takes the standard sanitised server-fault envelope. Undeclared body throws (verbatim-message 400) and body crashes (sanitised 500) are unchanged.
