---
'@object-ui/collaboration': patch
'@object-ui/mobile': patch
---

refactor(collaboration,mobile): delete the module-local `createPresenceUpdater` and `requestBackgroundSync` helpers that nothing reads

Clause-②: no
Metadata-protocol: none

Neither name is exported from its package entry (the single `.` export), so no host can import them; the compiled `usePresence.js` and `serviceWorkerSource.js` simply stop carrying the two dead function bodies. Behaviour of every exported name is unchanged.
