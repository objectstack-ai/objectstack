/**
 * Internal bridge module to break the circular dependency between
 * index.tsx (defines getCellRenderer) and RecordPickerDialog.tsx
 * (consumes it).
 *
 * index.tsx registers the resolver via setCellRendererResolver().
 * LookupField reads it via getCellRendererResolver() to pass as a prop.
 */
import type { CellRendererResolver } from './RecordPickerDialog.js';

let _resolver: CellRendererResolver | undefined;

export function setCellRendererResolver(resolver: CellRendererResolver): void {
  _resolver = resolver;
}

export function getCellRendererResolver(): CellRendererResolver | undefined {
  return _resolver;
}
