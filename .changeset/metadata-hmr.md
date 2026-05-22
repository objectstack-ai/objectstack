---
"@objectstack/metadata": patch
"@objectstack/studio": patch
"@objectstack/cli": patch
---

Metadata HMR via SSE — close the agent-edits → preview-refresh loop.

- `@objectstack/metadata`: register `/api/v1/dev/metadata-events` SSE endpoint unconditionally;
  add `POST` trigger that reloads the artifact and broadcasts a `reload` event to all listeners.
- `@objectstack/cli` (`os dev`): chokidar-based watch on `objectstack.config.ts` and `src/`;
  debounced recompile + `POST` to the HMR endpoint so the server reloads without restart.
- `@objectstack/studio`: `useMetadataHmr` provider opens an `EventSource`, exposes a version
  counter; previews include it in their query deps, and a top-bar badge surfaces connection
  state and event counts for diagnostics.
