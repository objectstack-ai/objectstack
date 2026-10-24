// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PackageFormDialog — ONE modal for creating, editing, and viewing a package,
 * rendered from the spec-derived manifest form (`package-schema`) through the
 * generic {@link SchemaForm}. It replaces the three hand-rolled package forms
 * (CreatePackageDialog / EditPackageDialog / the BuilderLanding inline form),
 * each of which carried its own field list and id-validation regex — a package
 * created on one surface was rejected by another.
 *
 * Modes:
 *   • create → POST /api/v1/packages { manifest }         (409 on duplicate id)
 *   • edit   → PATCH /api/v1/packages/:id { name, description, version,
 *              dependencies? } — `dependencies` only when the author changed
 *              it (objectui#13121); the door persists those four keys and
 *              judges `dependencies` by `ManifestSchema`'s row
 *              (objectstack#24670). `id` / `type` / `namespace` / `scope` / …
 *              are `immutable` in the form and lock automatically once
 *              `createMode` is false.
 *   • view   → read-only render of the manifest
 *
 * Create mode's Package ID is not the spec form's text field but the shared
 * {@link PackageIdInput} (objectui#11792): it follows the display name until
 * the author edits it, and the dialog submits only an id the installed
 * `ManifestSchema` accepts — the rule `POST /api/v1/packages` refuses by.
 *
 * Create mode opens on the display name (objectui#12512): the id, namespace
 * and version below it in the same card are filled in for the author, each
 * says so until edited, and focusing one selects its whole value so typing
 * replaces it.
 */

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { ManifestSchema, deriveNamespaceFromPackageId } from '@objectstack/spec/kernel';
import { useAuth } from '@object-ui/auth';
import { NAMESPACE_RE, isSpecPackageId } from '../studio-design/packages-io.js';
import { PackageIdInput } from '../studio-design/PackageIdInput.js';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Label,
} from '@object-ui/components';
import { useMetadataLocale, t, tFormat, tOptional } from './i18n.js';
import { SchemaForm, type SchemaFormIssue } from './SchemaForm.js';
import type { FormFieldSpec, FormViewSpec } from './form-spec.js';
import { getPackageSchema, getPackageForm } from './package-schema.js';
import { PackageDependenciesEditor, type DependencyMap } from './PackageDependenciesEditor.js';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';

const API = '/api/v1/packages';

/**
 * Create mode renders the id through {@link PackageIdInput}, so the form's own
 * text field for it is hidden (still preserved on save). Edit and view keep
 * the form's locked id field (objectui#11792).
 */
const CREATE_HIDDEN_FIELDS = ['id', 'dependencies'];

/**
 * The `dependencies` row is a `package name → version range` map the spec
 * form has no renderer for: it fell back to a raw JSON box under a developer
 * hint (objectui#13278). Every mode hides it from the spec form and hosts
 * {@link PackageDependenciesEditor} instead, labelled from the form's own row.
 */
const HIDDEN_FIELDS = ['dependencies'];

/**
 * The fields create mode lays out itself, in one Basics card and in this
 * order (objectui#12512): the display name first, because the id, namespace
 * and version are filled in from it, then those three, then the rest of the
 * curated Basics fields. Every row except the id is still the spec form's
 * own field, taken from {@link getPackageForm} by name.
 */
const CREATE_BASICS_TAIL = ['type', 'description'] as const;
const CREATE_HOSTED_FIELDS: readonly string[] = ['name', 'id', 'namespace', 'version', ...CREATE_BASICS_TAIL];

function fieldName(f: string | FormFieldSpec): string {
  return typeof f === 'string' ? f : f.field;
}

/** The row named `name` in `form`, if the form declares one. */
function findFormField(form: FormViewSpec, name: string): FormFieldSpec | undefined {
  for (const s of form.sections ?? []) {
    if (!s.fields) continue;
    for (const f of s.fields) {
      if (fieldName(f) === name) return typeof f === 'string' ? { field: f } : f;
    }
  }
  return undefined;
}

/** A one-section form view holding `names` from `form`, in that order. */
function pickFormFields(form: FormViewSpec, names: readonly string[]): FormViewSpec {
  const byName = new Map<string, string | FormFieldSpec>();
  for (const s of form.sections ?? []) {
    if (!s.fields) continue; // a `{ group }` section hosts none of these fields
    for (const f of s.fields) byName.set(fieldName(f), f);
  }
  const fields = names.flatMap((n) => {
    const f = byName.get(n);
    return f === undefined ? [] : [f];
  });
  return { type: form.type, sections: [{ columns: 1, fields }] };
}

/** `form` without the sections whose fields create mode hosts in its Basics card. */
function withoutHostedSections(form: FormViewSpec): FormViewSpec {
  const sections = (form.sections ?? []).filter(
    (s) => !s.fields || !s.fields.some((f) => CREATE_HOSTED_FIELDS.includes(fieldName(f))),
  );
  return { type: form.type, sections };
}

/**
 * The spec form draws each section as its own bordered card. Inside the
 * Basics card the picked one-section forms drop that frame so the rows read
 * as one card, not a card per row.
 */
const FLUSH_SECTION =
  '[&>div>section]:rounded-none [&>div>section]:border-0 [&>div>section]:bg-transparent [&>div>section]:p-0';

/**
 * One field the dialog fills in for the author (objectui#12512). While the
 * value is still the filled-in one, the field says so under its row and
 * focusing it selects the whole value, so the next keystroke replaces it
 * instead of being appended to text the author never typed.
 */
function DerivedField({
  derived,
  hint,
  testId,
  children,
}: {
  derived: boolean;
  hint: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="space-y-1.5"
      data-testid={testId}
      data-derived={derived ? 'true' : 'false'}
      onFocus={(e) => {
        if (derived && e.target instanceof HTMLInputElement) e.target.select();
      }}
    >
      {children}
      {derived && (
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-derived`}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Is `v` a package version the INSTALLED `@objectstack/spec` accepts?
 *
 * Judged by `ManifestSchema`'s own `version` field schema, never by a grammar
 * copied into this repo: a hand-copied regex drifts the moment the spec's
 * canon moves (objectui#10207 — the spec is converging every package-version
 * carrier on SemVer 2.0.0, objectstack#18697), leaving the dialog stricter or
 * looser than the contract it is a form for. Reading the field schema also
 * survives the spec renaming or retiring whatever pattern constant backs it.
 */
function isSpecPackageVersion(v: string): boolean {
  return ManifestSchema.shape.version.safeParse(v).success;
}

/**
 * One reverse-domain id segment from free text: accents folded, lowercased,
 * every run of other characters turned into one hyphen, no hyphen at either
 * end. Empty when nothing usable remains (a CJK-only name, say).
 */
function toIdSegment(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The id a new package's display name suggests: `com.<org>.<name>`, where
 * `<org>` is the active organization's slug as the session already holds it
 * (objectui#11792). With no active organization — no auth provider, a
 * single-tenant deployment, or a session whose organizations have not loaded
 * — the segment is left out rather than invented, giving `com.<name>`.
 *
 * The candidate is checked against the spec before it is offered, so a
 * derivation never puts an id in the field that the dialog itself refuses.
 * `null` when the name yields no segment at all.
 */
function deriveCreatePackageId(name: string, orgSlug: string | null | undefined): string | null {
  const nameSegment = toIdSegment(name);
  if (!nameSegment) return null;
  const orgSegment = orgSlug ? toIdSegment(orgSlug) : '';
  const candidate = ['com', orgSegment, nameSegment].filter(Boolean).join('.');
  return isSpecPackageId(candidate) ? candidate : null;
}

/**
 * Does the edit draft's `dependencies` row differ from the one the dialog
 * loaded (objectui#13121)? Compared by entries, not by key order: the door
 * replaces the stored row whole, so an unchanged map in another order is no
 * edit. An absent row reads as the empty map on both sides — the dialog's own
 * form state, not a producer's value — so an author who empties a non-empty
 * row has changed it, and a row that was never declared and is still empty
 * has not. A value that is not a plain map (an editor mid-edit) counts as
 * changed, so it reaches the door and is judged there rather than dropped.
 */
function dependenciesChanged(loaded: unknown, now: unknown): boolean {
  const asMap = (v: unknown): Record<string, unknown> | null =>
    v === undefined || v === null
      ? {}
      : typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
  const a = asMap(loaded);
  const b = asMap(now);
  if (!a || !b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return true;
  return keys.some((k) => !Object.prototype.hasOwnProperty.call(b, k) || a[k] !== b[k]);
}

/** Which filled-in create fields the author has edited (objectui#12512). */
type Touched = { id: boolean; namespace: boolean; version: boolean };
const UNTOUCHED: Touched = { id: false, namespace: false, version: false };

export type PackageFormMode = 'create' | 'edit' | 'view';

/** A package manifest as a loose record (spec `ManifestSchema` shape). */
export type ManifestRecord = Record<string, unknown>;

export interface PackageSaveResult {
  id: string;
  mode: PackageFormMode;
  /** The server's package payload, when it returned one. */
  package?: { manifest: ManifestRecord } & Record<string, unknown>;
}

/**
 * Was this envelope's prose MARKED, i.e. did the producer address it to the end
 * user (`error.userMessage`, objectstack `79c46da90`) rather than to whoever is debugging?
 *
 * ⚠️ Why this is read separately instead of taken from
 * {@link readEnvelopeFailureText}: that reader answers *what prose to show* and
 * deliberately collapses the two channels into one string
 * (`userMessage || message`, plus the declared code). Its return value
 * therefore cannot tell a caller WHICH channel won — and objectui#8051's two
 * status arms need exactly that bit, because their localized constant is a
 * generic substitution that objectstack-ai/objectstack#3821 keeps for UNMARKED bodies only. So
 * the mark is read here and carried across the throw; ⛔ the arms cannot
 * re-derive it from the message they receive.
 *
 * ⛔ Not a second copy of the shared rule. The rule about what to SHOW stays in
 * `readEnvelopeFailureText` and is not restated here; this answers a different
 * question about the same body, at the one call site that asks it. Widening the
 * shared reader's signature to return the provenance is the surface of the
 * card behind `a810bb2ae`, not this card's.
 *
 * The predicate is byte-identical to the shared reader's `marked` const on
 * purpose: a typed `string` check, not a truthiness one, so a non-string mark
 * is not a mark (a producer bug — falling through to the diagnostic is the
 * honest answer) and an empty-string mark is not one either.
 */
function readEnvelopeUserMessage(payload: unknown): string {
  const error = (payload as { error?: unknown } | null | undefined)?.error;
  if (!error || typeof error !== 'object') return '';
  const { userMessage } = error as { userMessage?: unknown };
  return typeof userMessage === 'string' ? userMessage : '';
}

/**
 * What `apiJson` attaches to the `Error` it throws, and the whole of the
 * contract `submit()`'s catch reads back. Named rather than cast away one
 * property at a time so the carrier is legible from both ends: the catch cannot
 * recover either field from the message, and objectui#8051 turns on that.
 */
type ApiJsonError = Error & { status: number; userMessage: string };

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok || payload?.success === false) {
    // The ADR-0112 envelope first, by the ONE shared rule — a producer-marked
    // `error.userMessage` outranks the diagnostic `error.message`, and
    // `error.code` rides along behind whichever won. This reader used to read
    // `error.message` and stop, so a marked sentence arrived on the wire (both
    // doors serving these package routes emit the channel) and had nowhere to
    // appear: on a marked 5xx the author was shown the generic substitution
    // the door had put in `message` instead of the sentence written for them.
    // See {@link readEnvelopeFailureText}.
    //
    // The two rungs BELOW it stay, and stay HERE rather than moving into the
    // shared reader: they are not the ADR-0112 envelope. A bare-string `error`
    // and a top-level `message` are older runtimes' shapes, live for this call
    // site and not for the rule's other consumers, and folding them in would
    // hand every one of those a tolerant dialect it never asked for.
    const msg =
      readEnvelopeFailureText(payload) ||
      payload?.error ||
      payload?.message ||
      `Request failed (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : `Request failed (${res.status})`) as ApiJsonError;
    err.status = res.status;
    // objectui#8051 — the mark travels WITH the refusal. `msg` above already
    // resolved to the marked sentence when there was one, but it did so
    // irreversibly; the status arms in `submit()`'s catch have to know whether
    // the prose they are about to discard was addressed to the person reading
    // the screen. Empty string when unmarked, which is the overwhelmingly
    // common case and everything the two package doors emit today.
    err.userMessage = readEnvelopeUserMessage(payload);
    throw err;
  }
  return (payload?.data ?? payload) as T;
}

function notifyPackagesChanged() {
  try {
    window.dispatchEvent(new CustomEvent('objectui:packages-changed'));
  } catch {
    /* non-DOM env */
  }
}

export function PackageFormDialog({
  mode,
  open,
  onOpenChange,
  manifest,
  onSaved,
}: {
  mode: PackageFormMode;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Existing manifest to seed edit/view. Ignored for create. */
  manifest?: ManifestRecord | null;
  onSaved?: (result: PackageSaveResult) => void;
}) {
  const locale = useMetadataLocale();
  const schema = React.useMemo(() => getPackageSchema(), []);
  const form = React.useMemo(() => getPackageForm(locale, { create: mode === 'create' }), [locale, mode]);
  // objectui#11792 — the `<org>` of a derived `com.<org>.<name>` id. Null
  // outside an AuthProvider and whenever the session has no active
  // organization; `deriveCreatePackageId` then leaves the segment out.
  const orgSlug = useAuth().activeOrganization?.slug ?? null;
  const idInputId = React.useId();

  const createMode = mode === 'create';
  const readOnly = mode === 'view';

  // The draft, and which of the fields the dialog fills in on create the
  // author has since edited. One state, so a keystroke updates both together
  // and the derived marks render from state (objectui#12512):
  //   • id — follows the display name (objectui#11792) until typed into;
  //   • namespace — follows the id (framework#2694) until typed into;
  //   • version — the prefilled default until typed into.
  const [{ draft, touched }, setForm] = React.useState<{ draft: ManifestRecord; touched: Touched }>({
    draft: {},
    touched: UNTOUCHED,
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // objectui#13278 — false while a dependencies row has an empty or duplicate
  // package name; the editor flags the row and save waits for it.
  const [dependenciesValid, setDependenciesValid] = React.useState(true);

  React.useEffect(() => {
    if (!open) return;
    if (createMode) {
      // Defaults for a new package. No `scope`, and the create form offers
      // none (objectui#12869): `POST /api/v1/packages` defaults it to
      // `project` and refuses `cloud` / `system` (objectstack#24160). Whether
      // the new package is writable is the server's verdict, the row's served
      // `writable`, which PackagesPage reads; it is never guessed from
      // `scope`. `defaultDatasource` is likewise left to the server so we
      // don't pin a datasource on create.
      setForm({ draft: { version: '0.1.0', type: 'app' }, touched: UNTOUCHED });
    } else {
      setForm({ draft: { ...(manifest ?? {}) }, touched: UNTOUCHED });
    }
    setError(null);
    setBusy(false);
    setDependenciesValid(true);
  }, [open, createMode, manifest]);

  const handleDependenciesChange = React.useCallback((dependencies: DependencyMap, valid: boolean) => {
    setDependenciesValid(valid);
    setForm((prev) => ({ ...prev, draft: { ...prev.draft, dependencies } }));
  }, []);

  // On create, keep `namespace` in sync with the id (deriveNamespaceFromPackageId)
  // until the user edits the namespace field themselves — mirroring the old
  // create form's behaviour (framework#2694). SchemaForm hands us the full next
  // value, so we diff id/namespace to decide. The id itself follows the display
  // name the same way until the author edits it (objectui#11792), and a
  // derived id moves the namespace exactly as a typed one does.
  const handleChange = React.useCallback(
    (next: ManifestRecord) => {
      if (!createMode) {
        setForm((prev) => ({ ...prev, draft: next }));
        return;
      }
      setForm(({ draft: prev, touched: was }) => {
        const touchedNow = { ...was };
        if (next.version !== prev.version) touchedNow.version = true;
        let id = next.id;
        if (!touchedNow.id && next.name !== prev.name) {
          id = deriveCreatePackageId(String(next.name ?? ''), orgSlug) ?? '';
        }
        let namespace = next.namespace;
        if (namespace !== prev.namespace) {
          // Direct edit — stop tracking the id and sanitize to the allowed
          // namespace alphabet (lowercase letters, digits, underscore).
          touchedNow.namespace = true;
          namespace = String(namespace ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '');
        }
        if (!touchedNow.namespace && id !== prev.id) {
          namespace = deriveNamespaceFromPackageId(String(id ?? '')) ?? '';
        }
        return { draft: { ...next, id, namespace }, touched: touchedNow };
      });
    },
    [createMode, orgSlug],
  );

  // The create-mode id field (PackageIdInput) reports the sanitized id alone.
  // Typing into it ends the name derivation for this opening of the dialog;
  // the namespace keeps following the id exactly as above.
  const handleIdChange = React.useCallback((id: string) => {
    setForm(({ draft: prev, touched: was }) => {
      const touchedNow = was.id ? was : { ...was, id: true };
      if (id === prev.id) return { draft: prev, touched: touchedNow };
      const namespace = touchedNow.namespace ? prev.namespace : (deriveNamespaceFromPackageId(id) ?? '');
      return { draft: { ...prev, id, namespace }, touched: touchedNow };
    });
  }, []);

  // The active organization can arrive after the author has typed the name
  // (the session's organization list loads on its own schedule); an id still
  // following the name picks the segment up then.
  React.useEffect(() => {
    if (!open || !createMode) return;
    setForm((prev) => {
      const { draft: was, touched: t } = prev;
      const name = String(was.name ?? '');
      if (t.id || !name.trim()) return prev;
      const id = deriveCreatePackageId(name, orgSlug) ?? '';
      if (id === was.id) return prev;
      const namespace = t.namespace ? was.namespace : (deriveNamespaceFromPackageId(id) ?? '');
      return { draft: { ...was, id, namespace }, touched: t };
    });
  }, [open, createMode, orgSlug]);

  // The help line SchemaForm would have shown under the id: the localized row
  // when there is one, else the spec's own `.describe()` (see package-schema).
  const idHelp = tOptional('engine.packages.form.help.id', locale) ?? ManifestSchema.shape.id.description;

  // Spec validation → inline issues (only where fields are editable).
  const issues: SchemaFormIssue[] = React.useMemo(() => {
    if (readOnly) return [];
    const res = ManifestSchema.safeParse(draft);
    if (res.success) return [];
    return res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  }, [draft, readOnly]);

  const nameOk = !!String(draft.name ?? '').trim();
  const versionStr = String(draft.version ?? '').trim();
  const versionOk = createMode
    ? isSpecPackageVersion(versionStr)
    : !versionStr || isSpecPackageVersion(versionStr);
  // objectui#11792 — on create, only an id the spec accepts: a non-empty id
  // used to be enough, so `Repairs Center` was posted and refused with a 400.
  const idOk = !createMode || isSpecPackageId(String(draft.id ?? '').trim());
  // Namespace is required on create (framework#2694): every object name is
  // prefixed with it. On edit it's immutable and not resubmitted.
  const nsOk = !createMode || NAMESPACE_RE.test(String(draft.namespace ?? '').trim());
  const canSubmit = !readOnly && nameOk && versionOk && idOk && nsOk && dependenciesValid && !busy;

  // objectui#12512 — every field that keeps Create disabled says why under its
  // row. The spec form already does for the name and the version, and the id
  // input for a malformed id; an EMPTY id or namespace is the case nothing
  // else explains (the id is not a spec-form row on create, and the manifest
  // declares `namespace` optional, so its parse raises no issue). Both wait
  // for a cause, as the spec form's own lines do: a name that derived no id
  // (a CJK-only name), an id that derived no namespace, or the author
  // clearing the field.
  const idStr = String(draft.id ?? '').trim();
  const idMissing = createMode && !idStr && (touched.id || nameOk);
  // objectui#13389 — the display name is there but holds no Latin letter to
  // make an id from (a Chinese name, say): say that, rather than the "filled
  // in from the display name" line over an empty box.
  const idNotDerived =
    createMode && !touched.id && !idStr && nameOk && !toIdSegment(String(draft.name ?? ''));
  const nsMissing =
    createMode && !String(draft.namespace ?? '').trim() && (touched.namespace || !!idStr);

  const createForms = React.useMemo(
    () =>
      createMode
        ? {
            name: pickFormFields(form, ['name']),
            namespace: pickFormFields(form, ['namespace']),
            version: pickFormFields(form, ['version']),
            tail: pickFormFields(form, CREATE_BASICS_TAIL),
            rest: withoutHostedSections(form),
          }
        : null,
    [createMode, form],
  );

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      let result: PackageSaveResult;
      if (createMode) {
        // No `scope` reaches the install door, even from a draft that holds
        // one: the create form offers none and the server defaults it.
        const { scope: _scope, ...authored } = draft;
        const manifestBody: ManifestRecord = {
          ...authored,
          id: String(draft.id ?? '').trim(),
          name: String(draft.name ?? '').trim(),
          version: versionStr,
          type: draft.type ?? 'app',
        };
        const created = await apiJson<{ manifest: ManifestRecord } & Record<string, unknown>>(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifest: manifestBody }),
        });
        const id = String((created?.manifest?.id as string) ?? manifestBody.id);
        result = { id, mode, package: created };
      } else {
        const id = String((manifest?.id as string) ?? draft.id ?? '');
        // The REST PATCH persists name / description / version / dependencies
        // (objectstack#24670). `dependencies` is sent only when the author
        // changed it, in the flat shape, and whole: the door replaces the
        // stored row with it, so an emptied editor sends `{}`, which clears
        // the declaration (objectui#13121). The row is judged by the door
        // (`400 VALIDATION_ERROR`); a read-only package is refused before the
        // body is read (`422 WRITABLE_PACKAGE_REQUIRED`). Both reach the
        // banner below like any other refusal.
        const patchBody: Record<string, unknown> = {
          name: String(draft.name ?? '').trim(),
          description: String(draft.description ?? '').trim(),
          version: versionStr,
        };
        if (dependenciesChanged(manifest?.dependencies, draft.dependencies)) {
          patchBody.dependencies = draft.dependencies ?? {};
        }
        const updated = await apiJson<{ manifest: ManifestRecord } & Record<string, unknown>>(
          `${API}/${encodeURIComponent(id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchBody),
          },
        );
        result = { id, mode, package: updated };
      }
      notifyPackagesChanged();
      onSaved?.(result);
      onOpenChange(false);
    } catch (e: any) {
      const msg: string = e?.message ?? '';
      // objectui#8051 — WAS this refusal marked? The two status arms below
      // answer with a localized constant, and that constant is a GENERIC
      // SUBSTITUTION: objectstack-ai/objectstack#3821's rule, which the envelope writer states as
      // "a consumer that sees the field renders it verbatim and keeps its
      // generic substitution for everything unmarked", keeps it for unmarked
      // bodies and hands a MARKED body straight to the person. Until this card
      // both arms applied the substitution to marked bodies too, so on the two
      // statuses an author meets most — 409 (id taken) and 403 (no ADR-0066
      // capability) — the one sentence a producer wrote for them was dropped.
      //
      // Ruling of record, objectui#8051 (2026-09-09), verbatim:
      // 「本地化分支改为优先使用生产方消息」, 「⛔ 无产品语义分叉」.
      //
      // ⚠️ This bit is NOT derivable from `msg`. `apiJson` resolves the
      // envelope through `readEnvelopeFailureText`, which returns
      // `userMessage || message` and reports no provenance — a marked sentence
      // and a diagnostic that happens to read the same are one value by then.
      // Hence `readEnvelopeUserMessage` at the throw site and this read here.
      const marked: boolean = typeof e?.userMessage === 'string' && e.userMessage !== '';
      if (e?.status === 409 || /already exists/i.test(msg)) {
        setError(marked ? msg : t('engine.packages.create.exists', locale));
      } else if (e?.status === 403 || /manage_metadata/i.test(msg)) {
        // objectstack#8270 — for an UNMARKED body this arm still answers
        // exactly as it did, and that is the whole of what objectstack-ai/objectstack#8270 measured. The
        // sentence it was ruled about, "Managing packages requires the
        // `manage_metadata` capability.", is the door's DIAGNOSTIC:
        // `sendError(res, 403, 'FORBIDDEN', …)` in `@objectstack/rest`
        // `package-routes.ts` passes no `extra`, so no `userMessage` rides with
        // it, so `marked` is false and the localized copy answers — byte for
        // byte as the 2026-08-13 maintainer ruling requires. A deployment that
        // withholds the capability does so deliberately, so this is a settled
        // posture to state in the user's language, not a transient failure to
        // retry. What changes is only the case objectstack-ai/objectstack#8270 never saw: a body a
        // producer deliberately marked for the end user.
        //
        // Probed the same way as the 409 arm above — the status when the
        // transport reports one, the message when it does not.
        setError(marked ? msg : t('engine.packages.noCapability', locale));
      } else {
        setError(msg || t(createMode ? 'engine.packages.create.failed' : 'engine.packages.edit.failed', locale));
      }
    } finally {
      setBusy(false);
    }
  }

  // What every spec-form instance below shares; create mode mounts several,
  // each with its own slice of the curated form.
  const formProps = {
    schema,
    value: draft,
    onChange: handleChange,
    issues,
    hiddenFields: createMode ? CREATE_HIDDEN_FIELDS : HIDDEN_FIELDS,
    readOnly,
    createMode,
  };

  // The hosted dependencies row, labelled from the spec form's own row; its
  // help line falls back to the spec's `.describe()` as the form's would.
  const dependenciesRow = findFormField(form, 'dependencies');
  const dependenciesEditor = dependenciesRow ? (
    <section className="rounded-md border border-border/40 bg-card/30 p-4">
      <PackageDependenciesEditor
        label={dependenciesRow.label ?? dependenciesRow.field}
        help={dependenciesRow.helpText ?? ManifestSchema.shape.dependencies.description}
        value={draft.dependencies}
        onChange={handleDependenciesChange}
        readOnly={readOnly}
        locale={locale}
      />
    </section>
  ) : null;

  const title =
    mode === 'create'
      ? t('engine.packages.create.title', locale)
      : mode === 'edit'
        ? t('engine.packages.edit.title', locale)
        : t('engine.packages.view.title', locale);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {mode === 'create' ? (
            <DialogDescription>
              {tFormat('engine.packages.create.description', locale, { example: 'com.acme.crm' })}
            </DialogDescription>
          ) : (
            <DialogDescription className="font-mono text-xs">
              {String(manifest?.id ?? draft.id ?? '')}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="py-1" data-testid="package-form">
          {createForms ? (
            <div className="space-y-4">
              <section
                className="space-y-4 rounded-md border border-border/40 bg-card/30 p-4"
                data-testid="package-form-basics"
              >
                <header>
                  <h3 className="text-sm font-semibold text-foreground/90">
                    {t('engine.packages.form.basics', locale)}
                  </h3>
                </header>
                <div className={FLUSH_SECTION}>
                  <SchemaForm {...formProps} form={createForms.name} />
                </div>
                <DerivedField
                  derived={!touched.id && !idNotDerived}
                  hint={t('engine.packages.idRule.derived', locale)}
                  testId="package-form-id"
                >
                  <Label htmlFor={idInputId} className="text-sm font-medium">
                    {t('engine.packages.create.id', locale)}
                    <span className="ml-0.5 text-destructive" aria-hidden="true">
                      *
                    </span>
                  </Label>
                  <PackageIdInput
                    id={idInputId}
                    value={String(draft.id ?? '')}
                    onChange={handleIdChange}
                    placeholder="com.acme.crm"
                    locale={locale}
                    inputClassName="h-10 px-3 py-2 text-base md:text-sm"
                    testId="package-form-id-input"
                  />
                  {idMissing && (
                    <p className="text-xs text-destructive" data-testid="package-form-id-missing">
                      {tFormat(
                        idNotDerived ? 'engine.packages.idRule.notDerived' : 'engine.packages.idRule.formatHint',
                        locale,
                        { example: 'com.acme.crm' },
                      )}
                    </p>
                  )}
                  {idHelp && <p className="text-xs text-muted-foreground">{idHelp}</p>}
                </DerivedField>
                <DerivedField
                  derived={!touched.namespace}
                  hint={t('engine.packages.nsRule.derived', locale)}
                  testId="package-form-namespace"
                >
                  <div className={FLUSH_SECTION}>
                    <SchemaForm {...formProps} form={createForms.namespace} />
                  </div>
                  {nsMissing && (
                    <p className="text-xs text-destructive" data-testid="package-form-namespace-missing">
                      {t('engine.packages.nsRule.required', locale)}
                    </p>
                  )}
                </DerivedField>
                <DerivedField
                  derived={!touched.version}
                  hint={t('engine.packages.versionRule.default', locale)}
                  testId="package-form-version"
                >
                  <div className={FLUSH_SECTION}>
                    <SchemaForm {...formProps} form={createForms.version} />
                  </div>
                </DerivedField>
                <div className={FLUSH_SECTION}>
                  <SchemaForm {...formProps} form={createForms.tail} />
                </div>
              </section>
              <SchemaForm {...formProps} form={createForms.rest} />
              {dependenciesEditor}
            </div>
          ) : (
            <div className="space-y-4">
              <SchemaForm {...formProps} form={form} />
              {dependenciesEditor}
            </div>
          )}
        </div>

        {error && (
          <div
            data-testid="package-form-error"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          {readOnly ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('engine.close', locale)}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                {t('engine.cancel', locale)}
              </Button>
              <Button onClick={submit} disabled={!canSubmit} data-testid="package-form-submit">
                {busy
                  ? t(createMode ? 'engine.packages.create.creating' : 'engine.packages.edit.saving', locale)
                  : t(createMode ? 'engine.packages.create.submit' : 'engine.packages.edit.save', locale)}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
