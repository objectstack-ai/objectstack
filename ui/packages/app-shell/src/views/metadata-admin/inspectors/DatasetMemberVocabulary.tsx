// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A dataset member's business vocabulary (ADR-0149 D1): the `synonyms` and the
 * `description` of one dimension or measure, drawn inside that row's Advanced
 * disclosure in {@link DatasetDefaultInspector}, which replaces the spec's
 * `datasetForm` for a dataset and so has to draw them itself.
 *
 * Copy: the label and help text are the spec's own `datasetForm` row
 * properties (`dimensions.synonyms`, `measures.description`, …), localized
 * through the `metadataForms.dataset` overlay the spec-driven panels already
 * read (`localizeMetadataForm`). The limits the author reads are therefore the
 * spec's sentence, never a copy of it that could drift.
 *
 * Limits: none is judged here. `DatasetSchema` is the one judge of the
 * 20-word and 60-character bounds, of a word answering to two members and of
 * the 500-character description; a refused save names the rule. This editor
 * only turns the comma-separated text the spec's help text asks for into a
 * list.
 *
 * Writes: an emptied value removes the key ({@link writeMemberVocabulary}), so
 * a member never carries `synonyms: []` or `description: ''`.
 */

import * as React from 'react';
import { Input, Label, Textarea } from '@object-ui/components';
import { pickLocalized, setLocalized, clearLocalized } from '@object-ui/i18n';
import { datasetForm } from '@objectstack/spec/ui';
import { localizeMetadataForm } from '../metadata-form-i18n.js';
import type { SupportedLocale } from '../i18n.js';

/** The two member collections of a dataset, as `datasetForm` names their repeaters. */
export type DatasetMemberKind = 'dimensions' | 'measures';

/** The two vocabulary keys this editor writes on a member. */
export type MemberVocabularyKey = 'synonyms' | 'description';

type FieldCopy = { label: string; helpText?: string };

/** Label and help text for both keys of one member kind, in one locale. */
export type MemberVocabularyCopy = Record<MemberVocabularyKey, FieldCopy>;

type FormFieldLike = { field?: unknown; label?: unknown; helpText?: unknown; fields?: unknown };

function asFieldList(value: unknown): FormFieldLike[] {
  return Array.isArray(value) ? (value.filter((f) => f && typeof f === 'object') as FormFieldLike[]) : [];
}

const copyByLocale = new Map<string, MemberVocabularyCopy>();

/**
 * The `datasetForm` copy for a member kind's `synonyms` and `description` row
 * properties, overlaid with the active locale's `metadataForms.dataset`
 * strings. Cached per kind and locale: the form is a module constant.
 */
export function memberVocabularyCopy(kind: DatasetMemberKind, locale: SupportedLocale): MemberVocabularyCopy {
  const cacheKey = `${kind}|${locale}`;
  const cached = copyByLocale.get(cacheKey);
  if (cached) return cached;
  const form = localizeMetadataForm(datasetForm as unknown as Record<string, unknown>, 'dataset', locale);
  const repeater = asFieldList((form?.sections as unknown[] | undefined) ?? [])
    .flatMap((section) => asFieldList(section.fields))
    .find((f) => f.field === kind);
  const rows = asFieldList(repeater?.fields);
  const read = (key: MemberVocabularyKey): FieldCopy => {
    const row = rows.find((f) => f.field === key);
    return {
      label: typeof row?.label === 'string' && row.label ? row.label : key,
      helpText: typeof row?.helpText === 'string' && row.helpText ? row.helpText : undefined,
    };
  };
  const copy = { synonyms: read('synonyms'), description: read('description') };
  copyByLocale.set(cacheKey, copy);
  return copy;
}

/**
 * The words in the Synonyms box: split on a comma (ASCII or full-width, the
 * separator the spec's help text names), each word trimmed, empty pieces
 * dropped. Nothing else is decided here: a duplicate, an over-long word or a
 * twenty-first word is kept for the save to judge.
 */
export function parseSynonyms(text: string): string[] {
  return text
    .split(/[,，]/u)
    .map((word) => word.trim())
    .filter((word) => word !== '');
}

/** The stored synonym list of a member, read as written; anything else reads as none. */
function storedSynonyms(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((w): w is string => typeof w === 'string') : [];
}

