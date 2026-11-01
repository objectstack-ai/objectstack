/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record header on a phone (objectstack#27058, Target 4): the name and
 * the object chip, a subtitle line from the record's first two declared text
 * highlights (「Atlas Construction · Director of Sales」), then the remaining
 * highlights, at most four, in the strip's two columns. The rest of the
 * fields are in the sections anyway. It narrows the default page's header by
 * width, the record page v4 header's highlight rule (#27524 item 12); an
 * authored page draws its own header.
 */

import { deriveHighlightFields, detectStatusField } from '@object-ui/plugin-detail';

/** The highlights a phone's header strip shows after its subtitle. */
export const PHONE_HIGHLIGHTS_MAX = 4;

/** The declared text highlights the subtitle reads, at most. */
const PHONE_SUBTITLE_FIELDS = 2;

/** A field's declared type, from either form of an object's `fields`. */
function fieldType(def: unknown, name: string): string | undefined {
  const fields = (def as { fields?: unknown } | null | undefined)?.fields;
  if (Array.isArray(fields)) {
    const field = fields.find((f) => (f as { name?: unknown } | null)?.name === name) as { type?: unknown } | undefined;
    return typeof field?.type === 'string' ? field.type : undefined;
  }
  const field = (fields as Record<string, { type?: unknown } | undefined> | undefined)?.[name];
  return typeof field?.type === 'string' ? field.type : undefined;
}

export interface PhoneRecordHeader {
  /** The subtitle line, `''` when the declared text highlights hold no value. */
  subtitle: string;
  /** The strip's fields, after the subtitle's, at most {@link PHONE_HIGHLIGHTS_MAX}. */
  highlightFields: string[];
}

/**
 * The phone header of a default record page.
 *
 * `declared` is the object's declared `highlightFields`, the record's title
 * field already dropped (`undefined` when it declares none: the strip is then
 * derived, as on any width, and there is no subtitle). The subtitle reads the
 * values the reader may see (`record` is the row the page reads), so a field
 * the server masked adds nothing; the separator joins only the values that
 * are there.
 */
export function phoneRecordHeader(
  def: unknown,
  declared: readonly string[] | undefined,
  record: Record<string, unknown> | null | undefined,
): PhoneRecordHeader {
  const subtitleFields = (declared ?? [])
    .filter((name) => fieldType(def, name) === 'text')
    .slice(0, PHONE_SUBTITLE_FIELDS);
  const subtitle = subtitleFields
    .map((name) => record?.[name])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim())
    .join(' · ');
  const objectDef = def as Parameters<typeof deriveHighlightFields>[0];
  const strip = declared ?? deriveHighlightFields(objectDef, detectStatusField(objectDef));
  return {
    subtitle,
    highlightFields: strip.filter((name) => !subtitleFields.includes(name)).slice(0, PHONE_HIGHLIGHTS_MAX),
  };
}
