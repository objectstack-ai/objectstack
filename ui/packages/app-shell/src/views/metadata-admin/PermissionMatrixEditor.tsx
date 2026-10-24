// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PermissionMatrixEditor — custom editor for `type=permission` (Phase 3e).
 *
 * Renders the Salesforce-style matrix that lives behind a Permission
 * Set / Profile metadata item:
 *
 *   • Top section — object-level CRUD + VAMA (View All / Modify All)
 *     + lifecycle (Transfer).
 *   • Lower section — field-level R/W for the fields of any object
 *     selected from the table above.
 *
 * Data model (matches `PermissionSetSchema` in
 * `packages/spec/src/security/permission.zod.ts`):
 *
 *   {
 *     name: string,
 *     label?: string,
 *     isDefault?: boolean,   // install-time suggestion (ADR-0090 D5); Profile was removed (D2)
 *     objects: { [object_name]: ObjectPermission },
 *     fields?:  { [`${object_name}.${field_name}`]: FieldPermission },
 *     systemPermissions?: string[],
 *     tabPermissions?: Record<string, 'visible'|'hidden'|'default_on'|'default_off'>,
 *   }
 *
 * Wiring: registered from `builtinComponents.tsx` as
 *   registerMetadataResource({ type: 'permission', EditPage: PermissionMatrixEditPage })
 *
 * The component reads `/api/v1/meta/object` to enumerate available
 * objects, and reads each object's merged definition (`GET
 * /api/v1/meta/object/<name>`, whose `fields` reflect the published
 * object — inline + standalone) to enumerate that object's fields for
 * field-level permission editing. Saves through the
 * standard metadata save flow (overlay-aware, OCC, destructive-change
 * dialog already provided by the generic engine — we go through
 * client.save() directly).
 */

import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import {
  Save,
  Loader2,
  History as HistoryIcon,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Lock,
  MoreHorizontal,
  Shield,
} from 'lucide-react';
import { Button } from '@object-ui/components';
import { Badge } from '@object-ui/components';
import { Input } from '@object-ui/components';
import { Label } from '@object-ui/components';
import { Switch } from '@object-ui/components';
import { Checkbox } from '@object-ui/components';
import { cn } from '@object-ui/components';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@object-ui/components';
import { CapabilityMultiSelectField, parseCapabilityNames } from '@object-ui/fields';
import { PageShell } from './PageShell.js';
import { HistoryPanel } from './ResourceHistoryPage.js';
import { useMetadataClient, useMetadataTypes, type RichMetadataTypeEntry } from './useMetadata.js';
// objectui#11773 — the package door's draft save sends the version it was built on.
import { readDraftForSave, useDraftSaveGuard } from './DraftConflictDialog.js';
// objectui#11787 — the package door autosaves through the pillars' own autosave.
import { useDraftAutoSave, type DraftSend } from '../studio-design/useDraftAutoSave.js';
// objectui#12456 — the Studio Access pillar's presentation draws the shared item header.
import { StudioItemHeader, StudioTab } from '../studio-design/StudioItemHeader.js';
import { STUDIO_KIND_CHIP } from '../studio-design/studio-tokens.js';
import { useDisplayLocale } from '@object-ui/i18n';
import {
  t as translate,
  tFormat,
  translateMetadataType,
  translateValidationMessage,
  useMetadataLocale,
} from './i18n.js';
import { PermissionAdvancedFacets } from './PermissionAdvancedFacets.js';
import { useRegisterUnsavedEdits } from '../../chrome/unsavedEdits.js';
import { AssignedUsersSection } from './AssignedUsersSection.js';
import { isEnvironmentScope, useWalledCatalogReadOnly } from './catalog-scope.js';
import { useCanAuthorMetadata, useCanReadAuthoringTrail } from '../../hooks/useCanAuthorMetadata.js';
import { errorCodeIs } from '@object-ui/types';
import type { MetadataError } from '@object-ui/data-objectstack';
import { PermissionSetCloneDialog } from './PermissionSetCloneDialog.js';
import type { PermissionSetCloned } from './permission-set-clone.js';
import {
  mergePermissionSlice,
  scopePermissionSet,
  type ObjectPerm,
  type FieldPerm,
  type PermissionSetDraft,
} from './permission-slice.js';

/**
 * objectui#13113 — a refused save, in the author's words where the refusal
 * names an RLS policy's name.
 *
 * The server's message lists its issues by schema path and zod code
 * (`rowLevelSecurity.0.name [invalid_format]`), which the author cannot map to
 * the form. This reads the refusal's OWN issue paths (`MetadataError.issues`)
 * and words each `rowLevelSecurity.N.name` one as the input the editor shows:
 * the policy name, on row N + 1, with the door's message for what is wrong.
 * It is a display mapping of the door's answer, ⛔ not a second validator: no
 * rule of the spec is restated, and the problem text is the server's own.
 *
 * `null` when no issue names a policy name: the caller keeps today's text. When
 * other issues come with it, today's text follows the mapped lines, so nothing
 * the strip printed before is lost.
 */
const RLS_NAME_ISSUE_PATH = /^rowLevelSecurity\.(\d+)\.name$/;

function rlsNameRefusal(err: unknown, locale: string): string | null {
  const issues = (err as Partial<MetadataError> | null | undefined)?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const lines: string[] = [];
  let unmapped = 0;
  for (const issue of issues) {
    const at = RLS_NAME_ISSUE_PATH.exec(String(issue?.path ?? ''));
    if (!at) {
      unmapped += 1;
      continue;
    }
    lines.push(
      tFormat('perm.rls.nameRefused', locale, {
        row: Number(at[1]) + 1,
        problem: translateValidationMessage(issue.message, locale),
      }),
    );
  }
  if (lines.length === 0) return null;
  if (unmapped > 0) {
    const raw = (err as { message?: unknown } | null | undefined)?.message;
    lines.push(typeof raw === 'string' ? raw : String(err));
  }
  return lines.join('\n');
}

/* ────────────────────────────────────────────────────────────────── */
/* Domain shapes                                                      */
/* ────────────────────────────────────────────────────────────────── */

interface ObjectSummary {
  name: string;
  label?: string;
  /**
   * [ADR-0066 D2/④] The object's `access.default` posture. A `private`
   * object is NOT covered by a permission set's `'*'` wildcard grant —
   * access requires an explicit per-object grant (or the superuser
   * viewAllRecords/modifyAllRecords bypass). Surfaced as a row badge so
   * admins editing the matrix know a wildcard-only set does not reach it.
   */
  accessDefault?: 'public' | 'private';
  /**
   * [ADR-0090 D1] The object's authored OWD. Record-level baseline
   * context for the grants edited here: object CRUD in this matrix gates the
   * operation, the OWD decides WHICH records it reaches (own vs org-wide).
   * `owd` unset renders as the D1 fail-closed default (private).
   */
  owd?: string;
}

/**
 * Is this item backed by a **code-package artifact**? (objectui#4518, #4526)
 *
 * The client-side mirror of the server's `isArtifactBacked`
 * (metadata-protocol `protocol.ts`), asking the question the way
 * `ResourceEditPage` asks it for its own two-tier gate (its `isArtifactItem`):
 * off the SAME source, the layered envelope this editor already fetches — its
 * `code` layer and its ADR-0010 `provenance`. A non-null `code` layer alone is
 * NOT proof of a code package, and two exclusions carve out what is not one,
 * clause for clause the sibling's:
 *
 *   1. `code._packageId === 'sys_metadata'` — the save-path sentinel for a
 *      published ORG item, which also surfaces its active version in `code`.
 *      The server excludes exactly that sentinel ("`lookupArtifactItem` only
 *      returns items whose `_packageId` marks a genuine code package (the
 *      `'sys_metadata'` rehydration sentinel is excluded)"), so an
 *      org-authored set stays editable after publish.
 *   2. `provenance === 'org'` — the axis that actually separates tenant-authored
 *      content from code-shipped artifacts. The sentinel in (1) holds only on
 *      the save path: boot-time rehydration of `sys_metadata` re-registers each
 *      row under its REAL package id, so a tenant's own set reads back with a
 *      code-looking `_packageId`. With (1) alone this function called that set
 *      an artifact, and at the environment door — where `permission`'s
 *      `allowEnvironmentOverlay: false` then decides — the tenant's own matrix
 *      rendered read-only (objectui#4526). The framework fixed the same misread
 *      by asking provenance (`isTenantAuthored`, cloud#970), and the server's
 *      artifact lookup applies both exclusions.
 *
 * `provenance` describes `code` here: the server resolves it from
 * `code ?? overlay`, and `code != null` is already required. Only `'org'` is
 * carved out. `undefined` means "no opinion" (an older server, an unstamped
 * item) and keeps the artifact reading, as the sibling does; a genuine code
 * package reports `provenance: 'package'` and stays read-only unless the type
 * allows overlay.
 *
 * `null` / a failed layered read answers `false` — "no artifact known". That
 * is the fail-OPEN direction on purpose: it is what the sibling's
 * `layered?.code != null` does, it is the pre-#4518 behaviour, and a transient
 * read failure must not invent a lock. The cost is bounded and honest — the
 * save still round-trips to the server's own gate.
 *
 * ── Accepted behaviour: the single-kernel over-lock (objectui#4526) ─────────
 * The residue described at `artifactTierApplies` — on a single-kernel host the
 * server disengages its artifact tier, so an env-scope edit of a code-declared
 * set is accepted there while this editor renders it read-only — is ACCEPTED
 * as known behaviour by the maintainer-adopted ruling on objectui#4526. It
 * fails toward an honest lock, never toward a Save that 403s, and closing it
 * needs the kernel's environment topology on the client: the probe the #4518
 * ruling forbids. It is re-graded, as a NEW card, only when the client gains a
 * legitimate read of that topology (a ruling permitting the discovery probe,
 * or a `/meta` payload that carries the environment scope). This function
 * answers "does a code package ship this item", never "is the server's
 * artifact tier engaged".
 */
function isArtifactBackedLayer(
  layered: { code?: unknown; provenance?: unknown } | null | undefined,
): boolean {
  const code = layered?.code;
  if (code == null) return false;
  return (
    (code as { _packageId?: string })._packageId !== 'sys_metadata' &&
    layered?.provenance !== 'org'
  );
}

/** Localized short label for an OWD value; falls back to the raw value. */
function owdLabel(t: (k: string) => string, value: string): string {
  const key: Record<string, string> = {
    private: 'perm.owd.private',
    public_read: 'perm.owd.public_read',
    public_read_write: 'perm.owd.public_read_write',
    controlled_by_parent: 'perm.owd.controlled_by_parent',
  };
  return key[value] ? t(key[value]) : value;
}

interface FieldSummary {
  name: string;
  label?: string;
}

function getObjectActions(
  locale: string,
): Array<{ key: keyof ObjectPerm; short: string; tip: string }> {
  return [
    { key: 'allowCreate', short: 'C', tip: translate('perm.action.create', locale) },
    { key: 'allowRead', short: 'R', tip: translate('perm.action.read', locale) },
    { key: 'allowEdit', short: 'U', tip: translate('perm.action.edit', locale) },
    { key: 'allowDelete', short: 'D', tip: translate('perm.action.delete', locale) },
    { key: 'allowTransfer', short: 'Tr', tip: translate('perm.action.transfer', locale) },
    // No `Re` (allowRestore) / `Pu` (allowPurge) columns: both keys are retired
    // (objectui#6595 — see the tombstone on `ObjectPerm` in `permission-slice`
    // for the full account and the M2 return path on objectstack#1883). They
    // gated ObjectQL operations that have never existed, so every tick was a
    // grant no runtime read. `allowTransfer` is enforced upstream and stays.
    { key: 'viewAllRecords', short: 'VA', tip: translate('perm.action.viewAll', locale) },
    { key: 'modifyAllRecords', short: 'MA', tip: translate('perm.action.modifyAll', locale) },
  ];
}

/**
 * objectui#12456 — the five tabs of the Studio Access pillar's permission-set
 * page (epic objectui#12446, decision C): each holds one of the sections the
 * routed page stacks in one column.
 */
export type PermissionStudioTab = 'objects' | 'capabilities' | 'rls' | 'tabs' | 'admin';

export const PERMISSION_STUDIO_TABS: ReadonlyArray<{ key: PermissionStudioTab; labelKey: string }> = [
  { key: 'objects', labelKey: 'engine.studio.access.tab.objects' },
  { key: 'capabilities', labelKey: 'engine.studio.access.tab.capabilities' },
  { key: 'rls', labelKey: 'engine.studio.access.tab.rls' },
  { key: 'tabs', labelKey: 'engine.studio.access.tab.tabs' },
  { key: 'admin', labelKey: 'engine.studio.access.tab.admin' },
];

/** What the Studio Access pillar hands the page for its tabbed presentation. */
export interface PermissionStudioChrome {
  /** The open tab; the pillar holds it (default `objects`). */
  tab: PermissionStudioTab;
  onTabChange: (tab: PermissionStudioTab) => void;
  /** Before the header's icon tile (the pillar's mobile rail toggle). */
  leading?: React.ReactNode;
  /** The pillar's draft / read-only note, at the right end of the tab row. */
  chips?: React.ReactNode;
  /** Before History in the header's actions (the pillar's Explain access). */
  actions?: React.ReactNode;
}

export interface PermissionMatrixEditPageProps {
  type: string;
  name: string;
  /**
   * When set, the matrix is scoped to a single package (ADR-0086 P0): it lists
   * only the objects that package declares, and Save merges just that slice
   * back — other packages' contributed rows are left untouched. When omitted,
   * the matrix operates at environment scope (all objects, whole-record save).
   */
  packageId?: string;
  /**
   * ADR-0086 P2 (D6/D7 — the package door). When editing under a `packageId`,
   * a permission set is package **metadata**: an edit is autosaved to a
   * **draft** (not a live record), published atomically with the rest of the
   * package, the way the Data and Interfaces pillars save (objectui#11787).
   * `onDraftSaved` notifies the surface so its pending-changes counter
   * refreshes; `publishNonce` bumps on publish so the editor re-reads the
   * now-published baseline (its draft is gone). Both are no-ops at environment
   * scope, where the explicit Save stays and writes live config (D7).
   */
  onDraftSaved?: () => void;
  publishNonce?: number;
  /**
   * objectui#2505 — when provided, the per-object OWD badge becomes a link that
   * opens the package-level Record Sharing Baseline (OWD) overview, scrolled to
   * that object. Set only by the Studio Access pillar (which hosts the sibling
   * overview surface); omitted at environment scope / metadata-admin, where the
   * badge stays a plain read-only chip.
   */
  onOpenOwd?: (objectName: string) => void;
  /**
   * Fires on every unsaved-edit transition (false → true → false). The Studio
   * Access pillar keys this page per set (`key={name}`) and swaps it out for
   * the OWD overview, so the HOST must know before a surface switch whether a
   * remount would discard edits. Reset to `false` on unmount so a discarded
   * editor never leaves the host thinking edits are still pending.
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Host-level read-only gate — set by the Studio Access pillar when the
   * surrounding PACKAGE is read-only. Independent of the TYPE-level
   * `allowEnvironmentOverlay` writability: either gate locks the matrix (checkboxes,
   * bulk buttons, name/label, facets), hides Save, and shows the read-only
   * badge — the badge hint names the package as the reason when this gate
   * is the one that tripped.
   */
  readOnly?: boolean;
  /**
   * When true, the editor is hosted inside another surface (the Studio Access
   * pillar) rather than the routed metadata admin. Relative navigation would
   * resolve against the HOST's route (`/studio/:packageId/access/...`), where
   * the metadata-admin routes don't exist — so History opens as an in-place
   * sheet instead of navigating, and the PageShell breadcrumb loses its
   * `/metadata` links (same rule as MetadataResourceEditPage's `embedded`).
   */
  embedded?: boolean;
  /**
   * objectui#12456 — the Studio Access pillar's presentation (set with
   * `embedded`). The page draws the Studio item header (the set's label, api
   * name, Package chip, granted / override counts, History and a more menu
   * holding the name / label editor) instead of the PageShell breadcrumb,
   * badge row and collapsible set header, and splits its sections into five
   * tabs, all kept mounted. Presentation only: every write, gate and autosave
   * is the routed page's. Omitted (Setup's permission page): unchanged.
   */
  studio?: PermissionStudioChrome;
}

/* ────────────────────────────────────────────────────────────────── */
/* Component                                                          */
/* ────────────────────────────────────────────────────────────────── */

export function PermissionMatrixEditPage({ type, name, packageId, onDraftSaved, publishNonce, onOpenOwd, onDirtyChange, readOnly = false, embedded = false, studio }: PermissionMatrixEditPageProps) {
  const navigate = useNavigate();
  const client = useMetadataClient();
  // The editor reads no record: the capability picker lists the capability
  // registry through the console metadata store (objectui#7611,
  // `CapabilityMultiSelectField`), and "Clone to customize" calls the server's
  // clone door with a name and a label (`PermissionSetCloneDialog.tsx`,
  // `permission-set-clone.ts`).
  const { entries } = useMetadataTypes(client);
  const entry: RichMetadataTypeEntry | undefined = entries.find((t) => t.type === type);
  // Does a code package SHIP this set? Read off the layered envelope the load
  // effect below already fetches, via {@link isArtifactBackedLayer}. Starts
  // `false` ("no artifact known") and is re-derived on every load, so a slow or
  // failed read never invents a lock — see the helper's doc (objectui#4518).
  const [codeIsArtifact, setCodeIsArtifact] = React.useState(false);
  // The server's own write verdict for THIS set: `editable`, the ADR-0010
  // protection envelope of the same layered read. `undefined` until a load
  // lands, after a failed read, and from a server that sends none: "no
  // opinion". Read by the artifact tier below (objectui#12169).
  const [servedEditable, setServedEditable] = React.useState<boolean | undefined>(undefined);
  // Three independent read-only gates, and each reads the fact that actually
  // governs it (objectui#4446, #4518):
  //
  //  • TYPE gate — the metadata type must offer SOME runtime write channel.
  //    That is the DISJUNCTION `allowEnvironmentOverlay || allowRuntimeCreate`, not
  //    `allowEnvironmentOverlay` alone: those are two different doors, and this
  //    editor's Save goes through the second one. `allowEnvironmentOverlay` is
  //    permission to OVERLAY a code-shipped item per org; `allowRuntimeCreate`
  //    is permission to author an item at runtime — which is what a save under
  //    a `packageId` does (`mode: 'draft'` + `packageId`, ADR-0086 P0/P2).
  //    The server's own gate is that same disjunction: `saveMetaItem` and
  //    `promoteDraftForPublish` refuse only when BOTH are false
  //    (`!isOverlayAllowed && !isRuntimeCreateAllowed`, metadata-protocol
  //    `protocol.ts`). Gating on `allowEnvironmentOverlay` alone therefore locked a
  //    surface the server accepts: `permission` is `allowEnvironmentOverlay: false`
  //    (ADR-0005 forbids per-org overlay of a packaged permission set — silent
  //    privilege drift) but `allowRuntimeCreate: true`, and objectstack `ee58392e1`
  //    kept that second door open on purpose ("Runtime-created sets … ride
  //    `allowRuntimeCreate` (still `true`) and keep working").
  //    `useMetadata.ts` states the convention on the field itself: "UI
  //    affordances ('+ New', Save, Delete on DB-only items) should activate
  //    when either flag is true" — `DirectoryPage`'s `writableCount` and its
  //    "Writable only" filter, `EmbeddedItemEditor`'s `readOnly` and
  //    `ResourceEditPage`'s `canWriteByType` all already read it that way. Read the raw
  //    server `entry` like they do; `resolveResourceConfig` forwards
  //    `allowEnvironmentOverlay` ONLY, so a `resolved.allowRuntimeCreate` would be
  //    silently `undefined`.
  //
  //  • ARTIFACT gate — the server's SECOND tier, added by objectui#4518. See
  //    the block below the state declaration for why the type tier alone is
  //    not the whole gate.
  //
  //  • HOST gate — the package-level `readOnly` prop the Studio Access pillar
  //    passes for a read-only package. UNCHANGED and still dominant: this is
  //    the "Studio 维持包级只读" half of the objectstack#5768 ruling, and a
  //    code-defined package stays locked here exactly as before.
  //
  // Any of the three locks every authoring affordance below.
  //
  // ── The ARTIFACT tier (objectui#4518) ─────────────────────────────────────
  //
  // The server's metadata write gate is TWO tiers, and #4446 modelled only the
  // first. `saveMetaItem` refuses a second time, AFTER the type-tier
  // disjunction above has already passed (metadata-protocol `protocol.ts`):
  //
  //     if (this.environmentId !== undefined) {
  //         const artifactBacked = this.isArtifactBacked(request.type, request.name);
  //         if (artifactBacked && !overlayAllowed) { … status 403 not_overridable }
  //     }
  //
  // So for an item a code package SHIPS, `allowRuntimeCreate` is not enough —
  // overwriting it is an OVERLAY, and overlaying needs `allowEnvironmentOverlay`. The
  // method's own doc states the split: "overlaying a packaged item" (requires
  // `allowEnvironmentOverlay`) vs "authoring a DB-only item" (requires only
  // `allowRuntimeCreate`). `permission` sits exactly in the gap — `false` /
  // `true` — so without this tier the matrix offered live checkboxes and a Save
  // button that failed at the end with a 403 instead of a surface that explains
  // itself up front.
  //
  // `ResourceEditPage` has modelled both tiers all along; this is that same
  // three-way rule, with the same artifact predicate — the `sys_metadata`
  // sentinel AND ADR-0010 `provenance` (see {@link isArtifactBackedLayer},
  // objectui#4526) — read off the layered envelope this editor ALREADY
  // fetches. No new probe — the ruling on #4518 forbids one, and the entry
  // flags plus `layered.code` and `layered.provenance` are the whole input.
  //
  // ── …scoped to the environment door, which is the binding constraint ──────
  //
  // The server's artifact tier is `environmentId !== undefined`-scoped, and a
  // client cannot see that key: it is a SERVER-side row-scoping property of the
  // kernel (`ObjectStackProtocolImplementation.environmentId`), the console
  // never passes one to `useMetadataClient`, and `MetadataClient` bakes it into
  // a private base URL. The only place it is readable is `GET /discovery` — a
  // new probe, which is exactly what was ruled out.
  //
  // The condition used instead is the one the filing itself names, and it is a
  // fact this component already holds: `packageId`. Under a `packageId` the
  // write is a package-door DRAFT (ADR-0086 P0/P2) and the measured behaviour
  // is 200 — that is the #4446 headline case (a code-declared set on the
  // single-kernel showcase, `PUT …/permission/<n>?package=<pkg>` → 200), which
  // this must NOT re-lock. It also cannot: under a `packageId` a code-defined
  // package already arrives with the host `readOnly` prop set, so the artifact
  // case is covered there by a gate that dominates anyway. The one uncovered
  // surface — the metadata-admin route at environment scope — is precisely
  // where this engages.
  //
  // Known, deliberate residue (reported with the fix, not hidden): on a SINGLE
  // kernel the server disengages its artifact tier entirely, so an env-scope
  // edit of a code-declared set there would be accepted (200) while this
  // renders read-only. That is the conservative direction — an honest lock
  // rather than a Save that 403s — and closing it would need the kernel's
  // environment topology on the client, i.e. the probe the ruling forbids.
  //
  // ── …and the item's own answer, which the type flag cannot give ───────────
  //
  // objectui#12169 — `allowEnvironmentOverlay` answers for the TYPE. ADR-0131
  // D6 seals managed content: the `OS_METADATA_WRITABLE` hatch opens a type's
  // sets that no package ships and never a set a package ships, so on a
  // hatch-elevated type the flag is true and the server still refuses this
  // set's environment-scope write (403 `NOT_OVERRIDABLE`). The server says so
  // on the layered read, per set: its `editable` (objectstack
  // `servedLockState`, through the seal predicate the write door asks). So the
  // artifact arm opens only where the server's answer does not refuse it.
  // ⛔ No read of `overrideSource` here: telling the hatch from the registry
  // opt-in would be a client copy of the seal rule. `undefined` keeps the
  // flag's answer, as before.
  const artifactTierApplies = !packageId && codeIsArtifact;
  // The set's provenance, for the page badge and the Studio kind chip alike:
  // a package ships it (the package door's `packageId`, or the layered
  // envelope's code artifact), else it was authored in this environment. Spec
  // 18 retired the authored `managedBy` (objectstack#23891), and no served
  // datum names a "platform" set, so there are two answers (objectui#12753).
  const shippedByPackage = !!packageId || codeIsArtifact;
  const artifactArmOpen = !!entry?.allowEnvironmentOverlay && servedEditable !== false;
  const typeTierOpen = !!(entry?.allowEnvironmentOverlay || entry?.allowRuntimeCreate);
  const canWriteByType = artifactTierApplies ? artifactArmOpen : typeTierOpen;
  // objectui#7611 — the fourth gate, the CALLER: the metadata door refuses a
  // save without `manage_metadata` (measured on objectstack main: 403 "Saving a
  // metadata item requires the `manage_metadata` capability."), and so does the
  // clone door, which asks the same verdict (`metaWriteCapabilityVerdict`), so
  // a caller without it is offered no clone. Unknown fails open
  // (`useCanAuthorMetadata`); the door then answers 403, shown as sent. Its
  // reason is named in the body below.
  const canAuthor = useCanAuthorMetadata();
  // objectui#12475 — History reads the authoring-trail door, which
  // objectstack#23546 narrowed to `studio.access` / `manage_metadata`: a
  // `setup.access`-only caller is offered no History. Unknown fails open.
  const canReadTrail = useCanReadAuthoringTrail();
  // objectui#12183 — and under a wall the security catalog is the platform
  // operator's: the `/meta` doors and the clone door refuse a non-operator's
  // write of a permission set, `manage_metadata` or not (objectstack ADR-0131
  // D3, `catalog-scope.ts`), the package door's drafts included. The wall is
  // the gate to NAME where the host and the type would otherwise admit it.
  const walled = useWalledCatalogReadOnly(type);
  const walledReadOnly = walled && !readOnly && typeTierOpen;
  const writable = canWriteByType && !readOnly && canAuthor && !walled;
  // objectui#7611 — does the server hold this set at all? `false` only when the
  // layered read answered the not-found shape (no effective, code or overlay
  // layer): a name nobody has saved yet, which this editor's first Save creates.
  // `null` until a load lands, and after a failed read, which says nothing.
  const [existsOnServer, setExistsOnServer] = React.useState<boolean | null>(null);
  // objectui#7611 — the Setup catalog (`?scope=environment`) shows who holds the
  // set under its definition; Studio's design surface does not. Nor does a set
  // the server does not hold yet: a grant names a set that exists, so Add there
  // could only be refused (400), and there is nobody to list.
  const [searchParams] = useSearchParams();
  const showAssignments = !embedded && isEnvironmentScope(searchParams) && existsOnServer !== false;
  // Which gate to NAME when the surface is locked (host > artifact > type).
  // The artifact tier is the DECIDING one only where the type tier would have
  // said yes: with both flags false the honest reason is still "this type has
  // no runtime write channel at all", which is also the refusal the server
  // reaches first (`!overlayAllowed && !runtimeCreateAllowed`).
  // Not under a wall: its remedy, the clone, is a catalog write the clone door
  // refuses a tenant there (objectui#12183).
  const lockedByArtifactTier = artifactTierApplies && !artifactArmOpen && typeTierOpen && canAuthor && !walled;
  const locale = useMetadataLocale();
  const t = React.useCallback((k: string) => translate(k, locale), [locale]);
  const OBJECT_ACTIONS = React.useMemo(() => getObjectActions(locale), [locale]);

  const [draft, setDraft] = React.useState<PermissionSetDraft>({
    name,
    objects: {},
    fields: {},
  });
  // Snapshot of the last loaded/saved draft — the anchor `isDirty` compares
  // against. `null` until the first load lands (nothing to be dirty against).
  const baselineRef = React.useRef<string | null>(null);
  /** Set the draft AND re-anchor the dirty baseline to it (load + post-save). */
  const resetDraftBaseline = React.useCallback((next: PermissionSetDraft) => {
    try {
      baselineRef.current = JSON.stringify(next);
    } catch {
      baselineRef.current = null;
    }
    // objectui#9484 — a fresh identity, ALWAYS. `isDirty` below is a `useMemo`
    // keyed on `draft`, while the anchor it reads lives in a ref: hand
    // `setDraft` the object that is already the draft and React bails out on
    // `Object.is`, the memo never recomputes, and the moved anchor is never
    // read — the editor keeps reporting dirty against a baseline that already
    // says clean. Measured on the environment door's post-save re-read
    // rejection, where the re-anchor falls back to the saved body, which IS
    // `draft`; the copy is what makes re-anchoring observable at all. Shallow
    // is enough: the anchor is a JSON snapshot, so a copy is anchor-identical.
    setDraft({ ...next });
  }, []);
  // objectui#11773 — the pin of the row the package door's draft was built on
  // (the load's draft read, then each save's receipt), sent by its next draft
  // save. A conflict's "reload" re-runs the load.
  const [reloadNonce, setReloadNonce] = React.useState(0);
  const reloadSet = React.useCallback(() => setReloadNonce((n) => n + 1), []);
  const {
    save: saveVersioned,
    recordRead: recordSetRead,
    forget: forgetSetVersion,
    dialog: draftConflictDialog,
  } = useDraftSaveGuard(client, reloadSet);
  const [objects, setObjects] = React.useState<ObjectSummary[]>([]);
  const [fieldsByObject, setFieldsByObject] = React.useState<Record<string, FieldSummary[]>>({});
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  // objectui#11787 — when the package door's last draft save landed, for the
  // status line that replaces its Save button ("Saved 10:42").
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const displayLocale = useDisplayLocale();
  const [error, setError] = React.useState<string | null>(null);
  // objectui#9484 — the ENVIRONMENT door's post-save baseline re-read REJECTED.
  // The write itself has already landed when that read runs, so this is an
  // advisory notice about the DISPLAY being un-refreshed, and it deliberately
  // does NOT live on `error`: that strip means "your save failed", which is the
  // opposite of the truth here.
  const [postSaveRereadFailed, setPostSaveRereadFailed] = React.useState(false);
  // objectui#5987 — "Clone to customize": whether its dialog is open; the copy
  // the server reported (its name and the server's notice), shown on the copy
  // once it opens, or on this set when the host is embedded (no route to open
  // the copy on); and the env-door save the server refused as a PACKAGED set
  // (403 `NOT_OVERRIDABLE`), holding the server's message. That last one is NOT
  // `error`: the red strip renders the transport's text, which for this refusal
  // says "edit the source artifact and redeploy" — the pre-ruling remedy — so a
  // save that reached the server used to end in a generic refusal while the
  // lock's own guidance says "clone". Keyed on the refusal's CODE, never on its
  // prose.
  const [cloneOpen, setCloneOpen] = React.useState(false);
  const [cloned, setCloned] = React.useState<PermissionSetCloned | null>(null);
  const [saveRefusedAsLocked, setSaveRefusedAsLocked] = React.useState<string | null>(null);
  const [destructive, setDestructive] = React.useState<
    null | { issues: Array<{ kind?: string; path?: string; message?: string }>; pending: PermissionSetDraft }
  >(null);
  const [filter, setFilter] = React.useState('');
  const [showOnlyEnabled, setShowOnlyEnabled] = React.useState(false);
  // objectui#2600 B1 — the pillar is called "Permission Matrix", so the matrix
  // must reach the first screen. Name/label change rarely and the capability
  // picker floods the top with option chips even at zero grants, so both start
  // collapsed to a one-line summary and the user opts in to edit them.
  const [basicsOpen, setBasicsOpen] = React.useState(false);
  const [capsOpen, setCapsOpen] = React.useState(false);
  // Embedded-mode History sheet (see `embedded` prop doc).
  const [historyOpen, setHistoryOpen] = React.useState(false);
  // All permission-set api-names — the admin-scope editor's assignable
  // allowlist picks from these (ADR-0056 P3).
  const [allSetNames, setAllSetNames] = React.useState<string[]>([]);
  // objectui#11799 — the same published read, held for the load below: a set
  // it does not list has never been published. The load runs after this
  // effect, so it reads this request rather than sending one of its own.
  const publishedSetsRef = React.useRef<Promise<Array<{ name?: string }>> | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const published = client.list<{ name?: string }>('permission', {});
    publishedSetsRef.current = published;
    published
      .then((rows) => {
        if (!cancelled)
          setAllSetNames(
            (rows || []).map((r) => r?.name).filter((n): n is string => !!n),
          );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  /* ── Load draft + object catalog ───────────────────────────── */
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Re-derived from the envelope below. Cleared here so a switch to another
    // set can never carry the previous one's artifact verdict for a frame
    // (objectui#4518).
    setCodeIsArtifact(false);
    setServedEditable(undefined);
    setExistsOnServer(null);
    // Same reason: a notice raised by the previous set's save must not survive
    // into a set that is about to be read fresh (objectui#9484).
    setPostSaveRereadFailed(false);
    // Same reason again (objectui#5987): a refusal belongs to the set that
    // raised it, and a clone notice to the copy it reports — kept only while
    // that copy is the set being opened (the routed hop to it).
    setSaveRefusedAsLocked(null);
    setCloned((c) => (c && c.name === name ? c : null));
    (async () => {
      try {
        // ADR-0086 P2 (D6): under the package door a set is draft/published
        // metadata, so surface the PENDING draft if one exists — otherwise a
        // just-saved-not-yet-published edit would appear lost on reopen. Draft
        // reads return the `{ type, name, item }` envelope; `null` = no draft.
        // objectui#11773 — read at the package door's save address, with the
        // pin it serves for that address (the package door's draft save).
        const draftReadForSave = packageId
          ? readDraftForSave<{ item?: PermissionSetDraft } | PermissionSetDraft>(client, type, name, packageId)
          : Promise.resolve(null);
        const draftRead = draftReadForSave.then((read) => read?.answer ?? null);
        const readLayered = () => client.layered<PermissionSetDraft>(type, name).catch(() => null);
        // objectui#11799 — a set "+ New" created and nobody published has a
        // draft and no layer, and `GET …/layers` answers 404 for it. Under the
        // package door the layered envelope is used only without a pending
        // draft: the draft wins for display, and the artifact tier it also
        // feeds applies at environment scope only (`artifactTierApplies`). So
        // a set the published list above does not hold is not asked while its
        // draft is in hand. A listed set, a set with no draft and every
        // environment-scope read are read as before; an unreadable list says
        // nothing, and the set is read as before too. The list is the one read
        // with this editor: a set published since has no draft (a publish
        // drains it), so it is read again here.
        const publishedSets = publishedSetsRef.current;
        const neverPublished =
          packageId && type === 'permission' && publishedSets
            ? publishedSets.then((rows) => !(rows || []).some((r) => r?.name === name), () => false)
            : Promise.resolve(false);
        const [lay, objList, pendingRead] = await Promise.all([
          packageId
            ? neverPublished.then((unlisted) =>
                unlisted ? draftRead.then((d) => (d ? null : readLayered())) : readLayered(),
              )
            : readLayered(),
          // In package scope, list only the objects this package declares
          // (ADR-0086 P0) — otherwise the whole environment leaks into the panel.
          client.list<any>('object', packageId ? { packageId } : {}).catch(() => []),
          draftReadForSave,
        ]);
        if (cancelled) return;
        const pendingDraft = pendingRead?.answer ?? null;
        // ARTIFACT tier input (objectui#4518) — the `code` layer, and its
        // `provenance` (objectui#4526), of the SAME envelope the display
        // baseline comes from, so the writability verdict and the body on
        // screen can never be read from different round trips.
        setCodeIsArtifact(isArtifactBackedLayer(lay));
        // objectui#12169 — and the server's write verdict for the set, off the
        // same envelope (`null` from a failed read says nothing).
        setServedEditable(lay?.editable);
        // objectui#7611 — `MetadataClient.layered` answers a 404 as an envelope
        // with every layer null; a rejected read was caught to `null` above and
        // decides nothing.
        setExistsOnServer(lay ? lay.effective != null || lay.code != null || lay.overlay != null : null);
        // Read decorations do NOT seed the editor (objectui#8181). `doSave`
        // below re-bases on a fresh RAW `layered` read, which drops them — but
        // its `.catch(() => null)` arm falls back to this very body and
        // spreads it into `client.save`, so a failed layered read used to put
        // `_diagnostics` / `_draft` on the wire. Strip at the unwrap, which is
        // the one place the served envelope becomes an editable draft.
        const draftBody = pendingDraft
          ? (stripReadDecorations(
              (pendingDraft as any).item ?? pendingDraft,
            ) as PermissionSetDraft)
          : null;
        // Draft wins over the published baseline for display (D6).
        const effective: PermissionSetDraft = (draftBody ?? lay?.effective ??
          lay?.code ?? { name, objects: {} }) as PermissionSetDraft;
        const list: ObjectSummary[] = ((objList as any[]) ?? [])
          .map((row) => {
            const item = row?.item ?? row;
            return {
              name: String(item?.name ?? ''),
              label: item?.label,
              accessDefault: item?.access?.default as ObjectSummary['accessDefault'],
              owd: typeof item?.sharingModel === 'string' ? item.sharingModel : undefined,
            };
          })
          .filter((o) => !!o.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        setObjects(list);
        const full: PermissionSetDraft = {
          ...effective,
          name: String(effective?.name ?? name),
          objects: effective?.objects ?? {},
          fields: effective?.fields ?? {},
        };
        // Package scope: only surface this package's slice for editing; rows
        // contributed by other packages stay off-screen and are re-merged on
        // Save from a fresh read (see doSave).
        if (packageId) {
          const sliced = scopePermissionSet(full, list.map((o) => o.name));
          resetDraftBaseline({ ...full, objects: sliced.objects, fields: sliced.fields });
        } else {
          resetDraftBaseline(full);
        }
        // objectui#11773 — the package door's next draft save is pinned to what
        // the draft read served. The environment door reads no draft and its
        // live write is not pinned.
        if (pendingRead && packageId) recordSetRead(type, name, packageId, pendingRead.pin);
        else forgetSetVersion();
      } catch (err: any) {
        setError(err?.message ?? String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, type, name, packageId, publishNonce, resetDraftBaseline, reloadNonce, recordSetRead, forgetSetVersion]);

  /* ── Lazy-load fields when an object is expanded ─────────── */
  async function ensureFields(objectName: string) {
    if (fieldsByObject[objectName]) return;
    try {
      // Read the authoritative, merged object definition (same source the
      // object settings tab uses for its nameField dropdown). The `field`
      // LIST endpoint only surfaces standalone/code-package field metadata
      // and misses fields carried inline on a published object, which left
      // this editor showing "no fields" for objects that clearly have them.
      // `fields` may come back as an array or as a `{ [name]: def }` map.
      const obj = (await client.get<any>('object', objectName)) as
        | { fields?: Record<string, any> | Array<any> }
        | null;
      const raw = obj?.fields;
      const list: FieldSummary[] = (
        Array.isArray(raw)
          ? raw.map((f: any) => ({ name: String(f?.name ?? ''), label: f?.label }))
          : raw && typeof raw === 'object'
            ? Object.entries(raw).map(([name, f]: [string, any]) => ({
                name: String(f?.name ?? name),
                label: f?.label,
              }))
            : []
      )
        .filter((f) => !!f.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      setFieldsByObject((prev) => ({ ...prev, [objectName]: list }));
    } catch {
      setFieldsByObject((prev) => ({ ...prev, [objectName]: [] }));
    }
  }

  /**
   * Resolve a policy object's field NAMES for the RLS CEL editor
   * (objectui#2413) — powers field lint + autocomplete. Reads the merged object
   * definition like {@link ensureFields}; the facets cache the result per object.
   */
  const loadObjectFields = React.useCallback(
    async (objectName: string): Promise<string[]> => {
      try {
        const obj = (await client.get<any>('object', objectName)) as
          | { fields?: Record<string, any> | Array<any> }
          | null;
        const raw = obj?.fields;
        const names = (
          Array.isArray(raw)
            ? raw.map((f: any) => String(f?.name ?? ''))
            : raw && typeof raw === 'object'
              ? Object.entries(raw).map(([name, f]: [string, any]) => String((f as any)?.name ?? name))
              : []
        ).filter(Boolean);
        return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
      } catch {
        return [];
      }
    },
    [client],
  );

  // Count of blocking CEL parse errors in the RLS editor — gates Save
  // (objectui#2413): a malformed predicate silently mis-scopes rows, so we
  // don't let it persist.
  const [celErrorCount, setCelErrorCount] = React.useState(0);
  // objectui#13113 — RLS rows with no name yet ("Add policy" inserts one
  // blank). Incomplete, not wrong: like a CEL error, they hold the save, and
  // each row says beside itself what it needs (`policyNamed` in
  // `PermissionAdvancedFacets`, the same emptiness test). Read from the draft
  // itself, so the hold moves with the very edit that adds or names a row.
  // Emptiness only: ⛔ the spec's name format is not restated; a non-empty name
  // the server refuses is sent, and its refusal worded (`rlsNameRefusal`).
  const rlsUnnamedCount = (Array.isArray(draft.rowLevelSecurity) ? draft.rowLevelSecurity : []).filter(
    (p) => {
      const n = (p as { name?: unknown } | null)?.name;
      return !(typeof n === 'string' && n.trim() !== '');
    },
  ).length;
  const saveHeld = celErrorCount > 0 || rlsUnnamedCount > 0;

  // Dirty detection — cheap JSON snapshot comparison against the last
  // loaded/saved baseline (same approach as ResourceEditPage). Every mutation
  // funnels through setDraft (matrix checkboxes, header inputs, capabilities,
  // advanced facets), so comparing the draft covers them all.
  const isDirty = React.useMemo(() => {
    const snap = baselineRef.current;
    if (snap == null) return false;
    try {
      return JSON.stringify(draft) !== snap;
    } catch {
      return false;
    }
  }, [draft]);

  // Report dirty transitions to the host (see onDirtyChange). Ref-stabilized
  // so a non-memoized callback prop doesn't refire the effect; the unmount
  // cleanup reports `false` so a deliberately-discarded editor clears the
  // host's guard state.
  const onDirtyChangeRef = React.useRef(onDirtyChange);
  React.useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });
  React.useEffect(() => {
    onDirtyChangeRef.current?.(isDirty);
  }, [isDirty]);
  React.useEffect(
    () => () => {
      onDirtyChangeRef.current?.(false);
    },
    [],
  );

  // Browser-native "leave site?" prompt on tab close / reload with unsaved
  // matrix edits — same guard ResourceEditPage installs.
  React.useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Required for Chrome to actually show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
  // objectui#13253 — the shell's own departures (header menus, palette, inbox,
  // AI entry) navigate from buttons, which neither guard above sees. While the
  // matrix holds edits it registers them with the shell's seam, with the
  // question its hosts already ask before dropping them.
  useRegisterUnsavedEdits(isDirty, translate('engine.edit.unsavedLeaveConfirm', locale));

  function toggleExpand(objectName: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(objectName)) next.delete(objectName);
      else {
        next.add(objectName);
        ensureFields(objectName);
      }
      return next;
    });
  }

  /* ── Mutators ───────────────────────────────────────────── */
  function updateObjectPerm(objectName: string, action: keyof ObjectPerm, value: boolean) {
    setDraft((prev) => {
      const cur = prev.objects[objectName] ?? {};
      const nextObj: ObjectPerm = { ...cur, [action]: value };
      // Cascade: viewAllRecords implies allowRead.
      if (action === 'viewAllRecords' && value) nextObj.allowRead = true;
      if (action === 'modifyAllRecords' && value) {
        nextObj.allowEdit = true;
        nextObj.allowRead = true;
      }
      return {
        ...prev,
        objects: { ...prev.objects, [objectName]: nextObj },
      };
    });
  }

  function bulkSetObject(objectName: string, action: 'all' | 'none' | 'crud' | 'read') {
    setDraft((prev) => {
      // `none` REPLACES the row with `{}` — deliberately, unlike the three
      // granting arms below (#6605). The defect those arms had was a GRANT
      // that silently dropped a narrowing: "All" deleting a `readScope: 'own'`
      // widens effective read access with no diff and no error. `none` grants
      // nothing, so nothing survives for a scope to narrow; merging here would
      // instead leave `allowExport: true` (and the scopes) alive after a click
      // on the button labelled "None" — a permissive outcome that does not
      // exist today. What an admin's "None" means is a behaviour decision, not
      // a mechanical merge; pinned by
      // `PermissionMatrixEditor.bulkMergeKeys.test.tsx`.
      if (action === 'none') {
        return { ...prev, objects: { ...prev.objects, [objectName]: {} } };
      }
      // The granting arms MERGE (#6605): start from the current row, reset the
      // keys this matrix authors (`OBJECT_ACTIONS`), then set the granted
      // ones. Keys the matrix does not model — `allowExport`, `readScope`,
      // `writeScope`, anything an older or newer editor wrote — ride through
      // exactly as they do on the per-checkbox path (`updateObjectPerm`'s
      // spread). Replacing the row wholesale is what silently deleted them,
      // and both save doors persist the row as-is: the environment door writes
      // the whole record, and at package scope `mergePermissionSlice` takes
      // in-scope rows entirely from `edited` (ADR-0086 P0), so `base` cannot
      // restore what a bulk click dropped.
      const cur = prev.objects[objectName] ?? {};
      const next: ObjectPerm = { ...cur };
      for (const a of OBJECT_ACTIONS) delete next[a.key];
      const grants: Array<keyof ObjectPerm> =
        action === 'all'
          ? OBJECT_ACTIONS.map((a) => a.key)
          : action === 'crud'
          ? ['allowCreate', 'allowRead', 'allowEdit', 'allowDelete']
          : ['allowRead'];
      for (const key of grants) next[key] = true;
      return {
        ...prev,
        objects: { ...prev.objects, [objectName]: next },
      };
    });
  }

  function updateFieldPerm(objectName: string, fieldName: string, action: keyof FieldPerm, value: boolean) {
    const key = `${objectName}.${fieldName}`;
    setDraft((prev) => {
      const fields = { ...(prev.fields ?? {}) };
      const cur = fields[key] ?? { readable: true, editable: false };
      const next: FieldPerm = { ...cur, [action]: value };
      // Cascade: !readable implies !editable.
      if (action === 'readable' && !value) next.editable = false;
      // Cascade: editable implies readable.
      if (action === 'editable' && value) next.readable = true;
      fields[key] = next;
      return { ...prev, fields };
    });
  }

  // objectui#2600 B4 — field-level bulk over the fields currently VISIBLE in the
  // sub-table (i.e. after the field filter), mirroring the per-object row's
  // read/all/none shortcuts. `readable` sets read-only, `writable` grants R+W,
  // `clear` drops the explicit overrides so those fields fall back to default.
  function bulkSetFields(objectName: string, action: 'readable' | 'writable' | 'clear', fieldNames: string[]) {
    if (fieldNames.length === 0) return;
    setDraft((prev) => {
      const fields = { ...(prev.fields ?? {}) };
      for (const fieldName of fieldNames) {
        const key = `${objectName}.${fieldName}`;
        if (action === 'clear') delete fields[key];
        else if (action === 'readable') fields[key] = { readable: true, editable: false };
        else fields[key] = { readable: true, editable: true };
      }
      return { ...prev, fields };
    });
  }

  /**
   * Re-narrow a freshly-read full permission set to this package's slice for
   * display. No-op at environment scope (no `packageId`).
   */
  function toDisplayDraft(set: PermissionSetDraft): PermissionSetDraft {
    if (!packageId) return set;
    const sliced = scopePermissionSet(set, objects.map((o) => o.name));
    return { ...set, objects: sliced.objects, fields: sliced.fields };
  }

  /* ── Save ────────────────────────────────────────────────── */
  /**
   * `sent` is the autosave's claim on the buffer it sent (objectui#11787, the
   * package door only); the environment door's Save and the destructive
   * dialog's force-save pass none.
   */
  async function doSave(force: boolean, pending?: PermissionSetDraft, sent?: DraftSend) {
    const payload = pending ?? draft;
    setSaving(true);
    setError(null);
    setPostSaveRereadFailed(false);
    setSaveRefusedAsLocked(null);
    try {
      // Package scope: merge only this package's slice back onto a fresh read
      // of the record so rows contributed by other packages survive byte-for-
      // byte (ADR-0086 P0). Environment scope keeps the whole-record save.
      let toSave = payload;
      if (packageId) {
        const scope = objects.map((o) => o.name);
        // objectui#9420 — the guarantee above is only KEEPABLE with a fresh
        // read in hand, so a REJECTED re-read refuses the save instead of
        // falling back to `payload`. The load path already narrowed `payload`
        // down to this package's objects, so `mergePermissionSlice` would have
        // no out-of-scope rows left to copy and the PUT would DELETE every
        // other package's contributed rows — 200, no error, no warning, on a
        // security surface. A save that cannot keep the promise IS the defect,
        // not a degraded form of the fix; the information needed to preserve
        // those rows is simply not in hand.
        //
        // ⚠️ Only a REJECTION refuses. A record the server does not hold
        // answers the 404 shape, which `MetadataClient.layered` resolves as
        // `{ effective: null, … }` — that arm keeps the `?? payload` base on
        // purpose: a set that exists only as a package draft (what the Studio
        // Access pillar's "+ New" creates) has no published rows for anyone to
        // lose, and refusing there would block its first save.
        let rereadFailed = false;
        const fresh = await client
          .layered<PermissionSetDraft>(type, payload.name)
          // Kept on `.catch` so the rejection can never escape as an unhandled
          // one; the refusal is raised below, inside this `try`'s own body, and
          // reaches the author on the same error channel a failed
          // `client.save` already uses.
          .catch(() => {
            rereadFailed = true;
            return null;
          });
        if (rereadFailed) throw new Error(t('perm.save.rereadFailed'));
        const base = (fresh?.effective ?? payload) as PermissionSetDraft;
        toSave = mergePermissionSlice(base, payload, scope);
      }
      // ADR-0086 P2 (D6/D7). Package door → the set is metadata: write a DRAFT
      // (stamped with `packageId`) that the package's atomic Publish promotes,
      // exactly like the Data/Interfaces pillars — NOT a live record write.
      // Environment door (no packageId) stays live (config).
      // objectui#11773 — the guard pins the package door's DRAFT save; the
      // environment door's live write passes through it unpinned, as before.
      // objectui#12725 — the draft names its authoring surface only under the
      // Studio host (`embedded`, the Access pillar), so a person's edit there
      // is recorded `studio`, not `api`. metadata-admin mounts this page with
      // neither `packageId` nor `embedded`, and states no surface.
      const outcome = await saveVersioned(type, payload.name, toSave, {
        force,
        ...(packageId ? { mode: 'draft' as const, packageId } : {}),
        ...(packageId && embedded ? { surface: 'studio' as const } : {}),
      });
      // The author chose the saved version; the load replaces the matrix.
      if (outcome === 'reloaded') return;
      if (packageId) {
        setSavedAt(new Date());
        if (sent && !sent.unmoved()) {
          // objectui#11787 (the objectui#11204 rule) — the author edited while
          // this autosave was in flight. Re-installing the staged body would
          // throw that edit away, so the matrix keeps it and only the anchor
          // moves to what this save sent: the edit stays dirty, and the
          // autosave sends it next. The fresh identity makes `isDirty` read the
          // moved anchor (objectui#9484).
          try {
            baselineRef.current = JSON.stringify(payload);
          } catch {
            baselineRef.current = null;
          }
          setDraft((current) => ({ ...current }));
        } else {
          // The draft is now the pending truth for display; the published
          // baseline hasn't moved. Show what we just staged.
          resetDraftBaseline(toDisplayDraft(toSave));
        }
        // Let the surface count it.
        onDraftSaved?.();
      } else {
        // objectui#9484 — this read runs AFTER `client.save` has returned: the
        // record on the server is already correct and nothing about the write
        // depends on the answer. It only re-anchors the display baseline, so a
        // REJECTION here may only degrade the DISPLAY. Left bare, it fell into
        // this `try`'s `catch` and produced three wrong outcomes at once for a
        // write that LANDED: the red error strip rendered the transport's
        // message, `resetDraftBaseline` was skipped so `isDirty` stayed true
        // and the `beforeunload` guard kept firing on a persisted record, and
        // `setDestructive(null)` was skipped so a force-save left its dialog
        // open. All three are closed by catching here and carrying on.
        //
        // This is NOT the package door's pre-save `.catch` above and the two
        // must not be unified: there the re-read happens BEFORE the write and
        // its rejection REFUSES the write on purpose (objectui#9420). Here the
        // write is already done, and refusing anything would be a lie.
        let rereadFailed = false;
        const lay = await client
          .layered<PermissionSetDraft>(type, payload.name)
          .catch(() => {
            rereadFailed = true;
            return null;
          });
        // `toSave` is the body the server just accepted, so it is a correct
        // anchor even when the confirming read never arrives — the same
        // fallback this line already spelled for the resolved-but-empty
        // (404-shaped) envelope.
        resetDraftBaseline(toDisplayDraft((lay?.effective ?? toSave) as PermissionSetDraft));
        setPostSaveRereadFailed(rereadFailed);
        // The write landed, so the server holds the set now whatever the
        // confirming read said (objectui#7611: its holders can be listed). Only
        // when it was saved under the name this page lists holders for.
        if (payload.name === name) setExistsOnServer(true);
      }
      // objectui#13272 — the clone notice is the server's point-in-time answer
      // to the clone, and a saved copy is past that moment: the copy is now
      // customised and saved, so the notice goes. Only a save OF THE COPY
      // ends it — an embedded host announces the copy on its base, and saving
      // the base changes nothing about the copy. The notice is one server
      // string shown verbatim and goes whole: cutting out one sentence would
      // key the editor on the server's prose.
      setCloned((c) => (c && c.name === payload.name ? null : c));
      setDestructive(null);
    } catch (err: any) {
      if (err?.status === 409 && errorCodeIs(err, 'DESTRUCTIVE_CHANGE')) {
        const issues = err?.body?.issues ?? [];
        setDestructive({ issues: Array.isArray(issues) ? issues : [], pending: payload });
      } else if (!packageId && err?.status === 403 && errorCodeIs(err, 'NOT_OVERRIDABLE')) {
        // objectui#5987 (the card's item 3) — the environment door refused the
        // write because a code package ships this set: the same condition the
        // artifact tier above locks on, reached by a save that got past it
        // (the lock is derived from a read; the server's answer is the
        // truth). Surface the lock's own guidance — clone first — beside the
        // refusal, instead of the transport's message alone. Env door only:
        // under a `packageId` the write is a package draft and this code has a
        // different meaning there (the package is not writable).
        setSaveRefusedAsLocked(err?.message ?? String(err));
      } else {
        // objectui#13113 — a refusal naming a policy name reads in the
        // author's words; any other keeps the transport's text.
        setError(rlsNameRefusal(err, locale) ?? err?.message ?? String(err));
      }
    } finally {
      setSaving(false);
    }
  }

  /* ── Autosave — the package door only (objectui#11787) ─────────── */
  // ADR-0086 D6 puts the package door under package draft/publish "exactly
  // like Data and Interfaces", and ADR-0033 §2 makes that draft the approval
  // gate, so this door saves the way those pillars do: the shared autosave,
  // 1.5s after the last edit, under the same conditions the Save button had
  // (a CEL syntax error holds the edit, objectui#2413). ⛔ The environment door
  // never autosaves: it writes live config (ADR-0086 D7), so every click would
  // change access at once. It keeps its explicit Save, and `blocked` holds the
  // timer there for good.
  //
  // The set is the open item; the host keys this page per set, so the target
  // never moves within a mount. The buffer is that set's once its load lands.
  const autosaveTarget = `${type}:${name}`;
  useDraftAutoSave({
    target: autosaveTarget,
    loadedFor: loading ? '' : autosaveTarget,
    dirty: isDirty,
    blocked: !packageId || !writable || saving || saveHeld || destructive !== null,
    snapshot: draft,
    save: (sent) => doSave(false, undefined, sent),
  });

  /* ── Clone to customize (objectui#5987, objectui#7611) ─────────── */
  /**
   * The server accepted a clone of THIS set (`PermissionSetCloneDialog`, which
   * asks for the copy's name and label and calls the clone door). What this
   * editor adds is only where the copy OPENS: on the routed metadata admin it
   * navigates to the copy, which loads with no code layer and is therefore
   * writable, and the server's notice is shown there; an embedded host has no
   * route, so the copy is announced by name instead.
   *
   * An answer that names no copy is said so, never guessed at (#0.1): the door
   * reports the set it saved.
   */
  function onCloned(copy: PermissionSetCloned) {
    setCloneOpen(false);
    setError(null);
    if (!copy.name) {
      setCloned(null);
      setError(t('perm.clone.noName'));
      return;
    }
    setCloned(copy);
    if (!embedded) {
      // Same spelling as ResourceEditPage's post-create hop: the route is
      // `metadata/:type/:name`, so `../<copy>` opens the copy under the same
      // type, keeping the query string (the Setup catalog's `?scope=`).
      navigate(
        { pathname: `../${encodeURIComponent(copy.name)}`, search: searchParams.toString() ? `?${searchParams}` : '' },
        { relative: 'path' },
      );
    }
  }

  /**
   * objectui#13272 — the clone notice ends "The copy is held by nobody yet",
   * which stops being true once the copy has a holder. The holders section
   * reports every read; one that lists anybody for the copy retires the
   * notice, whole (the server's string is never cut into sentences). Keyed on
   * the set the read was FOR, so a late read of another set cannot retire it.
   */
  function onHoldersRead(count: number, setName: string) {
    if (count > 0) setCloned((c) => (c && c.name === setName ? null : c));
  }

  /* ── Render helpers ──────────────────────────────────────── */
  const filteredObjects = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    return objects.filter((o) => {
      if (showOnlyEnabled) {
        const perm = draft.objects[o.name];
        if (!perm || !Object.values(perm).some(Boolean)) return false;
      }
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        (o.label ?? '').toLowerCase().includes(q)
      );
    });
  }, [objects, filter, showOnlyEnabled, draft.objects]);

  const stats = [
    {
      label: t('perm.stat.objectsGranted'),
      value: Object.values(draft.objects).filter((p) => Object.values(p).some(Boolean)).length,
    },
    {
      label: t('perm.stat.fieldOverrides'),
      value: Object.keys(draft.fields ?? {}).length,
    },
  ];

  // objectui#5987 — one element, two seats: the header slot Save would occupy
  // when the artifact tier locks the surface, and the refused-save strip when a
  // save reached the server anyway. Same label, same hint, same dialog.
  const cloneButton = (
    <Button size="sm" onClick={() => setCloneOpen(true)} disabled={cloneOpen} title={t('perm.clone.hint')}>
      <Copy className="h-4 w-4 mr-1" />
      {t('perm.clone.action')}
    </Button>
  );

  // objectui#12456 — the pieces both presentations draw: the routed page
  // (PageShell) and the Studio Access pillar's tabbed one (`studio`).
  const envSaveEl = (
    <>
      {/* ADR-0086 D7 — the environment door's explicit Save: a live write. */}
      {writable && !packageId && (
        <Button
          size="sm"
          onClick={() => doSave(false)}
          disabled={saving || saveHeld}
          title={
            celErrorCount > 0
              ? t('perm.cel.saveBlocked')
              : rlsUnnamedCount > 0
                ? t('perm.rls.nameNeeded')
                : undefined
          }
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-1" />
          )}
          {t('engine.edit.save')}
        </Button>
      )}
    </>
  );
  const autosaveStatusEl = (
    <>
      {/* objectui#11787 — the package door autosaves (see the autosave
          above), so its Save button gives way to the status line every
          Studio pillar shows: saving while in flight, the last-saved time
          once landed, and why an edit is held when a CEL error holds it. */}
      {writable && packageId && (
        saving ? (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
            data-testid="perm-autosaving"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('engine.studio.autoSaving')}
          </span>
        ) : celErrorCount > 0 && isDirty ? (
          <span className="text-[11px] text-destructive" data-testid="perm-autosave-held">
            {t('perm.cel.saveBlocked')}
          </span>
        ) : rlsUnnamedCount > 0 && isDirty ? (
          // objectui#13113 — held, not refused: a neutral line, no error tone.
          <span className="text-[11px] text-muted-foreground" data-testid="perm-autosave-held">
            {t('perm.rls.nameNeeded')}
          </span>
        ) : savedAt && !isDirty ? (
          <span className="text-[11px] text-muted-foreground" data-testid="perm-saved-at">
            {tFormat('engine.studio.data.lastSaved', locale, {
              time: savedAt.toLocaleTimeString(displayLocale, { hour: '2-digit', minute: '2-digit' }),
            })}
          </span>
        ) : null
      )}
    </>
  );
  const noticesEl = (
    <>
      {error && (
        <div className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* objectui#7611 — the caller cannot author this set at all: say so,
          once, instead of a matrix whose controls are disabled for no visible
          reason. The host and type gates keep their own badges. */}
      {/* objectui#12183 — under a wall the server rule is the reason, not a
          missing permission: the capability does not admit a tenant there. */}
      {walledReadOnly && (
        <div
          role="note"
          data-testid="perm-walled-readonly"
          className="m-4 rounded-md border bg-muted/40 p-3 text-sm flex items-start gap-2"
        >
          <Lock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <span>
            {tFormat('engine.catalog.readOnly.walled', locale, {
              type: translateMetadataType(type, locale, entry?.label ?? type),
            })}
          </span>
        </div>
      )}
      {!canAuthor && !readOnly && !walledReadOnly && (
        <div
          role="note"
          data-testid="perm-capability-readonly"
          className="m-4 rounded-md border bg-muted/40 p-3 text-sm flex items-start gap-2"
        >
          <Lock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <span>{t('engine.edit.capabilityReadOnly')}</span>
        </div>
      )}

      {/* objectui#5987 — the locked-state guidance, visible rather than
          tooltip-only, naming the ruled path first. The badge in the identity
          strip below still carries the full reasoning in its hint. */}
      {lockedByArtifactTier && (
        <div
          role="note"
          className="m-4 rounded-md border bg-muted/40 p-3 text-sm flex items-start gap-2"
        >
          <Lock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <span>{t('perm.clone.guidance')}</span>
        </div>
      )}

      {/* objectui#5987 (item 3) — a save that reached the server and was
          refused as a PACKAGED set: the same guidance as the lock, with the
          same primary action, and the server's own sentence kept underneath
          for diagnosis. `role="alert"`: this IS a failed save. */}
      {saveRefusedAsLocked !== null && (
        <div
          role="alert"
          className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex flex-col gap-2"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{t('perm.save.locked')}</span>
          </div>
          <div className="flex items-start gap-3 pl-6">
            {cloneButton}
            <span className="text-xs text-muted-foreground">{saveRefusedAsLocked}</span>
          </div>
        </div>
      )}

      {/* objectui#5987 — the copy the clone door saved: on the copy itself
          once the routed hop opens it, or, on an embedded host (no route to
          open it on), announced by name on this set. The server's notice
          (what was not copied, and that the copy is held by nobody yet) is
          shown as sent (advisory, like the re-read notice below), and only
          until the copy is saved or held (objectui#13272: `doSave`,
          `onHoldersRead`). */}
      {cloned !== null && (embedded || cloned.name === name) && (cloned.name !== name || !!cloned.notice) && (
        <div
          role="status"
          data-testid="perm-clone-notice"
          className="m-4 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2"
        >
          <Copy className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            {cloned.name !== name && <p>{tFormat('perm.clone.done', locale, { name: cloned.name })}</p>}
            {cloned.notice && <p>{cloned.notice}</p>}
          </div>
        </div>
      )}

      {/* objectui#9484 — the save LANDED and only its confirming re-read did
          not, so this is advisory (amber, `role="status"`), not the
          destructive-toned error strip above. Rendered separately rather than
          folded into `error` so the two can never be mistaken for each other
          on a permission surface. */}
      {postSaveRereadFailed && (
        <div
          role="status"
          className="m-4 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t('perm.save.rereadStale')}</span>
        </div>
      )}
    </>
  );
  const provenanceBadgesEl = (
    <>
      {/* Provenance: Package or Custom, from `shippedByPackage`.
          objectui#7611 (F2): "Package" also reads the layered envelope
          this editor already fetches (`codeIsArtifact`, the artifact
          gate's own input). At the environment scope there is no
          `packageId`, so a set a code package ships read "Custom" beside
          its own lock. */}
      <Badge variant="outline" className="text-[10px] shrink-0" data-testid="perm-provenance-badge">
        {shippedByPackage ? t('perm.badge.package') : t('perm.badge.custom')}
      </Badge>
      {!!draft.isDefault && (
        <Badge variant="secondary" className="text-[10px] shrink-0">{t('perm.badge.default')}</Badge>
      )}
    </>
  );
  const lockBadgeEl = writable ? null : (
    // Same badge slot, five distinct reasons, and each names the gate
    // that ACTUALLY tripped (objectui#4446, #4518):
    //
    //  • host gate — a read-only PACKAGE; mirror the top-bar wording
    //    so the screen is not self-contradictory.
    //  • artifact gate — a code package SHIPS this set and the type
    //    has not opted into per-org overlay, or the server's served
    //    `editable` refuses the set (a hatch-elevated type, whose
    //    hatch never opens a set a package ships: ADR-0131 D6,
    //    objectui#12169), so an environment-scope
    //    write of it is refused (403 `not_overridable`). Naming the
    //    type here would be a lie in the other direction: the type
    //    DOES have a runtime write channel — a brand-new set authored
    //    here saves fine — it is this PARTICULAR set that is packaged.
    //  • type gate — the metadata type offers no runtime write
    //    channel at all (`allowEnvironmentOverlay` AND `allowRuntimeCreate`
    //    both false). It used to read "OS_METADATA_WRITABLE not
    //    enabled", which blamed a deployment env var for what is a
    //    per-type registry declaration. That wording had NO reachable
    //    honest case: `OS_METADATA_WRITABLE` does not sit beside
    //    `allowEnvironmentOverlay`, it FLIPS it — `getMetaTypes` emits
    //    `allowEnvironmentOverlay: base.allowEnvironmentOverlay || isEnvOverridden`
    //    — so whenever the hatch is on for this type the type gate is
    //    open and this label is never the one shown (a set a package
    //    ships is then the artifact gate's). The env var is a
    //    documented REMEDY (it appears in the server's own 403 text),
    //    never the cause, so it belongs in the hint, not the label.
    //  • caller gate — the type is open and nothing above closed, so
    //    the one gate left is `canAuthor` (`writable` is the conjunction
    //    of exactly these). The type-tier sentence was false here: the
    //    type DOES have a runtime write channel, this caller may not use
    //    it (objectui#13011). The hint is the capability banner's
    //    sentence, so badge and banner give one reason.
    <Badge
      variant="secondary"
      className={studio ? 'shrink-0' : 'ml-auto shrink-0'}
      title={
        readOnly
          ? t('engine.studio.pkg.readonlyHint')
          : walledReadOnly
            ? tFormat('engine.catalog.readOnly.walled', locale, {
                type: translateMetadataType(type, locale, entry?.label ?? type),
              })
            : lockedByArtifactTier
              ? t('perm.readOnly.artifact.hint')
              : !typeTierOpen
                ? t('perm.readOnly.hint')
                : t('engine.edit.capabilityReadOnly')
      }
    >
      {readOnly
        ? t('engine.studio.pkg.readonly')
        : walledReadOnly
          ? t('perm.readOnly.walled')
          : lockedByArtifactTier
            ? t('perm.readOnly.artifact')
            : !typeTierOpen
              ? t('perm.readOnly')
              : t('perm.readOnly.capability')}
    </Badge>
  );
  const basicsFieldsEl = (
    <div className="px-6 pb-3 flex flex-wrap items-end gap-4">
      <div className="space-y-1">
        <Label htmlFor="perm-name" className="text-xs">{t('perm.field.name')}</Label>
        <Input
          id="perm-name"
          value={draft.name}
          // objectui#11787 — on the package door the api name is the
          // set's identity in the package's drafts: the autosave writes
          // the draft under `draft.name`, so an editable name would
          // stage a new set at every pause while typing. It is set once,
          // by "+ New". The environment door keeps it editable.
          disabled={!writable || !!packageId}
          onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
          className="h-8 w-56"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="perm-label" className="text-xs">{t('perm.field.label')}</Label>
        <Input
          id="perm-label"
          value={draft.label ?? ''}
          disabled={!writable}
          onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))}
          className="h-8 w-72"
        />
      </div>
    </div>
  );
  const capabilitiesEl = (
    <>
      {/* System Capabilities (ADR-0056 P2) — set-level platform/org
          capabilities (e.g. studio.access, manage_users). Stored
          as PermissionSetDraft.systemPermissions (string[]); the picker
          round-trips via a JSON string, so parse back into the array the
          draft model uses. Persisted by the whole-record Save at env scope. */}
      {writable && (draft.systemPermissions ?? []).length === 0 && !capsOpen ? (
        // objectui#2600 B1 — zero-grant writable sets used to render the full
        // picker's option chips, which read as already-owned capabilities.
        // Collapse to an explicit "none granted · add" affordance instead.
        <div className="px-6 py-2.5 border-b flex items-center gap-2 text-xs">
          <Label className="text-xs text-muted-foreground">{t('perm.field.systemCapabilities')}</Label>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{t('perm.cap.none')}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setCapsOpen(true)}
          >
            + {t('perm.cap.add')}
          </Button>
        </div>
      ) : (
        <div className="px-6 py-3 border-b">
          <Label className="text-xs">{t('perm.field.systemCapabilities')}</Label>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">
            {t('perm.field.systemCapabilitiesHelp')}
          </p>
          {/* objectui#3332 — the capability chip wall grows with the
              capability registry (44+ nav capabilities → 20+ rows). It is
              a non-shrinking sibling of the flex-1 matrix, so unbounded it
              squeezes the object list to ~0px with no page scrollbar. Cap it
              to a viewport share and scroll internally; the matrix keeps the
              remaining height (per #2600 B1 the picker itself stays inline). */}
          <div
            data-testid="capability-scroll"
            className="max-h-[30vh] overflow-y-auto overscroll-contain"
          >
            <CapabilityMultiSelectField
              value={JSON.stringify(draft.systemPermissions ?? [])}
              onChange={(v: unknown) =>
                setDraft((p) => ({ ...p, systemPermissions: parseCapabilityNames(v) }))
              }
              field={{ name: 'system_permissions' } as any}
              readonly={!writable}
            />
          </div>
        </div>
      )}
    </>
  );
  const dialogsEl = (
    <>
      {cloneOpen && (
        <PermissionSetCloneDialog
          source={name}
          locale={locale}
          onClose={() => setCloneOpen(false)}
          onCloned={onCloned}
        />
      )}

      {/* Destructive-change dialog */}
      <Dialog open={!!destructive} onOpenChange={(open) => !open && setDestructive(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> {t('engine.edit.destructive')}
            </DialogTitle>
            <DialogDescription>
              {t('engine.edit.destructiveHint')}
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm space-y-1 max-h-64 overflow-auto">
            {destructive?.issues.map((i, idx) => (
              <li key={idx} className="border-l-2 border-amber-500 pl-2">
                {i.kind && <Badge variant="outline" className="mr-2">{i.kind}</Badge>}
                {i.message ?? JSON.stringify(i)}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDestructive(null)}>{t('engine.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={() => destructive && doSave(true, destructive.pending)}
              disabled={saving}
            >
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {t('engine.edit.forceSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Embedded-mode History sheet — the routed history page doesn't exist
          under the host's router scope (see `embedded` prop doc). No rollback
          here: under a packageId the set is package METADATA whose truth moves
          via draft + atomic Publish (ADR-0086 D6/D7); a rollback would write a
          live overlay behind the draft flow's back. */}
      {embedded && canReadTrail && (
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent side="right" className="w-[92vw] sm:max-w-[720px] p-0 flex flex-col gap-0">
            <SheetHeader className="px-4 py-3 border-b">
              <SheetTitle className="text-base">{t('engine.edit.history')}</SheetTitle>
              <SheetDescription className="text-xs">
                {type} / {name}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-auto p-4">
              {historyOpen && <HistoryPanel type={type} name={name} client={client} />}
            </div>
          </SheetContent>
        </Sheet>
      )}
      {draftConflictDialog}
    </>
  );

  /* ── Studio presentation (objectui#12456) ─────────────────── */
  function renderStudio(chrome: PermissionStudioChrome) {
    const objectsGranted = stats[0].value;
    const fieldOverrides = stats[1].value;
    const meta = loading
      ? undefined
      : `${tFormat(objectsGranted === 1 ? 'engine.studio.access.grantedOne' : 'engine.studio.access.grantedOther', locale, { count: objectsGranted })} · ${tFormat(
          fieldOverrides === 1 ? 'engine.studio.access.overridesOne' : 'engine.studio.access.overridesOther',
          locale,
          { count: fieldOverrides },
        )}`;
    const chipButton =
      'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground';
    const facetTab = chrome.tab === 'rls' || chrome.tab === 'tabs' || chrome.tab === 'admin' ? chrome.tab : null;
    return (
      <div className="flex h-full flex-col">
        <StudioItemHeader
          testId="access-item-header"
          leading={chrome.leading}
          icon={Shield}
          title={draft.label || name}
          apiName={name}
          chips={
            <>
              {/* The provenance chip in the artboard's kind-chip look; same
                  test id and the same answer as the page's badge. */}
              <span className={STUDIO_KIND_CHIP} data-testid="perm-provenance-badge">
                {shippedByPackage ? t('perm.badge.package') : t('perm.badge.custom')}
              </span>
              {!!draft.isDefault && <span className={STUDIO_KIND_CHIP}>{t('perm.badge.default')}</span>}
              {/* A host-locked package says so in the pillar's note; the
                  other gates (type, artifact, wall) keep their own badge. */}
              {!readOnly && lockBadgeEl}
            </>
          }
          meta={meta}
          actions={
            <>
              {autosaveStatusEl}
              {chrome.actions}
              {/* objectui#12475 — offered only to a caller the trail door admits. */}
              {canReadTrail && (
                <button
                  type="button"
                  className={chipButton}
                  data-testid="history-button"
                  onClick={() => setHistoryOpen(true)}
                >
                  <HistoryIcon className="h-3.5 w-3.5" />
                  {t('engine.edit.history')}
                </button>
              )}
              {envSaveEl}
              {lockedByArtifactTier && cloneButton}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('engine.studio.access.more')}
                    title={t('engine.studio.access.more')}
                    data-testid="perm-more"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setBasicsOpen((o) => !o)}>
                    {t('perm.basics.editHint')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
          tabs={
            <>
              {PERMISSION_STUDIO_TABS.map((tab) => (
                <StudioTab
                  key={tab.key}
                  active={chrome.tab === tab.key}
                  data-testid={`perm-tab-${tab.key}`}
                  onClick={() => chrome.onTabChange(tab.key)}
                >
                  {t(tab.labelKey)}
                </StudioTab>
              ))}
              {/* The pillar's draft / read-only note, whole, at the tab row's
                  right: in the title row it squeezed the label and the counts
                  at the 1280 px design width. */}
              {chrome.chips && <span className="ml-auto flex items-center self-center pl-3">{chrome.chips}</span>}
            </>
          }
        />
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('perm.loading').replace('{name}', name)}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {noticesEl}
            {basicsOpen && (
              <div className="shrink-0 border-b pt-3" data-testid="perm-basics">
                {basicsFieldsEl}
              </div>
            )}
            {/* Every tab body stays mounted and the closed ones are hidden:
                the facets' CEL lint reports to the Save gate from any tab,
                and nothing an author typed is lost by switching. */}
            <div
              hidden={chrome.tab !== 'objects'}
              data-testid="perm-tabpanel-objects"
              className="min-h-0 flex-1 flex-col overflow-hidden data-[open=true]:flex"
              data-open={chrome.tab === 'objects'}
            >
              <StudioObjectsToolbar
                shown={filteredObjects.length}
                total={objects.length}
                filter={filter}
                onFilter={setFilter}
                onlyGranted={showOnlyEnabled}
                onOnlyGranted={setShowOnlyEnabled}
                locale={locale}
                t={t}
              />
              <div className="min-h-0 flex-1 overflow-auto">
                <StudioObjectMatrix
                  objects={filteredObjects}
                  draft={draft}
                  expanded={expanded}
                  fieldsByObject={fieldsByObject}
                  writable={writable}
                  objectActions={OBJECT_ACTIONS}
                  t={t}
                  onToggleExpand={toggleExpand}
                  onObjectPerm={updateObjectPerm}
                  onFieldPerm={updateFieldPerm}
                  onBulkSet={bulkSetObject}
                  onFieldBulk={bulkSetFields}
                  onOpenOwd={onOpenOwd}
                />
              </div>
              {writable && (
                <p className="shrink-0 border-t px-6 py-2.5 text-xs text-muted-foreground">
                  {t('engine.studio.access.bulkHint')}
                </p>
              )}
            </div>
            <div hidden={chrome.tab !== 'capabilities'} data-testid="perm-tabpanel-capabilities" className="min-h-0 flex-1 overflow-auto">
              {capabilitiesEl}
            </div>
            <div hidden={facetTab === null} data-testid="perm-tabpanel-facets" className="min-h-0 flex-1 overflow-auto">
              <PermissionAdvancedFacets
                draft={draft}
                setDraft={setDraft}
                writable={writable}
                allSetNames={allSetNames}
                loadObjectFields={loadObjectFields}
                onCelErrorsChange={setCelErrorCount}
                t={t}
                only={facetTab}
              />
            </div>
          </div>
        )}
        {dialogsEl}
      </div>
    );
  }

  if (studio) {
    return renderStudio(studio);
  }

  if (loading) {
    return (
      <PageShell entry={entry} itemName={name} embedded={embedded} readOnly={readOnly}>
        <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('perm.loading').replace('{name}', name)}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      entry={entry ?? { type, label: type }}
      itemName={name}
      subtitle={t('perm.subtitle.set')}
      stats={stats}
      embedded={embedded}
      // The header badge must report the gate that actually governs this
      // screen: without this the hero rendered "writable" while every control
      // below it was disabled by the package gate (objectui#4036).
      //
      // Still the HOST gate only, deliberately — `WritabilityBadge` reads the
      // type flags itself, and its own read-only condition (`readOnly ||
      // (!allowEnvironmentOverlay && !allowRuntimeCreate)`) is now exactly `!writable`
      // above. Passing `!writable` here instead would collapse that to one
      // input but make a TYPE-gate lock claim the PACKAGE as its reason, since
      // this branch's tooltip is `engine.studio.pkg.readonlyHint` — trading the
      // divergence for a fresh lie (objectui#4446).
      readOnly={readOnly}
      actions={
        <>
          {canReadTrail && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="history-button"
              onClick={() =>
                embedded
                  ? setHistoryOpen(true)
                  : navigate(`./history?type=${encodeURIComponent(type)}`)
              }
            >
              <HistoryIcon className="h-4 w-4 mr-1" /> {t('engine.edit.history')}
            </Button>
          )}
          {envSaveEl}
          {autosaveStatusEl}
          {/* objectui#5987 — the locked editor's PRIMARY action, in the slot Save
              would occupy: a code package ships this set, so the ruled path is
              to clone it and edit the clone. Only where the artifact tier is
              the deciding gate — a host-locked package or a type with no
              runtime write channel at all has no clone to offer (the clone is
              itself a runtime-created set). */}
          {lockedByArtifactTier && cloneButton}
        </>
      }
    >
      <div className="flex flex-col h-full overflow-hidden">
        {noticesEl}

        {/* Identity summary — collapsible (objectui#2600 B1). Name/label change
            rarely, so the strip collapses to a one-line summary and the matrix
            reaches the first screen; the row toggles the editable inputs open. */}
        <div className="border-b bg-muted/30">
          <button
            type="button"
            onClick={() => setBasicsOpen((o) => !o)}
            aria-expanded={basicsOpen}
            className="w-full px-6 py-2.5 flex items-center gap-2 text-left hover:bg-muted/50 transition-colors"
          >
            {basicsOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            {/* The api-name already sits in the PageShell breadcrumb (font-mono),
                so the summary carries the human label — no need to repeat it. */}
            <span className="font-medium truncate">{draft.label || draft.name}</span>
            {provenanceBadgesEl}
            {writable && (
              <span className="text-xs text-muted-foreground shrink-0">{t('perm.basics.editHint')}</span>
            )}
            {!writable && (
              lockBadgeEl
            )}
          </button>
          {basicsOpen && (
            basicsFieldsEl
          )}
        </div>

        {capabilitiesEl}

        {/* Filter bar */}
        <div className="px-6 py-3 border-b flex items-center gap-3">
          <Input
            placeholder={t('perm.filter.placeholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 w-72"
          />
          <div className="flex items-center gap-2">
            <Switch
              id="only-enabled"
              checked={showOnlyEnabled}
              onCheckedChange={(v) => setShowOnlyEnabled(!!v)}
            />
            <Label htmlFor="only-enabled" className="text-xs">{t('perm.filter.onlyGranted')}</Label>
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {filteredObjects.length} / {objects.length} {t('perm.stat.objectsSuffix')}
          </span>
        </div>

        {/* Column legend — the matrix header cells already carry a native
            `title` tooltip per column, but a hover-only affordance on
            unfamiliar two-letter abbreviations (Tr/VA/MA) is easy to
            miss. Spell them out once, up front. */}
        <div className="px-6 py-2 border-b flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {OBJECT_ACTIONS.map((a) => (
            <span key={a.key as string} className="whitespace-nowrap">
              <span className="font-medium text-foreground">{a.short}</span> {a.tip}
            </span>
          ))}
        </div>

        {/* Matrix */}
        <div className="flex-1 overflow-auto">
          <PermissionTable
            objects={filteredObjects}
            draft={draft}
            expanded={expanded}
            fieldsByObject={fieldsByObject}
            writable={writable}
            objectActions={OBJECT_ACTIONS}
            t={t}
            onToggleExpand={toggleExpand}
            onObjectPerm={updateObjectPerm}
            onFieldPerm={updateFieldPerm}
            onBulkSet={bulkSetObject}
            onFieldBulk={bulkSetFields}
            onOpenOwd={onOpenOwd}
          />
          {/* Advanced facets (ADR-0056 P3) — RLS / tab visibility / delegated
              admin scope, structured editors instead of raw JSON. Collapsed by
              default so they don't crowd the object matrix. */}
          <PermissionAdvancedFacets
            draft={draft}
            setDraft={setDraft}
            writable={writable}
            allSetNames={allSetNames}
            loadObjectFields={loadObjectFields}
            onCelErrorsChange={setCelErrorCount}
            t={t}
          />
        </div>
        {/* ADR-0056 P4 — assigning users is a Setup act, so the DESIGN surface
            (Studio, embedded) never shows it. objectui#7611 — the Setup catalog
            IS this editor in the environment scope (ADR-0131 D3), so there the
            set's holders render under its definition, by name. */}
        {showAssignments && (
          <div className="mx-4 mb-4 shrink-0 max-h-[35vh] overflow-y-auto rounded-md border" data-testid="perm-assignments">
            <AssignedUsersSection permissionSetName={name} onHoldersRead={onHoldersRead} />
          </div>
        )}
      </div>

      {dialogsEl}
    </PageShell>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Subcomponent: PermissionTable                                      */
