/**
 * Marketplace Package Detail Page.
 *
 * Shows full package metadata + readme + approved version list. Provides
 * an "Install" button that opens a dialog with environment picker. When this
 * environment holds an older version, the same button reads "Update" and opens
 * the same dialog as an UPDATE dialog (objectui#12146). Where install-local is
 * the install door and the package's manifest permits more than one install
 * mode, the page offers the choice and reads the door's answer
 * (objectui#12288, ADR-0131 D6).
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  RadioGroup,
  RadioGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import { ArrowLeft, ExternalLink, Download, AlertCircle, Package, Trash2, MoreHorizontal, CheckCircle2, ArrowUpCircle, Database, Loader2 } from 'lucide-react';
import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import { useDisplayLocale } from '@object-ui/i18n';
import { useAdapter } from '@object-ui/react';
import { PackageIcon } from './PackageIcon.js';
import { MarkdownText } from './MarkdownText.js';
import { PluginDisclosure } from './PluginDisclosure.js';
import { MarketplaceAccessDenied } from './MarketplaceAccessDenied.js';
import { MarketplaceResolving } from './MarketplaceResolving.js';
import { MarketplaceDisabled } from './MarketplaceDisabled.js';
import { localizePackage } from './usePackageL10n.js';
import { isNewerVersion } from './versionPrecedence.js';
import {
  getMarketplacePackage,
  getDeclaredInstallModes,
  installPackage,
  installLocal,
  uninstallLocal,
  listLocalInstalls,
  listCloudEnvironments,
  listInstallableOrgIds,
  cloudConsoleUrl,
  getCloudInstallationInfo,
  reseedSampleData,
  purgeSampleData,
  reseedLocalSampleData,
  purgeLocalSampleData,
  type MarketplaceDetailResponse,
  type CloudEnvironment,
  type LocalInstallEntry,
  type LocalInstallNotLoaded,
  type LocalInstallMode,
  type LocalInstallStrippedLock,
  type CloudInstallationInfo,
} from './marketplaceApi.js';
import { getCloudBase, getRuntimeConfig, isMarketplaceEnabled } from '../../runtime-config.js';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { useMetadata } from '../../providers/MetadataProvider.js';
import { appRouteSegment, filterActiveApps, resolveKeyedI18nLabel } from '../../utils/index.js';
import { waitForServedApp, type ServedApp } from './waitForServedApp.js';
import { SuggestedBindingsPanel, type SuggestedBindingsStrings } from '../../components/SuggestedBindingsPanel.js';
import type { SuggestedBinding } from '../../services/suggestedBindingsApi.js';
import { errorCodeIs } from '@object-ui/types';

/**
 * Whether a cloud install lands in the environment this console renders, read
 * off the same two facts `installPackage` routes on. With a cloud base the
 * install goes through the same-origin `/cloud-connection/install` proxy, which
 * installs into the environment the HOSTNAME names and never reads the picked
 * id. Without one it goes to the control plane for the picked environment,
 * which is this one only when the runtime named it as its own.
 */
function installLandsInThisEnvironment(selectedEnv: string): boolean {
  if (getCloudBase()) return true;
  const currentEnvId = getRuntimeConfig().defaultEnvironmentId;
  return !!currentEnvId && currentEnvId === selectedEnv;
}

/**
 * objectui#12087 — after an install into THIS environment, the page waits for
 * the runtime to serve the package's app before it refreshes the metadata
 * cache. `served` carries the first app of the package a user can open, or
 * `null` when every one is inactive or hidden. `version` is the one the install
 * answer names, so "Check again" waits for the same version (objectui#12098).
 */
type DeployState =
  | { phase: 'waiting'; manifestId: string; version: string | undefined; updatedTo: string | null }
  | { phase: 'served'; manifestId: string; version: string | undefined; updatedTo: string | null; app: ServedApp | null }
  | { phase: 'timeout'; manifestId: string; version: string | undefined; updatedTo: string | null };

/**
 * objectui#12146 — what the dialog is doing, fixed when it opens. `null` is an
 * install (the dialog as it always was); otherwise an update of the copy this
 * environment holds, from the version the page reads as installed to the
 * latest one, both already on the page ("Installed · v3.1.0", "Update
 * available → v4.0.1"). Fixed at open rather than derived per render: the
 * update's own success flips the installed version to the latest, and the
 * dialog that reports it must not turn back into an install dialog.
 */
type DialogUpdate = { from: string; to: string } | null;

/**
 * The major version of a version `isNewerVersion` already accepted, so a
 * SemVer 2.0.0 string by then: its leading numeric identifier.
 */
function majorOf(version: string): number {
  return Number(version.trim().split('.')[0]);
}

/** The side panel's entry for a version, the target of the dialog's release-notes link. */
function versionEntryId(version: string): string {
  return `marketplace-version-${version}`;
}

