// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowRecipientsField — the notify node's `recipients` editor (objectui#11788).
 *
 * One row per recipient, each a TYPE plus a value picked for that type, so a
 * "notify the owner when the ticket is done" flow is built without typing an
 * audience selector by hand:
 *
 * | Type          | Picked with                                   | Stored as                                  |
 * |---------------|-----------------------------------------------|--------------------------------------------|
 * | Record field  | the trigger object's fields                   | `{ dialect: 'cel', source: 'record.FIELD' }` |
 * | User          | a `sys_user` lookup                           | the user id                                |
 * | Team          | a `sys_team` lookup                           | `team:ID`                                  |
 * | Email address | free text, checked for an email's shape       | the address                                |
 * | Expression    | CEL with the bare-reference picker            | `{ dialect: 'cel', source }`               |
 * | Other         | free text                                     | exactly as typed                           |
 *
 * The spellings are the ones `NotifyConfigSchema.recipients` (in
 * `@objectstack/spec/automation`) accepts: a recipient string, a list of them,
 * each a string or a CEL value envelope evaluated per run, or one envelope.
 * `recipients` is a VALUE slot: a string is the literal text it spells, and a
 * `{…}` template token in one is refused (objectui#11824, the ADR-0032 §3
 * cutover; the spec prescribes `{ dialect: 'cel', source: 'record.owner' }`
 * for `{record.owner}`). Each resolved value is an audience spec for the
 * messaging service's `RecipientResolver` (objectstack `service-messaging`,
 * ADR-0030): a bare user id, `team:ID`, or an email-shaped value resolved to a
 * user. The user and team lookups are the ones the approval node's approvers
 * already use, so the committed column is the spec's `APPROVER_VALUE_SOURCES`
 * binding (`sys_user.id`, `sys_team.id`).
 *
 * "Other" keeps every stored string editable that is none of the four — a
 * `role:NAME` or `owner_of:OBJECT:ID` selector, a `user:ID`, or a stored
 * single-brace token such as `{ownerId}` — byte for byte, and an unedited
 * envelope is written back as it was read: reading a flow and saving it again
 * never rewrites a recipient. A stored `{record.FIELD}` string is NOT read as a
 * Record field row: the spec refuses it, and the platform ships no conversion
 * for it (an absent key wrote nothing under the template and fails under CEL),
 * so the rewrite is the author's call. A stored single value stays single while
 * it holds one recipient; the offline `stringList` editor used to read a string
 * as an empty list.
 */

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { RequiredMarker, uniqueId } from './_shared.js';
import { ReferenceCombobox, type FlowReferenceContext, type ResolvedRef } from './FlowReferenceField.js';
import { VariableTextInput } from './VariableTextInput.js';
import { FlowExprIssue } from './FlowExprIssue.js';
import type { ScopeGroup } from './useFlowScope.js';
import { t, type SupportedLocale } from '../i18n.js';

/** The recipient types a row can hold. `custom` is "Other": stored as typed. */
export type RecipientKind = 'field' | 'user' | 'team' | 'email' | 'expression' | 'custom';

export const RECIPIENT_KINDS: readonly RecipientKind[] = ['field', 'user', 'team', 'email', 'expression', 'custom'];

/** A CEL value envelope, the computed form of a recipient (spec `NotifyRecipientsSlotSchema`). */
export interface CelValueEnvelope {
  dialect: 'cel';
  source: string;
  [key: string]: unknown;
}

/** One stored recipient: a literal string, or a CEL value envelope. */
export type StoredRecipient = string | CelValueEnvelope;

export interface RecipientEntry {
  kind: RecipientKind;
  /** The field name, user id, team id, address or CEL source — or the raw text for `custom`. */
  value: string;
  /** The envelope as read, written back while the row is unedited (it may carry `ast` / `meta`). */
  stored?: CelValueEnvelope;
}

/** The `team:` audience prefix `RecipientResolver` expands to the team's members. */
const TEAM_PREFIX = 'team:';

/** `record.FIELD` — one field of the trigger record, as a CEL source. */
const RECORD_FIELD_SOURCE = /^record\.([A-Za-z_][A-Za-z0-9_]*)$/;

export function isCelValueEnvelope(v: unknown): v is CelValueEnvelope {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    (v as { dialect?: unknown }).dialect === 'cel' &&
    typeof (v as { source?: unknown }).source === 'string'
  );
}

/**
 * Whether `s` has an email's shape — the same linear test `RecipientResolver`
 * applies before it looks a recipient up by email (one `@`, not first or last,
 * a dot inside the domain, no whitespace). A value that fails it is read by the
 * resolver as a user id, which is why the Email row warns instead of saving it
 * silently.
 */
