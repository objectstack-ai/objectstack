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
 * | Email field   | the trigger object's `email`-typed fields     | `{ emailField: 'FIELD' }`, the whole value |
 * | User          | a `sys_user` lookup                           | the user id                                |
 * | Team          | a `sys_team` lookup                           | `team:ID`                                  |
 * | Email address | free text, checked for an email's shape       | the address                                |
 * | Expression    | CEL with the bare-reference picker            | `{ dialect: 'cel', source }`               |
 * | Other         | free text                                     | exactly as typed                           |
 *
 * The spellings are the ones `NotifyConfigSchema.recipients` (in
 * `@objectstack/spec/automation`) accepts: a recipient string, a list of them,
 * each a string or a CEL value envelope evaluated per run, one envelope, or an
 * email-field recipient as the whole value.
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
 * The Email field row (objectstack#25900) mails a person who is not a user: the
 * address in an `email`-typed field of the trigger record. The spec takes it
 * only as the whole `recipients` value, on a node whose one channel is `email`,
 * so the row is offered only while it is the sole row, no row is added beside
 * it, and the commit that first stores it writes `channels: ['email']` in the
 * same patch when the node does not already name email alone. On a node that
 * sends email the runtime refuses a computed address no user holds, which is
 * what a Record field row over an `email`-typed field evaluates to: there the
 * Record field row suggests no such field, and a stored one says why it may
 * fail.
 *
 * "Other" keeps every stored string editable that is none of the four — a
 * `role:NAME` or `owner_of:OBJECT:ID` selector, a `user:ID`, or a stored
 * single-brace token such as `{ownerId}` — byte for byte, and an unedited
 * envelope or email-field recipient is written back as it was read: reading a
 * flow and saving it again never rewrites a recipient. A stored
 * `{record.FIELD}` string is NOT read as a
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
import { isExpressionEnvelopeShaped } from '@objectstack/spec/automation';
import { RequiredMarker, uniqueId } from './_shared.js';
import {
  ReferenceCombobox,
  resolveObjectName,
  type FlowReferenceContext,
  type ResolvedRef,
} from './FlowReferenceField.js';
import { VariableTextInput } from './VariableTextInput.js';
import { FlowExprIssue } from './FlowExprIssue.js';
import type { ScopeGroup } from './useFlowScope.js';
import { useObjectFields } from '../previews/useObjectFields.js';
import { t, type SupportedLocale } from '../i18n.js';

/** The recipient types a row can hold. `custom` is "Other": stored as typed. */
export type RecipientKind = 'field' | 'emailField' | 'user' | 'team' | 'email' | 'expression' | 'custom';

export const RECIPIENT_KINDS: readonly RecipientKind[] = [
  'field',
  'emailField',
  'user',
  'team',
  'email',
  'expression',
  'custom',
];

/** A CEL value envelope, the computed form of a recipient (spec `NotifyRecipientsSlotSchema`). */
export interface CelValueEnvelope {
  dialect: 'cel';
  source: string;
  [key: string]: unknown;
}

/** An email-field recipient (spec `NotifyEmailFieldRecipientSchema`): the whole `recipients` value. */
export interface EmailFieldRecipient {
  emailField: string;
  [key: string]: unknown;
}

/** One stored recipient: a literal string, a CEL value envelope, or an email-field recipient. */
export type StoredRecipient = string | CelValueEnvelope | EmailFieldRecipient;

export interface RecipientEntry {
  kind: RecipientKind;
  /** The field name, user id, team id, address or CEL source — or the raw text for `custom`. */
  value: string;
  /** The object as read, written back while the row is unedited (an envelope may carry `ast` / `meta`). */
  stored?: CelValueEnvelope | EmailFieldRecipient;
}

/**
 * Config keys a commit writes beside `recipients`, in the same patch — today
 * only `channels`, which an email-field recipient needs to be `email` alone.
 */
export type RecipientsAlongside = Readonly<Record<string, unknown>>;

/** The `team:` audience prefix `RecipientResolver` expands to the team's members. */
const TEAM_PREFIX = 'team:';

/** `record.FIELD` — one field of the trigger record, as a CEL source. */
const RECORD_FIELD_SOURCE = /^record\.([A-Za-z_][A-Za-z0-9_]*)$/;

/** The field type an email-field recipient names (the lint rule `validateNotifyEmailFieldRecipients` judges the same). */
const EMAIL_FIELD_TYPE = 'email';
const EMAIL_FIELD_TYPES: readonly string[] = [EMAIL_FIELD_TYPE];

/** The one channel that can deliver to an email-field recipient, as the node stores it. */
const EMAIL_ONLY_CHANNELS: readonly string[] = ['email'];

export function isCelValueEnvelope(v: unknown): v is CelValueEnvelope {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    (v as { dialect?: unknown }).dialect === 'cel' &&
    typeof (v as { source?: unknown }).source === 'string'
  );
}