export function MarketplacePackagePage() {
  const navigate = useNavigate();
  const { packageId, appName } = useParams<{ packageId?: string; appName?: string }>();
  const { isAdmin, isResolved } = useWorkspaceAdminStatus();
  const { t, language } = useObjectTranslation();
  // Dates and numbers on this surface read the display locale; a bare
  // `toLocale*()` call used the MACHINE's locale (objectui#9909).
  const displayLocale = useDisplayLocale();
  // ADR-0090 D5 — install-time suggested audience bindings ("this app
  // suggests granting <set> to Everyone"), surfaced right after a
  // successful install into THIS runtime, with the deployment's decision on
  // each. Accept/dismiss/revoke need `manage_metadata` server-side; the panel
  // renders nothing for a caller without it (the list answers 403).
  const suggestionStrings: SuggestedBindingsStrings = {
    describe: (s: SuggestedBinding) =>
      t(s.anchor === 'guest' ? 'marketplace.suggestedBindings.promptGuest' : 'marketplace.suggestedBindings.promptEveryone', { set: s.permission_set_name }),
    confirm: t('marketplace.suggestedBindings.confirm'),
    confirming: t('marketplace.suggestedBindings.confirming'),
    dismiss: t('marketplace.suggestedBindings.dismiss'),
    confirmedToast: (s: SuggestedBinding) =>
      t('marketplace.suggestedBindings.confirmedToast', { set: s.permission_set_name, anchor: s.anchor }),
    dismissedToast: (s: SuggestedBinding) =>
      t('marketplace.suggestedBindings.dismissedToast', { set: s.permission_set_name }),
    guestUnsupported: t('marketplace.suggestedBindings.guestUnsupported'),
    acceptedState: (s: SuggestedBinding) =>
      t('marketplace.suggestedBindings.acceptedState', { set: s.permission_set_name }),
    notInForceState: (s: SuggestedBinding) =>
      t('marketplace.suggestedBindings.notInForceState', { set: s.permission_set_name }),
    dismissedState: (s: SuggestedBinding) =>
      t('marketplace.suggestedBindings.dismissedState', { set: s.permission_set_name }),
    revoke: t('marketplace.suggestedBindings.revoke'),
    revoking: t('marketplace.suggestedBindings.revoking'),
    revokedToast: (s: SuggestedBinding) =>
      t('marketplace.suggestedBindings.revokedToast', { set: s.permission_set_name }),
  };
  const basePath = appName ? `/apps/${appName}` : '';
  const { refresh: refreshMetadata } = useMetadata();
  // The adapter `MetadataProvider` reads through: the deploy wait asks the
  // same `GET /meta/app` the cache would, without the cache persisting it.
  const adapter = useAdapter();
  const { appLabel } = useObjectLabel();
  // The runtime's own answer, read once per render -- the same read the
  // catalog page makes (objectui#5504). `false` means this runtime mounts no
  // marketplace at all, so there is no package to fetch and nothing to
  // install from here. NEVER inferred from a failed request: see
  // `isMarketplaceEnabled()` for why a 404 is not evidence of it.
  const marketplaceEnabled = isMarketplaceEnabled();

  const [data, setData] = useState<MarketplaceDetailResponse | null>(null);
  // Seeded from the runtime flag rather than settled by the effect: a runtime
  // with no marketplace is not "loading" a package, it is done. Keeps the state
  // truthful even if the early return below is ever reordered -- a seeded
  // `true` with the fetch skipped would spin forever.
  //
  // Deliberately NOT `&& isAdmin`, even though objectui#5583 gates both fetches
  // on `isAdmin` as well. `isAdmin` reads `activeMember`, which AuthProvider
  // resolves asynchronously AFTER the session settles (`refreshActiveMember`),
  // so an admin whose adminship comes from the org member row renders once as a
  // non-admin before flipping. Seeding `false` there would leave that first
  // admin render with `loading: false` and no data -- i.e. the destructive
  // "failed to load" card, painted for a frame before the effect could raise
  // the flag again. `true` means "this runtime has a marketplace, so a package
  // answer is expected and none has arrived yet"; whether THIS viewer may see
  // it is the separate question answered by the guard above the branch.
  const [loading, setLoading] = useState(marketplaceEnabled);
  const [error, setError] = useState<string | null>(null);

  const [installOpen, setInstallOpen] = useState(false);
  const [dialogUpdate, setDialogUpdate] = useState<DialogUpdate>(null);
  // Set by the update dialog's release-notes link: the side-panel entry that
  // takes focus once the dialog has closed, in place of the button that opened
  // it. Ephemeral by design (AGENTS.md #8): it lives for one close.
  const focusOnCloseRef = useRef<string | null>(null);
  const [envs, setEnvs] = useState<CloudEnvironment[]>([]);
  const [envsLoading, setEnvsLoading] = useState(false);
  const [envsError, setEnvsError] = useState<string | null>(null);
  const [selectedEnv, setSelectedEnv] = useState<string>('');
  // env id -> installed version, for annotating the picker with each env's
  // current install state ("Installed v1.0.0" / "Update → v1.0.1"). Lets a
  // multi-env operator see at a glance where this app already lives and which
  // copies are out of date before choosing a target.
  const [envInstallMap, setEnvInstallMap] = useState<Record<string, string>>({});
  const [seedSampleData, setSeedSampleData] = useState(false);
  // PD4: a code-bearing package requires explicit acknowledgement of its
  // requested permissions before the install button is enabled.
  const [acknowledged, setAcknowledged] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [deploy, setDeploy] = useState<DeployState | null>(null);
  // Tracks whether the package has been installed into the current
  // environment via the cloud install path. Used to flip the primary
  // CTA from "Install to Cloud" → "Installed" so the user gets
  // immediate feedback after a successful install. Seeded from the
  // install response (which echoes the installation row) and from a
  // boot-time fetch of sys_package_installation for the current env.
  const [cloudInstalledVersion, setCloudInstalledVersion] = useState<string | null>(null);
  const [cloudInstall, setCloudInstall] = useState<CloudInstallationInfo | null>(null);
  const [sampleDataBusy, setSampleDataBusy] = useState<'reseed' | 'purge' | null>(null);
  const [sampleDataMsg, setSampleDataMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Set once the control plane refuses a cloud Re-seed / Purge with
  // `ENVIRONMENT_KERNEL_UNAVAILABLE` (cloud#2072): it registers no environment
  // kernel, a fact of this deployment's composition rather than a passing
  // fault, so neither action can succeed here and neither is offered again
  // (objectui#10432). Every other code leaves both actions enabled, as before.
  const [cloudSampleDataRefused, setCloudSampleDataRefused] = useState(false);

  // Local-install state (this runtime's own kernel — separate flow from cloud).
  const [localInstalls, setLocalInstalls] = useState<LocalInstallEntry[]>([]);
  const [installingLocal, setInstallingLocal] = useState(false);
  // `unmanaged` is set when the answer was an unmanaged copy (ADR-0131 D6):
  // it carries the locks the copy dropped, and nothing is registered under the
  // package's id, so there are no install-time suggestions to surface.
  const [localResult, setLocalResult] = useState<{
    ok: boolean;
    message: string;
    unmanaged?: { strippedLocks: LocalInstallStrippedLock[] };
  } | null>(null);
  // ADR-0131 D6 — the install modes the package's latest manifest declares,
  // read from the manifest install-local judges, and the operator's pick among
  // them. Both are kept with the package they belong to, so a page that moves
  // to another package never offers or sends the last one's.
  const [modesRead, setModesRead] = useState<{ packageId: string; modes: readonly LocalInstallMode[] | undefined } | null>(null);
  const [modePick, setModePick] = useState<{ packageId: string; mode: LocalInstallMode } | null>(null);
  // `undefined` until read, when the manifest declares none, or when it could
  // not be read: then no choice is drawn and no mode is sent, so the door's own
  // default and answer decide.
  const declaredModes = modesRead && modesRead.packageId === packageId ? modesRead.modes : undefined;
  // Starts unpicked: the spec ranks no permitted mode above another, so the
  // page does not pick one for the operator.
  const chosenMode: LocalInstallMode | '' = modePick && modePick.packageId === packageId ? modePick.mode : '';

  useEffect(() => {
    // `features.installLocal` is a genuinely separate deployment axis from
    // `features.marketplace` (a runtime can mount a local kernel install path
    // with no marketplace proxy at all), so it stays its own check rather than
    // being folded into the other two predicates.
    if (!getRuntimeConfig().features.installLocal) return;
    // Its only consumer is the `localInstall` match below, read by the content
    // branch AND by the marketplace-off local view (objectui#11627). Neither
    // is drawn for a viewer refused the admin surface, so firing for one would
    // be the same discarded-request class `2573ff434` closed for this page
    // (objectui#5620). `marketplaceEnabled` is deliberately NOT a gate any
    // more: on a runtime with no marketplace but a mounted install-local
    // surface, this answer is what decides whether the local menu is drawn.
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const items = await listLocalInstalls();
      if (!cancelled) setLocalInstalls(items);
    })();
    return () => { cancelled = true; };
  }, [packageId, localResult, isAdmin]);

  // ADR-0131 D6 — what the package permits is its manifest's `installModes`,
  // so the page reads the manifest the install door reads: the same path and
  // the same version (`latest`, the one `installLocal` installs when it names
  // none). Only where install-local is the page's install door (the cloud
  // install routes take no mode) and only for a viewer the page serves.
  useEffect(() => {
    if (!packageId) return;
    if (!marketplaceEnabled) return;
    if (!isAdmin) return;
    if (!getRuntimeConfig().features.installLocal) return;
    let cancelled = false;
    (async () => {
      try {
        const modes = await getDeclaredInstallModes(packageId);
        if (!cancelled) setModesRead({ packageId, modes });
      } catch {
        // No manifest to read: no choice and no mode, and the door decides.
      }
    })();
    return () => { cancelled = true; };
  }, [packageId, marketplaceEnabled, isAdmin]);

  // A choice only when the manifest permits more than one mode. One declared
  // mode is sent as declared, with no choice; none declared sends none.
  const offeredInstallModes = declaredModes && declaredModes.length > 1 ? declaredModes : null;
  const requestedInstallMode: LocalInstallMode | undefined = !declaredModes
    ? undefined
    : declaredModes.length === 1 ? declaredModes[0] : (chosenMode || undefined);

  // Seed cloud-install state so the primary CTA renders as "Installed" on
  // first paint instead of inviting another install.
  // NOTE: a tenant runtime (per-subdomain ObjectOS) has NO
  // `defaultEnvironmentId` — but getCloudInstallationInfo's same-origin
  // `/cloud-connection/installation` path resolves the env by hostname and
  // does not need an explicit id (only the cloud-control-plane path needs
  // one, and it no-ops on an empty id internally). So do NOT gate the probe
  // on `currentEnvId` — that left the detail CTA stuck on "Install to
  // cloud…" for every already-installed package in an env console.
  useEffect(() => {
    if (!packageId) return;
    // Nothing to seed a CTA that never renders, and the cloud-install routes
    // are absent on this runtime too -- the probe would be one more guaranteed
    // 404 in the operator's network log.
    if (!marketplaceEnabled) return;
    // The same argument one step further (objectui#5583): this viewer is
    // refused before any CTA renders, so seeding one is work fired on behalf of
    // a page we have already decided not to draw.
    if (!isAdmin) return;
    const currentEnvId = getRuntimeConfig().defaultEnvironmentId ?? '';
    let cancelled = false;
    (async () => {
      const info = await getCloudInstallationInfo(packageId, currentEnvId);
      if (cancelled || !info) return;
      setCloudInstall(info);
      setCloudInstalledVersion(info.version);
    })();
    return () => { cancelled = true; };
  }, [packageId, marketplaceEnabled, isAdmin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!packageId) return;
      // No marketplace on this runtime -> no request. Fetching anyway and
      // discarding the result would still put a 404/403 on the server and can
      // race the destructive card onto the screen before the disabled state
      // settles (`2573ff434`).
      if (!marketplaceEnabled) return;
      // Nor on behalf of a viewer this page refuses (objectui#5583).
      // Authorization is not a function of whether the fetch succeeded, so it
      // is settled before the request rather than after it.
      if (!isAdmin) return;
      setLoading(true);
      setError(null);
      try {
        const resp = await getMarketplacePackage(packageId);
        if (!cancelled) setData(resp);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [packageId, marketplaceEnabled, isAdmin]);

  const openInstall = async (update: DialogUpdate = null) => {
    setDialogUpdate(update);
    setInstallOpen(true);
    setInstallResult(null);
    setEnvsError(null);

    // When the runtime tells us which env we're on (tenant subdomain
    // like demo.objectos.app), skip the picker entirely — the operator's
    // domain already identifies the target. Just open the dialog with
    // the env pre-selected so the sample-data checkbox + Install button
    // remain in place.
    const currentEnvId = getRuntimeConfig().defaultEnvironmentId;
    if (currentEnvId) {
      setEnvsLoading(false);
      setSelectedEnv(currentEnvId);
      setEnvs([]);
      return;
    }

    setEnvsLoading(true);
    try {
      const [list, adminOrgIds] = await Promise.all([
        listCloudEnvironments(),
        listInstallableOrgIds(),
      ]);
      // Only envs in orgs where the caller is owner/admin are installable.
      // Backend enforces the same gate; mirroring it here avoids confusing
      // 403s and lets us show a helpful empty-state message.
      const installable = list.filter((env) => {
        const orgId = env.organization_id;
        return orgId ? adminOrgIds.has(String(orgId)) : false;
      });
      setEnvs(installable);
      // Annotate each installable env with its current install state (best
      // effort, parallel; a failed lookup just omits the annotation).
      setEnvInstallMap({});
      const pkgId = packageId;
      if (pkgId) void Promise.all(
        installable.map(async (env) => {
          try {
            const info = await getCloudInstallationInfo(pkgId, env.id);
            return info ? ([env.id, info.version] as const) : null;
          } catch {
            return null;
          }
        }),
      ).then((pairs) => {
        const map: Record<string, string> = {};
        for (const pair of pairs) if (pair) map[pair[0]] = pair[1];
        setEnvInstallMap(map);
      });
      if (list.length > 0 && installable.length === 0) {
        setEnvsError(t('marketplace.install.noPermission'));
      } else if (installable.length === 1) {
        setSelectedEnv(installable[0].id);
      }
    } catch (e: any) {
      const status = e?.status;
      if (status === 401 || status === 403) {
        setEnvsError(t('marketplace.install.signInFirst'));
      } else {
        setEnvsError(e?.message ?? String(e));
      }
    } finally {
      setEnvsLoading(false);
    }
  };

  /**
   * objectui#12087 — wait until this environment serves the installed
   * package's app, and only then refresh and persist the metadata cache.
   *
   * The cache persists every `app` list it fetches (the tab's sessionStorage
   * seed) and keeps it in memory with no re-read of its own, so a refresh that
   * lands while the runtime still serves the pre-install kernel fixes the
   * pre-install list in place: the install "succeeded" and the app never
   * appeared. The wait reads `GET /meta/app` past the cache instead, and the
   * refresh, the seed drop and the bus pulse all wait for it. On expiry nothing
   * is refreshed, and the page says the app has not appeared rather than that
   * the install succeeded.
   *
   * objectui#12098 — on an upgrade the stale kernel still serves the OLD
   * version's app under the same `_packageId`, so the wait also names the
   * version the install answered with (see `waitForServedApp`).
   *
   * objectui#12146 — `updatedTo` is the version an UPDATE moved to, `null` for
   * an install: the result then says "Updated to vX" rather than the install's
   * "deployed" sentence.
   */
  const awaitServedInstall = async (manifestId: string, version: string | undefined, updatedTo: string | null) => {
    setDeploy({ phase: 'waiting', manifestId, version, updatedTo });
    const wait = await waitForServedApp({
      manifestId,
      version,
      // The SDK's declared list answer (`GetMetaItemsResponse`: `{ type,
      // items }`). Not `MetadataProvider`'s `extractItems`: a value import of
      // that module from this lazy page made rolldown park the provider in
      // this page's chunk, which pulled the page into the eager closure.
      readApps: async () => {
        if (!adapter) throw new Error('No data adapter to read the app list through');
        return (await adapter.getClient().meta.getItems('app')).items;
      },
    });
    if (!wait.served) {
      setDeploy({ phase: 'timeout', manifestId, version, updatedTo });
      return;
    }
    // Invalidate the metadata cache so the newly-installed app's
    // objects/views/menus are fetched fresh on next access, not only the
    // `app` list: otherwise a menu entry of the new app fails with "metadata
    // not found" against objects/views cached from before the install.
    try {
      // Drop the persisted seed too — refresh() overwrites it when the new
      // list comes back, but clearing first protects against a partial
      // failure leaving the pre-install list for the next reload.
      if (typeof sessionStorage !== 'undefined') {
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith('objectui:metadata:')) {
            sessionStorage.removeItem(key);
          }
        }
      }
      await refreshMetadata();
    } catch {
      // Non-fatal: the app is served; worst case the user navigates away and
      // back to pick up the new metadata.
    }
    emitMetadataRefresh();
    setDeploy({ phase: 'served', manifestId, version, updatedTo, app: filterActiveApps(wait.apps)[0] ?? null });
  };

  const doInstall = async () => {
    if (!packageId || !selectedEnv) return;
    setInstalling(true);
    setInstallResult(null);
    try {
      // objectui#12146 — an update never asks for sample data: the update
      // dialog draws no "Include sample data" control, so it sends what an
      // unticked one sends. Adding sample data to an installed copy stays the
      // job of the page's own "Add sample data" action.
      const installResp = await installPackage({
        packageId,
        environmentId: selectedEnv,
        seedSampleData: dialogUpdate ? false : seedSampleData,
      });
      // The version an update reports moving to: the install answer's own, else
      // the one the dialog named.
      const updatedTo = dialogUpdate ? (installResp?.installation?.version ?? dialogUpdate.to) : null;
      // Flip the primary CTA to "Installed" so the user sees the state
      // change without a page refresh. Response includes the install
      // row when the cloud handler echoes it; fall back to the package's
      // latest version when it doesn't.
      const installedVersion = installResp?.installation?.version
        ?? data?.package?.latest_version?.version
        ?? data?.versions?.[0]?.version
        ?? '';
      setCloudInstalledVersion(installedVersion || 'installed');
      // Refresh the installation handle so reseed/purge can target it
      // without the user having to reload the page.
      try {
        const currentEnvId = getRuntimeConfig().defaultEnvironmentId;
        const envId = currentEnvId || selectedEnv;
        if (envId) {
          const info = await getCloudInstallationInfo(packageId, envId);
          if (info) setCloudInstall(info);
        }
      } catch { /* non-fatal */ }
      if (installLandsInThisEnvironment(selectedEnv) && data) {
        // objectui#12087 — the runtime answers this install while it still
        // serves the PRE-install kernel, so nothing is refreshed yet: the wait
        // below refreshes once the package's app is served. Not awaited, and
        // not cancelled on unmount: an operator who leaves this page while the
        // app deploys still gets the refreshed cache when it lands. The version
        // is the answer's own (objectui#12098), never the catalog's latest: an
        // answer that names none waits on the id alone, as before.
        void awaitServedInstall(data.package.manifest_id, installResp?.installation?.version, updatedTo);
      } else {
        // Another environment: nothing this console renders changed, so there
        // is nothing here to wait for or to refresh.
        setInstallResult({
          ok: true,
          message: updatedTo
            ? t('marketplace.update.success', { version: updatedTo })
            : t('marketplace.install.success'),
        });
      }
    } catch (e: any) {
      setInstallResult({ ok: false, message: e?.message ?? String(e) });
    } finally {
      setInstalling(false);
    }
  };

  /**
   * Install this package into the LOCAL runtime kernel (not a cloud env).
   * Single-target operation — no picker, no dialog. Same-origin POST so
   * cloud session is not required. The local AuthPlugin session is what
   * the backend validates.
   */
  const doInstallLocal = async () => {
    if (!packageId) return;
    // ADR-0131 D6 — the mode is sent only when the manifest declares
    // `installModes`: its one mode, or the operator's pick among several.
    // Declaring none sends none, and the door's own default stands.
    const installMode = requestedInstallMode;
    if (offeredInstallModes && !installMode) return;
    setInstallingLocal(true);
    setLocalResult(null);
    try {
      const result = await installLocal({ packageId, ...(installMode ? { installMode } : {}) });
      const name = data?.package ? localizePackage(data.package as any, language).displayName : result.manifestId;
      // An unmanaged copy (ADR-0131 D6): the package's metadata is this
      // runtime's own from now on, in the base the answer names; the answer
      // lists every protection lock the copy dropped, with the package's reason.
      if (result.installMode === 'unmanaged') {
        try {
          await refreshMetadata('app');
        } catch {
          // Non-fatal: the copy is written; the app list refreshes on next navigation.
        }
        setLocalResult({
          ok: true,
          message: t('marketplace.install.unmanagedSuccess', { version: result.version, name, base: result.targetPackageId }),
          unmanaged: { strippedLocks: result.strippedLocks },
        });
        emitMetadataRefresh();
        return;
      }
      // Asked for a copy, answered without one: a runtime that predates the
      // install mode reads no `installMode` and installed the package MANAGED.
      // Said out loud, since the opposite of what was asked happened.
      const ignoredCopy = installMode === 'unmanaged';
      // objectui#12098 — `hotLoaded` says whether the running kernel registered
      // the package (objectstack#22695). `false` is the runtime's lenient path:
      // installed and in its ledger, loaded at its next restart. Nothing of it
      // is served until then, so the app list is not refreshed as if it were,
      // and the page says when the app will appear.
      if (!result.hotLoaded) {
        setLocalResult(ignoredCopy
          ? { ok: false, message: t('marketplace.install.unmanagedIgnored', { name }) }
          : { ok: true, message: t('marketplace.install.localLoadsAtRestart', { version: result.version, name }) });
        return;
      }
      try {
        await refreshMetadata('app');
      } catch {
        // Non-fatal: the install succeeded; the app list will refresh on next navigation.
      }
      setLocalResult(ignoredCopy
        ? { ok: false, message: t('marketplace.install.unmanagedIgnored', { name }) }
        : { ok: true, message: t('marketplace.install.localSuccess', { version: result.version, name }) });
      emitMetadataRefresh();
    } catch (e: any) {
      // A refusal shows the envelope's own message. The install-mode refusals
      // (`INSTALL_MODE_NOT_PERMITTED`, `UNMANAGED_INSTALL_WALLED_POSTURE`,
      // `RESOURCE_CONFLICT`) take no branch below: each message names its own
      // remedy, and the page has nothing to add to it.
      const code = e?.code;
      let msg = e?.message ?? String(e);
      if (errorCodeIs(e, 'MANIFEST_CONFLICT')) {
        msg = t('marketplace.install.localManifestConflict', { message: msg });
      } else if (errorCodeIs(e, 'UNAUTHENTICATED')) {
        msg = t('marketplace.install.localUnauthorized');
      } else if (errorCodeIs(e, 'MARKETPLACE_UNAVAILABLE')) {
        msg = t('marketplace.install.localMarketplaceUnavailable');
      }
      setLocalResult({ ok: false, message: msg });
    } finally {
      setInstallingLocal(false);
    }
  };

  /**
   * Uninstall this package's cached manifest from the local runtime.
   * NB: kernel API is additive only — the app remains live in the
   * running kernel until the runtime restarts. We surface that
   * caveat in the success message.
   *
   * Except for a package this runtime did not load (the listing's `notLoaded`
   * marker): nothing of it is in the running kernel, so its confirm and its
   * result drop that caveat, which would contradict the header's own
   * "Not loaded" — the texts Installed Apps uses for the same entry
   * (objectui#11760, objectui#11645).
   */
  const doUninstallLocal = async () => {
    if (!localInstall) return;
    const question = localInstall.notLoaded
      ? t('marketplace.uninstall.confirmNotLoaded', { manifestId: localInstall.manifestId, version: localInstall.version })
      : t('marketplace.uninstall.confirm', { manifestId: localInstall.manifestId, version: localInstall.version });
    if (!confirm(question)) {
      return;
    }
    setInstallingLocal(true);
    setLocalResult(null);
    try {
      await uninstallLocal(localInstall.manifestId);
      try {
        await refreshMetadata('app');
      } catch {
        // Non-fatal.
      }
      setLocalResult({
        ok: true,
        message: localInstall.notLoaded
          ? t('marketplace.uninstall.successNotLoaded', { manifestId: localInstall.manifestId })
          : t('marketplace.uninstall.successInDetail', { manifestId: localInstall.manifestId }),
      });
    } catch (e: any) {
      setLocalResult({ ok: false, message: e?.message ?? String(e) });
    } finally {
      setInstallingLocal(false);
    }
  };

  /**
   * Re-seed sample data into the cloud environment for this install.
   * Used when the user forgot to tick "Include sample data" during the
   * original install. SeedLoaderService upserts by id, so calling this
   * multiple times is safe.
   */
  const doReseedSampleData = async () => {
    if (!cloudInstall) return;
    setSampleDataBusy('reseed');
    setSampleDataMsg(null);
    try {
      const r = await reseedSampleData(cloudInstall.installationId);
      if (r.ok) {
        setCloudInstall({ ...cloudInstall, withSampleData: true });
        setSampleDataMsg({
          ok: true,
          text: t('marketplace.detail.reseedQueued'),
        });
      } else if (errorCodeIs(r, 'ENVIRONMENT_KERNEL_UNAVAILABLE')) {
        setCloudSampleDataRefused(true);
        setSampleDataMsg({ ok: false, text: t('marketplace.detail.sampleDataKernelUnavailable') });
      } else {
        setSampleDataMsg({ ok: false, text: r.error || 'Re-seed failed' });
      }
    } finally {
      setSampleDataBusy(null);
    }
  };

  /**
   * Delete the sample data this package seeded. Use before going live
   * with a clean production environment. Only records declared in the
   * package's seed datasets are removed; user-added rows are untouched.
   */
  const doPurgeSampleData = async () => {
    if (!cloudInstall) return;
    if (!confirm(t('marketplace.detail.purgeConfirm'))) {
      return;
    }
    setSampleDataBusy('purge');
    setSampleDataMsg(null);
    try {
      const r = await purgeSampleData(cloudInstall.installationId);
      if (r.ok) {
        setCloudInstall({ ...cloudInstall, withSampleData: false });
        const removed = r.deleted ?? 0;
        setSampleDataMsg({
          ok: true,
          text: removed > 0
            ? t('marketplace.detail.purgeSuccess', { count: removed })
            : t('marketplace.detail.purgeNoData'),
        });
      } else if (errorCodeIs(r, 'ENVIRONMENT_KERNEL_UNAVAILABLE')) {
        setCloudSampleDataRefused(true);
        setSampleDataMsg({ ok: false, text: t('marketplace.detail.sampleDataKernelUnavailable') });
      } else {
        setSampleDataMsg({ ok: false, text: r.error || 'Purge failed' });
      }
    } finally {
      setSampleDataBusy(null);
    }
  };

  const doReseedLocalSampleData = async () => {
    if (!localInstall) return;
    setSampleDataBusy('reseed');
    setSampleDataMsg(null);
    try {
      const r = await reseedLocalSampleData(localInstall.manifestId);
      setLocalInstalls((prev) => prev.map((i) =>
        i.manifestId === localInstall.manifestId ? { ...i, withSampleData: true } : i,
      ));
      const inserted = r.inserted ?? 0;
      const updated = r.updated ?? 0;
      const errored = r.errors ?? 0;
      const base = t('marketplace.detail.reseedLocalSuccess', { inserted, updated });
      // A reseed can land some rows and fail others (the server only hard-fails
      // when ZERO rows write). Don't hide the partial failures behind a green
      // success toast — flag them so the user knows the data is incomplete.
      setSampleDataMsg(errored > 0
        ? { ok: false, text: `${base} ${t('marketplace.detail.reseedPartialErrors', { count: errored })}` }
        : { ok: true, text: base });
    } catch (err: any) {
      setSampleDataMsg({ ok: false, text: err?.message || 'Re-seed failed' });
    } finally {
      setSampleDataBusy(null);
    }
  };

  const doPurgeLocalSampleData = async () => {
    if (!localInstall) return;
    if (!confirm(t('marketplace.detail.purgeConfirm'))) {
      return;
    }
    setSampleDataBusy('purge');
    setSampleDataMsg(null);
    try {
      const r = await purgeLocalSampleData(localInstall.manifestId);
      setLocalInstalls((prev) => prev.map((i) =>
        i.manifestId === localInstall.manifestId ? { ...i, withSampleData: false } : i,
      ));
      const removed = r.deleted ?? 0;
      setSampleDataMsg({
        ok: true,
        text: removed > 0
          ? t('marketplace.detail.purgeSuccess', { count: removed })
          : t('marketplace.detail.purgeNoData'),
      });
    } catch (err: any) {
      setSampleDataMsg({ ok: false, text: err?.message || 'Purge failed' });
    } finally {
      setSampleDataBusy(null);
    }
  };

  // `features.installLocal` is the server's own answer to "is the install-local
  // surface mounted here" -- the same read the effect above gates on, never a
  // guess from the package's fields.
  const supportsLocal = getRuntimeConfig().features.installLocal;
  // Which local install, if any, this page is about. With a marketplace the
  // catalog row names it, by manifest id. Without one there is no catalog row,
  // and the route's id is the one Installed Apps built this link from
  // (`entry.packageId`), so it is matched on that same field. Declared ahead of
  // every early return: the local sample-data handlers above close over it.
  const localInstall = (marketplaceEnabled
    ? localInstalls.find((i) => !!data && i.manifestId === data.package.manifest_id)
    : localInstalls.find((i) => i.packageId === packageId)) ?? null;

  // The local-install menu and the two status banners, drawn by both the
  // catalog view and the marketplace-off local view below (objectui#11627).
  //
  // objectui#11760 — a local install this runtime refused to load at startup
  // (the listing's `notLoaded` marker) is still installed but none of it runs,
  // so it is not drawn as "Installed": it gets the installed version and the
  // destructive "Not loaded" badge Installed Apps draws for the same entry, and
  // the reason beneath the badges (objectui#11645). A loaded entry is untouched.
  const localInstalledBadge = localInstall && (localInstall.notLoaded ? (
    <>
      <Badge variant="outline">{t('marketplace.versionBadge', { version: localInstall.version })}</Badge>
      <Badge variant="destructive">{t('marketplace.notLoaded.badge')}</Badge>
    </>
  ) : (
    <Badge variant="default" className="bg-green-600 hover:bg-green-600 gap-1">
      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      {t('marketplace.detail.installedV', { version: localInstall.version })}
    </Badge>
  ));
  // The reason in plain words. A code the console has no sentence for is still
  // read as not loaded, naming the code — Installed Apps' reading of the marker.
  const notLoadedReason = (marker: LocalInstallNotLoaded): string =>
    marker.code === 'OS_PROTOCOL_INCOMPATIBLE'
      ? t('marketplace.notLoaded.protocolIncompatible', { requiredRange: marker.requiredRange })
      : t('marketplace.notLoaded.otherReason', { code: marker.code });
  const localNotLoadedReason = localInstall?.notLoaded && (
    <p className="text-xs text-destructive mt-2 flex items-start gap-1.5">
      <AlertCircle className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden="true" />
      <span>{notLoadedReason(localInstall.notLoaded)}</span>
    </p>
  );
  const localMenu = localInstall && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className="px-2.5" aria-label={t('marketplace.detail.moreOptions')}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* objectui#11645 — re-seed and purge write and read the package's own
            objects, which a package this runtime refused to load at startup
            (`notLoaded`) never registered, so neither is offered for it. The
            listing omits `withSampleData` for such an entry, and its absence
            used to read as "Add sample data". Uninstall stays: it is how the
            operator removes the refused entry. */}
        {!localInstall.notLoaded && (
          <>
            <DropdownMenuItem onSelect={doReseedLocalSampleData} disabled={sampleDataBusy !== null}>
              {sampleDataBusy === 'reseed'
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                : <Database className="h-4 w-4 mr-2" aria-hidden="true" />}
              {localInstall.withSampleData
                ? t('marketplace.detail.reseedAgain')
                : t('marketplace.detail.addSampleData')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={doPurgeLocalSampleData}
              disabled={sampleDataBusy !== null || !localInstall.withSampleData}
              className="text-destructive focus:text-destructive"
            >
              {sampleDataBusy === 'purge'
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                : <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />}
              {t('marketplace.detail.purgeSampleData')}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onSelect={doUninstallLocal} disabled={installingLocal} className="text-destructive focus:text-destructive">
          <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
          {t('marketplace.detail.uninstallFromRuntime')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const sampleDataNote = sampleDataMsg && (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-md border p-3 text-sm ${sampleDataMsg.ok ? 'border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}
    >
      {sampleDataMsg.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />}
      <div className="flex-1">{sampleDataMsg.text}</div>
      <button
        type="button"
        className="text-xs underline opacity-60 hover:opacity-100"
        onClick={() => setSampleDataMsg(null)}
      >
        {t('marketplace.action.dismiss')}
      </button>
    </div>
  );
  // objectui#12087 — the install-into-this-environment status, from the
  // install answering until its app is served (or the wait expires). Drawn in
  // the install dialog while it is open and on the page once it is closed, so
  // closing the dialog does not hide what is still happening.
  const deployApp = deploy?.phase === 'served' ? deploy.app : null;
  const deployNote = deploy && (
    <div
      role="status"
      data-testid="install-deploy-status"
      className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
        deploy.phase === 'served'
          ? 'border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400'
          : deploy.phase === 'timeout'
            ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
            : 'border-border bg-muted/40 text-foreground'
      }`}
    >
      {deploy.phase === 'waiting'
        ? <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
        : deploy.phase === 'served'
          ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />}
      <div className="flex-1 space-y-2">
        <div>
          {deploy.phase === 'waiting'
            ? t('marketplace.install.deploying')
            : deploy.phase === 'served'
              ? (deploy.updatedTo
                  ? t('marketplace.update.success', { version: deploy.updatedTo })
                  : t('marketplace.install.deployed'))
              : (deploy.updatedTo
                  ? t('marketplace.update.deployTimeout', { version: deploy.updatedTo })
                  : t('marketplace.install.deployTimeout'))}
        </div>
        {deployApp && appRouteSegment(deployApp) ? (
          <Button size="sm" onClick={() => navigate(`/apps/${appRouteSegment(deployApp)}`)}>
            {t('marketplace.install.openApp', {
              name: appLabel({
                name: String(deployApp.name ?? appRouteSegment(deployApp)),
                label: resolveKeyedI18nLabel(deployApp.label, t),
              }),
            })}
          </Button>
        ) : null}
        {deploy.phase === 'timeout' ? (
          <Button size="sm" variant="outline" onClick={() => void awaitServedInstall(deploy.manifestId, deploy.version, deploy.updatedTo)}>
            {t('marketplace.install.checkAgain')}
          </Button>
        ) : null}
      </div>
    </div>
  );

  // `suggestFor` is the manifest id whose suggested audience bindings a
  // successful local INSTALL surfaces (ADR-0090 D5), or `null` where no install
  // door is drawn and the only result this banner can carry is an uninstall's.
  const localResultNote = (suggestFor: string | null) => localResult && (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-md border p-3 text-sm whitespace-pre-wrap ${localResult.ok ? 'border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}
    >
      {localResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />}
      <div className="flex-1">
        {localResult.message}
        {/* ADR-0131 D6 — each protection lock the unmanaged copy dropped, as
            the answer states it: the item, the lock and the package's reason
            verbatim, so the operator reads why the vendor locked an item
            before editing it. */}
        {localResult.unmanaged && localResult.unmanaged.strippedLocks.length > 0 ? (
          <div className="mt-2 whitespace-normal" data-testid="unmanaged-stripped-locks">
            <p>{t('marketplace.install.unmanagedStrippedLocks')}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {localResult.unmanaged.strippedLocks.map((entry, i) => (
                <li key={`${entry.type}.${entry.name}.${i}`}>
                  <code className="font-mono text-xs">{entry.type}.{entry.name}</code>
                  {': '}
                  <code className="font-mono text-xs">{entry.lock}</code>
                  {entry.reason ? <>{' — '}{entry.reason}</> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {/* ADR-0090 D5 — local installs land in this runtime's kernel, so
            its suggested audience bindings are confirmable right here. Not
            for an unmanaged copy: nothing is registered under the package. */}
        {localResult.ok && suggestFor && !localResult.unmanaged ? (
          <SuggestedBindingsPanel packageId={suggestFor} strings={suggestionStrings} className="mt-2" />
        ) : null}
      </div>
      <button
        type="button"
        className="text-xs underline opacity-60 hover:opacity-100"
        onClick={() => setLocalResult(null)}
      >
        {t('marketplace.action.dismiss')}
      </button>
    </div>
  );

  // A CONFIGURATION CONCLUSION, not a load failure -- the same informational
  // state the catalog page renders, so the two pages stop disagreeing about the
  // same runtime (`2573ff434`). Reached by a pasted or bookmarked package URL,
  // the only way in once the catalog and both Home entries are gated.
  //
  // Ahead of the `!isAdmin` branch below deliberately: on a runtime that mounts
  // no marketplace, "there is no marketplace here" is true of every viewer, and
  // `features.marketplace` is public runtime config that any client already
  // reads. Telling an unprivileged operator they lack permission for a surface
  // that exists for nobody is the same misdirection this fix removes.
  //
  // objectui#11627 — that answer covers the REMOTE half of the page only. A
  // runtime with no marketplace can still mount the install-local surface (an
  // offline boot, `OS_CLOUD_URL=off`), and Installed Apps links each local
  // install's Details here; the notice used to be all that page showed, so
  // local reseed / purge had no way in. Now an admin whose package IS a local
  // install also gets its header and local menu, ABOVE the same notice: the
  // catalog fetch, the install-to-cloud CTA, the readme and the version list
  // stay refused exactly as before, and every other viewer sees the notice
  // alone. The local half is ADDED once `listLocalInstalls` answers, so the
  // notice is never painted and then retracted.
  if (!marketplaceEnabled) {
    if (!(supportsLocal && isAdmin && (localInstall || localResult))) return <MarketplaceDisabled />;
    return (
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 p-4 sm:p-6">
        {localInstall && (
          <div className="flex items-start gap-5 flex-wrap sm:flex-nowrap rounded-2xl border bg-gradient-to-br from-primary/5 via-background to-background p-6 sm:p-8">
            <PackageIcon
              manifestId={localInstall.manifestId}
              className="h-20 w-20 rounded-2xl shadow-sm ring-1 ring-border shrink-0"
              initialClassName="text-3xl font-bold"
            />
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">{localInstall.manifestId}</h1>
              <div className="text-sm text-muted-foreground mt-2 flex flex-wrap items-center gap-1.5">
                {localInstalledBadge}
              </div>
              {localNotLoadedReason}
            </div>
            <div className="flex items-center gap-2 shrink-0 self-start">
              {localMenu}
            </div>
          </div>
        )}
        {sampleDataNote}
        {localResultNote(null)}
        <MarketplaceDisabled />
      </div>
    );
  }

  // Ahead of BOTH the loading and the load-failure branches below
  // (objectui#5583): authorization is not a function of whether the fetch
  // succeeded. Sitting behind them, this guard handed a non-admin whose package
  // failed to load the destructive "Failed to load package" card carrying the
  // server's own error message -- a diagnosis about a surface they are not
  // allowed to use -- and reached the refusal only on the paths where the load
  // happened to work. Both fetch effects above are gated on the same predicate,
  // so the refusal also stops the page requesting on behalf of a viewer it has
  // already decided to turn away: the discipline `2573ff434` established on
  // this page for `features.marketplace`, applied to the other predicate that
  // decides the same thing.
  //
  // The server remains the authority on what a non-admin may fetch; this only
  // stops the client doing work it would throw away. It is also the ordering
  // `MarketplacePage` carries after objectui#5557, so the sibling pages now
  // answer one runtime the same way for every viewer.
  // objectui#5619 — a refusal is not a repaint: `MarketplaceAccessDenied` tells
  // a real administrator they lack a grant they hold, and it is the frame they
  // read. The verdict has a third state ("not resolved yet") and this guard is
  // the reason it exists. Ordered AFTER `!marketplaceEnabled` deliberately —
  // that answer is true of every viewer on this runtime and needs no verdict,
  // so the ordering objectui#5557 and `2573ff434` established is untouched — and BEFORE
  // `!isAdmin`, which is the branch that must not fire on a guess.
  //
  // This is NOT the incidental skeleton objectui#5621 removed: that one hid the
  // window behind an unrelated package fetch, for as long as the network
  // happened to take. This waits on the verdict itself and on nothing else, and
  // `isResolved` is already true for any admin the session identifies.
  if (!isResolved) return <MarketplaceResolving />;

  if (!isAdmin) return <MarketplaceAccessDenied />;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 p-4 sm:p-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 p-4 sm:p-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`${basePath}/system/marketplace`)}>
          <ArrowLeft className="h-4 w-4 mr-1.5" aria-hidden="true" />
          {t('marketplace.back')}
        </Button>
        <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" aria-hidden="true" />
          <div>
            <div className="font-medium text-destructive">{t('marketplace.load.packageFailed')}</div>
            <div className="text-muted-foreground mt-1">{error ?? t('marketplace.load.notFound')}</div>
          </div>
        </div>
      </div>
    );
  }

  const pkg = data.package;
  const loc = localizePackage(pkg as any, language);
  const latestVersion = pkg.latest_version?.version ?? data.versions[0]?.version ?? null;
  // PD4 (ADR-0025 §3.11): code-bearing packages must disclose + be acknowledged.
  const containsCode = !!pkg.latest_version?.contains_code;
  // ADR-0010 version lifecycle: installed cloud env is on an OLDER version than
  // the package's latest published → surface an update affordance. OLDER is
  // SemVer precedence, not inequality (objectui#10899): an env holding a newer
  // version than the latest approved one is not offered a "downgrade update".
  // The `'installed'` sentinel (version unknown) has no precedence, so it never
  // claims an update either.
  const cloudUpdateAvailable = !!cloudInstalledVersion
    && !!latestVersion
    && isNewerVersion(latestVersion, cloudInstalledVersion);

  // ADR-0131 D6 — where the package permits more than one mode, the install
  // waits for the operator's pick.
  const installModeUnpicked = supportsLocal && !!offeredInstallModes && !chosenMode;
  const primaryDisabled = !latestVersion || installingLocal || installing || installModeUnpicked || (!supportsLocal && !!cloudInstalledVersion && !cloudUpdateAvailable);
  // The reason Install is disabled, when the missing pick is what disables it:
  // the console's convention for a disabled control (`DeclaredActionsBar`'s
  // `actions.notAvailableForRecord`) — a focusable wrapper that opens it on
  // hover and focus, and an accessible description on the button and on the
  // wrapper, so a screen reader hears it with the tooltip closed.
  const installModeReason = installModeUnpicked && !!latestVersion && !installingLocal && !installing
    ? t('marketplace.install.mode.required')
    : undefined;
  const installModeReasonId = 'install-mode-required-reason';
  const primaryAction = supportsLocal
    ? {
      label: installingLocal
        ? t('marketplace.action.working')
        : localInstall
          ? t('marketplace.action.reinstall')
          : t('marketplace.action.install'),
      onClick: doInstallLocal,
    }
    : {
      label: installing
        ? (dialogUpdate ? t('marketplace.action.updating') : t('marketplace.action.installing'))
        : cloudInstalledVersion
          ? (cloudUpdateAvailable
              // No `version` argument: `marketplace.action.updateTo` reads a bare
              // `Update` in all ten packs, so i18next had nothing to interpolate
              // and silently dropped it (objectui#3845). Its sister
              // `marketplace.install.updateTo` below DOES render the version —
              // whether this button should too is a copy decision, not a fix.
              ? t('marketplace.action.updateTo', { defaultValue: 'Update' })
              : t('marketplace.action.installed', { defaultValue: 'Installed' }))
          : t('marketplace.action.installToCloud'),
      // objectui#12146 — "Update" opens the dialog as an update of the copy
      // this environment holds, naming both versions; every other state opens
      // it as the install dialog, unchanged.
      onClick: () => void openInstall(cloudUpdateAvailable && cloudInstalledVersion && latestVersion
        ? { from: cloudInstalledVersion, to: latestVersion }
        : null),
    };

  // The update dialog's notice for a major-version jump, and the side-panel
  // entry its release-notes link points at: the target version's, when the
  // panel lists that version with notes. No notes, no link.
  const majorJump = !!dialogUpdate && majorOf(dialogUpdate.to) > majorOf(dialogUpdate.from);
  const targetNotes = dialogUpdate
    ? data.versions.find((v) => v.version === dialogUpdate.to && !!v.release_notes?.trim())
    : undefined;

  const categoryLabel = pkg.category
    ? t(`marketplace.category.${pkg.category}` as any, { defaultValue: pkg.category })
    : null;

  // ADR-0131 D6 — the install modes the manifest permits, as the operator's
  // choice: drawn only where it permits more than one. A package that permits
  // only `unmanaged` draws no choice, but says what its install does before
  // the click, since that install is a copy rather than the registration every
  // install was before the key existed.
  const installModeChoice = supportsLocal && offeredInstallModes ? (
    <div className="mt-4 max-w-2xl space-y-2" data-testid="install-mode-choice">
      <p id="install-mode-label" className="text-sm font-medium">{t('marketplace.install.mode.label')}</p>
      <RadioGroup
        value={chosenMode}
        onValueChange={(v) => {
          const mode = offeredInstallModes.find((m) => m === v);
          setModePick(mode && packageId ? { packageId, mode } : null);
        }}
        aria-labelledby="install-mode-label"
        disabled={installingLocal}
        className="gap-3"
      >
        {offeredInstallModes.map((mode) => (
          <div key={mode} className="flex items-start gap-2">
            <RadioGroupItem value={mode} id={`install-mode-${mode}`} className="mt-0.5" />
            <Label htmlFor={`install-mode-${mode}`} className="grid gap-0.5 font-normal cursor-pointer">
              <span className="font-medium">
                {mode === 'managed' ? t('marketplace.install.mode.managed') : t('marketplace.install.mode.unmanaged')}
              </span>
              <span className="text-xs text-muted-foreground">
                {mode === 'managed' ? t('marketplace.install.mode.managedHint') : t('marketplace.install.mode.unmanagedHint')}
              </span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  ) : supportsLocal && declaredModes?.length === 1 && declaredModes[0] === 'unmanaged' ? (
    <p className="mt-3 max-w-2xl text-sm text-muted-foreground" data-testid="install-mode-sole">
      <span className="font-medium text-foreground">{t('marketplace.install.mode.unmanaged')}</span>
      {': '}
      {t('marketplace.install.mode.unmanagedHint')}
    </p>
  ) : null;

  const primaryButton = (
    <Button
      onClick={primaryAction.onClick}
      disabled={primaryDisabled}
      aria-describedby={installModeReason ? installModeReasonId : undefined}
      size="lg"
      className="min-w-[8rem]"
    >
      <Download className="h-4 w-4 mr-1.5" aria-hidden="true" />
      {primaryAction.label}
    </Button>
  );
  // A natively disabled button fires no pointer or focus events, so the
  // wrapping span is the tooltip trigger and the Tab stop.
  const primaryControl = installModeReason ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-describedby={installModeReasonId}
            data-disabled-reason=""
            className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {primaryButton}
            <span id={installModeReasonId} className="sr-only">{installModeReason}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{installModeReason}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : primaryButton;

  return (
    <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 p-4 sm:p-6">
      <Button variant="ghost" size="sm" className="self-start -ml-2 text-muted-foreground hover:text-foreground" onClick={() => navigate(`${basePath}/system/marketplace`)}>
        <ArrowLeft className="h-4 w-4 mr-1.5" aria-hidden="true" />
        {t('marketplace.back')}
      </Button>

      <div className="flex items-start gap-5 flex-wrap sm:flex-nowrap rounded-2xl border bg-gradient-to-br from-primary/5 via-background to-background p-6 sm:p-8">
        <PackageIcon
          iconUrl={pkg.icon_url}
          displayName={loc.displayName}
          manifestId={pkg.manifest_id}
          className="h-20 w-20 rounded-2xl shadow-sm ring-1 ring-border shrink-0"
          initialClassName="text-3xl font-bold"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">{loc.displayName || pkg.manifest_id}</h1>
            {pkg.homepage_url && (
              <a
                href={pkg.homepage_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                title={t('marketplace.detail.homepage')}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t('marketplace.detail.homepage')}</span>
              </a>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-2 flex flex-wrap items-center gap-1.5">
            <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">{pkg.manifest_id}</code>
            {latestVersion && <Badge variant="outline">{t('marketplace.versionBadge', { version: latestVersion })}</Badge>}
            {pkg.publisher && pkg.publisher !== 'private' && (
              <Badge variant={pkg.publisher === 'objectstack' ? 'default' : 'secondary'}>{pkg.publisher}</Badge>
            )}
            {categoryLabel && <Badge variant="outline">{categoryLabel}</Badge>}
            {pkg.license && <Badge variant="outline" className="font-normal">{pkg.license}</Badge>}
            {localInstalledBadge}
            {!localInstall && cloudInstalledVersion && (
              <Badge variant="default" className="bg-green-600 hover:bg-green-600 gap-1">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {t('marketplace.detail.installedV', { version: cloudInstalledVersion })}
              </Badge>
            )}
            {cloudUpdateAvailable && (
              <Badge variant="default" className="bg-amber-500 hover:bg-amber-500 gap-1">
                <ArrowUpCircle className="h-3 w-3" aria-hidden="true" />
                {t('marketplace.detail.updateAvailable', { defaultValue: 'Update available' })} → v{latestVersion}
              </Badge>
            )}
          </div>
          {localNotLoadedReason}
          {loc.description && (
            <p className="text-sm sm:text-base text-foreground/80 mt-3 max-w-2xl leading-relaxed">{loc.description}</p>
          )}
          {installModeChoice}
        </div>
        <div className="flex items-center gap-2 shrink-0 self-start">
          {primaryControl}
          {localMenu}
          {/* Reseed / purge still POST cross-origin to the control plane, which
              the browser blocks on a tenant subdomain. Only offer them when the
              runtime IS the cloud (same-origin). On tenants the install state is
              still detected — the CTA flips to "Installed" — we just hide the
              sample-data actions until they route through a same-origin proxy. */}
          {!localInstall && cloudInstall && !getRuntimeConfig().cloudUrl && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg" className="px-2.5" aria-label={t('marketplace.detail.moreOptions')}>
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={doReseedSampleData} disabled={sampleDataBusy !== null || cloudSampleDataRefused}>
                  {sampleDataBusy === 'reseed'
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                    : <Database className="h-4 w-4 mr-2" aria-hidden="true" />}
                  {cloudInstall.withSampleData
                    ? t('marketplace.detail.reseedAgain')
                    : t('marketplace.detail.addSampleData')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={doPurgeSampleData}
                  disabled={sampleDataBusy !== null || cloudSampleDataRefused || !cloudInstall.withSampleData}
                  className="text-destructive focus:text-destructive"
                >
                  {sampleDataBusy === 'purge'
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                    : <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />}
                  {t('marketplace.detail.purgeSampleData')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {sampleDataNote}

      {!installOpen && deployNote}

      {localResultNote(pkg.manifest_id)}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('marketplace.detail.about')}</CardTitle>
            </CardHeader>
            <CardContent>
              {loc.readme ? (
                <MarkdownText source={loc.readme} />
              ) : (
                <p className="text-sm text-muted-foreground">{t('marketplace.detail.noReadme')}</p>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('marketplace.detail.versions')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('marketplace.detail.noApprovedVersions')}</p>
              ) : (
                <ul className="space-y-3">
                  {data.versions.map((v) => (
                    <li
                      key={v.id}
                      id={versionEntryId(v.version)}
                      tabIndex={-1}
                      className="space-y-1 rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <Package className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          <code className="font-mono">v{v.version}</code>
                          {v.is_prerelease && <Badge variant="outline" className="text-xs">{t('marketplace.detail.prerelease')}</Badge>}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {v.published_at ? new Date(v.published_at).toLocaleDateString(displayLocale) : '\u2014'}
                        </span>
                      </div>
                      {v.release_notes && v.release_notes.trim() && (
                        <p className="whitespace-pre-line pl-5 text-xs text-muted-foreground">{v.release_notes.trim()}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={installOpen} onOpenChange={(o) => { setInstallOpen(o); if (!o) { setInstallResult(null); setAcknowledged(false); } }}>
        <DialogContent
          onCloseAutoFocus={(e) => {
            // The release-notes link closed the dialog: focus (and so scroll
            // to) the notes it named, not the button that opened the dialog.
            const target = focusOnCloseRef.current;
            focusOnCloseRef.current = null;
            const el = target ? document.getElementById(target) : null;
            if (!el) return;
            e.preventDefault();
            el.focus();
            el.scrollIntoView?.({ block: 'center' });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {dialogUpdate
                ? t('marketplace.update.dialogTitle', { name: loc.displayName || pkg.manifest_id })
                : t('marketplace.install.dialogTitle', { name: loc.displayName || pkg.manifest_id })}
            </DialogTitle>
            <DialogDescription>
              {getRuntimeConfig().defaultEnvironmentId
                ? (dialogUpdate
                    ? t('marketplace.update.dialogDescCurrent', { host: typeof window !== 'undefined' ? window.location.host : '' })
                    : t('marketplace.install.dialogDescCurrent', { host: typeof window !== 'undefined' ? window.location.host : '' }))
                : (dialogUpdate
                    ? t('marketplace.update.dialogDescPicker')
                    : t('marketplace.install.dialogDescPicker'))}
            </DialogDescription>
          </DialogHeader>

          {/* objectui#12146 — an update names the version it moves from and the
              one it moves to, and a major-version jump says so in one line that
              links to the target version's notes in the side panel. */}
          {dialogUpdate && (
            <div className="space-y-2">
              <p data-testid="update-versions" className="font-mono text-sm">
                {t('marketplace.versionBadge', { version: dialogUpdate.from })}
                {' → '}
                {t('marketplace.versionBadge', { version: dialogUpdate.to })}
              </p>
              {majorJump && (
                <p
                  data-testid="update-major-notice"
                  className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400"
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    {t('marketplace.update.majorNotice', {
                      fromMajor: majorOf(dialogUpdate.from),
                      toMajor: majorOf(dialogUpdate.to),
                    })}
                    {targetNotes ? (
                      <>
                        {' '}
                        <a
                          href={`#${versionEntryId(targetNotes.version)}`}
                          className="font-medium underline underline-offset-2"
                          onClick={(e) => {
                            e.preventDefault();
                            focusOnCloseRef.current = versionEntryId(targetNotes.version);
                            setInstallOpen(false);
                          }}
                        >
                          {t('marketplace.update.releaseNotes', { version: targetNotes.version })}
                        </a>
                      </>
                    ) : null}
                  </span>
                </p>
              )}
            </div>
          )}

          {envsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : envsError ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600" aria-hidden="true" />
                <div className="flex-1">{envsError}</div>
              </div>
              {/* Only when the runtime named an upstream cloud. An empty base
                  used to fall back to a composed vendor URL that 404'd
                  (objectui#7253); an `href=""` would reload this page. */}
              {cloudConsoleUrl() ? (
                <a href={cloudConsoleUrl()} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="w-full">
                    <ExternalLink className="h-4 w-4 mr-1.5" aria-hidden="true" />
                    {t('marketplace.action.openOnCloud')}
                  </Button>
                </a>
              ) : null}
            </div>
          ) : getRuntimeConfig().defaultEnvironmentId ? (
            // objectui#12146 — no "Include sample data" on an update: the page
            // offers sample data for an installed copy through its own action.
            dialogUpdate ? null : (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="seed"
                  checked={seedSampleData}
                  onCheckedChange={(c) => setSeedSampleData(c === true)}
                />
                <Label htmlFor="seed" className="text-sm font-normal cursor-pointer">
                  {t('marketplace.install.includeSampleData')}
                </Label>
              </div>
            )
          ) : envs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('marketplace.install.noEnvs')}</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="env-select">{t('marketplace.install.environment')}</Label>
                <Select value={selectedEnv} onValueChange={setSelectedEnv}>
                  <SelectTrigger id="env-select">
                    <SelectValue placeholder={t('marketplace.install.environmentPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {envs.map((e) => {
                      const installedHere = envInstallMap[e.id];
                      // Same precedence rule as `cloudUpdateAvailable` above.
                      const hasUpdate = !!installedHere && !!latestVersion
                        && isNewerVersion(latestVersion, installedHere);
                      return (
                        <SelectItem key={e.id} value={e.id}>
                          {e.display_name || e.hostname || e.id}
                          {e.plan && <span className="text-muted-foreground"> · {e.plan}</span>}
                          {installedHere && (
                            hasUpdate
                              ? <span className="text-amber-600"> · {t('marketplace.install.updateTo', { defaultValue: 'Update \u2192 v{{version}}', version: latestVersion })}</span>
                              : <span className="text-muted-foreground"> · {t('marketplace.install.installedVersion', { defaultValue: 'Installed v{{version}}', version: installedHere })}</span>
                          )}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              {!dialogUpdate && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="seed"
                    checked={seedSampleData}
                    onCheckedChange={(c) => setSeedSampleData(c === true)}
                  />
                  <Label htmlFor="seed" className="text-sm font-normal cursor-pointer">
                    {t('marketplace.install.includeSampleData')}
                  </Label>
                </div>
              )}
            </div>
          )}

          {containsCode && !envsError && (
            <div className="space-y-3">
              <PluginDisclosure version={pkg.latest_version} />
              <div className="flex items-start gap-2">
                <Checkbox
                  id="ack-perms"
                  checked={acknowledged}
                  onCheckedChange={(c) => setAcknowledged(c === true)}
                />
                <Label htmlFor="ack-perms" className="text-sm font-normal cursor-pointer leading-snug">
                  {t('marketplace.disclosure.acknowledge', {
                    defaultValue: 'I understand this package runs code and grants the permissions above.',
                  })}
                </Label>
              </div>
            </div>
          )}

          {deployNote || (installResult && (
            <div className={`rounded-md border p-3 text-sm ${installResult.ok ? 'border-green-500/30 bg-green-500/5 text-green-700' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>
              {installResult.message}
            </div>
          ))}

          {/* ADR-0090 D5 — after a successful install into THIS runtime,
              surface the package's suggested audience bindings for the admin
              to confirm or dismiss (the server never auto-binds). Cross-env
              installs are resolved from that env's own Studio instead.
              objectui#12087 — mounted once the app is SERVED: the panel reads
              this runtime once, on mount, and before that the runtime still
              serves the kernel from before the install. */}
          {deploy?.phase === 'served'
            && getRuntimeConfig().defaultEnvironmentId
            && getRuntimeConfig().defaultEnvironmentId === selectedEnv && (
            <SuggestedBindingsPanel packageId={pkg.manifest_id} strings={suggestionStrings} />
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallOpen(false)}>{t('marketplace.action.close')}</Button>
            {!envsError && (
              <Button
                onClick={doInstall}
                disabled={!selectedEnv || installing || installResult?.ok === true || deploy !== null || (containsCode && !acknowledged)}
              >
                {dialogUpdate
                  ? (installing ? t('marketplace.action.updating') : t('marketplace.action.updateTo', { defaultValue: 'Update' }))
                  : (installing ? t('marketplace.action.installing') : t('marketplace.action.install'))}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
