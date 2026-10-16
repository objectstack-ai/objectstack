---
'@objectstack/core': patch
---

Clause-②: no

A call with a revoked API key no longer hears "a revoked key never works again". The key row's own Restore API Key action clears the flag and the same key works again at once, so the `403 API_KEY_REVOKED` message now says the key was revoked, that its owner or a platform administrator can restore it (the Restore API Key action on the API Keys list), and otherwise to create a new key (`POST /api/v1/keys`, or the API Keys page) and replace this one wherever it is configured. The code, the status, the fields the refusal carries and the expired and inactive messages are unchanged. The error catalog's `API_KEY_REVOKED` Fix line says the same.
