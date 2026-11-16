// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How the AI chat's change card names the objects and fields a change touches
 * (objectstack#32984). The producer sends machine names only (「字段
 * b6bl_quote_item · line_total · currency」); these resolvers answer the
 * labels. An object or field nobody knows yet (one the change is about to
 * create) answers `undefined`, and the card shows the name as given.
 */
import { useCallback } from 'react';
import { useObjectLabel } from '@object-ui/i18n';
import type { MetadataContextValue } from '@object-ui/react';
import { readObjectsByName } from '../../hooks/useObjectPresence.js';

/** The part of an object definition the change card reads. */
interface LabelledObject {
  name?: string;
  label?: string;
  fields?: Record<string, { label?: string }>;
}

export interface ChangeCardLabels {
  resolveObjectLabel: (objectName: string) => string | undefined;
  resolveFieldLabel: (objectName: string, fieldName: string) => string | undefined;
}

export function useChangeCardLabels(
  metadata: Pick<MetadataContextValue, 'objects' | 'readObjectScope' | 'getTypeStatus'>,
): ChangeCardLabels {
  const { objectLabel: i18nObjectLabel, fieldLabel: i18nFieldLabel } = useObjectLabel();
  // By name, when a change card asks (objectui#12811): the chat dock mounts
  // the pane on an app's object-list open, where reading the whole `objects`
  // registry at render would bring it back onto that open.
  const findPublished = useCallback(
    (objectName: string) =>
      (readObjectsByName(metadata, [objectName]) as LabelledObject[]).find((o) => o?.name === objectName),
    [metadata],
  );
  const resolveObjectLabel = useCallback(
    (objectName: string) => {
      const object = findPublished(objectName);
      return object ? i18nObjectLabel({ name: objectName, label: object.label ?? objectName }) : undefined;
    },
    [findPublished, i18nObjectLabel],
  );
  const resolveFieldLabel = useCallback(
    (objectName: string, fieldName: string) => {
      const field = findPublished(objectName)?.fields?.[fieldName];
      return field ? i18nFieldLabel(objectName, fieldName, field.label ?? fieldName) : undefined;
    },
    [findPublished, i18nFieldLabel],
  );
  return { resolveObjectLabel, resolveFieldLabel };
}
