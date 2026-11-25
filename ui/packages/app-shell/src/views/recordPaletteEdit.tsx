// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record page's 「Edit」 in the ⌘K palette's Current page group
 * (objectstack#36286): the header's own Edit entry, published while the page
 * draws it, pressable exactly when the header's button is.
 *
 * Mounted inside the page's `InlineEditProvider`, because the header greys
 * Edit while an inline draft is live (`disableDuringInlineEdit`) and that
 * session is read there.
 *
 * @module
 */

import { useInlineEdit } from '@object-ui/react';
import { usePublishPageCommand } from '../chrome/paletteCommands.js';

/** The keys of the header's `sys_edit` entry this reads. */
export interface RecordHeaderEditEntry {
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  disableDuringInlineEdit?: boolean;
}

export function PublishRecordEditCommand({ edit }: { edit: RecordHeaderEditEntry | undefined }) {
  const inlineEditing = !!useInlineEdit()?.editing;
  usePublishPageCommand(edit ? {
    id: 'edit-record',
    run: () => edit.onClick(),
    disabled: !!edit.disabled || (inlineEditing && edit.disableDuringInlineEdit === true),
    disabledReason: edit.disabledReason,
  } : null);
  return null;
}
