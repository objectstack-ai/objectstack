// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36195 — what a list says when the server refuses to save a view
 * an app package ships.
 *
 * That refusal, `NOT_OVERRIDABLE` (the metadata door's close on an item a
 * package ships, `protocol-packaged-base-refusal.ts`), is written for a
 * developer: in English, naming the package, the customization pair, the ADR
 * and a command (`'view/…' ships in '…': save it into '….custom' …`). A reader
 * saving a list gets their own sentence instead: the view comes with an app
 * package and cannot be changed directly; it can be saved as their own view.
 * The door's text goes to the console, where the caller already logs the
 * error.
 *
 * Every other refusal is said as before (`formatMetadataError`): a list of
 * field-anchored issues, else the door's message, which the view-write doors
 * word for the person saving (objectui#11583, objectui#12417).
 */

import { formatMetadataError } from '@object-ui/data-objectstack';
import { errorCodeIs } from '@object-ui/types';

type Translate = (key: string) => string;

/** The toast description for a refused view save. */
export function viewSaveRefusalText(err: unknown, t: Translate): string {
  if (errorCodeIs(err, 'NOT_OVERRIDABLE')) return t('console.objectView.saveRefused.packaged');
  return formatMetadataError(err);
}