/** Whether `v` is written as an email-field recipient — a plain object with an `emailField` key. */
export function isEmailFieldRecipient(v: unknown): v is EmailFieldRecipient {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.prototype.hasOwnProperty.call(v, 'emailField') &&
    !isExpressionEnvelopeShaped(v)
  );
}

/** A notify node's `channels`, a string or a list, as a list. */
export function readChannels(channels: unknown): string[] {
  if (typeof channels === 'string') return [channels];
  return Array.isArray(channels) ? channels.filter((c): c is string => typeof c === 'string') : [];
}

/** Whether `channels` names `email` and nothing else — what an email-field recipient needs. */
export function isEmailOnlyChannels(channels: unknown): boolean {
  const list = readChannels(channels);
  return list.length === 1 && list[0] === 'email';
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
  if (isEmailFieldRecipient(raw)) {
    return { kind: 'emailField', value: typeof raw.emailField === 'string' ? raw.emailField : String(raw.emailField), stored: raw };
  }
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
    case 'emailField':
      return { emailField: v };
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
  return typeof value === 'string' || isCelValueEnvelope(value) || isEmailFieldRecipient(value);
}

/** Read the stored `recipients` value (one recipient, or a list of them) as entries. */
export function readRecipients(value: unknown): RecipientEntry[] {
  const list: unknown[] = Array.isArray(value) ? value : isSingleRecipient(value) ? [value] : [];
  return list
    .filter(
      (v): v is StoredRecipient =>
        (typeof v === 'string' && v.trim() !== '') || isCelValueEnvelope(v) || isEmailFieldRecipient(v),
    )
    .map((v) => readRecipient(v));
}

/**
 * The value to store for `entries`: `undefined` for none, a single value when
 * the stored value was one and still holds one recipient, else a list. A sole
 * email-field recipient is always the single value: the spec takes it only as
 * the whole `recipients` value.
 */
export function writeRecipients(
  entries: RecipientEntry[],
  storedAsSingle: boolean,
): StoredRecipient | StoredRecipient[] | undefined {
  const list = entries.map(writeRecipient).filter((s) => s !== '');
  if (list.length === 0) return undefined;
  if (list.length === 1 && isEmailFieldRecipient(list[0])) return list[0];
  return storedAsSingle && list.length === 1 ? list[0] : list;
}

/** The reference each picked type resolves through (`FlowReferenceField`'s combobox). */
const KIND_REF: Partial<Record<RecipientKind, ResolvedRef>> = {
  // `$trigger`: the Start node's object, the record `record.*` names.
  field: { kind: 'object-field', objectSource: '$trigger' },
  emailField: { kind: 'object-field', objectSource: '$trigger', onlyFieldTypes: EMAIL_FIELD_TYPES },
  user: { kind: 'user' },
  team: { kind: 'team' },
};

/**
 * The Record field reference on a node that sends email: an `email`-typed field
 * is the Email field row's, since the runtime refuses the address a
 * `record.FIELD` envelope evaluates to there unless a user holds it.
 */
const FIELD_REF_ON_EMAIL_NODE: ResolvedRef = {
  kind: 'object-field',
  objectSource: '$trigger',
  exceptFieldTypes: EMAIL_FIELD_TYPES,
};

