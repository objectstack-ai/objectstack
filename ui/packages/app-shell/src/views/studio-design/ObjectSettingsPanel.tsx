/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Data pillar — object Settings view (builder-ui Phase B).
 *
 * Two stacked cards:
 *  1. Basics — hosts the SAME default inspector metadata-admin uses
 *     (`getMetadataDefaultInspector('object')` → ObjectDefaultInspector):
 *     label / pluralLabel / icon / description, one implementation for both
 *     surfaces.
 *  2. Record sharing (ADR-0056) — the object-level Org-Wide Default (OWD)
 *     `sharingModel` (private | public_read | public_read_write |
 *     controlled_by_parent). This is the baseline record-level visibility the
 *     runtime applies BEFORE positions and sharing rules. Since ADR-0090 D1
 *     an unset value RESOLVES to `private` at runtime (secure default) — the
 *     old fully-public cliff is gone — but leaving it unset is NOT safe to
 *     ship: the publish door refuses an object that declares no OWD
 *     (`security-owd-unset`), because the baseline must be an authored
 *     decision rather than an accident. Runtime fallback and publishability
 *     are two different questions, and this comment used to answer only the
 *     first (`7a90afdf9`).
 *  3. Semantic roles (ADR-0085) — the cross-surface presentation roles:
 *     `nameField`, `stageField` (string | false | unset), `highlightFields`
 *     (an ordered list — `HighlightFieldsEditor`), and
 *     `relatedLists` (objectstack#27069), the business order of the record
 *     page's related lists, over the object's inbound relationships
 *     (`RelatedListsEditor`).
 *     These are the ONLY presentation knobs the protocol carries, so the
 *     builder must make them directly editable — otherwise designers fall
 *     back to guessing which heuristic picked their title/stage/columns.
 *  4. Capabilities (framework#2707/#2727) — the `enable.*` record-surface
 *     switches. Only LIVE flags are exposed (every toggle is enforced at
 *     runtime — writer gates, 403s, or UI surfaces): trackHistory & files
 *     are opt-IN (spec default false), feeds/activities/clone are opt-OUT
 *     (spec default true, explicit false disables). `trash`/`mru` were
 *     REMOVED from the spec (framework#2377 — ObjectCapabilities is now
 *     .strict(), authoring them is a parse error).
 */

import React from 'react';
import { Settings2, ShieldCheck, Sparkles, ToggleRight } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { useRegisteredMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry.js';
import { readFields, type FieldEntry } from '../metadata-admin/previews/object-fields-io.js';
import { t, type SupportedLocale } from '../metadata-admin/i18n.js';
import { cbpMasterRefusal, requireCbpMasterDetails } from './owd-sharing.js';
import { HighlightFieldsEditor } from './HighlightFieldsEditor.js';
import { RelatedListsEditor } from './RelatedListsEditor.js';

/** The item a stored value none of a picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — one of this panel's pickers (the sharing model, the name
 * field, the lifecycle field, and the highlight
 * fields' "add field"), drawn with the shared `Select`, the control the
 * validation rule editor's pickers (`RulePicker`) pick with. They used to be
 * browser-native `<select>`s. What a pick writes is unchanged: `onPick`
 * receives the picked option's own `value`, the string the native control's
 * `change` carried, and each caller turns it into the same patch as before.
 * Re-picking the current option writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value. Every picker here opens
 *   on an option whose value is `''` ("not set", "auto-derived",
 *   "auto-detect", "add field"), which `SelectItem` refuses; an index cannot
 *   collide with a field's name, as any stand-in string could.
 * - A stored value none of the options carries gets an item of its own,
 *   labelled with the value, so the trigger shows what the object holds. The
 *   native control showed its first option there ("not set", "auto-derived",
 *   "auto-detect"), which is not what the object says. Picking that item
 *   writes nothing.
 * - Read-only follows the primitive (objectui#11781): `disabled` disables the
 *   trigger, which wears `SelectTrigger`'s own disabled look.
 * - Each caller keeps the picker inside its `<label>`, which names the trigger
 *   as it named the native control. The "add field" picker had no label and
 *   still has none.
 */
function SettingsPicker({
  id,
  value,
  options,
  onPick,
  disabled,
  className,
  testId,
  ariaLabel,
}: {
  /** The trigger's id, for a `<label htmlFor>` that names it. */
  id?: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  disabled?: boolean;
  className: string;
  testId: string;
  /** The trigger's accessible name, when nothing around it gives one. */
  ariaLabel?: string;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the stored value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} data-testid={testId} className={className} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The classes a full-width picker takes, at the height the native control had. */
const PICKER_FULL = 'h-7 px-2 py-1 text-[12px]';

/** The classes the inline "add field" picker takes, sized to its label as the native control was. */
const PICKER_INLINE = 'h-6 w-auto gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground';

/**
 * The metadata key a setting writes, drawn as small print beside its title:
 * the developer's handle on the setting (what code and the API spell), kept
 * out of the title itself, which speaks the author's language. One click
 * selects the whole key for copying. It sits OUTSIDE the setting's `<label>`,
 * so selecting it never opens a picker or flips a switch, and the control's
 * accessible name stays the title alone.
 */
export function SettingKey({ name }: { name: string }) {
  return (
    <code
      data-testid={`setting-key-${name}`}
      className="select-all rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground"
    >
      {name}
    </code>
  );
}

/** A setting's title (its control's label when `htmlFor` is given) and its key. */
function SettingHeading({ title, settingKey, htmlFor }: { title: string; settingKey: string; htmlFor?: string }) {
  return (
    <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-[11px] text-muted-foreground">{title}</label>
      ) : (
        <span className="text-[11px] text-muted-foreground">{title}</span>
      )}
      <SettingKey name={settingKey} />
    </div>
  );
}

/** A field as a picker option: its label and name, or its name alone. */
function fieldOption(e: FieldEntry): { value: string; label: string } {
  return {
    value: e.name,
    label: typeof e.def.label === 'string' ? `${e.def.label} (${e.name})` : e.name,
  };
}

export function ObjectSettingsPanel({
  name,
  draft,
  onPatch,
  disabled,
  locale,
  onBlockingIssuesChange,
}: {
  name: string;
  draft: Record<string, unknown>;
  onPatch: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  locale: SupportedLocale;
  /**
   * Forward the object inspector's blocking author-time issue count to the Data
   * pillar, which owns the Save this panel writes through (objectui#4527).
   *
   * INERT TODAY, and deliberately so: `ObjectDefaultInspector` mounts no CEL
   * editor, so nothing downstream ever calls this. It is wired anyway to keep
   * the panel-host family uniform — the next CEL editor added to the object
   * inspector is gated by construction rather than by remembering to come back
   * here. Only the forwarding is covered by test; there is no verdict to
   * produce.
   */
  onBlockingIssuesChange?: (count: number) => void;
}) {
  // Observed (objectui#11939): an object inspector registered after this panel
  // mounted replaces the "not registered" note below without a remount.
  const DefaultInspector = useRegisteredMetadataDefaultInspector('object');
  const idBase = React.useId();
  const controlId = (key: string) => `${idBase}-${key}`;

  const fields = React.useMemo(() => readFields(draft.fields).entries, [draft.fields]);
  const selectFields = fields.filter((e) => (e.def.type ?? 'text') === 'select');

  const nameField = typeof draft.nameField === 'string' ? draft.nameField : '';
  const stageField = draft.stageField as string | false | undefined;
  const highlightFields = Array.isArray(draft.highlightFields)
    ? (draft.highlightFields as unknown[]).filter((f): f is string => typeof f === 'string')
    : [];

  const highlightCandidates = fields.filter(
    (e) => e.def.hidden !== true && !highlightFields.includes(e.name),
  );

  // Record sharing (OWD). Canonical values only — spec 13 (ADR-0090 D4)
  // rejects the legacy `read`/`read_write`/`full` aliases at authoring time,
  // and an unset value defaults to `private` (ADR-0090 D1).
  const sharingModel = typeof draft.sharingModel === 'string' ? draft.sharingModel : '';
  const sharingDescKey =
    sharingModel === 'private'
      ? 'engine.studio.settings.sharingDescPrivate'
      : sharingModel === 'public_read'
        ? 'engine.studio.settings.sharingDescPublicRead'
        : sharingModel === 'public_read_write'
          ? 'engine.studio.settings.sharingDescPublicReadWrite'
          : sharingModel === 'controlled_by_parent'
            ? 'engine.studio.settings.sharingDescControlledByParent'
            : 'engine.studio.settings.sharingDescUnset';
  const owdOptions = [
    { value: '', label: t('engine.studio.settings.sharingUnset', locale) },
    { value: 'private', label: t('engine.studio.settings.sharingPrivate', locale) },
    { value: 'public_read', label: t('engine.studio.settings.sharingPublicRead', locale) },
    { value: 'public_read_write', label: t('engine.studio.settings.sharingPublicReadWrite', locale) },
    { value: 'controlled_by_parent', label: t('engine.studio.settings.sharingControlledByParent', locale) },
  ];
  // objectui#12326 — choosing `controlled_by_parent` sets `required: true` on
  // each `master_detail` field that writes no `required`, in the same patch:
  // the save door would read the omission as an optional master. An explicit
  // `required: false` is an optional master the author chose (ADR-0055 §1 as
  // amended, objectstack#30905 ruling A) and is kept. The fields are written
  // only when that changes them.
  const pickSharingModel = (v: string) => {
    if (!v) {
      onPatch({ sharingModel: undefined });
      return;
    }
    if (v !== 'controlled_by_parent') {
      onPatch({ sharingModel: v });
      return;
    }
    const fieldsNext = requireCbpMasterDetails(draft.fields);
    onPatch(fieldsNext === draft.fields ? { sharingModel: v } : { sharingModel: v, fields: fieldsNext });
  };
  // The spec's own refusal when the object still does not derive exactly one
  // master: no `master_detail` at all, or two or more (the designer never picks
  // one of them for the author).
  const objectName = draft.name ?? name;
  const cbpRefusal = React.useMemo(
    () => (sharingModel === 'controlled_by_parent' ? cbpMasterRefusal(objectName, draft.fields) : undefined),
    [sharingModel, objectName, draft.fields],
  );

  // Capabilities (`enable.*`, framework#2707/#2727). Checked = the flag's
  // EFFECTIVE runtime value; toggling writes an explicit boolean into the
  // enable block (preserving sibling keys). trackHistory/files are opt-in
  // (=== true enables); searchable/feeds/activities/clone are opt-out (only
  // an explicit false disables).
  const enable = (draft.enable && typeof draft.enable === 'object' ? draft.enable : {}) as Record<string, unknown>;
  const patchEnable = (key: string, value: boolean) => onPatch({ enable: { ...enable, [key]: value } });
  const CAPABILITIES: Array<{ key: string; optIn: boolean; labelKey: string; descKey: string }> = [
    { key: 'trackHistory', optIn: true,  labelKey: 'engine.studio.settings.capTrackHistory', descKey: 'engine.studio.settings.capTrackHistoryDesc' },
    { key: 'files',        optIn: true,  labelKey: 'engine.studio.settings.capFiles',        descKey: 'engine.studio.settings.capFilesDesc' },
    { key: 'feeds',        optIn: false, labelKey: 'engine.studio.settings.capFeeds',        descKey: 'engine.studio.settings.capFeedsDesc' },
    { key: 'activities',   optIn: false, labelKey: 'engine.studio.settings.capActivities',   descKey: 'engine.studio.settings.capActivitiesDesc' },
    { key: 'searchable',   optIn: false, labelKey: 'engine.studio.settings.capSearchable',   descKey: 'engine.studio.settings.capSearchableDesc' },
    { key: 'clone',        optIn: false, labelKey: 'engine.studio.settings.capClone',        descKey: 'engine.studio.settings.capCloneDesc' },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <section className="rounded-lg border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <Settings2 className="h-3.5 w-3.5" />
          <span className="text-[13px] font-medium">{t('engine.studio.settings.basics', locale)}</span>
        </header>
        <div className="max-w-xl p-3">
          {DefaultInspector ? (
            // eslint-disable-next-line react-hooks/static-components -- useRegisteredMetadataDefaultInspector returns a registered component (stable), not one created during render
            <DefaultInspector
              type="object"
              name={name}
              draft={draft}
              onPatch={onPatch}
              readOnly={!!disabled}
              locale={locale}
              onBlockingIssuesChange={onBlockingIssuesChange}
            />
          ) : (
            <p className="text-[12px] text-muted-foreground">{t('engine.studio.settings.noInspector', locale)}</p>
          )}
        </div>
      </section>

      <section className="rounded-lg border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="text-[13px] font-medium">{t('engine.studio.settings.sharing', locale)}</span>
          <span className="text-[11px] text-muted-foreground">
            {t('engine.studio.settings.sharingHint', locale)}
          </span>
        </header>
        <div className="grid max-w-xl gap-2 p-3">
          <div>
            <SettingHeading
              title={t('engine.studio.settings.sharingModel', locale)}
              settingKey="sharingModel"
              htmlFor={controlId('sharingModel')}
            />
            <SettingsPicker
              id={controlId('sharingModel')}
              testId="owd-internal-select"
              value={sharingModel}
              disabled={disabled}
              onPick={pickSharingModel}
              className={PICKER_FULL}
              options={owdOptions}
            />
          </div>
          {/* An UNSET internal OWD is not a neutral state — the publish door
              refuses it (`security-owd-unset`). Styled as the problem it is:
              "this authoring choice will be rejected at publish" — reading it
              as neutral is what let the unset case pass for a safe default. */}
          <p
            data-testid="owd-internal-desc"
            className={
              sharingModel === ''
                ? 'text-[11px] text-amber-600 dark:text-amber-500'
                : 'text-[11px] text-muted-foreground'
            }
          >
            {t(sharingDescKey, locale)}
          </p>
          {cbpRefusal && (
            <p data-testid="owd-cbp-refusal" role="alert" className="text-[11px] text-destructive">
              {cbpRefusal}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-lg border">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="text-[13px] font-medium">{t('engine.studio.settings.semanticRoles', locale)}</span>
          <span className="text-[11px] text-muted-foreground">
            {t('engine.studio.settings.semanticHint', locale)}
          </span>
        </header>
        <div className="grid max-w-xl gap-4 p-3">
          {/* nameField */}
          <div>
            <SettingHeading
              title={t('engine.studio.settings.nameField', locale)}
              settingKey="nameField"
              htmlFor={controlId('nameField')}
            />
            <SettingsPicker
              id={controlId('nameField')}
              testId="name-field-select"
              value={nameField}
              disabled={disabled}
              onPick={(v) => onPatch(v ? { nameField: v } : { nameField: undefined })}
              className={PICKER_FULL}
              options={[
                { value: '', label: t('engine.studio.settings.autoDerive', locale) },
                ...fields.map(fieldOption),
              ]}
            />
          </div>

          {/* stageField */}
          <div>
            <SettingHeading
              title={t('engine.studio.settings.stageField', locale)}
              settingKey="stageField"
              htmlFor={controlId('stageField')}
            />
            <SettingsPicker
              id={controlId('stageField')}
              testId="stage-field-select"
              value={stageField === false ? '__none__' : (stageField ?? '')}
              disabled={disabled}
              onPick={(v) => onPatch({ stageField: v === '__none__' ? false : v === '' ? undefined : v })}
              className={PICKER_FULL}
              options={[
                { value: '', label: t('engine.studio.settings.autoDetect', locale) },
                { value: '__none__', label: t('engine.studio.settings.stageNone', locale) },
                ...selectFields.map(fieldOption),
              ]}
            />
          </div>

          {/* highlightFields */}
          <div>
            <SettingHeading title={t('engine.studio.settings.highlightFields', locale)} settingKey="highlightFields" />
            <HighlightFieldsEditor
              value={highlightFields}
              fields={fields}
              onChange={(next) => onPatch({ highlightFields: next })}
              disabled={disabled}
              locale={locale}
              renderAdd={() => highlightCandidates.length > 0 && (
                <SettingsPicker
                  testId="highlight-add-select"
                  value=""
                  onPick={(v) => {
                    if (!v) return;
                    onPatch({ highlightFields: [...highlightFields, v] });
                  }}
                  className={PICKER_INLINE}
                  options={[
                    { value: '', label: t('engine.studio.settings.addFieldOption', locale) },
                    ...highlightCandidates.map(fieldOption),
                  ]}
                />
              )}
            />
          </div>

          {/* relatedLists (objectstack#27069) */}
          <div>
            <SettingHeading title={t('engine.studio.settings.relatedLists', locale)} settingKey="relatedLists" />
            <RelatedListsEditor
              name={name}
              draft={draft}
              onChange={(next) => onPatch({ relatedLists: next })}
              disabled={disabled}
              locale={locale}
              renderAdd={(options, add) => (
                <SettingsPicker
                  testId="related-lists-add-select"
                  ariaLabel={t('engine.studio.settings.relatedListsAdd', locale)}
                  value=""
                  onPick={(v) => {
                    if (v) add(v);
                  }}
                  className={PICKER_INLINE}
                  options={[
                    { value: '', label: t('engine.studio.settings.relatedListsAdd', locale) },
                    ...options,
                  ]}
                />
              )}
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border" data-testid="capabilities-section">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <ToggleRight className="h-3.5 w-3.5" />
          <span className="text-[13px] font-medium">{t('engine.studio.settings.capabilities', locale)}</span>
          <span className="text-[11px] text-muted-foreground">
            {t('engine.studio.settings.capabilitiesHint', locale)}
          </span>
        </header>
        <div className="grid max-w-xl gap-3 p-3">
          {CAPABILITIES.map(({ key, optIn, labelKey, descKey }) => {
            const raw = enable[key];
            const checked = optIn ? raw === true : raw !== false;
            // The title and the description both label the switch; the key
            // between them does not (see `SettingKey`).
            const id = controlId(`enable.${key}`);
            return (
              <div key={key} className="flex items-start gap-2">
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  data-testid={`cap-${key}`}
                  onChange={(e) => patchEnable(key, e.target.checked)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <label htmlFor={id} className="text-[12px]">{t(labelKey, locale)}</label>
                    <SettingKey name={`enable.${key}`} />
                  </span>
                  <label htmlFor={id} className="block text-[11px] text-muted-foreground">{t(descKey, locale)}</label>
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
