// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How the AI chat's change card names the objects and fields a change touches
 * (objectstack#32984). The producer sends machine names only (「字段
 * b6bl_quote_item · line_total · currency」); these resolvers answer the
 * labels.
 *
 * Two worlds answer, in order:
 *
 *  1. the published registry the console already reads, by name;
 *  2. for a name it does not know (an object drafted but never published, or a
 *     field drafted onto a published object), the draft overlay
 *     (`GET /meta/object/:name?preview=draft`), by object name. A build
 *     conversation edits drafts, so before the first publish every object it
 *     made lives only there.
 *
 * The overlay's answer is kept per object. A kept answer that does not name
 * what a card asks for (no object, or not that field) is asked again once the
 * conversation's `revision` has moved since it was asked: a later change in
 * the same conversation may have drafted it. At most one read per object per
 * revision, and none while one is in flight, so a render never refetches.
 *
 * A name neither world knows (one the change is about to create) answers
 * `undefined`, and the card shows the name as given. Only this card reads the
 * overlay: what the rest of the console reads stays the published world.
 */
import { useCallback, useRef, useState } from 'react';
import { useObjectLabel } from '@object-ui/i18n';
import type { MetadataContextValue } from '@object-ui/react';
import { readObjectsByName } from '../../hooks/useObjectPresence.js';

/** The part of an object definition the change card reads. */
interface LabelledObject {
  name?: string;
  label?: string;
  fields?: Record<string, { label?: string }>;
}

/** The by-name read of the draft overlay: a client that can turn `?preview=draft` on. */
export interface DraftOverlayReader {
  withPreviewDrafts(previewDrafts: boolean): { get(type: string, name: string): Promise<unknown> };
}

export interface ChangeCardLabels {
  resolveObjectLabel: (objectName: string) => string | undefined;
  resolveFieldLabel: (objectName: string, fieldName: string) => string | undefined;
}

const NO_DRAFTS: ReadonlyMap<string, LabelledObject | null> = new Map();

export function useChangeCardLabels(
  metadata: Pick<MetadataContextValue, 'objects' | 'readObjectScope' | 'getTypeStatus'>,
  client: DraftOverlayReader,
  /**
   * Moves when the conversation may have drafted something new (a message
   * lands, a turn ends). Compared by identity; any primitive works.
   */
  revision: string | number,
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

  // The draft overlay's answer per object name: the definition, or `null` when
  // the overlay holds none (or the read failed); the revision each name was
  // last asked at; and the names whose read is in flight.
  const [drafts, setDrafts] = useState(NO_DRAFTS);
  const askedAt = useRef(new Map<string, string | number>());
  const inFlight = useRef(new Set<string>());
  const findDraft = useCallback(
    (objectName: string, fieldName?: string): LabelledObject | undefined => {
      const kept = drafts.get(objectName) ?? undefined;
      const answers = kept !== undefined && (fieldName === undefined || kept.fields?.[fieldName] !== undefined);
      const askable = !askedAt.current.has(objectName) || askedAt.current.get(objectName) !== revision;
      if (!answers && askable && !inFlight.current.has(objectName)) {
        askedAt.current.set(objectName, revision);
        inFlight.current.add(objectName);
        const settle = (item: LabelledObject | null) => {
          inFlight.current.delete(objectName);
          setDrafts((prev) => new Map(prev).set(objectName, item));
        };
        client
          .withPreviewDrafts(true)
          .get('object', objectName)
          .then(
            (item) => settle(item && typeof item === 'object' ? (item as LabelledObject) : null),
            () => settle(null),
          );
      }
      return kept;
    },
    [client, drafts, revision],
  );

  const resolveObjectLabel = useCallback(
    (objectName: string) => {
      const object = findPublished(objectName) ?? findDraft(objectName);
      return object ? i18nObjectLabel({ name: objectName, label: object.label ?? objectName }) : undefined;
    },
    [findPublished, findDraft, i18nObjectLabel],
  );
  const resolveFieldLabel = useCallback(
    (objectName: string, fieldName: string) => {
      const field =
        findPublished(objectName)?.fields?.[fieldName] ?? findDraft(objectName, fieldName)?.fields?.[fieldName];
      return field ? i18nFieldLabel(objectName, fieldName, field.label ?? fieldName) : undefined;
    },
    [findPublished, findDraft, i18nFieldLabel],
  );
  return { resolveObjectLabel, resolveFieldLabel };
}
