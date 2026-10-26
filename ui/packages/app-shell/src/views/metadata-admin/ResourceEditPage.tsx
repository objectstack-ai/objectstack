// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataResourceEditPage — generic AutoForm-driven editor (Phase 3c).
 *
 * What it does:
 *   1. Fetches the layered view (`GET /meta/:type/:name/layers`) so the user
 *      sees code vs overlay vs effective.
 *   2. Renders a SchemaForm against the JSONSchema in the type's
 *      `/meta/types` registry row.
 *   3. Save → PUT, with automatic destructive-change handling: a 409
 *      `destructive_change` response opens a confirmation dialog
 *      listing the issues, and on confirm we retry with `?force=true`.
 *   4. Reset overlay → DELETE (overlay only).
 *   5. References tab → calls `client.references()` and lists
 *      back-pointers so admins know what will break before deleting.
 *
 * Works for any of the 27 metadata types — bespoke editors (Object,
 * Field, View, Permission Matrix) opt out by registering a custom
 * EditPage via `registerMetadataResource()`.
 */

import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useNavSelDeepLink } from './useNavSelDeepLink.js';
import {
  Save,
  RotateCcw,
  Trash2,
  History,
  Link2,
  Loader2,
  AlertTriangle,
  Layers3,
  GitCompareArrows,
  Boxes,
  Eye,
  Pencil,
  X,
  PanelRightClose,
  PanelRightOpen,
  Maximize2,
  Minimize2,
  MousePointer2,
  SlidersHorizontal,
  FileCode2,
  Zap,
  ZapOff,
  Send,
  Undo2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@object-ui/components';
import { Badge } from '@object-ui/components';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@object-ui/components';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@object-ui/components';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@object-ui/components';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@object-ui/components';
import { Empty, EmptyTitle, EmptyDescription } from '@object-ui/components';
import type {
  MetadataLayered,
  MetadataLockState,
  MetadataReference,
} from '@object-ui/data-objectstack';
// The ONE draft-envelope reader (objectui#8181). Its docblock carries the
// read-decoration contract objectui#7603 established here; it was hoisted so
// the three sibling copies could stop re-deriving it.
import { extractDraftBody } from '@object-ui/data-objectstack';
import { PageShell } from './PageShell.js';
import { MetadataTypeActions } from './MetadataTypeActions.js';
import { LayeredDiff, countOverlaidFields } from './LayeredDiff.js';
import { DraftReviewPanel, computeDraftChangeCount } from './DraftReviewPanel.js';
import {
  SchemaForm,
  DRAWER_METADATA_ID_SCOPE,
  type SchemaFormIssue,
} from './SchemaForm.js';
import {
  collectPageComponentIds,
  formDeclaresWidget,
  type ObjectActionOption,
  type ObjectFieldOption,
  type RegistryItemOption,
  type WidgetContext,
} from './widgets.js';
import {
  conditionScopeForMetadataType,
  conditionRootsForMetadataType,
  conditionSubjectsForMetadataType,
} from './conditionScope.js';
import { mapLoaded, usePickerLoad } from './loadState.js';
import {
  useMetadataClient,
  useMetadataTypes,
  type RichMetadataTypeEntry,
} from './useMetadata.js';
// objectui#11773 — the draft save's optimistic-concurrency guard and its dialog.
import { readDraftForSave, useDraftSaveGuard } from './DraftConflictDialog.js';
import {
  getMetadataResource,
  resolveResourceConfig,
  listAnchorsFor,
} from './registry.js';
import { useCreateDerive, deriveDefaultCreateFields } from './createDerive.js';
import { RelatedPanel, type RelatedTarget } from './RelatedPanel.js';
import { MetadataDetailDrawer } from './MetadataDetailDrawer.js';
import { HistoryPanel } from './ResourceHistoryPage.js';
import { AuditPanel } from './AuditPanel.js';
import {
  getMetadataPreview,
  useRegisteredMetadataPreview,
  type MetadataSelection,
} from './preview-registry.js';
import { readFields } from './previews/object-fields-io.js';
import { useRegisterAssistantEditor, type AssistantEditorContext } from '../../assistant/assistantBus.js';
import { useRegisteredMetadataInspector } from './inspector-registry.js';
import { useRegisteredMetadataDefaultInspector } from './default-inspector-registry.js';
import { useMetadataLocale, t, tFormat, translateMetadataType, translateValidationMessage } from './i18n.js';
import { JsonSourceEditor } from './JsonSourceEditor.js';
import { validateMetadataDraft, hasClientValidator, type DraftMode } from './clientValidation.js';
import { describeIssuePath, issueSlicePath, issueSliceFingerprint } from './issuePath.js';
import { buildCreateModeBody, seedStructuralDefaults, unsetSeedPlaceholders } from './createBody.js';
import { errorCodeIs, errorCodeIsAnyOf } from '@object-ui/types';
import { useCanAuthorMetadata, useCanReadAuthoringTrail } from '../../hooks/useCanAuthorMetadata.js';
import { environmentScopeSuffix, isEnvironmentScope, useWalledCatalogReadOnly } from './catalog-scope.js';
import { PositionHoldersSection } from './PositionHoldersSection.js';
import { declarationOnlyAuthoredObject } from './sharing-rule-catalog.js';
import { useRegisterUnsavedEdits } from '../../chrome/unsavedEdits.js';
import { RefusalMessage } from '../../components/RefusalMessage.js';

/**
 * objectui#7611 — the Setup half of an item, rendered under its definition in
 * the ENVIRONMENT scope (`catalog-scope.ts`): who holds it. Keyed by type and
 * internal to this page; the permission set's half lives in its own editor,
 * `PermissionMatrixEditPage`, which renders `AssignedUsersSection`.
 */
const ENVIRONMENT_SECTIONS: Readonly<Record<string, React.ComponentType<{ name: string }>>> = {
  position: PositionHoldersSection,
};

/**
 * ADR-0010 §3.6 lock state -> the lock banner's headline sentence.
 *
 * Keyed on `MetadataLockState` — which derives from `packages/spec`'s own
 * `z.enum` — so a fifth state added upstream fails `type-check` HERE, naming
 * the label that is missing. That is the strictness the audit panel's
 * `LOCK_STATE_ZH` has had since objectui#5004 and this banner did not: its
 * title used to be three independent `&&` branches with no `else`.
 *
 * `Exclude<…, 'none'>` because `none` never banners — `isLocked` gates the
 * whole box on `lock && lock !== 'none'`. Typing the record over exactly the
 * states that CAN reach the screen keeps the two rules from drifting apart,
 * and still fails on a state added to the union.
 */
const LOCK_BANNER_TITLE_KEY: Record<Exclude<MetadataLockState, 'none'>, string> = {
  'no-overlay': 'engine.edit.lockNoOverlay',
  'no-delete': 'engine.edit.lockNoDelete',
  full: 'engine.edit.lockFull',
};

/**
 * The banner's headline for whatever `lock` ACTUALLY arrived — including a
 * value the lookup above has never heard of (objectui#5024).
 *
 * The compile-time half cannot be the whole fix. `MetadataLockState` types what
 * this repo may WRITE; it constrains nothing about what a server may SEND,
 * because `MetadataClient.layered()` casts the wire value in unchecked:
 *
 *   ...(body.lock !== undefined ? { lock: body.lock as MetadataLayered['lock'] } : {}),
 *
 * over a raw `res.json()` body — no parse, no allowlist, no default. So a
 * back end that grows a fifth state reaches this banner with no code change
 * here at all. Measured rather than assumed: feeding `no-publish` through this
 * page opened the amber box, drew the padlock and the border, and left the
 * title `<div>` empty. An exhaustive `satisfies` alone would have type-checked
 * green over that exact render.
 *
 * Hence a sentence for the unrecognised value, carrying the raw token: the
 * operator who meets this is the only person able to report which state their
 * server actually sent, and a generic "this is locked" would take that away.
 * `String(lock)` rather than a cast — the same unchecked path can hand us a
 * number or an object, and this must not throw on the way to explaining itself.
 */
function lockBannerTitle(
  lock: MetadataLayered['lock'],
  locale: string | undefined,
): string {
  if (
    typeof lock === 'string' &&
    Object.prototype.hasOwnProperty.call(LOCK_BANNER_TITLE_KEY, lock)
  ) {
    return t(LOCK_BANNER_TITLE_KEY[lock as Exclude<MetadataLockState, 'none'>], locale);
  }
  return tFormat('engine.edit.lockUnknown', locale, { state: String(lock) });
}

/**
 * Metadata types whose canvas IS the primary create-time authoring
 * surface, so we render the preview/inspector split during create
 * instead of the centered basic-info form. Object-level basics stay
 * editable via the no-selection default inspector. Other types keep
 * the conventional "name it first, design after save" create flow.
 */
const CREATE_MODE_CANVAS_TYPES = new Set<string>(['object', 'report', 'dataset', 'doc']);

/**
 * Top-level metadata keys that a type's canvas PreviewComponent owns and
 * edits visually (e.g. the object designer owns `fields` + `fieldGroups`).
 * These must never surface in the inspector's fallback SchemaForm — the
 * no-selection panel would otherwise render a raw JSON editor for data
 * the user is already editing on the canvas.
 */
const CANVAS_OWNED_KEYS: Record<string, string[]> = {
  object: ['fields', 'fieldGroups'],
  // The doc editor (`previews/DocPreview`, objectui#10188): the Markdown body,
  // its per-locale variants and the book-section placement are written there.
  doc: ['content', 'translations', 'group'],
};


/**
 * The software-package binding this editor is authoring under, read from the
 * ONE place the save->publish loop states it: `?package=` on the editor URL.
 *
 * ## Why this is a function and not two inline reads
 *
 * Both steps of the loop send this value — `doSave` binds the draft row to the
 * package (`PUT ?package=`), and since objectstack `9e04c3e35`, `doPublish` states the
 * same package on the promotion (`POST .../publish?package=`) so objectstack-ai/objectstack#9612's
 * package-closure narrowing at the runtime publish gate is reachable from an
 * HTTP-driven promotion at all. One value, one spelling, both steps — which
 * means one derivation too. A second inline copy in the publish path would be
 * free to drift from the save path (most easily on the `'all'` fold below),
 * and the two calls would then disagree about which package the edit belongs
 * to while both looking correct in isolation.
 *
 * ## The `'all'` fold
 *
 * `?package=all` is the metadata list's "show everything" scope, NOT a package
 * literally named `all`; the framework's normaliser folds `all` and the empty
 * value together to mean "env-local overlay, no package". Folded here to
 * `undefined` so both callers OMIT the parameter rather than sending it empty.
 * The two are the same to that normaliser today, so this is not a behaviour
 * difference against the current server — omit-when-unbound is simply the
 * shape this door already had, and the loop's two calls must not disagree.
 *
 * Read at call time rather than per render because the editor URL's package
 * scope can move under the component (`setSearchParams`), and the value that
 * must be stated is the one in force when the request is issued.
 *
 * Deliberately NOT `ownerPackageId` (the router-read `?package=` used to scope
 * layered/draft READS): that one does not fold `'all'`, so reusing it here
 * would send `package=all` as if it were a package id.
 */
function readActivePackageBinding(): string | undefined {
  try {
    const p = new URLSearchParams(window.location.search).get('package');
    return p && p !== 'all' ? p : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a layered answer this page already read holds no layer at all: no
 * packaged baseline, no customisation row, no effective value. That is what
 * `MetadataClient.layered()` resolves for the server's 404, an item that has
 * never been saved (objectui#11799). `null` (nothing read yet) is not that
 * answer.
 *
 * A draft-mode save or a draft discard makes no layer, so after either one
 * such an item still has none, and asking `/layers` again only logs the same
 * 404.
 */
function holdsNoLayer(layered: MetadataLayered<unknown> | null): boolean {
  return !!layered && layered.code == null && layered.overlay == null && layered.effective == null;
}

/**
 * Decide whether the validation-diagnostics banner should render at all.
 *
 * The gate has two reasons to stay hidden:
 *   - `loadFailed` — the layered/draft fetch itself failed, so the form is
 *     sitting on empty defaults. Any required-field issues the client
 *     validator produces are an artefact of the empty form, not a verdict on
 *     the item; the explicit "failed to load" banner already tells the real
 *     story. Suppress so a transport failure never masquerades as a broken
 *     item.
 *   - no diagnostics source — there is neither a server `_diagnostics`
 *     payload nor a client-side validator for this type, so there is nothing
 *     to show.
 */
export function shouldRenderDiagnostics(opts: {
  loadFailed: boolean;
  hasDiag: boolean;
  hasClientValidator: boolean;
}): boolean {
  if (opts.loadFailed) return false;
  return opts.hasDiag || opts.hasClientValidator;
}

/**
 * The `view-ref` picker's catalog: the views bound to `objectName`, as
 * `{ name, label }`, first occurrence of each name kept.
 *
 * A row's binding is read under `object` alone (objectui#11013, ruling 甲 on
 * objectstack#20051). The spec declares `object` on every `view` member, and
 * declares neither `objectName` nor `object_name`, which this filter used to
 * read first and last. Extracted so the reading is assertable without opening
 * the picker (Radix portals its options on open).
 */
export function viewRefCatalog(
  rows: ReadonlyArray<Record<string, unknown>> | null | undefined,
  objectName: string,
): Array<{ name: string; label?: string }> {
  const seen = new Set<string>();
  return (rows || [])
    .filter((v) => v?.object === objectName)
    .map((v) => ({ name: v?.name as string, label: (v?.label as string) || undefined }))
    .filter((v) => !!v.name && !seen.has(v.name) && seen.add(v.name));
}

export interface MetadataResourceEditPageProps {
  type?: string;
  name?: string;
  /** When true, this is the Create flow (skip initial fetch). */
  createMode?: boolean;
  /**
   * When true, the editor is rendered inside another surface (e.g.
   * the Related drawer). Hides Related-tab and URL-sync so the inner
   * page does not fight the outer page for `?tab` / `?open`.
   */
  embedded?: boolean;
}

export function MetadataResourceEditPage({
  type: typeProp,
  name: nameProp,
  createMode = false,
  embedded = false,
}: MetadataResourceEditPageProps) {
  // Tiny dispatcher: a registered Custom EditPage / CreatePage is a
  // different component type than MetadataResourceEditPageImpl, so React
  // will unmount/remount when the registry-driven branch wins or loses
  // (e.g. navigating from `/object/new` → `/object/sales_order`). Doing
  // the dispatch INSIDE the impl below would leak hooks between
  // branches and trigger "Rendered more hooks than during the previous
  // render". We therefore keep this outer dispatcher hook-free apart
  // from `useParams`, which is unconditional.
  const params = useParams<{ type?: string; name?: string }>();
  const type = typeProp ?? params.type ?? '';
  const name = nameProp ?? params.name ?? '';

  const customConfig = getMetadataResource(type);
  if (customConfig?.EditPage && !createMode) {
    const Custom = customConfig.EditPage;
    return <Custom type={type} name={name} />;
  }
  if (customConfig?.CreatePage && createMode) {
    const Custom = customConfig.CreatePage;
    return <Custom type={type} />;
  }

  return (
    <MetadataResourceEditPageImpl
      type={type}
      name={name}
      createMode={createMode}
      embedded={embedded}
    />
  );
}

/**
 * References panel data — one discriminated union, not a `refs` / `refsLoading`
 * pair (objectui#5110).
 *
 * The pair could only spell two of the three facts this panel has to tell
 * apart. `refs == null` was already overloaded as "still loading", so a failed
 * `client.references()` call had nowhere to go: the catch wrote `setRefs([])`,
 * which is byte-identical to a *successful* scan that found nothing — and the
 * panel renders that state as "Nothing in the metadata graph points at this
 * item. Safe to delete." A refused request, a dropped connection, an expired
 * session and a `501 NOT_IMPLEMENTED` were therefore all shown to the operator
 * as an affirmative, measured all-clear, with a `console.error` nobody reads as
 * the only trace. The operator is on this panel precisely because they are
 * about to delete something.
 *
 * `status` makes the third fact representable, and makes the wrong combination
 * unrepresentable: no value of this type is both `error` and `loaded`, so no
 * render path can read a failure as a measurement. The `error` arm carries the
 * cause and asserts NOTHING about deletion safety — the honest answer when the
 * question was never answered — and the panel offers a retry so the operator
 * can ask it again.
 *
 * `idle` is deliberately distinct from `loading`: the sheet is lazy, and
 * "never asked" is what re-enables a retry after a failure (see
 * `loadReferences`'s re-entry guard).
 *
 * ADR-0110 D3 — a miss and a fault are different facts.
 */
type ReferencesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; items: MetadataReference[] }
  | { status: 'error'; message: string };

/** The two catalogs the single `client.get('object', …)` call yields. */
type ObjectCatalog = {
  fields: ObjectFieldOption[];
  actions: ObjectActionOption[];
};

/**
 * A refusal the SERVER returned for this document, held against the draft
 * slices its issue paths named (`9073cf018`).
 *
 * Not `issues`: that state is overwritten wholesale by the debounced live Zod
 * pass 200ms after any edit, so a server verdict parked there is gone by the
 * author's next keystroke — which is part of why the wedge this closes was
 * silent. This record survives edits until the named slice actually moves.
 */
interface SaveRefusal {
  /**
   * The slices that were LOCALISABLE at refusal time. ⛔ May be empty, and an
   * empty list gates nothing: a refusal we cannot tie to any part of the
   * document must fail open rather than block a Save the author has no
   * described way to unblock.
   */
  held: Array<{ slicePath: string; fingerprint: string; label: string }>;
  /** What the server said, kept for the Save button's explanation. */
  summary: string;
}

interface MetadataResourceEditPageImplProps {
  type: string;
  name: string;
  createMode: boolean;
  embedded: boolean;
}

function MetadataResourceEditPageImpl({
  type,
  name,
  createMode,
  embedded,
}: MetadataResourceEditPageImplProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // ADR-0048 — the owning package of the item being edited, carried on the
  // edit URL as `?package=` (emitted by the metadata list links). Scopes the
  // layered/draft read so a same-name collision resolves to the right
  // package's item. NOT the active Studio app's package — Studio edits items
  // across all installed packages.
  const ownerPackageId = searchParams.get('package') ?? undefined;
  const client = useMetadataClient();
  const { entries, loading: typesLoading } = useMetadataTypes(client);
  const entry: RichMetadataTypeEntry | undefined = entries.find((t) => t.type === type);
  const config = resolveResourceConfig(type, entry);
  // Hoist `schema` to the top: it's a pure derivation of entry/config
  // and several create-mode hooks below need it. Keeping it down here
  // would put those hooks *after* the loading early-return, which
  // breaks the rules of hooks when navigating new→edit (a different
  // number of hooks runs across renders of the same instance).
  const schema =
    (createMode && config.createSchema
      ? config.createSchema
      : (entry?.schema as Record<string, unknown> | undefined)) ??
    (config.defaultSchema as Record<string, unknown> | undefined);
  const locale = useMetadataLocale();
  // objectui#11939 — the designer registries, read so that this page re-renders
  // when a preview or inspector for `type` is registered after its first render
  // (a designer that arrives in a lazily loaded chunk). Hooks, so they are read
  // here, above the auto-design effect that depends on the preview and above
  // the `loading` early return; the read sites below use these values. The two
  // reads inside `doSave` / `doReset` stay plain `getMetadataPreview` calls:
  // they run in an event handler and read the registry as it is at that moment.
  const registeredPreview = useRegisteredMetadataPreview(type);
  const registeredInspector = useRegisteredMetadataInspector(type);
  const registeredDefaultInspector = useRegisteredMetadataDefaultInspector(type);
  // Which DOOR this page is (objectstack#5316): a create draft is authored here
  // and judged by the strict authoring schema; an edit draft is a body that came
  // back out of storage. Hoisted to one name because it now also decides whether
  // a client validator exists at all — some schemas are author-shape-only and
  // gate `create` only (objectui#3561, `AUTHOR_SHAPE_ONLY_TYPES`).
  const draftMode: DraftMode = createMode ? 'create' : 'edit';

  const [layered, setLayered] = React.useState<MetadataLayered<any> | null>(null);
  const identityField = config.identityField ?? 'name';
  const [draft, setDraft] = React.useState<Record<string, unknown>>(() =>
    createMode ? { ...(config.createDefaults ?? {}), [identityField]: '' } : {},
  );
  const [refsState, setRefsState] = React.useState<ReferencesState>({ status: 'idle' });
  const [loading, setLoading] = React.useState(!createMode);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Distinguishes "the layered/draft fetch itself failed" (network/500/
  // timeout) from "we loaded an item that fails validation". Without it a
  // failed load renders the form with empty defaults and the client
  // validator fires spurious "name/label/regions required" diagnostics,
  // making a transport failure look like a structurally broken item. Set
  // in the load catch block, reset at the start of each load.
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [issues, setIssues] = React.useState<SchemaFormIssue[]>([]);
  // In create mode, hold back validation noise until the author has actually
  // edited a field. A blank new-item form firing 3 red "required" errors before
  // the user types anything reads as broken, not helpful (the save path still
  // validates). Flips true on the first real edit.
  const [createDirty, setCreateDirty] = React.useState(false);

  // Wrap setDraft so that editing a field clears any *server-side*
  // diagnostic issues whose path begins with that field. The user
  // gets immediate visual feedback — the red ring disappears as
  // they type — and the form re-validates on save. We diff at the
  // top-level segment, which matches how Zod's `issue.path[0]`
  // identifies the offending field.
  const handleDraftChange = React.useCallback(
    (next: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => {
      setDraft((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        const changed = new Set<string>();
        const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(resolved ?? {})]);
        for (const k of keys) {
          if (!Object.is(prev?.[k], resolved?.[k])) changed.add(k);
        }
        if (changed.size > 0) {
          setCreateDirty(true);
          setIssues((prevIssues) =>
            prevIssues.filter((i) => {
              const head = (i.path ?? '').split('.')[0];
              return !changed.has(head);
            }),
          );
        }
        return resolved;
      });
    },
    [],
  );
  // objectui#12866 — a create draft carries the spec create seed's STRUCTURAL
  // defaults (a dataset's `count` measure), so the designer shows before the
  // first save what the save writes. The seed rides the `/meta/types` entry,
  // which `useMetadataTypes` reads AFTER the first render, so the draft is
  // built without it and the defaults are folded in once, when it arrives.
  // Only keys the draft does not hold yet are added: anything the author (or
  // `createDefaults`, which `buildCreateModeBody` lets the draft win over)
  // already set is left alone, and an absent key is exactly the one the save
  // fills from the seed. The seed's placeholder identity stays out, as it
  // stays out of the save body (`seedStructuralDefaults`, objectui#12810). A
  // type with `createBuildBody` builds its own body and is not seeded.
  const specCreateSeedForDraft = (entry as { createSeed?: Record<string, unknown> } | undefined)?.createSeed;
  const draftSeededRef = React.useRef(false);
  React.useEffect(() => {
    if (!createMode || draftSeededRef.current || config.createBuildBody || !specCreateSeedForDraft) return;
    draftSeededRef.current = true;
    const defaults = seedStructuralDefaults(specCreateSeedForDraft);
    setDraft((prev) => {
      const missing = Object.keys(defaults).filter((key) => !(key in prev));
      if (missing.length === 0) return prev;
      const next = { ...prev };
      // A copy: the designer must never hold (and patch) the registry entry's own arrays.
      for (const key of missing) next[key] = structuredClone(defaults[key]);
      return next;
    });
  }, [createMode, config.createBuildBody, specCreateSeedForDraft]);
  const [destructiveIssues, setDestructiveIssues] = React.useState<
    null | Array<{ kind?: string; path?: string; message?: string }>
  >(null);
  const [pendingItem, setPendingItem] = React.useState<unknown>(null);

  // ── Create-mode form harness ──────────────────────────────────────
  //
  // Apply the registry's `createDerive` rules live (label→name slug,
  // singular→plural, etc.). The hook is a no-op when not in create
  // mode or when no rules are declared, so we always mount it.
  const onCreatePatch = React.useCallback(
    (patch: Partial<Record<string, unknown>>) => {
      handleDraftChange((d) => ({ ...(d as Record<string, unknown>), ...patch }));
    },
    [handleDraftChange],
  );
  const { markTouched: markCreateFieldTouched } = useCreateDerive({
    rules: config.createDerive,
    draft,
    onPatch: onCreatePatch,
    enabled: !!createMode,
  });

  // Effective hidden-fields for create mode: collapse the form to just
  // the identity inputs declared by the type (or required-fields ∪
  // label/name as a sensible default). Edit mode keeps the full form.
  //
  // The complement-set is what SchemaForm consumes (it hides paths
  // listed in `hiddenFields`), so we invert the allowlist here.
  const createFieldList = React.useMemo(() => {
    if (!createMode) return undefined;
    if (config.createFields && config.createFields.length > 0) return config.createFields;
    const props = (schema?.properties as Record<string, unknown> | undefined) ?? undefined;
    const required = (schema?.required as readonly string[] | undefined) ?? undefined;
    return deriveDefaultCreateFields(props, required);
  }, [createMode, config.createFields, schema]);

  const effectiveHiddenFields = React.useMemo<string[] | undefined>(() => {
    // Keys edited on the canvas (fields, fieldGroups) are never shown in
    // the inspector's SchemaForm fallback — otherwise deselecting reveals
    // a raw JSON editor for data the canvas already owns.
    const canvasOwned = CANVAS_OWNED_KEYS[type] ?? [];
    if (!createMode || !createFieldList) {
      if (canvasOwned.length === 0) return config.hiddenFields;
      return Array.from(new Set([...(config.hiddenFields ?? []), ...canvasOwned]));
    }
    const props = (schema?.properties as Record<string, unknown> | undefined) ?? {};
    const allow = new Set(createFieldList);
    const hidden = Object.keys(props).filter((k) => !allow.has(k));
    // Preserve any registry-declared `hiddenFields` too — they remain
    // hidden in create mode even if they appeared in `createFields`.
    if (config.hiddenFields) {
      for (const k of config.hiddenFields) if (!hidden.includes(k)) hidden.push(k);
    }
    // Canvas-owned keys are hidden regardless of the create allowlist.
    for (const k of canvasOwned) if (!hidden.includes(k)) hidden.push(k);
    return hidden;
  }, [createMode, createFieldList, schema, config.hiddenFields, type]);

  const effectiveFieldOrder = React.useMemo<string[] | undefined>(() => {
    if (createMode && createFieldList) return createFieldList;
    return config.fieldOrder;
  }, [createMode, createFieldList, config.fieldOrder]);

  // Mark a top-level field as user-touched so create-mode derivations
  // (label→name slug, etc.) leave it alone going forward. Wraps the
  // standard onChange so the rest of the form is unaffected.
  //
  // objectui#12680 — every surface on which the author edits the draft's
  // top-level keys writes through this: the generic SchemaForm, the curated
  // default inspector (a designer's home panel, where the object, report and
  // dataset Name / Label fields live) and the Source tab's JSON editor. When
  // only SchemaForm did, a Name typed in the object designer was never marked,
  // so the label→name rule replaced it on the next Label keystroke, and a name
  // written in the Source tab was re-derived from the label beside it. The
  // touched set lives in this page, so it outlives the inspector panel, which
  // the Properties / Source tabs remount.
  const handleCreateAwareChange = React.useCallback(
    (next: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => {
      if (createMode) {
        const before = draft;
        const resolved = typeof next === 'function' ? next(before) : next;
        const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(resolved ?? {})]);
        for (const k of keys) {
          if (!Object.is(before?.[k], resolved?.[k])) markCreateFieldTouched(k);
        }
      }
      handleDraftChange(next);
    },
    [createMode, draft, handleDraftChange, markCreateFieldTouched],
  );
  // Live client-side Zod validation. Debounced 200ms so we don't run
  // on every keystroke through a complex AutoForm tree. When a client
  // schema exists for `type` (spec 7.x exports per-type schemas under
  // /data, /ui, /automation, /ai, /system, /kernel), we replace the
  // `issues` state with Zod's output — same schemas the server runs,
  // so behavior matches the post-save diagnostics but appears live.
  // Types without a client schema keep the existing server-only flow.
  React.useEffect(() => {
    if (!hasClientValidator(type, draftMode)) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      // Pass the live server schema so the client never flags fields the
      // running server now treats as optional (cross-repo spec-skew root-cure).
      //
      // `mode` picks the gate (objectstack#5316): a create draft is AUTHORED
      // here and judged by the strict authoring schema, while an edit draft is
      // a body that came back out of storage and is judged by the same wire
      // schema the server runs. Judging a stored body by the authoring schema
      // made this editor reject bodies the server accepts — e.g. a view that
      // had been pinned or reordered carries `isPinned` / `sortOrder`.
      //
      // objectui#10202 — in edit mode the pass judges the body the save SENDS,
      // `fromDraft(draft)`, the same serialiser `doSave` applies before
      // `client.save`. A key that serialiser drops is not the author's to fix:
      // an object's served picklist options (the door refuses them beside
      // `picklist`) used to surface here as "`picklist` and `options` cannot
      // both be declared" on a draft whose save sends neither pair. Read from
      // the registry by `type`, so no memoised identity keys this effect.
      const fromDraft = createMode ? undefined : getMetadataResource(type)?.fromDraft;
      let judged: Record<string, unknown> = draft;
      if (fromDraft) {
        try {
          judged = fromDraft(draft);
        } catch {
          judged = draft;
        }
      }
      void validateMetadataDraft(
        type,
        judged,
        entry?.schema as { required?: unknown } | undefined,
        { mode: draftMode },
      ).then((res) => {
        if (cancelled) return;
        setIssues(res.issues);
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [type, draft, entry?.schema, draftMode, createMode]);
  // Issues to DISPLAY (banner + inline). Suppressed on a pristine create form
  // so a blank new item doesn't open covered in required-field errors.
  const displayIssues = React.useMemo(
    () => (createMode && !createDirty ? [] : issues),
    [createMode, createDirty, issues],
  );
  // Server-computed diagnostics handed to a canvas Preview (e.g. the flow
  // Problems panel + on-canvas badges). Errors prefer the live client-side Zod
  // issues when a client validator exists (so they track every keystroke);
  // warnings stay server-sourced. Mirrors the read-only banner's source
  // selection, flattened to a path-keyed, severity-tagged list.
  const previewDiagnostics = React.useMemo<
    Array<{ path?: string; message: string; severity: 'error' | 'warning' }>
  >(() => {
    const diag = (layered as any)?._diagnostics as
      | { errors?: Array<{ path: string; message: string }>; warnings?: Array<{ path: string; message: string }> }
      | undefined;
    const errs = hasClientValidator(type, draftMode)
      ? displayIssues.map((i) => ({ path: i.path, message: translateValidationMessage(i.message, locale) }))
      : (diag?.errors ?? []).map((i) => ({ path: i.path, message: translateValidationMessage(i.message, locale) }));
    const warns = (diag?.warnings ?? []).map((i) => ({
      path: i.path,
      message: translateValidationMessage(i.message, locale),
    }));
    return [
      ...errs.map((e) => ({ path: e.path || undefined, message: e.message, severity: 'error' as const })),
      ...warns.map((w) => ({ path: w.path || undefined, message: w.message, severity: 'warning' as const })),
    ];
  }, [layered, displayIssues, type, locale, draftMode]);
  // Per-item draft pending publish (mode=draft saves land here).
  // When non-null, the editor is "viewing the draft" and we surface
  // Publish / Discard-draft actions.
  const [hasDraft, setHasDraft] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  // Bumped by destructive operations (rollback / discard-draft) to
  // force the load effect to refetch layered + draft state.
  const [reloadKey, setReloadKey] = React.useState(0);
  // objectui#11773 — the pin of the row the editor's draft was built on (the
  // load's draft read, then each save's receipt), sent by every draft save of
  // an existing item. A conflict's "reload" re-runs the load effect, the same
  // way a discard does.
  const reloadFromServer = React.useCallback(() => setReloadKey((k) => k + 1), []);
  const {
    save: saveDraftVersioned,
    recordRead: recordDraftRead,
    forget: forgetDraftVersion,
    dialog: draftConflictDialog,
  } = useDraftSaveGuard(client, reloadFromServer);

  // Form edit mode. The form is read-only by default — admins land in a
  // "view" state and must click Edit to mutate, mirroring the Salesforce /
  // Notion convention. createMode is always editing (you can't view what
  // doesn't exist yet). Truly read-only types (no allowEnvironmentOverlay) stay
  // read-only regardless.
  const [editing, setEditing] = React.useState<boolean>(!!createMode);
  // Currently selected sub-element (e.g. a dashboard widget). The
  // preview emits this; the inspector consumes it. Must live above
  // any early returns to preserve hook order — reset on item
  // navigation or when leaving edit mode below.
  const [selection, setSelection] = React.useState<MetadataSelection | null>(null);
  React.useEffect(() => {
    setSelection(null);
  }, [type, name]);
  // ── Why the live client Zod `issues` are NOT a term in this gate ──
  //
  // Two author-time error sources reach this page and only one of them gates
  // Save. The asymmetry is intended; it is recorded here because its absence
  // read as a defect from outside (objectui#6980). The discriminator is
  // whether the SERVER is a backstop for the class:
  //
  //  - Inspector issues (a CEL predicate that does not parse) have none.
  //    objectui#4306 measured a dangling-operator formula saving 200 with a
  //    success toast and publishing as the live field definition, and the
  //    runtime authoring gate reports its findings only as ADVISORY on an
  //    already-SUCCESSFUL save (#4133). The client is the only gate, so it
  //    must block.
  //  - Schema issues DO have one. `saveMetaItem` runs the same contract, and
  //    `doSave` below already maps its refusal (422 / INVALID_METADATA /
  //    INVALID_PAYLOAD) back into these same inline issues. A schema-invalid
  //    draft cannot land, so the live Zod pass is a PREVIEW of the server's
  //    verdict rather than the thing standing between the draft and storage.
  //
  // That leaves only the failure the client can cause by itself: being
  // STRICTER than the server. objectui bundles `@objectstack/spec` on a caret
  // range while the server ships its own copy, so the two skew — and skew in
  // that direction is not hypothetical: objectstack#5316 (stored views
  // carrying the platform's own `isPinned` / `sortOrder`), the `report`
  // `objectName`/`columns` drift pinned by `clientValidation.skew.test.tsx`,
  // and the flow node-type shim are three landed instances. (That third shim
  // has since been retired — the published `FlowNodeSchema.type` is an open
  // string on spec 17.2.0, so the enum mismatch it suppressed can no longer be
  // produced; objectui#6982. The skew CLASS it was an instance of is what this
  // paragraph is about, and that has not gone away.)
  //
  // `clientValidation.ts`'s root-cure covers exactly ONE class of that skew: a
  // TOP-LEVEL required field, absent from the draft, that the live server
  // marks optional (`path.length === 1`). It cannot cover the rest. Measured
  // on the bundled spec 17.2.0, 14 of the 15 wired schemas reject an
  // undeclared key, and `unrecognized_keys` arrives at `path.length` 0 (root)
  // or 2 (e.g. `nodes.0`) — which that filter passes straight through. So a
  // server that gains one authorable key would, under a blocking gate,
  // dead-bolt Save for every author using it, on a draft the server accepts,
  // with no on-screen editor able to take the key back out. That is the same
  // wedge every gate in this family is built to avoid — see the stamp on
  // `blockingReport` below, and its siblings in `ObjectFieldInspector`,
  // `ConditionBuilder` and `ConditionalFormattingEditor`.
  //
  // So schema issues are surfaced loudly — banner, inline field errors,
  // `previewDiagnostics` — and left advisory; the server has the last word.
  // Pinned by `ResourceEditPage.schemaAdvisory.test.tsx`.
  //
  // ⭐ THE BOUNDARY, stated so a later reader can apply it (`9073cf018`).
  // "Advisory" is about a verdict this client PREDICTS, and it is the whole of
  // what is advisory. It has never covered a verdict the server RETURNED:
  //
  //   server-REFUSED  →  BLOCKS   (`saveRefusal` / `refusalBlocking` below)
  //   server-ACCEPTED →  advisory (this paragraph, unchanged)
  //
  // The two cannot overlap, and that is a property of the mechanism rather
  // than a promise: only a 422 arms the blocking half, and a draft the server
  // accepts does not produce one. So the dead-bolt this paragraph exists to
  // prevent — Save wedged shut on a draft the server would have taken — stays
  // unreachable. What ended with `9073cf018` is only the client's habit of
  // re-sending a document the server had ALREADY refused, on every later edit,
  // while reporting nothing. ⛔ Do not read the blocking half as licence to
  // gate Save on the live Zod pass: that is the skew case, and it is still
  // advisory. Both halves are pinned in `ResourceEditPage.schemaAdvisory.test.tsx`.
  // Blocking author-time issues reported by the scoped inspector (e.g. a CEL
  // formula that does not parse) — Save must refuse them rather than publish a
  // malformed definition (objectui#4306).
  //
  // The count is STAMPED with the selection it describes, so it expires by
  // construction when the selection changes or the inspector unmounts: a
  // component that has gone away cannot retract its last verdict, and a host
  // that waited for one would wedge Save shut.
  const [blockingReport, setBlockingReport] = React.useState({ key: '', count: 0 });
  // Covers BOTH inspector branches. With no selection the editor renders the
  // registered DEFAULT inspector instead, and that surface hosts CEL too (a
  // hook's guard, an action's predicates, a view's formatting rules) — so it
  // gets its own stamp rather than sharing the scoped one (objectui#4527).
  // Distinct keys are what stop one branch's verdict from gating the other.
  const selectionKey = selection
    ? `${type}:${name}:${selection.kind}:${selection.id}`
    : `${type}:${name}:default`;
  const inspectorBlocking = blockingReport.key === selectionKey ? blockingReport.count : 0;

  // ── The SERVER's refusal is not advisory — and it is DOCUMENT-scoped ──
  //
  // Everything above is about a verdict the CLIENT predicts, and the ruling
  // there stands untouched: a live Zod issue stays advisory. This is the other
  // kind of verdict — one the SERVER returned, on the wire, about THIS exact
  // document. `doSave`'s 422 branch records it here.
  //
  // ⭐ Why this does not narrow the advisory ruling above. That ruling is
  // conditioned, in its own words, on the server ACCEPTING the draft: the wedge
  // it exists to prevent is a dead-bolt "on a draft the server accepts, with no
  // on-screen editor able to take the key back out". A refusal cannot be armed
  // by a draft the server accepts — there is no 422 to arm it with. So the skew
  // this page fears (client stricter than server) structurally cannot reach
  // this term: it holds only what the server has ALREADY refused, and so
  // refuses only what is already refused one layer down. Nothing is predicted
  // here; the discriminator is observed. Both halves are pinned by
  // `ResourceEditPage.schemaAdvisory.test.tsx`.
  //
  // ⭐ Why it is DOCUMENT-scoped where `inspectorBlocking` is SELECTION-scoped.
  // The measured wedge (`9073cf018`) is an author who adds a Lookup field
  // with an empty target, then selects an unrelated already-saved field and
  // renames it. `inspectorBlocking` above expires when the selection changes —
  // BY DESIGN, and that design is right for what it gates — so it is already
  // gone by that second step, and every later auto-save PUTs the half-filled
  // document again and is refused again, while the designer renders the rename
  // as applied and the server has none of it. ⛔ The fix is NOT to widen that
  // stamp: a selection-scoped term cannot carry a document-scoped invariant.
  // This term has no selection in it at all, which is exactly why it survives.
  const [saveRefusal, setSaveRefusal] = React.useState<SaveRefusal | null>(null);
  // The wire body the server's issue paths address. `fromDraft` is the same
  // serialiser `doSave` applies before `client.save`, so arming and gating read
  // the same shape by construction rather than by coincidence.
  const refusalProbeBody = React.useCallback(
    (d: Record<string, unknown>): Record<string, unknown> => {
      try {
        return config.fromDraft ? config.fromDraft(d) : d;
      } catch {
        return d;
      }
    },
    [config],
  );
  // Outstanding while ANY slice the refusal named is still byte-identical to
  // what the server refused. Editing the offending field — or deleting it —
  // changes that slice and releases the block; editing an UNRELATED field does
  // not, which is the whole point. A refusal that localised nothing
  // (`held: []`) is deliberately open: see `issueSliceFingerprint`.
  const refusalBlocking = React.useMemo(() => {
    if (!saveRefusal) return 0;
    const body = refusalProbeBody(draft);
    return saveRefusal.held.filter(
      (h) => issueSliceFingerprint(body, h.slicePath) === h.fingerprint,
    ).length;
  }, [saveRefusal, draft, refusalProbeBody]);
  // One item's refusal must never follow the author to the next item. Declared
  // here rather than beside the sibling `setSelection(null)` effect above only
  // because the state it clears is declared here.
  React.useEffect(() => {
    setSaveRefusal(null);
  }, [type, name]);
  React.useEffect(() => {
    if (!editing) setSelection(null);
  }, [editing]);

  // Snapshot of the last saved draft. Used by Cancel to revert in-flight
  // edits, and as the source-of-truth when entering edit mode.
  const draftSnapshotRef = React.useRef<Record<string, unknown> | null>(null);

  // Last successful save timestamp — surfaced as "Saved HH:MM" indicator
  // next to the icon-only Save button.
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);

  // Auto-save toggle, persisted per-browser. Defaults to on for an
  // "it just works" experience; users can disable it from the toolbar.
  const [autoSaveEnabled, setAutoSaveEnabled] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const v = window.localStorage.getItem('metadata-admin:autosave');
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  });
  React.useEffect(() => {
    try {
      window.localStorage.setItem('metadata-admin:autosave', autoSaveEnabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [autoSaveEnabled]);
  // Tracks the last draft snapshot we attempted to auto-save, so a
  // validation failure does not loop on the same payload — auto-save
  // only retries once the user mutates the draft again.
  const lastAutoSaveSnapshotRef = React.useRef<string | null>(null);

  // Prefetch object name list once — fuels the `ref:object` widget.
  // We don't block render on it; the widget shows a "Loading…" state.
  //
  // objectui#5170: this used to be `objectNames: string[]` + `objectsLoading:
  // boolean`, and the catch wrote `setObjectNames([])` — the exact value a
  // successful list of zero objects writes — then flipped loading to false, with
  // no error state, no banner and not even a `console.error`. The picker
  // rendered as a completed, empty list and told the operator "object_name (no
  // objects detected)". See {@link usePickerLoad}.
  const objectsState = usePickerLoad<string[]>(
    React.useCallback(async () => {
      const list = (await client.list('object')) as Array<{ name?: string }>;
      return list.map((x) => x?.name).filter((n): n is string => !!n).sort();
    }, [client]),
  );
  // Field catalog of the draft's bound/source object — fuels field-picker
  // widgets (e.g. the interface-page filter-mode selector). For a page the
  // source is `interfaceConfig.source` (interface mode) or the bound
  // `object`; other types fall back to their own `object`/`objectName`.
  const sourceObjectName: string | undefined =
    ((draft as any)?.interfaceConfig?.source as string | undefined) ||
    ((draft as any)?.data?.object as string | undefined) ||
    ((draft as any)?.object as string | undefined) ||
    ((draft as any)?.objectName as string | undefined);
  // The field catalog and the action catalog come from ONE `client.get('object',
  // …)` call, so they succeed together and fail together — one `LoadState` for
  // the pair, not two that could disagree (objectui#5170).
  const objectCatalogState = usePickerLoad<ObjectCatalog>(
    React.useMemo(
      () =>
        sourceObjectName
          ? async () => {
              const obj = (await client.get('object', sourceObjectName)) as { fields?: Record<string, any> | Array<any> } | null;
              const raw = obj?.fields;
              const list = Array.isArray(raw)
                ? raw.map((f: any) => ({ name: f?.name, label: f?.label, type: f?.type }))
                : raw && typeof raw === 'object'
                  ? Object.entries(raw).map(([name, f]: [string, any]) => ({ name, label: f?.label, type: f?.type }))
                  : [];
              const rawActions = (obj as any)?.actions;
              const acts = Array.isArray(rawActions)
                ? rawActions.map((a: any) => ({ name: a?.name, label: a?.label, locations: a?.locations })).filter((a: any) => !!a.name)
                : [];
              return { fields: list.filter((f) => !!f.name), actions: acts };
            }
          : null,
      [client, sourceObjectName],
    ),
  );

  // View catalog of the source object — fuels the `view-ref` picker for
  // `interfaceConfig.sourceView` so the author chooses an existing view
  // instead of typing (and mistyping) a name. Views are standalone metadata
  // keyed to their object via `object` ({@link viewRefCatalog}); the LIST
  // endpoint returns name + label, which is all the picker needs.
  const objectViewsState = usePickerLoad<Array<{ name: string; label?: string }>>(
    React.useMemo(
      () =>
        sourceObjectName
          ? async () =>
              viewRefCatalog(
                (await client.list('view')) as Array<Record<string, any>>,
                sourceObjectName,
              )
          : null,
      [client, sourceObjectName],
    ),
  );

  // The permission-set catalog — fuels the `ref-multi:permission` picker
  // (objectui#12126), which the position form's `permissionSets` row declares
  // (ADR-0131 D4: a reference to a declared item is by machine name, resolved
  // registry-first). Loaded only when the form on screen declares that widget,
  // so no other editor sends the request. The list is the whole registry, not
  // one package's: a position names permission sets from the environment
  // catalog, platform-shipped sets included (ADR-0131 D3).
  const declaresPermissionSets = formDeclaresWidget(
    createMode && config.createSchema ? undefined : entry?.form,
    'ref-multi:permission',
  );
  const permissionSetsState = usePickerLoad<RegistryItemOption[]>(
    React.useMemo(
      () =>
        declaresPermissionSets
          ? async () => {
              const rows = (await client.list('permission')) as Array<{ name?: string; label?: string }>;
              return rows
                .filter((r): r is { name: string; label?: string } => typeof r?.name === 'string' && !!r.name)
                .map((r) => ({ name: r.name, label: r.label }))
                .sort((a, b) => a.name.localeCompare(b.name));
            }
          : null,
      [client, declaresPermissionSets],
    ),
  );

  // Component ids placed on the page being edited — fuels the `ref:component`
  // picker so a page variable's `source` (the component that writes it) is
  // chosen from the real canvas components, not a free-text id. Derived from
  // the live draft so newly-added components appear immediately; a no-op empty
  // list for non-page types (they carry no `regions`).
  const componentIds = React.useMemo(
    () => (type === 'page' ? collectPageComponentIds(draft) : []),
    [type, draft],
  );

  // Each loader's `LoadState` reaches the pickers WHOLE (objectui#5228).
  //
  // This used to project each one down into a pair — the catalog array plus a
  // `*Loading` flag — with the failure arm sent alongside on a separate
  // `catalogErrors` record. That projection is what let a failed load arrive as
  // `[]`, byte-identical to a load that completed and found nothing, with the
  // rule that a picker must consult the side channel first living in a doc
  // comment. Handing the union over intact deletes both the projection and the
  // rule: a consumer cannot reach the list without the compiler having seen it
  // decide what a failure renders as.
  //
  // `objectFields` and `objectActions` are DERIVED FROM ONE STATE rather than
  // loaded twice, because they come from one `client.get('object', …)` request:
  // they succeed together and fail together, and `mapLoaded` is what makes that
  // true by construction instead of by two independent states happening to
  // agree.
  const widgetContext = React.useMemo<WidgetContext>(
    () => ({
      // objectui#8167 — this page is the generic editor for EVERY metadata
      // type, so it is the one host that cannot state a single verdict: it
      // derives one per type from the ruled table. Hard-coding a value here
      // would put one tier's scope in front of every other tier's authors,
      // which is the shape the ruling refused by name.
      conditionScope: conditionScopeForMetadataType(type),
      // objectui#9953 — the scope above and this vocabulary answer two
      // DIFFERENT questions, and this page is where both have to be answered
      // per type: `action`, `hook` and `validation` all rule `record`, but only
      // the first is evaluated where `user` is bound. Deriving it here is the
      // same move as the line above, applied to the fact that line cannot
      // carry.
      conditionSubjects: conditionSubjectsForMetadataType(type),
      // objectui#9856 — the same move once more, on the question the two lines
      // above cannot answer between them: what the raw editor's autocomplete
      // may OFFER. The builder's own default narrows a record-scoped mount to
      // what every host binds, so the `action` tier — evaluated in the browser
      // — is the one that has to declare that it binds more. Derived per type
      // here for the reason the scope is: this page edits every metadata type.
      conditionRoots: conditionRootsForMetadataType(type),
      objectNames: objectsState,
      objectFields: mapLoaded(objectCatalogState, (catalog) => catalog.fields),
      objectActions: mapLoaded(objectCatalogState, (catalog) => catalog.actions),
      objectViews: objectViewsState,
      componentIds,
      permissionSets: permissionSetsState,
    }),
    [type, objectsState, objectCatalogState, objectViewsState, componentIds, permissionSetsState],
  );

  // Load layered view + initial draft.
  React.useEffect(() => {
    if (createMode) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    (async () => {
      try {
        const scope = ownerPackageId ? { packageId: ownerPackageId } : {};
        // objectui#11773 — the draft is read at the address `doSave` writes
        // (`readActivePackageBinding`, the folded `?package=`), so the version
        // it serves is the one that save compares against.
        const draftPackage = readActivePackageBinding();
        const [lay, draftRead] = await Promise.all([
          client.layered<any>(type, name, scope),
          // Draft reads are best-effort — a 404/error must not block
          // the page; readers without overlay-write permission still
          // see the published item.
          readDraftForSave<any>(client, type, name, draftPackage),
        ]);
        if (cancelled) return;
        const draftResp = draftRead.answer;
        setLayered(lay);
        // Surface server-computed load-time validation errors as inline
        // SchemaForm issues — operators see what's wrong with the
        // saved metadata immediately, not just on the next Save round-trip.
        const loadDiag = (lay as any)?._diagnostics as
          | { valid: boolean; errors?: Array<{ path: string; message: string }> }
          | undefined;
        if (loadDiag && loadDiag.valid === false && Array.isArray(loadDiag.errors)) {
          setIssues(
            loadDiag.errors.map((e) => ({
              path: e.path || '',
              message: e.message,
            })),
          );
        } else {
          setIssues([]);
        }
        // Draft envelope from the framework is `{ type, name, item }`;
        // an empty/missing item means "no pending draft".
        const draftReal = extractDraftBody(draftResp);
        // Prefer the pending draft as the editing baseline — the
        // operator is mid-flight on this item and should see their
        // own in-progress state, not the last published version.
        // A served draft is the WHOLE document (objectui#10765): the server
        // stores a `?mode=draft` body raw and its `?state=draft` read returns
        // that row raw, and every writer of a draft sends a full document —
        // so `type` and every other inherited field are already inside it.
        // ⛔ Never spread the draft over `effective`: a spread cannot express
        // deletion, so a key the author cleared came back from the PUBLISHED
        // layer on every reload and the next save sent it again. The
        // baseline is only for an item that has no pending draft at all.
        const baseline = (lay.effective ?? lay.code ?? {}) as Record<string, unknown>;
        const rawInitial: Record<string, unknown> = draftReal ?? baseline;
        // Normalise the wire shape into the editor's draft shape (e.g.
        // `view` unwraps an expanded ViewItem's `config` into a
        // `{ list | form }` family key). No-op for types without a hook.
        const initial = config.toDraft ? config.toDraft(rawInitial) : rawInitial;
        setDraft(initial);
        draftSnapshotRef.current = initial;
        // objectui#11773 — the next save is pinned to what the draft read
        // served: its version, or "no draft row" when none was pending.
        recordDraftRead(type, name, draftPackage, draftRead.pin);
        setHasDraft(!!draftReal);
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          // A failed fetch is a LOAD error, not a validation error: flag it
          // so the diagnostics banner suppresses the spurious required-field
          // issues the empty-default form would otherwise produce, and make
          // the top error banner explicit about what actually went wrong.
          setLoadFailed(true);
          setError(
            tFormat('engine.edit.loadFailed', locale, {
              type,
              name: name ?? '',
              message: err?.message ?? String(err),
            }),
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, type, name, ownerPackageId, createMode, reloadKey, locale, recordDraftRead]);

  // Lazy-load references the first time the References sheet opens.
  //
  // Re-entry guard: a request already in flight is not duplicated, and a
  // completed scan is not re-run when the sheet is reopened. `idle` and
  // `error` both fall through — which is what makes the panel's Retry work
  // without a second code path: it calls this same loader (objectui#5110).
  async function loadReferences() {
    if (refsState.status === 'loading' || refsState.status === 'loaded') return;
    setRefsState({ status: 'loading' });
    try {
      const r = await client.references(type, name);
      setRefsState({ status: 'loaded', items: r });
    } catch (err: any) {
      // NOT `{ status: 'loaded', items: [] }`: an unanswered question is not
      // an answer of "nothing". The panel renders this arm as a failed check
      // with a retry and says nothing about whether deleting is safe.
      setRefsState({ status: 'error', message: String(err?.message ?? err) });
    }
  }

  // Related drawer state. `null` = closed. We avoid querystring round-
  // trips on every keystroke; URL state is best-effort sync via effect
  // below.
  const [relatedTarget, setRelatedTarget] = React.useState<RelatedTarget | null>(null);

  const hasAnchors = React.useMemo(
    () => !createMode && !embedded && listAnchorsFor(type).length > 0,
    [type, createMode, embedded],
  );

  // objectui#12475 — History and Audit read the authoring-trail doors, which
  // objectstack#23546 narrowed to `studio.access` / `manage_metadata`: a
  // `setup.access`-only caller is offered neither entry, and neither sheet is
  // mounted for that caller. Unknown fails open.
  const canReadTrail = useCanReadAuthoringTrail();

  // objectui#12496 — the open sheet is SEEDED from the `?tab=` deep link the
  // URL-sync effect below writes, so a shared or refreshed link reopens it.
  // It is read here, in the state's initializer, and not in a mount effect:
  // the sync effect's mount pass ran first with no sheet open and deleted
  // `tab` before any later reader could see it. Only a sheet this page offers
  // THIS caller is accepted — the same conditions the header buttons render
  // on. Anything else (an unknown value, a gated sheet, `review`, which needs
  // a loaded draft) opens nothing, and the sync effect drops it from the URL.
  // Embedded items are not deep-linkable: they live in the parent body and
  // need the parent payload to materialise.
  const [openSheet, setOpenSheet] =
    React.useState<'layers' | 'references' | 'related' | 'history' | 'audit' | 'review' | null>(() => {
      if (typeof window === 'undefined' || embedded || createMode) return null;
      const tab = new URLSearchParams(window.location.search).get('tab');
      if (tab === 'layers' || tab === 'references') return tab;
      if (tab === 'related') return hasAnchors ? tab : null;
      if (tab === 'history' || tab === 'audit') return canReadTrail ? tab : null;
      return null;
    });

  // ADR-0033 Phase B — `?review=1` arrival (from the chat's "Review N change(s)"
  // affordance). The AI may have drafted this item *after* the page mounted, so
  // we first force a fresh fetch, then — once the draft is loaded — open the
  // generic review/diff sheet and consume the query param (so a refresh/back
  // doesn't re-trigger it). The same-item-already-open case is covered by the
  // reload bump (the load effect keys off `reloadKey`, not the search string).
  const reviewParam = searchParams.get('review');
  const reviewBumpedRef = React.useRef(false);
  React.useEffect(() => {
    if (reviewParam !== '1' || createMode) return;
    if (!reviewBumpedRef.current) {
      reviewBumpedRef.current = true;
      setReloadKey((k) => k + 1);
      return; // wait for the reload to settle before reading hasDraft
    }
    if (!loading) {
      if (hasDraft) setOpenSheet('review');
      const next = new URLSearchParams(searchParams);
      next.delete('review');
      setSearchParams(next, { replace: true });
      reviewBumpedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewParam, createMode, loading, hasDraft]);

  // Inspector tabs: properties form vs raw JSON source view. Source view
  // is for power users who need to edit fields the form doesn't expose
  // (e.g. nested arrays). Tracked locally — not persisted between
  // navigations since most users live in the form 99% of the time.
  const [inspectorTab, setInspectorTab] =
    React.useState<'properties' | 'source'>('properties');

  // When the References sheet opens, lazy-load the data (idempotent).
  // Also keep the URL `?tab=` query in sync so deep-links round-trip: the
  // state's initializer above reads the link, so this mount pass keeps an
  // accepted `tab` and drops one that opened nothing.
  React.useEffect(() => {
    if (openSheet === 'references') {
      void loadReferences();
    }
    if (typeof window !== 'undefined' && !embedded) {
      const url = new URL(window.location.href);
      if (openSheet) url.searchParams.set('tab', openSheet);
      else url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSheet, embedded]);

  // Designer-style split-panel state. The inspector (right form panel)
  // can collapse to give the preview the full canvas. The collapsed
  // state is persisted in localStorage so the user's preference sticks
  // across navigations.
  const inspectorStorageKey = 'metadata-edit:inspector-collapsed';
  const inspectorSizeStorageKey = 'metadata-edit:inspector-size';
  const [inspectorCollapsed, setInspectorCollapsed] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(inspectorStorageKey) === '1';
  });
  // Remember the user's preferred inspector size so collapsing then
  // re-expanding restores it instead of leaving a sliver. react-resizable-
  // panels' built-in expand() returns to the size right before collapse
  // which is often near 0, hence the explicit memory.
  const lastInspectorSizeRef = React.useRef<number>(38);
  // Hydrate from localStorage on mount.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = Number(window.localStorage.getItem(inspectorSizeStorageKey));
    if (Number.isFinite(v) && v >= 22 && v <= 80) {
      lastInspectorSizeRef.current = v;
    }
  }, []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inspectorPanelRef = React.useRef<any>(null);
  const toggleInspector = React.useCallback(() => {
    setInspectorCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(inspectorStorageKey, next ? '1' : '0');
      }
      return next;
    });
  }, []);
  // Drive the imperative panel resize from a state-change effect rather
  // than inside the setter — the latter runs before React has committed
  // the new state and react-resizable-panels can race with its own
  // onResize observer, producing tiny re-expanded sizes.
  // ⚠️ resize() treats numeric values as **pixels**; pass a string to
  // get a percentage. resize(38) → 38px (~2.7%); resize('38%') → 38%.
  React.useEffect(() => {
    const handle = inspectorPanelRef.current;
    if (!handle) return;
    if (inspectorCollapsed) {
      handle.resize?.('0%');
    } else {
      const target = lastInspectorSizeRef.current || 38;
      handle.resize?.(`${target}%`);
    }
  }, [inspectorCollapsed]);

  // Canvas-local UX state — preview-only view (hides design chrome
  // without dropping dirty edits) and fullscreen (canvas takes over the
  // viewport so designers can focus). Both are session-scoped.
  const [previewOnly, setPreviewOnly] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  // Lock body scroll while fullscreen so the underlying page can't peek
  // through and the user's scroll position is preserved on exit.
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!isFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isFullscreen]);
  // Escape exits fullscreen.
  React.useEffect(() => {
    if (typeof window === 'undefined' || !isFullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsFullscreen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // ── Is this item a packaged ARTIFACT, or org-authored content? ────────
  // The two-tier authorization model (PR-10d.7) applies a different gate to
  // each: overlaying a code-shipped artifact needs `allowEnvironmentOverlay`, while
  // authoring org content needs only `allowRuntimeCreate`. Several call sites
  // below key off the answer, so it is derived ONCE here — the previous two
  // in-place copies are how the two drifted from the server (objectui#4308).
  //
  // A non-null `code` layer is NOT by itself proof of a packaged artifact: it
  // only proves that SOME package tagged the item, and org-authored items
  // carry a package tag too. Two exclusions cover that, and they mirror the
  // server rather than guessing alongside it:
  //
  //   1. `_packageId === 'sys_metadata'` — the save-path sentinel for a
  //      published org item, excluded by the protocol's own
  //      `isArtifactBacked` / `lookupArtifactItem`.
  //   2. `provenance === 'org'` (ADR-0010) — the axis that actually separates
  //      tenant-authored content from code-shipped artifacts. The sentinel in
  //      (1) holds only on the save path: boot-time rehydration of
  //      `sys_metadata` re-registers each row under its REAL package id, so a
  //      tenant's own item reads back with a code-looking `_packageId`. The
  //      framework hit exactly this and fixed it by asking provenance instead
  //      (`isTenantAuthored`, cloud#970) — an app the user had just built went
  //      un-editable at the first kernel rebuild. This page still carried the
  //      pre-cloud#970 spelling, which is objectui#4308: an object published
  //      into a WRITABLE package was mis-tiered as a packaged artifact, so
  //      this pillar alone showed the "provided by an installed package"
  //      lock while Studio treated it as editable and the server accepted the
  //      PUT.
  //
  // The server ships the answer on the layered envelope, so we read it rather
  // than re-deriving package writability from a third source. `provenance`
  // describes `code` here (the server resolves it from `code ?? overlay`, and
  // this branch already requires `code != null`); `undefined` means "no
  // opinion" (older server / unstamped item) and keeps the conservative
  // artifact reading, matching the `lock*` flags below.
  //
  // Deliberately NOT loosened: a genuine code package still reports
  // `provenance: 'package'` and stays read-only here, per the objectui#4036
  // ruling — "a code-defined package is read-only; customize in a writable
  // package" is one rule, and this change only stops it firing on packages
  // that are not code-defined.
  const isArtifactItem =
    !createMode
    && layered?.code != null
    && (layered.code as { _packageId?: string } | null)?._packageId !== 'sys_metadata'
    && layered?.provenance !== 'org';

  // ── objectui#4886 — ONE verdict decides the reset/delete verb ──────────
  //
  // Which verb the destructive control carries is a server question, and the
  // server already answers it: `resolveLockState` computes
  // `resettable = artifactBacked` and ships it on the layered envelope. This
  // page used to re-derive that answer TWICE, differently — the render side
  // asked `isArtifactItem`, `doReset()` asked `layered?.code != null` — and
  // the two disagree for a published org-own item, whose `code` layer is a
  // rehydrated `sys_metadata` row: the button rendered `Trash2` /
  // "Delete" and then executed the reset branch (refetch, stay on the page)
  // after asking "Reset overlay for …?". A button that said delete, asked
  // reset, and did reset.
  //
  // Honest tri-state. `resettable` is `boolean | undefined`:
  //   • `true`      — a package baseline exists behind the overlay, so
  //                   "Reset overlay" is the truthful verb: peel the overlay,
  //                   the code default remains, stay on the page.
  //   • `false`     — nothing to reset TO. The entry IS its `sys_metadata`
  //                   row, so the DELETE the button issues removes it
  //                   outright: `deleteMetaItem` hard-deletes the row, writes
  //                   a `delete` tombstone, and retires the item's registry
  //                   entry because no layer under it can serve the name. The
  //                   server says so in its own receipt for exactly this
  //                   population — `Deleted <type> '<name>' — it no longer
  //                   exists.`, as against `… reset to artifact default.` for
  //                   the backed one. "Delete" is the honest verb and the
  //                   confirm dialog is the consent gate — the maintainer's
  //                   2026-08-17 ruling on this card.
  //   • `undefined` — the server has NO OPINION (pre-ADR-0010 envelope, or a
  //                   transport that drops the flag). The old
  //                   `layered?.resettable !== false` read collapsed this into
  //                   `true`, i.e. it promised a baseline that may not exist.
  //                   We do not guess in the server's name: fall back to this
  //                   page's own conservative tier (`isArtifactItem`), which
  //                   is exactly what the render side already used before this
  //                   change — so a legacy server keeps its legacy rendering,
  //                   and render + confirm + execute still read ONE value.
  //
  // `??` (not `||`) on purpose: `false` from the server is an ANSWER, and must
  // not fall through to the client heuristic.
  const resettableVerdict: boolean | undefined = layered?.resettable;
  const isResetSemantic = !createMode && (resettableVerdict ?? isArtifactItem);

  // ── Can THIS item be written? Decided once, read by every gate below ────
  //
  // Two-tier authorization (PR-10d.7):
  //   - artifact-backed items need allowEnvironmentOverlay
  //   - org-authored items need allowEnvironmentOverlay OR allowRuntimeCreate
  //   - createMode is always writable (the server will gate on intent)
  // Which tier this item is in is `isArtifactItem` above.
  //
  // The type flags answer for a TYPE, and the server answers for the ITEM:
  // `editable`, the ADR-0010 protection envelope's write verdict, served on
  // the layered read this page already loads. `undefined` means "no opinion"
  // (older server / non-lockable item) and keeps the legacy behaviour; `false`
  // is an answer.
  //
  // objectui#12169 — the item answer is the only one that can tell two items
  // of the same type apart. ADR-0131 D6 seals managed content: the
  // `OS_METADATA_WRITABLE` hatch opens a type's items that no package ships,
  // and never an item a package ships. So on a hatch-elevated type
  // `allowEnvironmentOverlay` is true for both, and the server's `editable`
  // is `false` for the packaged one (objectstack `servedLockState`, through
  // the same seal predicate the write door asks). ⛔ This page does not read
  // `overrideSource` to tell the hatch from the registry opt-in: that would
  // be a client copy of the seal rule, and the served answer already holds
  // the server's.
  //
  // Hoisted above the designer auto-on effect below, which used to carry its
  // own copy of the type half without the item half. That copy put a sealed
  // item's canvas into design mode with nothing to save it with.
  const lockEditable = layered?.editable !== false;
  // objectui#12982 — a declaration-only catalog (declared sharing rules) is
  // read-only in the environment scope whatever the type entry offers: the
  // items an environment authors are records of another object
  // (`sharing-rule-catalog.ts`), so a save here would author a second kind.
  const declarationOnly = isEnvironmentScope(searchParams) && !!declarationOnlyAuthoredObject(type);
  const canWriteByType = declarationOnly
    ? false
    : createMode
      ? !!(entry?.allowEnvironmentOverlay || entry?.allowRuntimeCreate)
      : isArtifactItem
        ? !!entry?.allowEnvironmentOverlay
        : !!(entry?.allowEnvironmentOverlay || entry?.allowRuntimeCreate);
  const itemWritable = canWriteByType && (createMode || lockEditable);

  // ── …and may THIS CALLER write it? The caller tier, decided here too ────
  //
  // objectui#7611 — the metadata door refuses every save without
  // `manage_metadata` (measured on objectstack main: 403 "Saving a metadata
  // item requires the `manage_metadata` capability."), so a caller without it
  // gets the read-only page and the reason, not a Save that fails at the end.
  // Unknown fails open (`useCanAuthorMetadata`).
  //
  // objectui#12183 — and under a wall the security catalog is the platform
  // operator's: every door refuses a non-operator's write of a position,
  // permission set or capability, `manage_metadata` or not (objectstack
  // ADR-0131 D3, `catalog-scope.ts`). `walledDeciding` is the wall where it is
  // the gate to NAME: where the item tier would otherwise admit the write.
  //
  // Hoisted above the designer auto-on effect below, which reads `canWrite`
  // (objectui#7611 pointer 6117177535): reading the item tier alone, it put a
  // caller the server refuses into design mode with nothing to save it with.
  const canAuthor = useCanAuthorMetadata();
  const walled = useWalledCatalogReadOnly(type);
  const walledDeciding = walled && itemWritable;
  const canWrite = itemWritable && canAuthor && !walled;
  // Auto-enable design mode for designer-capable types. We do this once
  // per (type,name) navigation so the user lands in the productive
  // state instead of having to click "Edit". An item this caller cannot
  // write (`canWrite` false) keeps the old behavior. The check happens inside
  // the effect to avoid hook-order issues with the early `loading`
  // return below.
  const designerAutoOnRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    designerAutoOnRef.current = null;
  }, [type, name]);
  React.useEffect(() => {
    if (createMode || embedded || loading) return;
    const key = `${type}/${name ?? ''}`;
    if (designerAutoOnRef.current === key) return;
    if (!registeredPreview) return;
    // The gate the Save button below reads (`canWrite`), not a copy of it. An
    // in-place copy of the artifact heuristic answered differently from the
    // Save gate for one item (objectui#4308), a copy of the type half alone
    // opened a sealed item in design mode (objectui#12169), and the item tier
    // alone opened it for a caller the server refuses (objectui#7611).
    if (!canWrite) return;
    designerAutoOnRef.current = key;
    setEditing(true);
  }, [type, name, createMode, embedded, loading, canWrite, registeredPreview]);

  // Keyboard shortcut: Cmd/Ctrl+\ toggles the inspector. This is the
  // designer convention shared by Figma, VS Code (Cmd+B), Sketch — `\`
  // sits next to Return so it's reachable one-handed.
  React.useEffect(() => {
    if (typeof window === 'undefined' || embedded) return;
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (e.key !== '\\') return;
      // Ignore when typing in an editor (textarea / contenteditable).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      toggleInspector();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded, toggleInspector]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || embedded) return;
    // `?open=` on first mount restores the Related drawer target. `?tab=` is
    // read by `openSheet`'s initializer, not here (objectui#12496).
    const sp = new URLSearchParams(window.location.search);
    const open = sp.get('open');
    if (open && open.includes(':')) {
      const [t, n] = open.split(':', 2);
      if (t && n) setRelatedTarget({ kind: 'metadata', type: t, name: n });
    }
    // intentionally empty deps — first mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect drawer target into the URL so refresh/share works.
  React.useEffect(() => {
    if (typeof window === 'undefined' || embedded) return;
    const url = new URL(window.location.href);
    if (relatedTarget?.kind === 'metadata') {
      url.searchParams.set('open', `${relatedTarget.type}:${relatedTarget.name}`);
    } else {
      url.searchParams.delete('open');
    }
    window.history.replaceState({}, '', url.toString());
  }, [relatedTarget, embedded]);

  function labelForIssuePath(path: string): string {
    const key = path.split('.')[0];
    if (!key) return path;
    // Resolve the human label for the HEAD segment from the form/schema.
    const headLabel = ((): string => {
      const formForLabels = (createMode && config.createSchema ? undefined : entry?.form);
      const sections = Array.isArray(formForLabels?.sections) ? formForLabels.sections : [];
      for (const section of sections) {
        const fields = Array.isArray(section?.fields) ? section.fields : [];
        for (const field of fields) {
          if (typeof field === 'string') {
            if (field === key) return field;
          } else if (field?.field === key) {
            return String(field.label ?? key);
          }
        }
      }
      const props = (schema?.properties ?? {}) as Record<string, any>;
      return String(props[key]?.title ?? key);
    })();
    // For a NESTED path (e.g. `widgets.2.layout`) append a readable trail naming
    // the offending element + sub-field, so a terse "Widgets: Invalid input"
    // becomes "Widgets → priority_split → layout".
    return describeIssuePath(headLabel, path, draft);
  }

  async function doSave(force: boolean) {
    setSaving(true);
    setError(null);
    setIssues([]);
    try {
      // Ensure identity is set on create, and that any `createDefaults`
      // / `createBuildBody` shape (e.g. `{ fields: {} }` for object,
      // or `{ list: { data: { object } } }` for view) is present so
      // the saved body satisfies its JSONSchema. User-supplied values
      // always win over the defaults.
      // Prefer the server's authoritative create seed (from /meta/types — the
      // single source of truth in @objectstack/spec) over the locally hardcoded
      // createDefaults, so the create shape can't drift from the spec's required
      // fields (the dashboard-`layout` / action-`body` 422 family). `createSeed`
      // is a runtime field absent from the bundled GetMetaTypes type, hence the cast.
      const specCreateSeed = (entry as { createSeed?: Record<string, unknown> } | undefined)?.createSeed;
      let builtBody = createMode
        ? buildCreateModeBody(config, draft, specCreateSeed)
        // Edit mode: serialise the editor draft back to the wire shape
        // (inverse of `toDraft` — e.g. `view` folds the `{ list | form }`
        // family key back into the ViewItem `config` wrapper).
        : (config.fromDraft ? config.fromDraft(draft) : draft);
      // Async create-time augmentation (e.g. seed a record page's regions from
      // the bound object's synthesized default). Best-effort — a failure leaves
      // the un-augmented body. User/builder-supplied keys win over the seed.
      if (createMode && config.createSeed) {
        try {
          const seeded = await config.createSeed(draft, { client });
          if (seeded && typeof seeded === 'object') {
            // Seed wins over the empty defaults (`builtBody` already folded the
            // user's draft in, which only carries default-empty `regions`).
            builtBody = { ...(builtBody as Record<string, unknown>), ...seeded };
          }
        } catch { /* seed is best-effort; proceed with the un-augmented body */ }
      }
      const savedName = String(
        (builtBody as Record<string, unknown>)[identityField] ?? draft[identityField] ?? name,
      );
      const itemToSave = createMode
        ? { ...builtBody, [identityField]: savedName }
        : builtBody;
      if (!savedName) {
        setError(t('engine.validation.nameRequired', locale));
        setSaving(false);
        return;
      }
      // objectui#12810 — a create never saves the seed's placeholder identity
      // (`buildCreateModeBody` leaves it out). One the author left unset that
      // the type requires — a dataset's base object — is refused HERE, named,
      // with no request sent, as an empty name is above.
      const unsetPlaceholders = createMode
        ? unsetSeedPlaceholders(
            config,
            itemToSave as Record<string, unknown>,
            specCreateSeed,
            (entry?.schema as { required?: unknown } | undefined)?.required,
            identityField,
          )
        : [];
      if (unsetPlaceholders.length > 0) {
        setError(
          tFormat('engine.validation.seedPlaceholderUnset', locale, {
            fields: unsetPlaceholders.map((key) => `“${labelForIssuePath(key)}”`).join(', '),
          }),
        );
        setSaving(false);
        return;
      }
      // Save lands in the draft buffer — the runtime keeps serving the
      // last published version until the operator clicks Publish. The
      // backend defaults to publish mode for backward-compatibility, so
      // Studio must opt into draft explicitly.
      // Bind to the active software package (sys_metadata.package_id) when a
      // real package scope is carried in the URL (`?package=`). The backend
      // stamps it on create and preserves an existing binding on update, so
      // env-local overlays (no `?package=`) are unaffected.
      const activePackage = readActivePackageBinding();
      const saveOptions = {
        force,
        mode: 'draft' as const,
        ...(activePackage ? { packageId: activePackage } : {}),
      };
      // objectui#11773 — a create, with nothing read, is the first-write pin
      // (`If-None-Match: *`): the door refuses it where the name already holds
      // a draft instead of writing over it, and reads it as a create. A save of
      // the item this editor loaded sends the pin its load or last save held.
      if (createMode) {
        // objectui#7611 — a type whose edit page writes the live item creates
        // it live too (`createLive`), so the page that opens next reads what
        // was created and no draft is left behind for a Publish to replay.
        const createOptions =
          config.createLive && !activePackage ? { force } : saveOptions;
        await client.save<any>(type, savedName, itemToSave, { ...createOptions, ifNoneMatch: '*' });
      } else if ((await saveDraftVersioned(type, savedName, itemToSave, saveOptions)) === 'reloaded') {
        // The author chose the saved version; the load effect replaces the draft.
        return;
      }
      // Refresh layered + draft state after save — scope to the same package
      // as the initial load (ADR-0048) so a same-name collision re-reads this
      // package's own row, not another's.
      const refreshScope = ownerPackageId ? { packageId: ownerPackageId } : {};
      // objectui#11799 — this save went into a draft, which makes no layer. An
      // item this page loaded with no layer still has none, and an item it
      // just created has never been published (the page then navigates to the
      // item, whose load reads it afresh). `/layers` answers 404 for both, so
      // it is not asked: the answer already held stands.
      const layerless = createMode || (savedName === name && holdsNoLayer(layered));
      const [lay, draftResp] = await Promise.all([
        layerless ? layered : client.layered<any>(type, savedName, refreshScope),
        client.getDraft<any>(type, savedName, refreshScope).catch(() => null),
      ]);
      if (!layerless) setLayered(lay);
      const draftReal = extractDraftBody(draftResp);
      setHasDraft(!!draftReal);
      // The served draft is the whole document the save just stored (see the
      // load effect, objectui#10765): take it as-is. ⛔ Not spread over
      // `effective` — that is the PUBLISHED layer, and a spread would bring a
      // key this save deleted straight back into the editor, invisibly, for
      // the next save to send. The baseline is only for a save that left no
      // draft row to read back.
      const freshBaseline = (lay?.effective ?? itemToSave) as Record<string, unknown>;
      const rawFresh: Record<string, unknown> = draftReal ?? freshBaseline;
      // Re-normalise the refreshed wire shape so the editor keeps showing
      // the canonical draft shape after a save (e.g. the backend re-expands
      // a view into the ViewItem `config` wrapper).
      const fresh = config.toDraft ? config.toDraft(rawFresh) : rawFresh;
      setDraft(fresh);
      draftSnapshotRef.current = fresh;
      setLastSavedAt(new Date());
      lastAutoSaveSnapshotRef.current = JSON.stringify(fresh);
      setDestructiveIssues(null);
      setPendingItem(null);
      // The server took this document, so whatever it refused before is
      // settled. Cleared HERE and not on edit: an edit elsewhere in the
      // draft is not evidence the refused part was fixed — that conflation
      // is the wedge itself.
      setSaveRefusal(null);
      // Stay in design mode after save for designer-capable types so the
      // user keeps their inspector context. Non-designer types fall back
      // to the previous "exit edit on save" UX.
      const stayInEditing = !createMode && !!getMetadataPreview(type);
      if (!createMode && !stayInEditing) setEditing(false);
      if (createMode) {
        // Preserve the active query string (notably `?package=…`) so the
        // post-create navigation lands on the item in the SAME package the
        // author was working in. Without this the param is dropped and the
        // editor falls back to the user's default package, where the freshly
        // saved draft doesn't exist — so it reloads a blank form.
        const qs = searchParams.toString();
        navigate(`../${encodeURIComponent(savedName)}${qs ? `?${qs}` : ''}`, {
          relative: 'path',
        });
      }
    } catch (err: any) {
      // `err` is the client's parsed `MetadataError`: `MetadataClient`'s
      // `parseError` has already read every live wire shape onto `message`,
      // `issues` and `code` — the REST door's top-level `issues` and the HTTP
      // dispatcher's `error.details.issues` alike. Both branches below read
      // those fields. ⛔ Never `err.body`: re-reading the raw envelope is a
      // second parse, and the one this page had knew only the REST shape, so a
      // refusal the dispatcher served showed `[object Object]` with an empty
      // field path (objectui#11379).
      const parsedIssues: unknown[] = Array.isArray(err?.issues) ? err.issues : [];
      // Map destructive change → confirmation dialog.
      if (err?.status === 409 && errorCodeIs(err, 'DESTRUCTIVE_CHANGE')) {
        setDestructiveIssues(parsedIssues as Array<{ kind?: string; path?: string; message?: string }>);
        setPendingItem(draft);
      }
      // ADR-0070 D1/D3 — the kernel rejects authoring into a read-only
      // code/installed package (`writable_package_required`, also HTTP 422,
      // so this MUST precede the generic invalid_metadata branch below).
      // Surface an actionable message guiding the author to pick or create a
      // writable base rather than mangling it into phantom field issues.
      else if (errorCodeIs(err, 'WRITABLE_PACKAGE_REQUIRED')) {
        setError(t('engine.package.writableRequired', locale));
      }
      // Map schema validation → inline field errors.
      else if (err?.status === 422 || errorCodeIsAnyOf(err, ['INVALID_METADATA', 'INVALID_PAYLOAD'])) {
        let mapped: SchemaFormIssue[] = parsedIssues.map((x: any) => ({
          path: Array.isArray(x.path) ? x.path.join('.') : String(x.path ?? ''),
          message: translateValidationMessage(String(x.message ?? 'Invalid'), locale),
        }));
        // Backend's invalid_metadata sometimes returns a flat string like
        // "<type>/<name> failed spec validation: <path>: <message>".
        // Parse it into a single inline issue + summary so users see the
        // real problem instead of "0 issues".
        const raw: string = String(err?.message ?? '');
        if (mapped.length === 0 && raw) {
          const m = raw.match(/failed spec validation:\s*(.+?):\s*(.+)$/);
          if (m) {
            mapped = [{ path: m[1].trim(), message: translateValidationMessage(m[2].trim(), locale) }];
          } else {
            mapped = [{ path: '', message: translateValidationMessage(raw, locale) }];
          }
        }
        setIssues(mapped);
        // Hold the refusal against the draft slices the server named, so the
        // next auto-save cannot re-send the same refused document behind an
        // unrelated edit (`9073cf018`). Paths that do not localise are
        // DROPPED rather than kept as a wildcard: a refusal we cannot tie to a
        // slice must gate nothing at all.
        const probe = refusalProbeBody(draft);
        const held: SaveRefusal['held'] = [];
        const seenSlices = new Set<string>();
        for (const m of mapped) {
          const slicePath = issueSlicePath(m.path);
          if (seenSlices.has(slicePath)) continue;
          const fingerprint = issueSliceFingerprint(probe, slicePath);
          if (fingerprint === undefined) continue;
          seenSlices.add(slicePath);
          held.push({ slicePath, fingerprint, label: labelForIssuePath(m.path) });
        }
        setSaveRefusal({
          held,
          summary: held.map((h) => h.label).join(', '),
        });
        if (mapped.length === 1 && !mapped[0].path) {
          setError(mapped[0].message);
        } else if (mapped.length === 1) {
          setError(`${labelForIssuePath(mapped[0].path)}: ${mapped[0].message}`);
        } else {
          setError(tFormat('engine.validation.failed', locale, { count: mapped.length }));
        }
      } else {
        setError(err?.message ?? String(err));
      }
    } finally {
      setSaving(false);
    }
  }

  // objectui#13333 — the reset / delete and the discard-draft confirmations
  // are asked in the console's in-app AlertDialog (the idiom `PackagesPage`
  // uses), never the browser's native `confirm()`. One slot holds whichever
  // is open; its copy is computed when it opens, from the body loaded then.
  const [pendingConfirm, setPendingConfirm] = React.useState<{
    kind: 'reset' | 'delete' | 'discard';
    title: string;
    description: string;
    actionLabel: string;
    item: string;
  } | null>(null);

  /** The item's own label from its loaded body, trimmed; empty when it carries none. */
  function ownItemLabel(): string {
    return typeof draft.label === 'string' ? draft.label.trim() : '';
  }

  function doReset() {
    const confirmKey = isResetSemantic
      ? 'engine.edit.resetConfirm'
      : 'engine.edit.deleteConfirm';
    const vars = {
      type,
      name: name ?? '',
      typeLabel: translateMetadataType(type, locale, entry?.label ?? type),
      item: ownItemLabel() || (name ?? ''),
    };
    setPendingConfirm({
      kind: isResetSemantic ? 'reset' : 'delete',
      title: tFormat(confirmKey, locale, vars),
      description: tFormat(`${confirmKey}Body`, locale, vars),
      actionLabel: t(isResetSemantic ? 'engine.edit.reset' : 'engine.edit.delete', locale),
      item: vars.item,
    });
  }

  async function runReset(resetSemantic: boolean) {
    // Two semantics, ONE verdict — see `isResetSemantic` above. Both this
    // handler and the button that triggers it read that single value, so the
    // icon, the `title`, the confirm text and the branch taken here can no
    // longer disagree about the same entry (objectui#4886). The wire call is
    // the same `DELETE /meta/:type/:name` either way; what differs is what
    // the server does with it and therefore what we must tell the user:
    //   - baseline present: the overlay row is dropped and the code default
    //     is what remains → "Reset overlay", refetch layered, stay put.
    //   - no baseline: the overlay row IS the entry, so the same DELETE
    //     destroys it → "Delete", and the current URL no longer refers to
    //     anything, so navigate back to the list.
    // `resetSemantic` is the verdict the confirm was opened with, so the
    // branch taken is the one the dialog asked about.
    setSaving(true);
    setError(null);
    try {
      // objectui#12335 — name the package whose row this removes: the SAME
      // binding the save and the publish of this loop state, read from the
      // same source, so the row reset is the row the loop wrote. Absent (not
      // empty) when the editor holds no binding; the door then resolves the
      // item's one package itself, and an item two packages hold is refused
      // `409 RESOURCE_CONFLICT`, which the `catch` below shows with the door's
      // own sentence, as every refused write on this page is shown.
      const activePackage = readActivePackageBinding();
      await client.reset(type, name, {
        ...(activePackage ? { packageId: activePackage } : {}),
      });
      // objectui#11773 — the buffer below is re-read from the layers, with no
      // draft read behind it, so nothing pins its next save.
      forgetDraftVersion();
      if (resetSemantic) {
        const lay = await client.layered<any>(type, name);
        setLayered(lay);
        const fresh = (lay.effective ?? lay.code ?? {}) as Record<string, unknown>;
        setDraft(fresh);
        draftSnapshotRef.current = fresh;
        // Designer-capable types stay in design mode; allow the auto-on
        // effect to re-trigger after this reset.
        if (getMetadataPreview(type)) {
          designerAutoOnRef.current = null;
        } else {
          setEditing(false);
        }
      } else {
        // No artifact baseline → return to the list view (in its scope).
        navigate(`../${scopeSuffix}`, { relative: 'path' });
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  // Promote the pending draft to the active overlay. Mirrors `doSave`'s
  // refresh pattern so the editor stays in sync with the new baseline.
  async function doPublish() {
    setPublishing(true);
    setError(null);
    try {
      // State the SAME package the save step already stated — read from the
      // same single source, so the two calls of one loop can never disagree.
      // Absent (not empty) when the designer holds no binding: the framework
      // branches on the KEY BEING PRESENT downstream, where a present-but-null
      // package pins the draft lookup to unbound rows and a packaged draft
      // stops being found (`no_draft`) — see objectstack `9e04c3e35`'s own warning.
      const activePackage = readActivePackageBinding();
      await client.publish<any>(type, name, {
        ...(activePackage ? { packageId: activePackage } : {}),
      });
      // objectui#11773 — the draft is re-read at the address the next save
      // writes, so its answer pins that save (see the load effect).
      const [lay, draftRead] = await Promise.all([
        client.layered<any>(type, name),
        readDraftForSave<any>(client, type, name, activePackage),
      ]);
      const draftResp = draftRead.answer;
      setLayered(lay);
      const draftReal = extractDraftBody(draftResp);
      setHasDraft(!!draftReal);
      // After a publish the promoted body IS `effective` and the draft row is
      // normally gone; a draft that does remain is a whole document and is
      // taken as-is (objectui#10765). ⛔ Not spread over `effective`: the
      // spread cannot express deletion and would resurrect a published key
      // the draft had cleared.
      const freshBaseline = (lay.effective ?? draft) as Record<string, unknown>;
      const rawFresh: Record<string, unknown> = draftReal ?? freshBaseline;
      // Same wire-to-editor normalisation the load and save refreshes apply.
      const fresh = config.toDraft ? config.toDraft(rawFresh) : rawFresh;
      setDraft(fresh);
      draftSnapshotRef.current = fresh;
      // objectui#11773 — the publish dropped the draft the held version named;
      // the re-read says what the next save is pinned to (normally "no draft
      // row").
      recordDraftRead(type, name, activePackage, draftRead.pin);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setPublishing(false);
    }
  }

  // Discard the pending draft (`DELETE ?state=draft`). The published
  // overlay is untouched; the editor reverts to showing the live body.
  function doDiscardDraft() {
    // objectui#12690 — the confirm and the toast name the item by the label
    // its loaded body carries (the one the assistant context above reads),
    // and by the machine `type/name` only when it carries none. Read once,
    // when the confirm opens, before the discard swaps the body.
    const item = ownItemLabel() || `${type}/${name ?? ''}`;
    setPendingConfirm({
      kind: 'discard',
      title: tFormat('engine.edit.discardDraftConfirm', locale, { item }),
      description: t('engine.edit.discardDraftConfirmBody', locale),
      actionLabel: t('engine.edit.discardDraft', locale),
      item,
    });
  }

  async function runDiscardDraft(item: string) {
    setSaving(true);
    setError(null);
    try {
      // objectui#12335 — the draft row the save wrote at `?package=` is
      // discarded at that same address, as `doReset` above does for the
      // active row; package-less when the editor holds no binding.
      const activePackage = readActivePackageBinding();
      await client.reset(type, name, {
        state: 'draft',
        ...(activePackage ? { packageId: activePackage } : {}),
      });
      // objectui#11773 — the discard dropped the draft the held version named,
      // and no draft read follows it: nothing pins the next save.
      forgetDraftVersion();
      // objectui#11799 — a discard makes no layer: an item this page loaded
      // with no layer still has none, and `/layers` would answer 404.
      const lay = layered && holdsNoLayer(layered) ? layered : await client.layered<any>(type, name);
      setLayered(lay);
      const fresh = (lay.effective ?? lay.code ?? {}) as Record<string, unknown>;
      setDraft(fresh);
      draftSnapshotRef.current = fresh;
      setHasDraft(false);
      // objectui#12303 — the discard is said, naming what it discarded, through
      // the console's shared toast (`sonner`, the one Studio's publish uses).
      // Only here, after the DELETE and the re-read landed: a refused discard
      // goes to the `catch` below and keeps showing its error instead.
      toast.success(tFormat('engine.edit.draftDiscarded', locale, { item }));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  // Dirty detection: cheap structural comparison via JSON. The draft is
  // small (a single metadata record) so this is fine on each render.
  // Used to surface an "unsaved" indicator next to the Save button.
  // Must be declared BEFORE any early returns to preserve hook order.
  const isDirty = React.useMemo(() => {
    if (createMode) return Object.keys(draft).length > 0;
    const snap = draftSnapshotRef.current;
    if (!snap) return false;
    try {
      return JSON.stringify(draft) !== JSON.stringify(snap);
    } catch {
      return false;
    }
  }, [draft, createMode]);

  // The write gates — hoisted above the early `loading` return so the
  // auto-save / keyboard / blocker effects below can read them. The item
  // half (`itemWritable`: the type tier and the served `editable`) and the
  // caller half (`canWrite`) are decided once, next to the designer auto-on
  // effect above.
  // ADR-0010 — server-computed lock flags. undefined means "no opinion"
  // (older server / non-lockable item) → preserve legacy behaviour.
  // `deletable` is the lock gate for BOTH verbs, not just the delete one:
  // reset and delete are the same `DELETE /meta/:type/:name` call, and the
  // server gates it once, through `evaluateLockForDelete` (`assertLockAllowsDelete`
  // runs on every `deleteMetaItem`, artifact-backed or not). `resettable` is
  // NOT a permission — it is `artifactBacked`, i.e. "is there a baseline to
  // reset to", which is why it now drives the VERB (`isResetSemantic`) and no
  // longer doubles as the button's lock gate (objectui#4886).
  const lockDeletable = layered?.deletable !== false;
  const lockReason = layered?.lockReason;
  const isLocked = layered?.lock && layered.lock !== 'none';
  const readOnly = !canWrite && !createMode;
  const envScope = isEnvironmentScope(searchParams);
  const scopeSuffix = environmentScopeSuffix(searchParams);
  const EnvironmentSection = envScope && !createMode && !embedded ? ENVIRONMENT_SECTIONS[type] : undefined;

  // #2272 — designer deep-link: `?sel=nav:<id>` selects the nav item with
  // that spec `id` (stable across reorders, unlike the positional selection
  // ids the canvas/inspector exchange internally), applied once per
  // param/item. The nav selection mirrors back to the URL (replace — no
  // history spam, same convention as ADR-0047 `uf_*`) so the designer's
  // selected menu is shareable and survives reload; a non-nav selection
  // clears the param. objectui#11153 — one hook with the Studio Interfaces
  // pillar's copy: the param is kept until the item has loaded, and the
  // write state it reads waits for the type registry (`entry` decides
  // `canWrite`). On an item this page cannot write, the link selects the nav
  // item WITHOUT entering editing: the preview marks it and the inspector
  // opens on it read-only.
  useNavSelDeepLink({
    enabled: type === 'app',
    scope: name,
    draft,
    loaded: !loading,
    readOnly: typesLoading ? undefined : readOnly,
    selection,
    onApply: (hit, { enterEditing }) => {
      if (enterEditing) setEditing(true);
      setSelection({ kind: 'nav', id: hit.selectionId, label: hit.label });
    },
  });

  // Auto-save: debounce edits and persist silently once the user pauses
  // for AUTOSAVE_DEBOUNCE_MS. Skipped for create mode (need an explicit
  // name first), read-only forms, and while a save is already in flight.
  // We track the last attempted snapshot so a validation failure doesn't
  // loop on the same payload — the user has to mutate the draft again.
  const AUTOSAVE_DEBOUNCE_MS = 1500;
  // Keep doSave fresh inside the effect without re-arming the timer on
  // every render.
  const doSaveRef = React.useRef(doSave);
  React.useEffect(() => {
    doSaveRef.current = doSave;
  });
  React.useEffect(() => {
    if (!autoSaveEnabled) return;
    if (createMode || readOnly || !editing || !isDirty || saving) return;
    // Autosave is a save door like any other: gating only the button would let
    // the timer publish the malformed definition a second later (objectui#4306).
    if (inspectorBlocking > 0) return;
    // Second validation term, and the one that survives a selection change.
    // The timer is the door the wedge (`9073cf018`) actually came through: it
    // re-sent the refused document on every later edit, silently, so the
    // designer showed the rename as applied while the server held none of it.
    if (refusalBlocking > 0) return;
    let snap: string;
    try {
      snap = JSON.stringify(draft);
    } catch {
      return;
    }
    if (snap === lastAutoSaveSnapshotRef.current) return;
    const handle = window.setTimeout(() => {
      lastAutoSaveSnapshotRef.current = snap;
      doSaveRef.current(false);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [draft, isDirty, editing, saving, createMode, readOnly, autoSaveEnabled, inspectorBlocking, refusalBlocking]);

  // Keyboard shortcut — ⌘S / Ctrl+S triggers save when dirty.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (!canWrite || readOnly) return;
        if (!editing && !createMode) return;
        e.preventDefault();
        // Third save door — the shortcut must respect the same gate as the
        // button and the autosave timer (objectui#4306).
        if (!saving && (createMode || isDirty) && inspectorBlocking === 0 && refusalBlocking === 0) {
          doSaveRef.current(false);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canWrite, readOnly, editing, createMode, saving, isDirty, inspectorBlocking, refusalBlocking]);

  // Leave guard (objectui#13231) — registered with the shell's unsaved-edits
  // seam, which guards every departure it can see while the draft is dirty:
  // the browser-native "leave site?" prompt on a tab close / reload, an in-app
  // link click (intercepted before the router consumes it — cheaper and more
  // compatible than useBlocker, which requires a data router; the host app
  // uses BrowserRouter), and the shell's own departures from its header,
  // workspace and sidebar menus, which navigate from a button no link
  // listener sees.
  useRegisterUnsavedEdits(isDirty, t('engine.edit.unsavedLeaveConfirm', locale));

  // Publish "what's being edited" to the global AI chat so the agent can
  // act on the open item (and offer item-specific starter prompts). Kept
  // to a light summary — the agent can `describe_object` for full detail.
  // Declared above the early returns to satisfy the Rules of Hooks.
  const assistantEditorCtx = React.useMemo<AssistantEditorContext | null>(() => {
    if (embedded) return null;
    const itemName = String((draft as any).name ?? name ?? '');
    if (!itemName) return null;
    const ctx: AssistantEditorContext = {
      type,
      name: itemName,
      label: typeof (draft as any).label === 'string' ? (draft as any).label : undefined,
    };
    if (type === 'object') {
      ctx.fields = readFields((draft as any).fields).entries.slice(0, 60).map((e) => ({
        name: e.name,
        type: typeof e.def.type === 'string' ? (e.def.type as string) : undefined,
        label: typeof e.def.label === 'string' ? (e.def.label as string) : undefined,
        required: !!e.def.required || undefined,
      }));
    }
    return ctx;
  }, [embedded, type, name, draft]);
  useRegisterAssistantEditor(assistantEditorCtx);

  if (loading) {
    return (
      <PageShell entry={entry} itemName={name}>
        <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading {type}/{name}…
        </div>
      </PageShell>
    );
  }

  // `schema`, `createFieldList`, `effectiveHiddenFields`,
  // `effectiveFieldOrder`, and `handleCreateAwareChange` are all
  // hoisted to the top of the component (next to the rest of the
  // create-mode harness) to avoid placing hooks *after* the loading
  // early-return.

  // Banner variant: when type ships with allowRuntimeCreate but this
  // specific item is locked because it comes from a code package, we
  // show a different message inviting the user to create their own.
  const showArtifactLockedBanner =
    // objectui#7611 — and only for a caller who could author the new item
    // (objectui#12183: under a wall, the operator).
    readOnly && isArtifactItem && !!entry?.allowRuntimeCreate && canAuthor && !walled && !declarationOnly;

  // Preview tab — opt-in via `registerMetadataPreview()`. Hidden in
  // create mode (nothing to preview yet) and inside the embedded
  // drawer (the parent context owns the preview surface).
  //
  // Exception: a few types host their primary authoring surface IN the
  // canvas (object → field designer). For those we light the canvas up
  // during create too, so authors design fields immediately instead of
  // round-tripping through a save first. Object-level basics (name,
  // label, …) stay editable via the default inspector shown when no
  // field is selected, so naming still works before any field exists.
  const showPreviewInCreate = CREATE_MODE_CANVAS_TYPES.has(type);
  const PreviewComponent =
    !embedded && (!createMode || showPreviewInCreate)
      ? registeredPreview
      : undefined;

  // The id scope for THIS editor's form (objectui#5092). Embedded means we are
  // mounted inside `MetadataDetailDrawer`, which slides over a page that is
  // still rendering its own form: without a scope segment both forms emit the
  // same `mdf-{field}` ids for every field name they share, and the drawer's
  // labels — later in document order — resolve to the page's controls.
  // The page editor passes `undefined` and its ids stay exactly as they were.
  const formIdPath = embedded ? DRAWER_METADATA_ID_SCOPE : undefined;

  // Optional scoped inspector for the selected sub-element (e.g. a
  // dashboard widget). Registered separately via
  // `registerMetadataInspector()` so a type can opt in independently
  // of having a Preview, and so plugins can swap implementations.
  const InspectorComponent = registeredInspector;
  // Optional "home" inspector shown when there is NO selection, replacing
  // the generic whole-draft SchemaForm with a curated panel (e.g. the View
  // type + fields manager). Falls back to SchemaForm when unregistered.
  const DefaultInspectorComponent = registeredDefaultInspector;

  // Cancel edits: revert the draft to the last saved snapshot and exit
  // edit mode. Safe to call even with no snapshot (no-op).
  function doCancelEdit() {
    if (draftSnapshotRef.current) {
      setDraft(draftSnapshotRef.current);
    }
    setIssues([]);
    setError(null);
    // Cancel reverts the draft to the last saved snapshot, so the document the
    // server refused no longer exists to be refused.
    setSaveRefusal(null);
    setEditing(false);
  }

  // When the form is "live" but not yet in edit mode, it renders as
  // read-only. createMode is always editing; truly read-only types
  // (no allowEnvironmentOverlay) ignore the editing toggle entirely.
  // objectui#12183 — the create form too: under a wall its Save is not offered,
  // so its fields are not either.
  const formReadOnly = readOnly || walledDeciding || (!editing && !createMode);

  // Note: URL `?tab=` deep-links were repurposed to open side-panel
  // sheets (Layers / References / Related). Anything else is ignored —
  // the main work area is always the form+preview.

  // The Save button's name: the shortcut hint, or why Save is withheld. It is
  // the button's accessible name and tooltip both, so the word drawn beside
  // the icon (objectui#13337) leaves the name a reader hears unchanged.
  const saveTitle = saving
    ? t('engine.edit.saving', locale)
    : inspectorBlocking > 0
      // Neutral: the inspector channel carries CEL faults AND the
      // objectui#6900 required-field refusal (ruling 5831744213).
      ? t('perm.inspector.saveBlocked', locale)
      : refusalBlocking > 0
        ? tFormat('engine.validation.serverRefused', locale, {
            issue: saveRefusal?.summary ?? '',
          })
        : !createMode && !isDirty
          ? t('engine.edit.noChanges', locale)
          : `${t('engine.edit.save', locale)} (⌘S)`;

  // Action group rendered identically in either the PageShell header
  // (form-only types) or the canvas toolbar (types with a PreviewComponent).
  // Centralising it lets us merge the two top bars into one when a
  // designer is present, saving a full row of vertical chrome.
  const actionsNode = (
    <>
      {/* Declarative type-level actions (GAP-1) — e.g. datasource
          "Test connection". Only on a saved item: record_header actions
          template `${ctx.recordId}` from the item name, which `(new)`
          drafts don't have yet. */}
      {!createMode && (
        <MetadataTypeActions
          entry={entry}
          location="record_header"
          recordId={name}
          onAfter={() => setReloadKey((k) => k + 1)}
        />
      )}
      {/* Info sheets — icon-only group, mirrors the canvas
          toolbar style (small ghost icons + tooltip). Keeps
          the primary edit / save actions visually dominant. */}
      {(!createMode || hasAnchors) && (
        <div className="flex items-center rounded-md border bg-background p-0.5">
          {!createMode && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpenSheet('layers')}
              title={t('engine.edit.layers', locale)}
              className="h-7 w-7 p-0 relative"
            >
              <Layers3 className="h-3.5 w-3.5" />
              {layered?.overlay && (() => {
                const n = countOverlaidFields(layered.code, layered.effective);
                return n > 0 ? (
                  <span
                    className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-emerald-600 text-emerald-50 text-[9px] leading-[14px] text-center font-medium"
                    title={t('engine.layers.diff', locale)}
                  >
                    {n}
                  </span>
                ) : null;
              })()}
            </Button>
          )}
          {!createMode && hasDraft && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpenSheet('review')}
              title={t('designer.draftReview.title', locale)}
              className="h-7 w-7 p-0 relative"
              data-testid="resource-review-trigger"
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
              {(() => {
                const n = computeDraftChangeCount(
                  layered?.effective ?? null,
                  draft,
                );
                return n > 0 ? (
                  <span
                    className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-amber-500 text-amber-50 text-[9px] leading-[14px] text-center font-medium"
                    title={tFormat('designer.draftReview.badge', locale, { n })}
                  >
                    {n}
                  </span>
                ) : null;
              })()}
            </Button>
          )}
          {!createMode && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpenSheet('references')}
              title={t('engine.edit.references', locale)}
              className="h-7 w-7 p-0 relative"
            >
              <Link2 className="h-3.5 w-3.5" />
              {refsState.status === 'loaded' && refsState.items.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-muted text-foreground text-[9px] leading-[14px] text-center font-medium border">
                  {refsState.items.length}
                </span>
              )}
            </Button>
          )}
          {hasAnchors && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpenSheet('related')}
              title={t('engine.edit.related', locale)}
              className="h-7 w-7 p-0"
            >
              <Boxes className="h-3.5 w-3.5" />
            </Button>
          )}
          {!createMode && canReadTrail && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="history-button"
              onClick={() => setOpenSheet('history')}
              title={t('engine.edit.history', locale)}
              className="h-7 w-7 p-0"
            >
              <History className="h-3.5 w-3.5" />
            </Button>
          )}
          {!createMode && canReadTrail && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="audit-button"
              onClick={() => setOpenSheet('audit')}
              title={t('engine.edit.auditTab', locale)}
              className="h-7 w-7 p-0"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
      {!createMode && canWrite && layered?.overlay && lockDeletable && (
        <Button
          variant="ghost"
          size="sm"
          onClick={doReset}
          disabled={saving}
          data-testid="reset-or-delete-button"
          title={
            isResetSemantic
              ? t('engine.edit.reset', locale)
              : t('engine.edit.delete', locale)
          }
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
        >
          {isResetSemantic ? (
            <RotateCcw className="h-3.5 w-3.5" data-testid="reset-icon" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" data-testid="delete-icon" />
          )}
        </Button>
      )}
      {/* Edit-mode toggle.
          - Designer types (with PreviewComponent): always editing.
            The Design / Preview toggle in the canvas toolbar takes the
            place of an Edit / Cancel binary — users switch to Preview
            to see the rendered result, no "leave edit mode" needed.
          - Form-only types: keep the Salesforce-style Edit / Cancel
            convention (View → click Edit → mutate → Save or Cancel).
          - createMode: always editing, Save only.
          - Truly read-only types (no allowEnvironmentOverlay): no buttons. */}
      {canWrite && !createMode && !editing && !PreviewComponent && (
        <Button size="sm" onClick={() => setEditing(true)} className="h-7">
          <Pencil className="h-3.5 w-3.5 mr-1" />
          {t('engine.edit.edit', locale)}
        </Button>
      )}
      {canWrite && (editing || createMode) && (
        <SaveStatusIndicator
          saving={saving}
          isDirty={isDirty}
          autoSaveEnabled={autoSaveEnabled}
          lastSavedAt={lastSavedAt}
          createMode={!!createMode}
          locale={locale}
        />
      )}
      {canWrite && (editing || createMode) && !createMode && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAutoSaveEnabled((v) => !v)}
          className="h-7 w-7 p-0 text-muted-foreground"
          title={
            autoSaveEnabled
              ? t('engine.edit.autoSaveOn', locale)
              : t('engine.edit.autoSaveOff', locale)
          }
        >
          {autoSaveEnabled ? (
            <Zap className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <ZapOff className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
      {canWrite && !createMode && editing && !PreviewComponent && (
        <Button
          variant="ghost"
          size="sm"
          onClick={doCancelEdit}
          disabled={saving}
          className="h-7 w-7 p-0"
          title={t('engine.cancel', locale)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
      {/* TWO validation terms here, and the live client Zod `issues` are
          still neither of them — that asymmetry is on purpose. The
          discriminator is who refused, not how bad it looks:
            - `inspectorBlocking` — an author-time fault the server does NOT
              catch (a CEL predicate that does not parse), SELECTION-scoped
              (objectui#4306 / #6980);
            - `refusalBlocking` — a 422 the server DID return for this exact
              document, DOCUMENT-scoped so it survives a selection change
              (`9073cf018`).
          `issues` — the live client Zod pass — stays advisory, because the
          only failure the client can cause on its own is being STRICTER than
          the server. The reasoning, and the measurement behind all three, is
          at `blockingReport` and `saveRefusal` above. ⛔ Do not add
          `issues.length` to this gate without reading it. */}
      {canWrite && (editing || createMode) && (
        <Button
          size="sm"
          onClick={() => doSave(false)}
          disabled={saving || (!createMode && !isDirty) || inspectorBlocking > 0 || refusalBlocking > 0}
          className="h-7 gap-1 px-2.5 text-xs relative"
          aria-label={saveTitle}
          title={saveTitle}
          data-testid="resource-save"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {/* objectui#13337 — labelled, not an icon alone. */}
          <span>{t('engine.edit.save', locale)}</span>
          {isDirty && !saving && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 inline-block h-2 w-2 rounded-full bg-amber-300 ring-2 ring-background"
            />
          )}
        </Button>
      )}
      {/* Publish / Discard draft — only when there is a pending draft.
          Save writes to the draft buffer; the runtime keeps serving the
          published version until the operator clicks Publish. */}
      {canWrite && !createMode && hasDraft && (
        <Button
          variant="ghost"
          size="sm"
          onClick={doDiscardDraft}
          disabled={saving || publishing}
          className="h-7 w-7 p-0 text-muted-foreground"
          title={t('engine.edit.discardDraft', locale)}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
      )}
      {canWrite && !createMode && hasDraft && (
        <Button
          size="sm"
          onClick={doPublish}
          disabled={saving || publishing || isDirty}
          className="h-7 px-2 relative bg-emerald-600 hover:bg-emerald-700 text-emerald-50"
          title={
            isDirty
              ? t('engine.edit.publishBlockedDirty', locale)
              : t('engine.edit.publish', locale)
          }
        >
          {publishing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Send className="h-3.5 w-3.5 mr-1" />
              <span className="text-xs">{t('engine.edit.publish', locale)}</span>
            </>
          )}
        </Button>
      )}
    </>
  );

  return (
    <PageShell
      entry={entry ?? { type, label: type }}
      itemName={createMode ? '(new)' : name}
      subtitle={createMode ? t('engine.edit.createNew', locale) : undefined}
      actions={PreviewComponent ? null : actionsNode}
    >
      <div
        className={
          PreviewComponent
            ? 'flex h-full min-h-0 flex-col'
            : 'p-6 space-y-6 max-w-7xl'
        }
      >
        {(error || readOnly || hasDraft || isLocked || walledDeciding) && (
          <div
            className={
              PreviewComponent
                ? 'px-6 pt-4 space-y-3'
                : 'space-y-3'
            }
          >
            {error && (
              <div className="text-sm text-destructive border border-destructive/30 rounded p-3 bg-destructive/5">
                <RefusalMessage text={error} />
              </div>
            )}
            {isLocked && (
              <div className="text-xs text-amber-900 border border-amber-300/70 bg-amber-50/70 rounded-md px-3 py-2.5 dark:text-amber-200 dark:border-amber-700/40 dark:bg-amber-950/20 flex items-start gap-2.5">
                <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-80" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium" data-testid="lock-banner-title">
                    {lockBannerTitle(layered?.lock, locale)}
                  </div>
                  {lockReason && <div className="mt-0.5 opacity-90">{lockReason}</div>}
                  {layered?.lockDocsUrl && (
                    <a
                      href={layered.lockDocsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-amber-800 underline hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100"
                    >
                      {locale === 'zh-CN' ? '查看文档' : 'View docs'} →
                    </a>
                  )}
                  {layered?.packageId && (
                    <div className="mt-0.5 text-amber-700 dark:text-amber-300/80">
                      <code className="font-mono">{layered.packageId}{layered.packageVersion ? `@${layered.packageVersion}` : ''}</code>
                    </div>
                  )}
                </div>
                {/* When this locked item ships from a code package the
                    user can still author their own copy — fold that CTA
                    into the lock banner instead of stacking a second,
                    near-identical amber notice below it. */}
                {showArtifactLockedBanner && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-7 bg-background/60"
                    onClick={() => navigate(`../new${scopeSuffix}`, { relative: 'path' })}
                  >
                    {t('engine.list.create', locale)}
                  </Button>
                )}
              </div>
            )}
            {hasDraft && !createMode && (
              <div className="text-xs text-emerald-900 border border-emerald-300 bg-emerald-50 rounded p-3 dark:text-emerald-200 dark:border-emerald-700/50 dark:bg-emerald-950/30 flex items-center gap-3">
                <Send className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{t('engine.edit.draftPending', locale)}</span>
                {canWrite && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={doDiscardDraft}
                      disabled={saving || publishing}
                      className="h-7"
                    >
                      {t('engine.edit.discardDraft', locale)}
                    </Button>
                    <Button
                      size="sm"
                      onClick={doPublish}
                      disabled={saving || publishing || isDirty}
                      className="h-7 bg-emerald-600 hover:bg-emerald-700 text-emerald-50"
                    >
                      {publishing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        t('engine.edit.publish', locale)
                      )}
                    </Button>
                  </>
                )}
              </div>
            )}
            {/* When the item is already flagged via the lock banner above,
                this read-only notice is redundant (and its CTA has been
                folded into the lock banner). Only render it for the
                non-locked read-only cases. */}
            {/* objectui#12183 — under a wall the server rule is the reason,
                not a missing permission: the capability does not admit a
                tenant there. Shown on the create page too, whose Save the
                wall withholds the same way. */}
            {walledDeciding && (
              <div
                data-testid="walled-catalog-readonly-banner"
                className="text-xs text-amber-800 border border-amber-300/70 bg-amber-50/70 rounded-md px-3 py-2.5 dark:text-amber-200 dark:border-amber-700/40 dark:bg-amber-950/20 flex items-start gap-2"
              >
                <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  {tFormat('engine.catalog.readOnly.walled', locale, {
                    type: translateMetadataType(type, locale, entry?.label ?? type),
                  })}
                </span>
              </div>
            )}
            {declarationOnly && (
              <div
                data-testid="declared-readonly-banner"
                className="text-xs text-muted-foreground border rounded-md px-3 py-2.5 bg-muted/30 flex items-start gap-2"
              >
                <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{t(`engine.catalog.declaredOnly.hint.${type}`, locale)}</span>
              </div>
            )}
            {readOnly && !isLocked && !canAuthor && !walledDeciding && !declarationOnly && (
              <div
                data-testid="capability-readonly-banner"
                className="text-xs text-amber-800 border border-amber-300/70 bg-amber-50/70 rounded-md px-3 py-2.5 dark:text-amber-200 dark:border-amber-700/40 dark:bg-amber-950/20 flex items-start gap-2"
              >
                <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{t('engine.edit.capabilityReadOnly', locale)}</span>
              </div>
            )}
            {readOnly && !isLocked && canAuthor && !walledDeciding && !declarationOnly && (
              <div data-testid="readonly-banner" className="text-xs text-amber-800 border border-amber-300/70 bg-amber-50/70 rounded-md px-3 py-2.5 dark:text-amber-200 dark:border-amber-700/40 dark:bg-amber-950/20 flex items-start gap-3">
                <div className="flex-1">
                  {showArtifactLockedBanner ? (
                    /* Type allows runtime-create but THIS item ships from
                       a code package. Tell the user clearly and provide
                       a CTA to author their own. */
                    t('engine.edit.artifactLockedBanner', locale)
                      .split(/(\{type\})/)
                      .map((part, i) => {
                        if (part === '{type}') return <code key={i} className="font-mono">{type}</code>;
                        return <React.Fragment key={i}>{part}</React.Fragment>;
                      })
                  ) : (
                    /* The platform i18n bundle ships `engine.edit.readOnlyTypeBanner`
                       with `{flag} / {type}` placeholders so the monospace
                       tokens are inlined inside the translated sentence in any
                       locale. Splitting on the two tokens preserves the
                       sentence order across translations.
                       objectui#12141 — `{flag}` is `OS_METADATA_WRITABLE`, the
                       one spelling the server reads; the legacy
                       `OBJECTSTACK_`-prefixed name it used to print is read by
                       nothing. The banner no longer offers a registry flip:
                       the registry is a TypeScript literal in
                       `@objectstack/spec` that no deployment edits. */
                    t('engine.edit.readOnlyTypeBanner', locale)
                      .split(/(\{flag\}|\{type\})/)
                      .map((part, i) => {
                        if (part === '{flag}') return <code key={i} className="font-mono">OS_METADATA_WRITABLE</code>;
                        if (part === '{type}') return <code key={i} className="font-mono">{type}</code>;
                        return <React.Fragment key={i}>{part}</React.Fragment>;
                      })
                  )}
                </div>
                {showArtifactLockedBanner && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => navigate(`../new${scopeSuffix}`, { relative: 'path' })}
                  >
                    {t('engine.list.create', locale)}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <div
          className={
            PreviewComponent
              ? 'flex w-full flex-1 min-h-0 flex-col'
              : 'w-full'
          }
        >
          <div
            className={
              PreviewComponent
                ? 'mt-2 flex-1 min-h-0 flex flex-col px-6 pb-4'
                : 'mt-4 space-y-3'
            }
          >
            {/* Read-only banner. In split mode we suppress it — the
                "可写" badge in the header plus the Edit button in the
                action bar already convey both signal and call-to-action,
                and saving every vertical pixel for the canvas matters. */}
            {!PreviewComponent && formReadOnly && !readOnly && canWrite && !createMode && (
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground border rounded p-2.5 bg-muted/30">
                <span>
                  {t('engine.edit.readOnlyBanner', locale).split(/\{edit\}/).map((part, i, arr) => (
                    <React.Fragment key={i}>
                      {part}
                      {i < arr.length - 1 && <strong>{t('engine.edit.edit', locale)}</strong>}
                    </React.Fragment>
                  ))}
                </span>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  {t('engine.edit.edit', locale)}
                </Button>
              </div>
            )}
            {(() => {
              // Server-computed load-time validation errors on the
              // effective payload — surfaced here so operators can see
              // a structural problem without saving first. The same
              // errors are also threaded into SchemaForm as `issues`
              // and rendered inline next to each broken field.
              const diag = (layered as any)?._diagnostics as
                | {
                    valid: boolean;
                    errors?: Array<{ path: string; message: string }>;
                    warnings?: Array<{ path: string; message: string }>;
                  }
                | undefined;
              // When client-side Zod validation is available for this
              // type, drive the error portion of the banner from the
              // live `issues` state instead of the stale load-time
              // diagnostics, so it stays in sync with every keystroke.
              // Warnings remain server-sourced (Zod doesn't model them).
              const liveErrors = hasClientValidator(type, draftMode)
                ? issues.map((i) => ({
                    path: i.path,
                    message: translateValidationMessage(i.message, locale),
                  }))
                : (diag?.errors ?? []).map((i) => ({
                    ...i,
                    message: translateValidationMessage(i.message, locale),
                  }));
              const liveValid = hasClientValidator(type, draftMode)
                ? liveErrors.length === 0
                : diag?.valid !== false;
              // Gate the whole diagnostics block on a successful load with
              // a diagnostics source. A failed load shows the explicit
              // "failed to load" banner above instead; the empty-default
              // form's required-field issues here would be noise, not a
              // verdict on the item (see shouldRenderDiagnostics).
              if (createMode && !createDirty) {
                return null;
              }
              if (
                !shouldRenderDiagnostics({
                  loadFailed,
                  hasDiag: !!diag,
                  hasClientValidator: hasClientValidator(type, draftMode),
                })
              ) {
                return null;
              }
              const errs = liveErrors;
              const warns = diag?.warnings ?? [];
              const hasErrs = !liveValid && errs.length > 0;
              const hasWarns = warns.length > 0;
              if (!hasErrs && !hasWarns) return null;
              const renderBlock = (
                kind: 'error' | 'warning',
                items: Array<{ path: string; message: string }>,
              ) => {
                const head = items.slice(0, 3);
                const rest = Math.max(0, items.length - head.length);
                const cls =
                  kind === 'error'
                    ? 'border-destructive/40 bg-destructive/[0.06] text-destructive'
                    : 'border-amber-500/40 bg-amber-500/[0.08] text-amber-800 dark:text-amber-200';
                const titleKey =
                  kind === 'error'
                    ? 'engine.edit.diagnostics.title'
                    : 'engine.edit.diagnostics.warnTitle';
                return (
                  <div
                    key={kind}
                    data-testid={kind === 'error' ? 'metadata-validation-banner' : undefined}
                    className={`flex items-start gap-2 text-xs border rounded p-2.5 ${cls}`}
                  >
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {tFormat(titleKey, locale, { count: items.length })}
                      </div>
                      <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                        {head.map((e, i) => (
                          <li key={i} className="truncate">
                            <span className="opacity-70">{e.path ? labelForIssuePath(e.path) : '(root)'}</span>: {e.message}
                          </li>
                        ))}
                        {rest > 0 && (
                          <li className="opacity-70">
                            {tFormat('engine.edit.diagnostics.more', locale, { count: rest })}
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                );
              };
              return (
                <div className="space-y-2">
                  {hasErrs && renderBlock('error', errs)}
                  {hasWarns && renderBlock('warning', warns)}
                </div>
              );
            })()}
            {PreviewComponent ? (
              <div
                className={
                  isFullscreen
                    ? 'fixed inset-0 z-50 bg-background flex flex-col p-3'
                    : 'relative flex-1 min-h-0 flex'
                }
              >
                <ResizablePanelGroup
                  orientation="horizontal"
                  className="flex-1 min-h-0 rounded-md border bg-background overflow-hidden"
                  id={`metadata-edit-${type}`}
                >
                  <ResizablePanel defaultSize={62} minSize={30}>
                    <div className="relative h-full flex flex-col">
                      {/* Canvas toolbar — owns the design/preview toggle
                          and fullscreen affordance so designers can drive
                          the canvas without round-tripping to the page
                          header. In fullscreen we also surface Save /
                          Cancel / Inspector controls here since the
                          PageShell header is hidden. */}
                      <div className="flex items-center justify-between gap-2 border-b bg-background/95 backdrop-blur px-3 py-2 sticky top-0 z-10">
                        <div className="flex items-center gap-1">
                          {canWrite && (
                            <div
                              role="tablist"
                              aria-label={t('engine.edit.designer', locale)}
                              className="inline-flex items-center rounded-md border bg-muted/40 p-0.5"
                            >
                              <button
                                type="button"
                                role="tab"
                                aria-selected={!previewOnly}
                                onClick={() => setPreviewOnly(false)}
                                className={
                                  'inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ' +
                                  (!previewOnly
                                    ? 'bg-background shadow-sm text-foreground'
                                    : 'text-muted-foreground hover:text-foreground')
                                }
                                title={t('engine.edit.designMode', locale)}
                              >
                                <MousePointer2 className="h-3.5 w-3.5" />
                                {t('engine.edit.designMode', locale)}
                              </button>
                              <button
                                type="button"
                                role="tab"
                                aria-selected={previewOnly}
                                onClick={() => setPreviewOnly(true)}
                                className={
                                  'inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ' +
                                  (previewOnly
                                    ? 'bg-background shadow-sm text-foreground'
                                    : 'text-muted-foreground hover:text-foreground')
                                }
                                title={t('engine.edit.previewMode', locale)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                {t('engine.edit.previewMode', locale)}
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {/* All page-level actions live here when the
                              designer is present — merged from the
                              PageShell header to reclaim a full row. */}
                          {actionsNode}
                          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                          {PreviewComponent && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={toggleInspector}
                              className="h-7 w-7 p-0"
                              title={
                                (inspectorCollapsed
                                  ? t('engine.edit.showInspector', locale)
                                  : t('engine.edit.hideInspector', locale)) + ' (⌘\\)'
                              }
                            >
                              {inspectorCollapsed ? (
                                <PanelRightOpen className="h-3.5 w-3.5" />
                              ) : (
                                <PanelRightClose className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsFullscreen((v) => !v)}
                            className="h-7 w-7 p-0"
                            title={
                              isFullscreen
                                ? t('engine.edit.exitFullscreen', locale)
                                : t('engine.edit.fullscreen', locale)
                            }
                          >
                            {isFullscreen ? (
                              <Minimize2 className="h-3.5 w-3.5" />
                            ) : (
                              <Maximize2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-auto p-4 bg-[radial-gradient(circle_at_1px_1px,theme(colors.border)_1px,transparent_0)] [background-size:16px_16px] bg-muted/30">
                        {/* eslint-disable-next-line react-hooks/static-components -- useRegisteredMetadataPreview returns a registered component (stable), not one created during render */}
                        <PreviewComponent
                          type={type}
                          name={name}
                          draft={draft}
                          baseline={
                            !createMode
                              ? ((layered?.effective as Record<string, unknown> | undefined) ?? undefined)
                              : undefined
                          }
                          editing={editing && !previewOnly}
                          selection={previewOnly ? null : selection}
                          onSelectionChange={setSelection}
                          locale={locale}
                          diagnostics={previewDiagnostics}
                          onPatch={(patch) =>
                            handleDraftChange((d) => ({ ...(d as Record<string, unknown>), ...patch }))
                          }
                        />
                      </div>
                    </div>
                  </ResizablePanel>
                  <ResizableHandle
                    withHandle
                    className={
                      inspectorCollapsed
                        ? 'hidden'
                        : 'w-1.5 bg-border/40 hover:bg-primary/40 active:bg-primary/60 transition-colors'
                    }
                  />
                  <ResizablePanel
                    panelRef={inspectorPanelRef}
                    defaultSize={lastInspectorSizeRef.current}
                    minSize={22}
                    collapsible
                    collapsedSize={0}
                    onResize={(size) => {
                      const pct = size.asPercentage;
                      const collapsed = pct <= 0.5;
                      if (!collapsed) {
                        lastInspectorSizeRef.current = pct;
                        if (typeof window !== 'undefined') {
                          window.localStorage.setItem(
                            inspectorSizeStorageKey,
                            String(Math.round(pct)),
                          );
                        }
                      }
                      setInspectorCollapsed((prev) => {
                        if (prev === collapsed) return prev;
                        if (typeof window !== 'undefined') {
                          window.localStorage.setItem(
                            inspectorStorageKey,
                            collapsed ? '1' : '0',
                          );
                        }
                        return collapsed;
                      });
                    }}
                  >
                    <div className="h-full overflow-auto">
                      {/* Inspector header — anchors the user to "this is
                          where the metadata for the selected item lives".
                          The collapse affordance lives in the canvas
                          toolbar (left of Fullscreen) so it stays
                          reachable when the panel is closed; we
                          deliberately do not duplicate it here. */}
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 backdrop-blur px-3 py-2">
                        <div
                          role="tablist"
                          className="inline-flex items-center rounded-md border bg-muted/40 p-0.5"
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={inspectorTab === 'properties'}
                            onClick={() => setInspectorTab('properties')}
                            className={
                              'inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ' +
                              (inspectorTab === 'properties'
                                ? 'bg-background shadow-sm text-foreground'
                                : 'text-muted-foreground hover:text-foreground')
                            }
                            title={t('engine.edit.inspector.properties', locale)}
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            {t('engine.edit.inspector.properties', locale)}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={inspectorTab === 'source'}
                            onClick={() => setInspectorTab('source')}
                            className={
                              'inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ' +
                              (inspectorTab === 'source'
                                ? 'bg-background shadow-sm text-foreground'
                                : 'text-muted-foreground hover:text-foreground')
                            }
                            title={t('engine.edit.inspector.source', locale)}
                          >
                            <FileCode2 className="h-3.5 w-3.5" />
                            {t('engine.edit.inspector.source', locale)}
                          </button>
                        </div>
                        {isDirty && (
                          <Badge variant="outline" className="text-[10px] border-amber-400/60 text-amber-600 dark:text-amber-300">
                            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                            {t('engine.edit.unsaved', locale)}
                          </Badge>
                        )}
                      </div>
                      <div className="p-4">
                        {inspectorTab === 'source' ? (
                          <JsonSourceEditor
                            value={draft}
                            onChange={handleCreateAwareChange}
                            readOnly={formReadOnly}
                            issues={displayIssues.map((i) => ({
                              path: i.path ?? '',
                              message: i.message,
                            }))}
                          />
                        ) : selection && InspectorComponent ? (
                          // eslint-disable-next-line react-hooks/static-components -- useRegisteredMetadataInspector returns a registered component (stable), not one created during render
                          <InspectorComponent
                            type={type}
                            name={name}
                            draft={draft}
                            selection={selection}
                            onPatch={(patch) =>
                              handleDraftChange((d) => ({
                                ...(d as Record<string, unknown>),
                                ...patch,
                              }))
                            }
                            onClearSelection={() => setSelection(null)}
                            onSelectionChange={setSelection}
                            onBlockingIssuesChange={(count) =>
                              setBlockingReport({ key: selectionKey, count })
                            }
                            readOnly={formReadOnly}
                            locale={locale}
                          />
                        ) : !selection && DefaultInspectorComponent ? (
                          // eslint-disable-next-line react-hooks/static-components -- useRegisteredMetadataDefaultInspector returns a registered component (stable), not one created during render
                          <DefaultInspectorComponent
                            type={type}
                            name={name}
                            draft={draft}
                            onPatch={(patch) =>
                              handleCreateAwareChange((d) => ({
                                ...(d as Record<string, unknown>),
                                ...patch,
                              }))
                            }
                            onSelectionChange={setSelection}
                            onBlockingIssuesChange={(count) =>
                              setBlockingReport({ key: selectionKey, count })
                            }
                            readOnly={formReadOnly}
                            locale={locale}
                            serverSchema={entry?.schema as Record<string, unknown> | undefined}
                          />
                        ) : (
                          <SchemaForm
                            schema={schema}
                            idPath={formIdPath}
                            form={createMode && config.createSchema ? undefined : entry?.form}
                            value={draft}
                            onChange={handleCreateAwareChange}
                            issues={displayIssues}
                            hiddenFields={effectiveHiddenFields}
                            fieldOrder={effectiveFieldOrder}
                            readOnly={formReadOnly}
                            createMode={createMode}
                            widgetContext={widgetContext}
                          />
                        )}
                      </div>
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
                {/* The floating reopen pill that used to live here was
                    removed: the canvas toolbar already hosts a permanent
                    VSCode-style inspector toggle next to the fullscreen
                    button, so this duplicate affordance was just noise. */}
              </div>
            ) : (
              <SchemaForm
                schema={schema}
                idPath={formIdPath}
                form={createMode && config.createSchema ? undefined : entry?.form}
                value={draft}
                onChange={handleCreateAwareChange}
                issues={displayIssues}
                hiddenFields={effectiveHiddenFields}
                fieldOrder={effectiveFieldOrder}
                readOnly={formReadOnly}
                createMode={createMode}
                widgetContext={widgetContext}
              />
            )}
            {/* objectui#7611 — under the designer, too: `position` renders
                through its preview, so the section takes a bounded strip
                below the canvas instead of squeezing it. */}
            {EnvironmentSection && (
              <div className={PreviewComponent ? 'shrink-0 max-h-[35vh] overflow-y-auto' : undefined}>
                <EnvironmentSection name={name} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Layers / References / Related are right-side sheets, opened from
          the page-shell header. They used to live in tabs above the form,
          which stole vertical space from the primary work area. */}
      <Sheet
        open={openSheet === 'layers'}
        onOpenChange={(o) => !o && setOpenSheet(null)}
      >
        <SheetContent side="right" className="w-[92vw] sm:max-w-[720px] p-0 flex flex-col gap-0">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="text-base">{t('engine.edit.layers', locale)}</SheetTitle>
            <SheetDescription className="text-xs">
              {type} / {name}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <LayeredDiff layered={layered} locale={locale} />
          </div>
        </SheetContent>
      </Sheet>

      {/* ADR-0033 Phase B — generic draft↔published review/diff. Available for
          ANY type whenever a pending draft exists; opened by the chat's
          "Review N change(s)" affordance (?review=1) or the toolbar button. */}
      <Sheet
        open={openSheet === 'review'}
        onOpenChange={(o) => !o && setOpenSheet(null)}
      >
        <SheetContent side="right" className="w-[92vw] sm:max-w-[720px] p-0 flex flex-col gap-0">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="text-base">{t('designer.draftReview.title', locale)}</SheetTitle>
            <SheetDescription className="text-xs">
              {type} / {name} · {t('designer.canvas.reviewVsPublished', locale)}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <DraftReviewPanel
              published={layered?.effective ?? null}
              draft={draft}
              locale={locale}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={openSheet === 'references'}
        onOpenChange={(o) => !o && setOpenSheet(null)}
      >
        <SheetContent side="right" className="w-[92vw] sm:max-w-[720px] p-0 flex flex-col gap-0">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="text-base">
              {t('engine.edit.references', locale)}
              {/* Only a completed scan may show a count — a `0` badge over a
                  failed check is the same false measurement in miniature. */}
              {refsState.status === 'loaded' && (
                <Badge
                  variant="outline"
                  className="ml-2 text-[10px]"
                  data-testid="refs-count-badge"
                >
                  {refsState.items.length}
                </Badge>
              )}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {type} / {name}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <ReferencesPanel
              state={refsState}
              locale={locale}
              onRetry={() => void loadReferences()}
            />
          </div>
        </SheetContent>
      </Sheet>

      {hasAnchors && (
        <Sheet
          open={openSheet === 'related'}
          onOpenChange={(o) => !o && setOpenSheet(null)}
        >
          <SheetContent side="right" className="w-[92vw] sm:max-w-[860px] p-0 flex flex-col gap-0">
            <SheetHeader className="px-4 py-3 border-b">
              <SheetTitle className="text-base">{t('engine.edit.related', locale)}</SheetTitle>
              <SheetDescription className="text-xs">
                {type} / {name}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-auto p-4">
              <RelatedPanel
                type={type}
                name={name}
                parentItem={draft}
                onOpen={(t) => setRelatedTarget(t)}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {!createMode && canReadTrail && (
        <Sheet
          open={openSheet === 'history'}
          onOpenChange={(o) => !o && setOpenSheet(null)}
        >
          <SheetContent side="right" className="w-[92vw] sm:max-w-[720px] p-0 flex flex-col gap-0">
            <SheetHeader className="px-4 py-3 border-b">
              <SheetTitle className="text-base">{t('engine.edit.history', locale)}</SheetTitle>
              <SheetDescription className="text-xs">
                {type} / {name}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-auto p-4">
              <HistoryPanel
                type={type}
                name={name}
                client={client}
                locale={locale}
                // The rollback door asks the capability and wall verdicts the
                // save door asks, so it is offered on Save's gate
                // (objectui#12183: a walled tenant was offered it, refused).
                onRollback={canWrite ? () => setReloadKey((k) => k + 1) : undefined}
                rollbackLabel={t('engine.edit.rollback', locale)}
                rollbackConfirm={(version) =>
                  t('engine.edit.rollbackConfirm', locale).replace(
                    '{version}',
                    String(version),
                  )
                }
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {!createMode && canReadTrail && (
        <Sheet
          open={openSheet === 'audit'}
          onOpenChange={(o) => !o && setOpenSheet(null)}
        >
          <SheetContent side="right" className="w-[92vw] sm:max-w-[860px] p-0 flex flex-col gap-0">
            <SheetHeader className="px-4 py-3 border-b">
              <SheetTitle className="text-base">{t('engine.edit.auditTab', locale)}</SheetTitle>
              <SheetDescription className="text-xs">
                {type} / {name}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-hidden p-3">
              <AuditPanel
                type={type}
                name={name}
                client={client}
                locale={locale}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      <MetadataDetailDrawer
        target={relatedTarget}
        onClose={() => setRelatedTarget(null)}
        parentContext={{ type, name }}
      />

      {/* Destructive-change confirmation dialog */}
      <Dialog
        open={destructiveIssues != null}
        onOpenChange={(open) => {
          if (!open) {
            setDestructiveIssues(null);
            setPendingItem(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              {t('engine.edit.destructiveTitle', locale)}
            </DialogTitle>
            <DialogDescription>
              {t('engine.edit.destructiveDesc', locale)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[300px] overflow-auto space-y-2 my-2">
            {destructiveIssues?.map((i, idx) => (
              <div
                key={idx}
                className="rounded border bg-amber-50 border-amber-200 p-2 text-xs"
              >
                <div className="font-mono text-amber-900">{i.kind ?? 'change'}</div>
                {i.path && (
                  <div className="text-amber-800 font-mono mt-0.5">{i.path}</div>
                )}
                <div className="text-amber-900 mt-1">{i.message}</div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDestructiveIssues(null)}>
              {t('engine.cancel', locale)}
            </Button>
            <Button
              variant="destructive"
              onClick={() => doSave(true)}
              disabled={saving}
            >
              {saving ? t('engine.edit.forcing', locale) : t('engine.edit.forceSave', locale)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* objectui#11773 — the draft-version conflict, apart from the
          destructive-change confirmation above: two different 409s. */}
      {draftConflictDialog}
      {/* objectui#13333 — reset / delete / discard-draft, asked in-app. */}
      <AlertDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
      >
        <AlertDialogContent data-testid="resource-edit-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription data-testid="resource-edit-confirm-body">
              {pendingConfirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="resource-edit-confirm-cancel">
              {t('engine.cancel', locale)}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="resource-edit-confirm-action"
              onClick={() => {
                const pending = pendingConfirm;
                setPendingConfirm(null);
                if (!pending) return;
                if (pending.kind === 'discard') void runDiscardDraft(pending.item);
                else void runReset(pending.kind === 'reset');
              }}
            >
              {pendingConfirm?.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

/**
 * Renders exactly one arm of `ReferencesState` — the union is the whole point
 * (objectui#5110), so the error arm is checked FIRST and there is no path from
 * a failure to the empty state's "Safe to delete."
 */
function ReferencesPanel({
  state,
  locale,
  onRetry,
}: {
  state: ReferencesState;
  locale?: string;
  onRetry: () => void;
}) {
  if (state.status === 'error') {
    return (
      <Empty data-testid="refs-error">
        <EmptyTitle className="flex items-center justify-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          {t('engine.edit.refsErrorTitle', locale)}
        </EmptyTitle>
        <EmptyDescription>
          {t('engine.edit.refsErrorDesc', locale)}
        </EmptyDescription>
        {state.message ? (
          <p
            data-testid="refs-error-cause"
            className="mt-2 max-w-full break-words font-mono text-xs text-muted-foreground"
          >
            {state.message}
          </p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          data-testid="refs-retry"
          onClick={onRetry}
        >
          {t('engine.edit.refsRetry', locale)}
        </Button>
      </Empty>
    );
  }
  if (state.status !== 'loaded') {
    return (
      <div
        data-testid="refs-scanning"
        className="text-sm text-muted-foreground flex items-center gap-2"
      >
        <Loader2 className="h-4 w-4 animate-spin" /> {t('engine.edit.refsScanning', locale)}
      </div>
    );
  }
  const refs = state.items;
  if (refs.length === 0) {
    return (
      <Empty data-testid="refs-empty">
        <EmptyTitle>{t('engine.edit.refsEmptyTitle', locale)}</EmptyTitle>
        <EmptyDescription>
          {t('engine.edit.refsEmptyDesc', locale)}
        </EmptyDescription>
      </Empty>
    );
  }
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">From type</th>
            <th className="px-3 py-2 text-left">From name</th>
            <th className="px-3 py-2 text-left">Path</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {refs.map((r, i) => (
            <tr key={i} className="hover:bg-accent/50">
              <td className="px-3 py-2">
                <Badge variant="outline" className="text-[10px] font-mono">
                  {r.fromType}
                </Badge>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{r.fromName}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {r.path}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * SaveStatusIndicator — small inline label next to the Save icon that
 * communicates auto-save state so the icon-only button is not a black
 * box. Five states:
 *   - saving      → "Saving…" with spinner
 *   - dirty + on  → "Auto-saving in 1.5s" (subtle, amber)
 *   - dirty + off → "Unsaved" (amber)
 *   - clean + ts  → "Saved 14:32" (muted)
 *   - createMode  → hidden until first save
 */
function SaveStatusIndicator({
  saving,
  isDirty,
  autoSaveEnabled,
  lastSavedAt,
  createMode,
  locale,
}: {
  saving: boolean;
  isDirty: boolean;
  autoSaveEnabled: boolean;
  lastSavedAt: Date | null;
  createMode: boolean;
  locale: 'en-US' | 'zh-CN' | string;
}) {
  // Re-render every 30s so "Saved 14:32" stays accurate without
  // requiring the caller to manage a ticker.
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!lastSavedAt) return;
    const id = window.setInterval(force, 30_000);
    return () => window.clearInterval(id);
  }, [lastSavedAt]);

  if (saving) {
    return (
      <span className="text-xs text-muted-foreground hidden md:inline-flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('engine.edit.saving', locale)}
      </span>
    );
  }
  if (isDirty) {
    if (createMode) return null;
    return (
      <span className="text-xs text-amber-600 dark:text-amber-300 hidden md:inline-flex items-center gap-1">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
        {autoSaveEnabled
          ? t('engine.edit.autoSavingShortly', locale)
          : t('engine.edit.unsaved', locale)}
      </span>
    );
  }
  if (lastSavedAt) {
    const hh = String(lastSavedAt.getHours()).padStart(2, '0');
    const mm = String(lastSavedAt.getMinutes()).padStart(2, '0');
    return (
      <span className="text-xs text-muted-foreground hidden md:inline-flex items-center gap-1">
        {tFormat('engine.edit.savedAt', locale, { time: `${hh}:${mm}` })}
      </span>
    );
  }
  return null;
}
