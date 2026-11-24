// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata list's 「新建」 for an object and a flow (objectstack#36897,
 * epic objectstack#36890): the create the Data and Automations pillars offer,
 * offered from the list, so the designers can give up their own.
 *
 *  - The item is created in the list's package, or — on a read-only base — in
 *    the base's paired `.custom` package, which the ensure door answers
 *    (`ensureCustomizationPackage`, ADR-0146 D3): its id, and for an object
 *    its namespace, come from that answer, never from a spelling here.
 *  - An object asks for its record sharing (the organization-wide default,
 *    `OWD_CREATE_MODELS`), and once live joins the menu of its package's one
 *    app (`addNewObjectToAppMenu`); not in a pair, whose package has no app.
 *  - A flow opens on the starting points (`flowPresets.ts`), with the Start
 *    node's whole trigger list under Advanced; it is born switched off.
 *
 * Both are written as a draft under the first-write pin and published at
 * once, as the pillars write them (`publishSavedItem`); a name already taken
 * is refused before anything is written (`findTakenIdentifier`).
 */

import * as React from 'react';
import { toast } from 'sonner';
import { customizationNamespace } from '@objectstack/spec/kernel';

import { CreateItemDialog } from '../studio-design/CreateItemDialog.js';
import { CreateTakenNotice, findTakenIdentifier } from '../studio-design/StudioPillarKit.js';
import { StudioPicker } from '../studio-design/StudioPicker.js';
import { OWD_CREATE_MODELS, OWD_DEFAULT, type OwdCreateModel } from '../studio-design/owd-sharing.js';
import { OWD_OPTION_DESC_KEY, OWD_OPTION_LABEL_KEY } from '../studio-design/DataPillarHelpers.js';
import { buildFlowSkeleton, buildObjectSkeleton } from '../studio-design/skeletons.js';
import { ensureCustomizationPackage, fetchPackages, prefixObjectName } from '../studio-design/packages-io.js';
import { publishSavedItem } from '../studio-design/studioSaveBar.js';
import { plainRefusal, type StudioRefusal } from '../studio-design/metadataError.js';
import { addNewObjectToAppMenu } from '../studio-design/newObjectJoinsAppMenu.js';
import { FLOW_PRESETS, flowPresetTrigger, type FlowPreset } from '../studio-design/flowPresets.js';
import { newFlowTriggerFields, withStartTrigger, type NewFlowTrigger } from '../studio-design/AutomationsFlowRail.js';
import { ObjectPicker } from './inspectors/ObjectPicker.js';
import { navItemLabelText } from './previews/navItemLabel.js';
import { useMetadataClient } from './useMetadata.js';
import { t, tFormat, type SupportedLocale } from './i18n.js';

/** The types whose list 「新建」 opens this dialog. */
export const LIST_CREATE_DIALOG_TYPES: readonly string[] = ['object', 'flow'];

export interface MetadataListCreateDialogProps {
  type: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The list's package. */
  packageId: string;
  /** The package is a read-only base: the item lands in its `.custom` pair. */
  inPair: boolean;
  locale: SupportedLocale;
  /** The item is live: where it was created. */
  onCreated: (created: { name: string; packageId: string }) => void;
}

type Taken = { name: string; label: string };

export function MetadataListCreateDialog(props: MetadataListCreateDialogProps): React.ReactElement | null {
  if (props.type === 'object') return <ObjectCreate {...props} />;
  if (props.type === 'flow') return <FlowCreate {...props} />;
  return null;
}

/**
 * Where the item is written: the pair the ensure door answers on a read-only
 * base, else the list's package — with its namespace read now when the
 * dialog's preview read has not answered yet, so a quick submit is not
 * written unprefixed.
 */
async function createTarget(packageId: string, inPair: boolean, namespace: string | null | undefined) {
  if (!inPair) {
    const ns = namespace !== undefined ? namespace : ((await fetchPackages()).find((p) => p.id === packageId)?.namespace ?? null);
    return { packageId, namespace: ns };
  }
  const pair = await ensureCustomizationPackage(packageId);
  return { packageId: pair.packageId, namespace: pair.namespace };
}

