/**
 * The one error row for an upload that did not yield a value — shared by the
 * file and image widgets for the reason `file-size-guard` is (objectui#7699).
 *
 * Two failures end an upload without a field value, and they are reported by
 * DIFFERENT sentences because they point at different things:
 *
 *  - the transport threw (`fields.file.uploadFailed`) — the adapter's own
 *    message is quoted, because it names the network, the bucket, the 4xx;
 *  - the transport resolved but surfaced no `sys_file` id, so
 *    `fileValueForSubmit` refused to submit (`fields.file.uploadIncomplete`) —
 *    nothing is quoted, because the adapter reported success and the sentence
 *    that matters is that the field was NOT changed and no blob was sent.
 *
 * Both widgets used to spell the first sentence themselves. With the second
 * one added, a widget re-deriving the pair would drift the moment one of them
 * moved (the image param once received `maxSize` and never read it — the
 * `file-size-guard` header records that instance), so both read from here.
 */

import type { TranslateFn } from '@object-ui/i18n';
import { UploadIncompleteError } from './file-value.js';

/**
 * The translated error row for a pick named `name` whose upload ended in
 * `err`, either kind.
 */
export function uploadErrorMessage(t: TranslateFn, name: string, err: unknown): string {
  if (err instanceof UploadIncompleteError) {
    return t('fields.file.uploadIncomplete', {
      defaultValue: `Upload of "${name}" did not complete: no file id was returned, so nothing was saved`,
      name,
    });
  }
  return t('fields.file.uploadFailed', {
    defaultValue: `Failed to upload "${name}": ${(err as Error).message}`,
    name,
    error: (err as Error).message,
  });
}
