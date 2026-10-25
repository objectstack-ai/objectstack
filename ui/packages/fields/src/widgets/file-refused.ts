/**
 * The platform's refused file marker `{ id, metadataRefused: true }`
 * (`FileRefusedValueSchema`, objectstack#22593): what a file field's expanded
 * read form is for a reader who may read the record but not the file's
 * `sys_file` metadata (objectui#12339).
 *
 * ⛔ Deliberately NOT re-exported from the package barrel: these two helpers
 * are shared by `file-value` and the file widgets, not published surface.
 * What renderers read is `FileValueView.metadataRefused`.
 */
import { FileRefusedValueSchema, type FileRefusedValue } from '@objectstack/spec/data';

/**
 * Is this value the platform's refused marker `{ id, metadataRefused: true }`?
 *
 * Judged by the spec's own closed `FileRefusedValueSchema`, not by a second
 * hand-written shape here: an object with any other key is not the marker,
 * and reads through `readFileValue`'s ordinary object arm.
 */
export function isFileRefusedValue(value: unknown): value is FileRefusedValue {
  return FileRefusedValueSchema.safeParse(value).success;
}

/**
 * One element of a field value as an editable widget re-submits it beside or
 * after an edit (append, remove, crop): the refused marker is reduced to its
 * bare `sys_file` id — the stored form — and ⛔ never sent back as the marker
 * object, which is a read form no record write accepts. Every other element
 * passes through untouched, as before.
 */
export function fileValueForResubmit(value: unknown): unknown {
  return isFileRefusedValue(value) ? value.id : value;
}