function ObjectCreate({ open, onOpenChange, packageId, inPair, locale, onCreated }: MetadataListCreateDialogProps) {
  const client = useMetadataClient();
  const [owd, setOwd] = React.useState<OwdCreateModel>(OWD_DEFAULT);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<StudioRefusal | null>(null);
  const [taken, setTaken] = React.useState<Taken | null>(null);
  // The package's object-name namespace (framework#2694): the dialog previews
  // the stored name; on a read-only base the pair's, by the spec's pairing
  // rule, while the save prefixes with the namespace the ensure door answers.
  // `undefined` while the read has not answered.
  const [namespace, setNamespace] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setOwd(OWD_DEFAULT);
    setError(null);
    setTaken(null);
    setNamespace(undefined);
    fetchPackages()
      .then((list) => {
        if (!cancelled) setNamespace(list.find((p) => p.id === packageId)?.namespace ?? null);
      })
      .catch(() => {
        // Best-effort preview: the save names the namespace it writes with.
      });
    return () => {
      cancelled = true;
    };
  }, [open, packageId]);
  const pairNamespace = customizationNamespace(namespace ?? null);
  const previewNamespace = inPair ? (pairNamespace.ok ? pairNamespace.value : null) : (namespace ?? null);

  const create = async (label: string, rawName: string) => {
    setBusy(true);
    setError(null);
    setTaken(null);
    try {
      const target = await createTarget(packageId, inPair, namespace);
      const name = prefixObjectName(rawName, target.namespace);
      const held = await findTakenIdentifier(client, 'object', name, locale);
      if (held) {
        setTaken(held);
        return;
      }
      const body = buildObjectSkeleton(name, label, t('engine.studio.data.nameFieldLabel', locale), owd);
      await client.save('object', name, body, { mode: 'draft', packageId: target.packageId, ifNoneMatch: '*', surface: 'studio' });
      const live = await publishSavedItem(client, { type: 'object', name, packageId: target.packageId }, false);
      if (!live.ok) {
        setError(plainRefusal(live.error));
        return;
      }
      toast.success(tFormat('engine.studio.save.done', locale, { items: label }));
      onCreated({ name, packageId: target.packageId });
      // objectstack#36748 — and it joins the menu of its package's one app; a
      // failure keeps the object and says the menu was left as it was.
      if (!inPair) {
        const join = await addNewObjectToAppMenu(
          client as unknown as Parameters<typeof addNewObjectToAppMenu>[0],
          { packageId: target.packageId, objectName: name },
          {
            notListed: t('engine.studio.data.appMenu.unreadable', locale),
            pendingDraft: t('engine.studio.data.appMenu.pendingDraft', locale),
            noVersion: t('engine.studio.data.appMenu.unreadable', locale),
            notWritable: t('engine.studio.data.appMenu.unreadable', locale),
          },
        );
        if (join.kind === 'failed') {
          const reason = plainRefusal(join.error).message;
          toast.warning(
            join.app
              ? tFormat('engine.studio.data.appMenu.failed', locale, {
                  object: label,
                  app: navItemLabelText(join.app.label, locale) || join.app.name,
                  reason,
                })
              : tFormat('engine.studio.data.appMenu.failedNoApp', locale, { object: label, reason }),
          );
        }
      }
    } catch (e) {
      setError(plainRefusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CreateItemDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('engine.studio.data.newObject', locale)}
      labelFieldLabel={t('engine.studio.data.nameLabel', locale)}
      labelPlaceholder={t('engine.studio.data.labelPlaceholder', locale)}
      idFieldLabel={t('engine.studio.data.idLabel', locale)}
      idPlaceholder={t('engine.studio.data.idPlaceholder', locale)}
      submitLabel={t('engine.studio.createLive', locale)}
      submittingLabel={t('engine.studio.creating', locale)}
      busy={busy}
      error={error?.message ?? null}
      locale={locale}
      storedName={(identifier) => prefixObjectName(identifier, previewNamespace)}
      extra={
        <>
          {taken && (
            <CreateTakenNotice
              scope="object"
              sentence={tFormat('engine.studio.data.createTakenElsewhere', locale, { label: taken.label, name: taken.name })}
            />
          )}
          {/* The object's record sharing (OWD): without it the object is
              refused at publish by `security-owd-unset`. The gloss is the
              Settings tab's own string for each model. */}
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted-foreground">{t('engine.studio.data.owdLabel', locale)}</span>
            <StudioPicker
              value={owd}
              options={OWD_CREATE_MODELS.map((m) => ({ value: m, label: t(OWD_OPTION_LABEL_KEY[m], locale) }))}
              onPick={(m) => setOwd(m as OwdCreateModel)}
              className="h-auto rounded px-2 py-1 text-[12px]"
              testId="create-object-owd"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">{t(OWD_OPTION_DESC_KEY[owd], locale)}</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">{t('engine.studio.data.owdHint', locale)}</span>
          </label>
        </>
      }
      onSubmit={({ label, name }) => void create(label, name)}
    />
  );
}