export function looksLikeEmail(s: string): boolean {
  if (!s || /\s/.test(s)) return false;
  const at = s.indexOf('@');
  if (at <= 0 || at !== s.lastIndexOf('@') || at === s.length - 1) return false;
  const domain = s.slice(at + 1);
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

/** Classify one stored recipient. Never rewrites it: see {@link writeRecipient}. */
export function readRecipient(raw: StoredRecipient): RecipientEntry {
  if (typeof raw !== 'string') {
    const field = RECORD_FIELD_SOURCE.exec(raw.source.trim());
    return field ? { kind: 'field', value: field[1], stored: raw } : { kind: 'expression', value: raw.source, stored: raw };
  }
  if (raw.startsWith(TEAM_PREFIX) && raw.length > TEAM_PREFIX.length && !/[\s{}]/.test(raw)) {
    return { kind: 'team', value: raw.slice(TEAM_PREFIX.length) };
  }
  if (looksLikeEmail(raw)) return { kind: 'email', value: raw };
  // A bare token is a user id to the resolver; anything carrying a brace, a
  // colon (another selector) or whitespace is kept as typed.
  if (/^[^\s{}:@]+$/.test(raw)) return { kind: 'user', value: raw };
  return { kind: 'custom', value: raw };
}

/** The stored value for one entry; `''` for an entry with no value yet. */
export function writeRecipient(entry: RecipientEntry): StoredRecipient {
  if (entry.stored) return entry.stored;
  const v = entry.value.trim();
  if (!v) return '';
  switch (entry.kind) {
    case 'field':
      return { dialect: 'cel', source: `record.${v}` };
    case 'expression':
      return { dialect: 'cel', source: v };
    case 'team':
      return `${TEAM_PREFIX}${v}`;
    default:
      return v;
  }
}

/** Whether the stored `recipients` value is one recipient rather than a list. */
export function isSingleRecipient(value: unknown): boolean {
  return typeof value === 'string' || isCelValueEnvelope(value);
}

/** Read the stored `recipients` value (one recipient, or a list of them) as entries. */
export function readRecipients(value: unknown): RecipientEntry[] {
  const list: unknown[] = Array.isArray(value) ? value : isSingleRecipient(value) ? [value] : [];
  return list
    .filter((v): v is StoredRecipient => (typeof v === 'string' && v.trim() !== '') || isCelValueEnvelope(v))
    .map((v) => readRecipient(v));
}

/**
 * The value to store for `entries`: `undefined` for none, a single value when
 * the stored value was one and still holds one recipient, else a list.
 */
export function writeRecipients(
  entries: RecipientEntry[],
  storedAsSingle: boolean,
): StoredRecipient | StoredRecipient[] | undefined {
  const list = entries.map(writeRecipient).filter((s) => s !== '');
  if (list.length === 0) return undefined;
  return storedAsSingle && list.length === 1 ? list[0] : list;
}

/** The reference each picked type resolves through (`FlowReferenceField`'s combobox). */
const KIND_REF: Partial<Record<RecipientKind, ResolvedRef>> = {
  // `$trigger`: the Start node's object, the record `record.*` names.
  field: { kind: 'object-field', objectSource: '$trigger' },
  user: { kind: 'user' },
  team: { kind: 'team' },
};

/** The designer-table rows naming each type, and the hint inside its value control. */
const KIND_LABEL_KEYS: Record<RecipientKind, string> = {
  field: 'engine.inspector.recipients.kind.field',
  user: 'engine.inspector.recipients.kind.user',
  team: 'engine.inspector.recipients.kind.team',
  email: 'engine.inspector.recipients.kind.email',
  expression: 'engine.inspector.recipients.kind.expression',
  custom: 'engine.inspector.recipients.kind.custom',
};
const KIND_PLACEHOLDER_KEYS: Record<RecipientKind, string> = {
  field: 'engine.inspector.recipients.placeholder.field',
  user: 'engine.inspector.recipients.placeholder.user',
  team: 'engine.inspector.recipients.placeholder.team',
  email: 'engine.inspector.recipients.placeholder.email',
  expression: 'engine.inspector.recipients.placeholder.expression',
  custom: 'engine.inspector.recipients.placeholder.custom',
};

interface Row extends RecipientEntry {
  id: string;
}

function toRows(entries: RecipientEntry[]): Row[] {
  const ids: string[] = [];
  return entries.map((e) => {
    const id = uniqueId('rcp', ids);
    ids.push(id);
    return { id, ...e };
  });
}

export interface FlowRecipientsFieldProps {
  label: string;
  value: unknown;
  onCommit: (value: StoredRecipient | StoredRecipient[] | undefined) => void;
  disabled?: boolean;
  locale?: SupportedLocale | string;
  /** Draft + node, so a Record field row can read the trigger object. */
  context?: FlowReferenceContext;
  /** In-scope references for an Expression row's picker. */
  scopeGroups?: ScopeGroup[];
  /** The spec requires this key (objectui#10948). */
  required?: boolean;
}

export function FlowRecipientsField({
  label,
  value,
  onCommit,
  disabled,
  locale,
  context,
  scopeGroups,
  required,
}: FlowRecipientsFieldProps) {
  const storedAsSingle = isSingleRecipient(value);
  const external = React.useMemo(
    () => JSON.stringify(writeRecipients(readRecipients(value), storedAsSingle) ?? null),
    [value, storedAsSingle],
  );
  const [rows, setRows] = React.useState<Row[]>(() => toRows(readRecipients(value)));
  const lastCommitted = React.useRef(external);

  // An EXTERNAL change (another node selected, an undo) resyncs the rows; our
  // own commits do not, so a half-edited row keeps its focus.
  React.useEffect(() => {
    if (external !== lastCommitted.current) {
      setRows(toRows(readRecipients(value)));
      lastCommitted.current = external;
    }
  }, [external, value]);

  const flush = (next: Row[]) => {
    const out = writeRecipients(next, storedAsSingle);
    lastCommitted.current = JSON.stringify(out ?? null);
    onCommit(out);
  };

  // Each handler derives the next rows from the rows on screen and commits
  // outside the state updater, so a commit runs once per gesture. An edited
  // row is written from its type and value: the envelope it was read from is
  // dropped.
  const patchRow = (id: string, patch: Partial<RecipientEntry>, commit: boolean) => {
    const next = rows.map((r) => (r.id === id ? { ...r, ...patch, stored: undefined } : r));
    setRows(next);
    if (commit) flush(next);
  };

  const addRow = () => {
    setRows([...rows, { id: uniqueId('rcp', rows.map((r) => r.id)), kind: 'field', value: '' }]);
  };

  const removeRow = (id: string) => {
    const next = rows.filter((r) => r.id !== id);
    setRows(next);
    flush(next);
  };

  const kindLabel = (k: RecipientKind) => t(KIND_LABEL_KEYS[k], locale);
  const placeholder = (k: RecipientKind) => t(KIND_PLACEHOLDER_KEYS[k], locale);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {required && <RequiredMarker />}
      </Label>
      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-[11px] italic text-muted-foreground">{t('engine.inspector.recipients.empty', locale)}</p>
        )}
        {rows.map((row, index) => {
          const ref = KIND_REF[row.kind];
          const notEmail = row.kind === 'email' && row.value.trim() !== '' && !looksLikeEmail(row.value.trim());
          return (
            <div key={row.id} className="space-y-1" data-recipient-row={index}>
              <div className="flex items-center gap-1.5">
                <Select
                  value={row.kind}
                  // A new type starts empty: a user id is not a field name.
                  onValueChange={(k) => patchRow(row.id, { kind: k as RecipientKind, value: '' }, true)}
                  disabled={disabled}
                >
                  <SelectTrigger
                    className="h-8 w-[7.5rem] shrink-0 text-xs"
                    aria-label={t('engine.inspector.recipients.kindLabel', locale)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECIPIENT_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {kindLabel(k)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="min-w-0 flex-1">
                  {ref ? (
                    <ReferenceCombobox
                      resolved={ref}
                      value={row.value}
                      onCommit={(v) => patchRow(row.id, { value: v == null ? '' : String(v) }, false)}
                      onBlur={() => flush(rows)}
                      onSelect={(v) => patchRow(row.id, { value: v }, true)}
                      disabled={disabled}
                      placeholder={placeholder(row.kind)}
                      context={context}
                      ariaLabel={kindLabel(row.kind)}
                    />
                  ) : row.kind === 'expression' ? (
                    <VariableTextInput
                      mode="expression"
                      mono
                      value={row.value}
                      onValueChange={(v) => patchRow(row.id, { value: v }, false)}
                      onBlur={() => flush(rows)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      groups={scopeGroups ?? []}
                      placeholder={placeholder('expression')}
                      disabled={disabled}
                    />
                  ) : row.kind === 'custom' ? (
                    <Input
                      value={row.value}
                      onChange={(e) => patchRow(row.id, { value: e.target.value }, false)}
                      onBlur={() => flush(rows)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      placeholder={placeholder('custom')}
                      aria-label={kindLabel('custom')}
                      disabled={disabled}
                      className="h-8 text-sm"
                    />
                  ) : (
                    <Input
                      type="email"
                      value={row.value}
                      onChange={(e) => patchRow(row.id, { value: e.target.value }, false)}
                      onBlur={() => flush(rows)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      placeholder={placeholder('email')}
                      aria-label={kindLabel('email')}
                      aria-invalid={notEmail || undefined}
                      disabled={disabled}
                      className="h-8 text-sm"
                    />
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
                  onClick={() => removeRow(row.id)}
                  disabled={disabled}
                  aria-label={t('engine.inspector.recipients.remove', locale)}
                  title={t('engine.inspector.recipients.remove', locale)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              {row.kind === 'expression' && row.value.trim() !== '' && (
                <FlowExprIssue value={row.value} role="value" scopeGroups={scopeGroups} />
              )}
              {notEmail && (
                <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400" role="note">
                  {t('engine.inspector.recipients.notEmail', locale)}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-full text-xs"
        onClick={addRow}
        disabled={disabled}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t('engine.inspector.recipients.add', locale)}
      </Button>
    </div>
  );
}