/**
 * Write one vocabulary key on a member row. An empty list or an absent
 * description removes the key — the row is rebuilt without it, not given
 * `undefined` — so the held draft and the body the save sends say the same
 * thing, and a member that never had the key never gains an empty one.
 */
export function writeMemberVocabulary<T extends object>(row: T, key: MemberVocabularyKey, value: unknown): T {
  const { [key]: _previous, ...rest } = row as Record<string, unknown>;
  const empty = value === undefined || (Array.isArray(value) && value.length === 0);
  return (empty ? rest : { ...rest, [key]: value }) as T;
}

function FieldHelp({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return <p id={id} className="text-[10px] text-muted-foreground">{text}</p>;
}

/**
 * The Synonyms box. The author types free text, so the box keeps its own text
 * while it parses to the stored list (a trailing `, ` stays on screen); when
 * the stored list changes from elsewhere — another row removed, an undo, the
 * Source tab — the box re-reads it.
 */
function MemberSynonymsField({
  value,
  copy,
  disabled,
  onCommit,
  testId,
}: {
  value: unknown;
  copy: FieldCopy;
  disabled?: boolean;
  onCommit: (next: string[]) => void;
  testId?: string;
}) {
  const id = React.useId();
  const stored = storedSynonyms(value);
  const storedKey = JSON.stringify(stored);
  const [text, setText] = React.useState(() => stored.join(', '));
  React.useEffect(() => {
    setText((current) =>
      JSON.stringify(parseSynonyms(current)) === storedKey ? current : (JSON.parse(storedKey) as string[]).join(', '),
    );
  }, [storedKey]);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{copy.label}</Label>
      <Input
        id={id}
        value={text}
        onChange={(e) => {
          const nextText = e.target.value;
          setText(nextText);
          const next = parseSynonyms(nextText);
          if (JSON.stringify(next) !== storedKey) onCommit(next);
        }}
        disabled={disabled}
        aria-describedby={copy.helpText ? `${id}-help` : undefined}
        data-testid={testId}
        className="h-8 text-sm"
      />
      <FieldHelp id={`${id}-help`} text={copy.helpText} />
    </div>
  );
}

/**
 * The member Description box. `description` is an `I18nLabel` like `label`:
 * the box reads and writes the active locale's entry of an inline map, so
 * editing one locale never flattens the others, and clearing it removes only
 * that entry.
 */
function MemberDescriptionField({
  value,
  copy,
  locale,
  disabled,
  onCommit,
  testId,
}: {
  value: unknown;
  copy: FieldCopy;
  locale: SupportedLocale;
  disabled?: boolean;
  onCommit: (next: unknown) => void;
  testId?: string;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{copy.label}</Label>
      <Textarea
        id={id}
        value={pickLocalized(value, locale)}
        onChange={(e) => {
          const v = e.target.value;
          onCommit(v ? setLocalized(value, locale, v) : clearLocalized(value, locale));
        }}
        disabled={disabled}
        rows={2}
        aria-describedby={copy.helpText ? `${id}-help` : undefined}
        data-testid={testId}
        className="min-h-[3rem] text-sm"
      />
      <FieldHelp id={`${id}-help`} text={copy.helpText} />
    </div>
  );
}

/** Synonyms and Description for one dimension or measure row. */
export function DatasetMemberVocabulary({
  kind,
  member,
  locale,
  disabled,
  onWrite,
}: {
  kind: DatasetMemberKind;
  member: { synonyms?: unknown; description?: unknown };
  locale: SupportedLocale;
  disabled?: boolean;
  onWrite: (key: MemberVocabularyKey, value: unknown) => void;
}) {
  const copy = memberVocabularyCopy(kind, locale);
  return (
    <>
      <MemberSynonymsField
        value={member.synonyms}
        copy={copy.synonyms}
        disabled={disabled}
        onCommit={(next) => onWrite('synonyms', next)}
        testId={`dataset-${kind}-synonyms`}
      />
      <MemberDescriptionField
        value={member.description}
        copy={copy.description}
        locale={locale}
        disabled={disabled}
        onCommit={(next) => onWrite('description', next)}
        testId={`dataset-${kind}-description`}
      />
    </>
  );
}