/** The designer-table rows naming each type, and the hint inside its value control. */
const KIND_LABEL_KEYS: Record<RecipientKind, string> = {
  field: 'engine.inspector.recipients.kind.field',
  emailField: 'engine.inspector.recipients.kind.emailField',
  user: 'engine.inspector.recipients.kind.user',
  team: 'engine.inspector.recipients.kind.team',
  email: 'engine.inspector.recipients.kind.email',
  expression: 'engine.inspector.recipients.kind.expression',
  custom: 'engine.inspector.recipients.kind.custom',
};
const KIND_PLACEHOLDER_KEYS: Record<RecipientKind, string> = {
  field: 'engine.inspector.recipients.placeholder.field',
  emailField: 'engine.inspector.recipients.placeholder.emailField',
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
  /**
   * Commits `recipients`; `alongside` names sibling config keys written in the
   * same patch (`channels` for an email-field recipient).
   */
  onCommit: (value: StoredRecipient | StoredRecipient[] | undefined, alongside?: RecipientsAlongside) => void;
  disabled?: boolean;
  locale?: SupportedLocale | string;
  /** Draft + node, so a Record field row can read the trigger object and the node's `channels`. */
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

  // The node's channels decide what an email-typed field may be used as.
  const nodeConfig = context?.node?.config;
  const channels =
    nodeConfig && typeof nodeConfig === 'object' && !Array.isArray(nodeConfig)
      ? (nodeConfig as Record<string, unknown>).channels
      : undefined;
  const sendsEmail = readChannels(channels).includes('email');
  const emailOnly = isEmailOnlyChannels(channels);

  // The trigger object's field types, for the notes below.
  const triggerObject = context ? resolveObjectName('object-field', '$trigger', context) : undefined;
  const { fields: triggerFields } = useObjectFields(triggerObject);
  const fieldType = (name: string) => triggerFields.find((f) => f.name === name)?.type;

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
    const committed = JSON.stringify(out ?? null);
    // The commit that first stores an email-field recipient also makes the
    // node's channels the one that can deliver to it; a blur that changes
    // nothing writes no channel.
    const setsEmailField = isEmailFieldRecipient(out) && committed !== lastCommitted.current;
    lastCommitted.current = committed;
    if (setsEmailField && !emailOnly) onCommit(out, { channels: [...EMAIL_ONLY_CHANNELS] });
    else onCommit(out);
  };

  // Each handler derives the next rows from the rows on screen and commits
  // outside the state updater, so a commit runs once per gesture. An edited
  // row is written from its type and value: the object it was read from is
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

  // A stored email-field recipient on a node that names another channel: the
  // author's explicit fix, the recipients committed as they stand.
  const setEmailOnly = () => {
    const out = writeRecipients(rows, storedAsSingle);
    lastCommitted.current = JSON.stringify(out ?? null);
    onCommit(out, { channels: [...EMAIL_ONLY_CHANNELS] });
  };

  const hasEmailField = rows.some((r) => r.kind === 'emailField');
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
          const ref = row.kind === 'field' && sendsEmail ? FIELD_REF_ON_EMAIL_NODE : KIND_REF[row.kind];
          const picked = row.value.trim();
          const notEmail = row.kind === 'email' && picked !== '' && !looksLikeEmail(picked);
          // A Record field row over an email-typed field, on a node that sends email.
          const fieldIsEmail = row.kind === 'field' && sendsEmail && picked !== '' && fieldType(picked) === EMAIL_FIELD_TYPE;
          // An Email field row naming a field the catalog types otherwise.
          const pickedType = row.kind === 'emailField' && picked !== '' ? fieldType(picked) : undefined;
          const emailFieldNotEmail = pickedType !== undefined && pickedType !== EMAIL_FIELD_TYPE;
          const needsEmailOnly = row.kind === 'emailField' && picked !== '' && !emailOnly;
          // The Email field type is the whole value: offered only on the sole row.
          const kinds = RECIPIENT_KINDS.filter((k) => k !== 'emailField' || rows.length === 1 || row.kind === 'emailField');
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
                    {kinds.map((k) => (
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
              {fieldIsEmail && (
                <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400" role="note">
                  {t('engine.inspector.recipients.fieldOnEmailNode', locale)}
                </p>
              )}
              {row.kind === 'emailField' && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {t('engine.inspector.recipients.emailFieldHint', locale)}
                </p>
              )}
              {emailFieldNotEmail && (
                <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400" role="note">
                  {t('engine.inspector.recipients.emailFieldNotEmail', locale)}
                </p>
              )}
              {needsEmailOnly && (
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400" role="note">
                    {t('engine.inspector.recipients.emailFieldChannels', locale)}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 shrink-0 px-2 text-[11px]"
                    onClick={setEmailOnly}
                    disabled={disabled}
                  >
                    {t('engine.inspector.recipients.emailFieldChannelsFix', locale)}
                  </Button>
                </div>
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
        disabled={disabled || hasEmailField}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t('engine.inspector.recipients.add', locale)}
      </Button>
    </div>
  );
}
