// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The server API base — `<VITE_SERVER_URL>/api/v1`, or `/api/v1` when the
 * console is served from the same origin as the backend.
 *
 * A LEAF module on purpose. This function lived in
 * `views/metadata-admin/previews/useFlowNodePalette.ts`, whose module scope
 * reaches the whole flow-designer canvas (`flow-canvas-parts.tsx` and the
 * region views, providers and icon set below it). Importing three lines of URL
 * arithmetic from there dragged all of that into the importer's graph — which
 * costs nothing for a module the designer already loads, and costs a chunk for
 * one that does not. Setup's packaged-automation page is the second kind: it is
 * imported EAGERLY by `services/builtinComponents`, so anything in its graph is
 * in the console's eager closure (`check:eager-closure`).
 *
 * `useFlowNodePalette.ts` re-exports this name, so its existing importers are
 * unchanged and there is still exactly ONE definition. ⛔ Do not re-derive the
 * base inline: this repo already carries several hand-rolled copies of the same
 * `VITE_SERVER_URL` arithmetic, and they are why a trailing-slash difference
 * can behave differently in two panels of one page.
 */
export function apiBase(): string {
  const url = (import.meta as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL || '';
  return `${String(url).replace(/\/$/, '')}/api/v1`;
}