/* ────────────────────────────────────────────────────────────────── */

interface PermissionTableProps {
  objects: ObjectSummary[];
  draft: PermissionSetDraft;
  expanded: Set<string>;
  fieldsByObject: Record<string, FieldSummary[]>;
  writable: boolean;
  objectActions: ReturnType<typeof getObjectActions>;
  t: (key: string) => string;
  onToggleExpand: (objectName: string) => void;
  onObjectPerm: (objectName: string, action: keyof ObjectPerm, value: boolean) => void;
  onFieldPerm: (objectName: string, fieldName: string, action: keyof FieldPerm, value: boolean) => void;
  onBulkSet: (objectName: string, action: 'all' | 'none' | 'crud' | 'read') => void;
  /** objectui#2600 B4 — field-level bulk over the filtered field set. */
  onFieldBulk: (objectName: string, action: 'readable' | 'writable' | 'clear', fieldNames: string[]) => void;
  /** objectui#2505 — when set, the OWD badge links to the package OWD overview. */
  onOpenOwd?: (objectName: string) => void;
}

function PermissionTable({
  objects,
  draft,
  expanded,
  fieldsByObject,
  writable,
  objectActions,
  t,
  onToggleExpand,
  onObjectPerm,
  onFieldPerm,
  onBulkSet,
  onFieldBulk,
  onOpenOwd,
}: PermissionTableProps) {
  return (
    // objectui#2600 B3 — the fixed columns (object + 7 CRUD + bulk) need ~960px;
    // a min-width makes the enclosing overflow-auto container scroll instead of
    // squishing the CRUD grid and clipping the Bulk column off the right edge.
    // The min-width is deliberately unchanged by the two columns objectui#6595
    // retired: it is a floor, so the grid simply has more room to breathe.
    <table className="w-full min-w-[960px] text-sm">
      <thead className="sticky top-0 bg-background border-b z-10">
        <tr>
          <th className="text-left px-4 py-2 font-medium w-72">{t('perm.col.object')}</th>
          {objectActions.map((a) => (
            <th
              key={a.key as string}
              className="px-2 py-2 font-medium text-center w-14"
              title={a.tip}
            >
              {a.short}
            </th>
          ))}
          <th className="px-2 py-2 font-medium w-44 text-right">{t('perm.col.bulk')}</th>
        </tr>
      </thead>
      <tbody>
        {objects.length === 0 && (
          <tr>
            <td colSpan={objectActions.length + 2} className="px-4 py-8 text-center text-muted-foreground">
              {t('perm.filter.empty')}
            </td>
          </tr>
        )}
        {objects.map((o) => {
          const perm = draft.objects[o.name] ?? {};
          const open = expanded.has(o.name);
          return (
            <React.Fragment key={o.name}>
              <tr className="border-b hover:bg-muted/30">
                <td className="px-2 py-1.5 align-middle">
                  <button
                    type="button"
                    onClick={() => onToggleExpand(o.name)}
                    className="inline-flex items-center gap-1.5 hover:text-foreground"
                  >
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    <span className="font-medium">{o.label ?? o.name}</span>
                    {o.label && (
                      <span className="text-xs text-muted-foreground">({o.name})</span>
                    )}
                  </button>
                  {o.accessDefault === 'private' && (
                    <Badge
                      variant="outline"
                      className="ml-2 border-amber-500/50 text-amber-600 dark:text-amber-400 text-[10px] px-1.5 py-0 align-middle"
                      title={t('perm.posture.private.tip')}
                    >
                      {t('perm.posture.private')}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={
                      'ml-2 text-[10px] px-1.5 py-0 align-middle text-muted-foreground' +
                      (onOpenOwd
                        ? ' cursor-pointer hover:text-foreground hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary'
                        : '')
                    }
                    title={onOpenOwd ? t('perm.owd.editLink') : t('perm.owd.tip')}
                    {...(onOpenOwd
                      ? {
                          role: 'button',
                          tabIndex: 0,
                          'data-testid': `owd-badge-${o.name}`,
                          onClick: () => onOpenOwd(o.name),
                          onKeyDown: (ev: React.KeyboardEvent) => {
                            if (ev.key === 'Enter' || ev.key === ' ') {
                              ev.preventDefault();
                              onOpenOwd(o.name);
                            }
                          },
                        }
                      : {})}
                  >
                    {`OWD ${o.owd ? owdLabel(t, o.owd) : t('perm.owd.defaultPrivate')}`}
                  </Badge>
                </td>
                {objectActions.map((a) => (
                  <td key={a.key as string} className="text-center px-2 py-1.5">
                    <Checkbox
                      checked={!!perm[a.key]}
                      disabled={!writable}
                      onCheckedChange={(v) => onObjectPerm(o.name, a.key, !!v)}
                      aria-label={`${o.name} ${a.tip}`}
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right space-x-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    disabled={!writable}
                    onClick={() => onBulkSet(o.name, 'read')}
                  >
                    {t('perm.bulk.read')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    disabled={!writable}
                    onClick={() => onBulkSet(o.name, 'crud')}
                  >
                    {t('perm.bulk.crud')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    disabled={!writable}
                    onClick={() => onBulkSet(o.name, 'all')}
                  >
                    {t('perm.bulk.all')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    disabled={!writable}
                    onClick={() => onBulkSet(o.name, 'none')}
                  >
                    {t('perm.bulk.none')}
                  </Button>
                </td>
              </tr>
              {open && (
                <tr className="bg-muted/10">
                  <td colSpan={objectActions.length + 2} className="px-12 py-3">
                    <FieldsSubTable
                      objectName={o.name}
                      fields={fieldsByObject[o.name]}
                      fieldsState={draft.fields ?? {}}
                      writable={writable}
                      t={t}
                      onFieldPerm={onFieldPerm}
                      onFieldBulk={onFieldBulk}
                    />
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Subcomponents: the Studio Objects tab (objectui#12456)             */
/* ────────────────────────────────────────────────────────────────── */

/** The artboard's short legend labels, keyed like `getObjectActions`. */
const STUDIO_LEGEND_KEYS: Partial<Record<keyof ObjectPerm, string>> = {
  allowCreate: 'engine.studio.access.legend.create',
  allowRead: 'engine.studio.access.legend.read',
  allowEdit: 'engine.studio.access.legend.edit',
  allowDelete: 'engine.studio.access.legend.delete',
  allowTransfer: 'engine.studio.access.legend.transfer',
  viewAllRecords: 'engine.studio.access.legend.viewAll',
  modifyAllRecords: 'engine.studio.access.legend.modifyAll',
};

/** The sharing group (Transfer, View all, Modify all) opens behind a divider. */
const STUDIO_SHARING_GROUP_START: keyof ObjectPerm = 'allowTransfer';

function StudioObjectsToolbar({
  shown,
  total,
  filter,
  onFilter,
  onlyGranted,
  onOnlyGranted,
  locale,
  t,
}: {
  shown: number;
  total: number;
  filter: string;
  onFilter: (v: string) => void;
  onlyGranted: boolean;
  onOnlyGranted: (v: boolean) => void;
  locale: string;
  t: (key: string) => string;
}) {
  const switchId = React.useId();
  const legend = getObjectActions(locale);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3" data-testid="perm-objects-toolbar">
      <span className="text-[13px] text-muted-foreground" data-testid="perm-object-count">
        {shown === total
          ? tFormat(total === 1 ? 'engine.studio.access.objectCountOne' : 'engine.studio.access.objectCountOther', locale, { count: total })
          : tFormat('engine.studio.access.objectCountFiltered', locale, { shown, count: total })}
      </span>
      <Input
        placeholder={t('perm.filter.placeholder')}
        aria-label={t('perm.filter.placeholder')}
        value={filter}
        onChange={(e) => onFilter(e.target.value)}
        className="h-7 w-44 text-[12px]"
      />
      <div className="flex items-center gap-2">
        <Switch id={switchId} checked={onlyGranted} onCheckedChange={(v) => onOnlyGranted(!!v)} />
        <Label htmlFor={switchId} className="text-[13px] font-normal">
          {t('perm.filter.onlyGranted')}
        </Label>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {legend.map((a) => (
          <span key={a.key as string} className="whitespace-nowrap" title={a.tip}>
            <span className="font-semibold text-foreground">{a.short}</span>{' '}
            {t(STUDIO_LEGEND_KEYS[a.key] ?? '') || a.tip}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The OWD chip's tint: Private muted, the public values green, by-parent blue. */
function owdChipTone(owd: string | undefined): string {
  switch (owd) {
    case 'public_read':
    case 'public_read_write':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
    case 'controlled_by_parent':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function StudioObjectMatrix({
  objects,
  draft,
  expanded,
  fieldsByObject,
  writable,
  objectActions,
  t,
  onToggleExpand,
  onObjectPerm,
  onFieldPerm,
  onBulkSet,
  onFieldBulk,
  onOpenOwd,
}: PermissionTableProps) {
  const sharingStart = objectActions.findIndex((a) => a.key === STUDIO_SHARING_GROUP_START);
  const divider = (i: number) => (i === 0 || i === sharingStart ? 'border-l' : '');
  return (
    <table className="w-full min-w-[960px] border-collapse text-[13px]" data-testid="perm-studio-matrix">
      <thead className="sticky top-0 z-10">
        <tr className="h-9 border-y bg-sidebar text-xs font-medium text-muted-foreground">
          <th className="pl-6 pr-3 text-left font-medium">{t('perm.col.object')}</th>
          <th className="w-28 px-3 text-left font-medium">{t('engine.studio.access.colOwd')}</th>
          {objectActions.map((a, i) => (
            <th key={a.key as string} title={a.tip} className={cn('w-[52px] px-1 text-center font-medium', divider(i))}>
              {a.short}
            </th>
          ))}
          <th className="w-56 border-l px-3 font-medium">
            <span className="sr-only">{t('perm.col.bulk')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {objects.length === 0 && (
          <tr>
            <td colSpan={objectActions.length + 3} className="px-6 py-8 text-center text-muted-foreground">
              {t('perm.filter.empty')}
            </td>
          </tr>
        )}
        {objects.map((o) => (
          <StudioObjectRow
            key={o.name}
            object={o}
            perm={draft.objects[o.name] ?? {}}
            open={expanded.has(o.name)}
            fieldsState={draft.fields ?? {}}
            fields={fieldsByObject[o.name]}
            writable={writable}
            objectActions={objectActions}
            divider={divider}
            t={t}
            onToggleExpand={onToggleExpand}
            onObjectPerm={onObjectPerm}
            onFieldPerm={onFieldPerm}
            onBulkSet={onBulkSet}
            onFieldBulk={onFieldBulk}
            onOpenOwd={onOpenOwd}
          />
        ))}
      </tbody>
    </table>
  );
}

function StudioObjectRow({
  object: o,
  perm,
  open,
  fieldsState,
  fields,
  writable,
  objectActions,
  divider,
  t,
  onToggleExpand,
  onObjectPerm,
  onFieldPerm,
  onBulkSet,
  onFieldBulk,
  onOpenOwd,
}: {
  object: ObjectSummary;
  perm: ObjectPerm;
  open: boolean;
  fieldsState: Record<string, FieldPerm>;
  fields: FieldSummary[] | undefined;
  writable: boolean;
  objectActions: ReturnType<typeof getObjectActions>;
  divider: (i: number) => string;
  t: (key: string) => string;
  onToggleExpand: (objectName: string) => void;
  onObjectPerm: (objectName: string, action: keyof ObjectPerm, value: boolean) => void;
  onFieldPerm: (objectName: string, fieldName: string, action: keyof FieldPerm, value: boolean) => void;
  onBulkSet: (objectName: string, action: 'all' | 'none' | 'crud' | 'read') => void;
  onFieldBulk: (objectName: string, action: 'readable' | 'writable' | 'clear', fieldNames: string[]) => void;
  onOpenOwd?: (objectName: string) => void;
}) {
  // The bulk strip draws on the row under the pointer, and on the row that
  // holds keyboard focus — read from the focus events themselves, so a Tab
  // into the row's first checkbox brings the strip into the tab order.
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const active = hovered || focused;
  const bulk: Array<{ action: 'read' | 'crud' | 'all' | 'none'; key: string }> = [
    { action: 'read', key: 'perm.bulk.read' },
    { action: 'crud', key: 'perm.bulk.crud' },
    { action: 'all', key: 'perm.bulk.all' },
    { action: 'none', key: 'perm.bulk.none' },
  ];
  return (
    <>
      <tr
        data-testid={`perm-row-${o.name}`}
        data-active={active || undefined}
        className={cn('h-10 border-b', active && 'bg-primary/5')}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          // Focus moving between the row's own controls keeps the strip.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        <td className="py-1 pl-6 pr-3 align-middle">
          <button
            type="button"
            onClick={() => onToggleExpand(o.name)}
            aria-expanded={open}
            className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-left"
          >
            {/* The chevron opens the object's field-level R/W, as on the page. */}
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="font-medium text-foreground">{o.label ?? o.name}</span>
            {o.label && <span className="font-mono text-[11px] text-muted-foreground">{o.name}</span>}
          </button>
          {o.accessDefault === 'private' && (
            <Badge
              variant="outline"
              className="ml-2 border-amber-500/50 px-1.5 py-0 align-middle text-[10px] text-amber-600 dark:text-amber-400"
              title={t('perm.posture.private.tip')}
            >
              {t('perm.posture.private')}
            </Badge>
          )}
        </td>
        <td className="px-3 py-1 align-middle">
          <span
            className={cn(
              'inline-flex h-[22px] items-center rounded px-1.5 text-[11px] font-medium',
              owdChipTone(o.owd),
              onOpenOwd && 'cursor-pointer hover:ring-1 hover:ring-border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
            )}
            title={onOpenOwd ? t('perm.owd.editLink') : t('perm.owd.tip')}
            {...(onOpenOwd
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'data-testid': `owd-badge-${o.name}`,
                  onClick: () => onOpenOwd(o.name),
                  onKeyDown: (ev: React.KeyboardEvent) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      onOpenOwd(o.name);
                    }
                  },
                }
              : {})}
          >
            {o.owd ? owdLabel(t, o.owd) : t('perm.owd.defaultPrivate')}
          </span>
        </td>
        {objectActions.map((a, i) => (
          <td key={a.key as string} className={cn('px-1 py-1 text-center align-middle', divider(i))}>
            <Checkbox
              checked={!!perm[a.key]}
              disabled={!writable}
              onCheckedChange={(v) => onObjectPerm(o.name, a.key, !!v)}
              aria-label={`${o.name} ${a.tip}`}
              className="h-[18px] w-[18px] rounded border-muted-foreground/40 align-middle data-[state=checked]:border-primary"
            />
          </td>
        ))}
        <td className="border-l px-3 py-1 align-middle">
          {active && (
            <span className="flex items-center gap-1" data-testid={`perm-bulk-${o.name}`}>
              {bulk.map((b) => (
                <button
                  key={b.action}
                  type="button"
                  disabled={!writable}
                  onClick={() => onBulkSet(o.name, b.action)}
                  className="inline-flex h-6 items-center rounded border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t(b.key)}
                </button>
              ))}
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/10">
          <td colSpan={objectActions.length + 3} className="py-3 pl-12 pr-6">
            <FieldsSubTable
              objectName={o.name}
              fields={fields}
              fieldsState={fieldsState}
              writable={writable}
              t={t}
              onFieldPerm={onFieldPerm}
              onFieldBulk={onFieldBulk}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function FieldsSubTable({
  objectName,
  fields,
  fieldsState,
  writable,
  t,
  onFieldPerm,
  onFieldBulk,
}: {
  objectName: string;
  fields: FieldSummary[] | undefined;
  fieldsState: Record<string, FieldPerm>;
  writable: boolean;
  t: (key: string) => string;
  onFieldPerm: (objectName: string, fieldName: string, action: keyof FieldPerm, value: boolean) => void;
  onFieldBulk: (objectName: string, action: 'readable' | 'writable' | 'clear', fieldNames: string[]) => void;
}) {
  // objectui#2600 B4 — filter fields and bulk-apply over the visible set, so
  // wide objects (dozens of fields) aren't two-checkboxes-at-a-time tedious.
  const [fieldFilter, setFieldFilter] = React.useState('');
  if (!fields) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> {t('perm.field.loading')}
      </div>
    );
  }
  if (fields.length === 0) {
    return <div className="text-xs text-muted-foreground">{t('perm.field.empty')}</div>;
  }
  const q = fieldFilter.trim().toLowerCase();
  const visible = q
    ? fields.filter((f) => f.name.toLowerCase().includes(q) || (f.label ?? '').toLowerCase().includes(q))
    : fields;
  const visibleNames = visible.map((f) => f.name);
  return (
    <div className="space-y-2">
      {/* Field toolbar (B4): filter + bulk over the visible field set. The
          filter only appears once one-by-one would actually hurt. */}
      <div className="flex flex-wrap items-center gap-2">
        {fields.length > 6 && (
          <Input
            value={fieldFilter}
            onChange={(e) => setFieldFilter(e.target.value)}
            placeholder={t('perm.field.filter')}
            aria-label={t('perm.field.filter')}
            className="h-7 w-44 text-xs"
          />
        )}
        {writable && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              disabled={visibleNames.length === 0}
              onClick={() => onFieldBulk(objectName, 'readable', visibleNames)}
            >
              {t('perm.field.bulk.readable')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              disabled={visibleNames.length === 0}
              onClick={() => onFieldBulk(objectName, 'writable', visibleNames)}
            >
              {t('perm.field.bulk.writable')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              disabled={visibleNames.length === 0}
              onClick={() => onFieldBulk(objectName, 'clear', visibleNames)}
            >
              {t('perm.field.bulk.clear')}
            </Button>
          </div>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {visible.length} / {fields.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t('perm.field.filterEmpty')}</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left py-1 font-medium">{t('perm.field.col.name')}</th>
              <th className="px-2 py-1 font-medium w-16 text-center" title={t('perm.field.read')}>{t('perm.field.read')}</th>
              <th className="px-2 py-1 font-medium w-16 text-center" title={t('perm.field.edit')}>{t('perm.field.edit')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f) => {
              const key = `${objectName}.${f.name}`;
              const cur = fieldsState[key] ?? { readable: true, editable: false };
              return (
                <tr key={f.name} className="border-t border-muted">
                  <td className="py-1">
                    {f.label ?? f.name}
                    {f.label && (
                      <span className="ml-1 text-muted-foreground">({f.name})</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <Checkbox
                      checked={!!cur.readable}
                      disabled={!writable}
                      onCheckedChange={(v) => onFieldPerm(objectName, f.name, 'readable', !!v)}
                      aria-label={`${objectName}.${f.name} readable`}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <Checkbox
                      checked={!!cur.editable}
                      disabled={!writable}
                      onCheckedChange={(v) => onFieldPerm(objectName, f.name, 'editable', !!v)}
                      aria-label={`${objectName}.${f.name} editable`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