function FlowCreate({ open, onOpenChange, packageId, inPair, locale, onCreated }: MetadataListCreateDialogProps) {
  const client = useMetadataClient();
  const startTrigger = React.useMemo(() => newFlowTriggerFields(locale), [locale]);
  const watchesObject = startTrigger.object?.showWhen?.equals ?? [];
  const [choice, setChoice] = React.useState<FlowPreset | 'advanced'>(FLOW_PRESETS[0]);
  const [trigger, setTrigger] = React.useState('');
  const [triggerObject, setTriggerObject] = React.useState('');
  const [needs, setNeeds] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<StudioRefusal | null>(null);
  const [taken, setTaken] = React.useState<Taken | null>(null);
  const group = React.useId();
  React.useEffect(() => {
    if (!open) return;
    setChoice(FLOW_PRESETS[0]);
    setTrigger('');
    setTriggerObject('');
    setNeeds(null);
    setError(null);
    setTaken(null);
  }, [open]);

  const create = async (label: string, name: string, start: NewFlowTrigger | null) => {
    setBusy(true);
    setError(null);
    setTaken(null);
    try {
      const held = await findTakenIdentifier(client, 'flow', name, locale);
      if (held) {
        setTaken(held);
        return;
      }
      // Born switched off (`obsolete`, what the switch writes for Off):
      // enabling it is the author's own flip.
      const skeleton = withStartTrigger(
        {
          ...buildFlowSkeleton(name, label, t('engine.studio.auto.nodeStart', locale), t('engine.studio.auto.nodeEnd', locale)),
          status: 'obsolete',
        },
        start,
      );
      const target = await createTarget(packageId, inPair, null);
      await client.save('flow', name, skeleton, { mode: 'draft', packageId: target.packageId, ifNoneMatch: '*', surface: 'studio' });
      const live = await publishSavedItem(client, { type: 'flow', name, packageId: target.packageId }, false);
      if (!live.ok) {
        setError(plainRefusal(live.error));
        return;
      }
      toast.success(tFormat('engine.studio.auto.createdOff', locale, { name: label }));
      onCreated({ name, packageId: target.packageId });
    } catch (e) {
      setError(plainRefusal(e));
    } finally {
      setBusy(false);
    }
  };

  const objectPicker = (onCommit: (v: string) => void) =>
    startTrigger.object && (
      <ObjectPicker label={startTrigger.object.label} value={triggerObject} objectsOnly onCommit={onCommit} locale={locale} />
    );

  return (
    <CreateItemDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('engine.studio.auto.newTitle', locale)}
      labelFieldLabel={t('engine.studio.auto.nameLabel', locale)}
      labelPlaceholder={t('engine.studio.auto.namePlaceholder', locale)}
      idFieldLabel={t('engine.studio.auto.idLabel', locale)}
      idPlaceholder={t('engine.studio.auto.idPlaceholder', locale)}
      submitLabel={t('engine.studio.createLive', locale)}
      submittingLabel={t('engine.studio.creating', locale)}
      busy={busy}
      error={needs ?? error?.message ?? null}
      locale={locale}
      extra={
        <>
          {taken && (
            <CreateTakenNotice
              scope="flow"
              sentence={tFormat('engine.studio.auto.createTakenElsewhere', locale, { label: taken.label, name: taken.name })}
            />
          )}
          <fieldset className="space-y-2">
            <legend className="mb-1 block text-sm font-medium">{t('engine.studio.auto.presets', locale)}</legend>
            {FLOW_PRESETS.map((p) => (
              <div key={p.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={group}
                    value={p.id}
                    checked={choice === p}
                    data-testid={`create-flow-preset-${p.id}`}
                    onChange={() => {
                      setChoice(p);
                      setNeeds(null);
                    }}
                  />
                  {t(p.labelKey, locale)}
                </label>
                {choice === p && watchesObject.includes(p.triggerType) && (
                  <div className="ml-6 mt-1.5">
                    {objectPicker((v) => {
                      setTriggerObject(v);
                      setNeeds(null);
                    })}
                  </div>
                )}
              </div>
            ))}
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={group}
                  value="advanced"
                  checked={choice === 'advanced'}
                  data-testid="create-flow-advanced"
                  onChange={() => {
                    setChoice('advanced');
                    setNeeds(null);
                  }}
                />
                {t('engine.studio.rules.advanced', locale)}
              </label>
              {/* The Start node's own trigger field: the same choices and labels. */}
              {choice === 'advanced' && startTrigger.trigger && (
                <div className="ml-6 mt-1.5 space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium">{startTrigger.trigger.label}</span>
                    <StudioPicker
                      value={trigger}
                      options={[
                        { value: '', label: t('engine.studio.newAutoTrigger.later', locale) },
                        ...(startTrigger.trigger.options ?? []).map((o) => ({ value: o.value, label: o.label })),
                      ]}
                      onPick={setTrigger}
                      className="h-auto rounded px-2 py-1.5 text-sm"
                      testId="create-flow-trigger"
                    />
                  </label>
                  {trigger && watchesObject.includes(trigger) && objectPicker(setTriggerObject)}
                </div>
              )}
            </div>
          </fieldset>
        </>
      }
      onSubmit={({ label, name }) => {
        if (choice === 'advanced') {
          const object = watchesObject.includes(trigger) ? triggerObject.trim() : '';
          void create(label, name, trigger ? { triggerType: trigger, ...(object ? { objectName: object } : {}) } : null);
          return;
        }
        // A preset: its trigger, or nothing sent while it waits for its object.
        const start = flowPresetTrigger(choice, watchesObject, triggerObject);
        if (!start) {
          setNeeds(t('engine.studio.auto.preset.needsObject', locale));
          return;
        }
        void create(label, name, start);
      }}
    />
  );
}
