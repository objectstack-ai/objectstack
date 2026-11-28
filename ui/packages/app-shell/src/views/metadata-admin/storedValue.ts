// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Whether a read value counts as UNSET — the one definition of "the author has
 * stored nothing here", shared by every site that has to answer it: the flow
 * node inspector's stored-value re-show rule and its defaulted controls
 * (`inspectors/flow-node-config.ts`, `inspectors/FlowNodeConfigField.tsx`),
 * and the metadata form's row visibility (`SchemaForm.tsx`), which keeps a row
 * whose `visibleWhen` is false drawn while its key holds a value.
 *
 * Every site must call a key unset in exactly these words, or the same draft
 * can render a field whose gate says "unset, so hide it / use the default"
 * beside a control that says "stored, so show it". `''` is included because a
 * cleared text control commits the empty string rather than deleting the key.
 */
export function isUnsetFieldValue(raw: unknown): boolean {
  return raw === undefined || raw === null || raw === '';
}
