/**
 * Plugin permission disclosure (ADR-0025 PD4 §3.5 / §3.11).
 *
 * Rendered in the install dialog for a code-bearing package. Shows what the
 * user is consenting to BEFORE install: that the package contains code, the
 * trust tier it runs under, whether it is signed / marketplace-reviewed, and
 * the exact structured permission set it requests. The control plane exposes
 * verification STATUS only (never raw signatures); see cloud
 * marketplace.projectVersion.
 */

import { Badge } from '@object-ui/components';
import { Boxes, CheckCircle2, Code2, FolderTree, Network, ShieldAlert, ShieldCheck, Webhook } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import type { MarketplacePackageVersion, PluginRuntime } from './marketplaceApi.js';

/**
 * English label per trust tier — the map i18next's `defaultValue` reads.
 *
 * Keyed by the spec's `PluginRuntime` rather than `string` (objectui#3846): a
 * tier the spec adds is now a compile error here instead of a silent hole that
 * used to fall through to `?? version.runtime` and render the raw wire value on
 * the panel granting code execution. Total map, so the lookup below needs no
 * fallback of its own.
 *
 * Exported for the parity pin next door, which compares these keys against
 * `PluginRuntimeSchema` itself.
 */
export const RUNTIME_FALLBACK: Record<PluginRuntime, string> = {
  node: 'In-process · full trust',
  sandbox: 'Sandboxed',
  worker: 'Out-of-process',
};

function PermissionGroup({
  icon: Icon,
  label,
  items,
}: {
  icon: typeof Boxes;
  label: string;
  items?: string[];
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">{label}</div>
        <div className="flex flex-wrap gap-1 mt-0.5">
          {items.map((it) => (
            <code key={it} className="font-mono text-[11px] px-1 py-0.5 rounded bg-muted break-all">{it}</code>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PluginDisclosure({ version }: { version?: MarketplacePackageVersion | null }) {
  const { t } = useObjectTranslation();
  if (!version?.contains_code) return null;

  const perms = version.permissions ?? {};
  const hasAny =
    (perms.services?.length ?? 0) +
      (perms.hooks?.length ?? 0) +
      (perms.network?.length ?? 0) +
      (perms.fs?.length ?? 0) >
    0;

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Code2 className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
        {t('marketplace.disclosure.containsCode', { defaultValue: 'This package contains code' })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {version.runtime && (
          <Badge variant="outline">
            {t(`marketplace.disclosure.runtime.${version.runtime}`, {
              defaultValue: RUNTIME_FALLBACK[version.runtime],
            })}
          </Badge>
        )}
        {version.platform_verified ? (
          <Badge variant="outline" className="gap-1 border-green-500/40 text-green-700 dark:text-green-400">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            {t('marketplace.disclosure.reviewed', { defaultValue: 'Reviewed & approved' })}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            {t('marketplace.disclosure.unreviewed', { defaultValue: 'Not yet reviewed' })}
          </Badge>
        )}
        {version.signed && (
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            {t('marketplace.disclosure.signed', { defaultValue: 'Signed' })}
          </Badge>
        )}
      </div>

      {hasAny ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {t('marketplace.disclosure.grantsIntro', { defaultValue: 'This package requests:' })}
          </div>
          <PermissionGroup
            icon={Boxes}
            label={t('marketplace.disclosure.services', { defaultValue: 'Platform services' })}
            items={perms.services ?? undefined}
          />
          <PermissionGroup
            icon={Webhook}
            label={t('marketplace.disclosure.hooks', { defaultValue: 'Lifecycle hooks' })}
            items={perms.hooks ?? undefined}
          />
          <PermissionGroup
            icon={Network}
            label={t('marketplace.disclosure.network', { defaultValue: 'Network access' })}
            items={perms.network ?? undefined}
          />
          <PermissionGroup
            icon={FolderTree}
            label={t('marketplace.disclosure.fs', { defaultValue: 'Filesystem access' })}
            items={perms.fs ?? undefined}
          />
          {/*
            objectstack `aaacf1d5c` — say what this list DOES, because a permission
            panel that only lists grants is read as a confinement promise.
            Measured on objectstack `9bd4344e4`: the consented set is persisted
            (`sys_package_installation.granted_permissions`), re-confirmed on a
            widening upgrade (cloud returns 409 without `reconsent`), and
            REGISTERED on the runtime's `PluginPermissionEnforcer` at load — and
            queried by nothing, because `SecurePluginContext` has no production
            construction site. So the list is real and auditable; it is not yet a
            gate. ⛔ Delete this line only together with the framework pin
            `granted-permissions-not-enforced.pin.test.ts`, which goes red the
            day the ADR-0025 materialize seam makes it a gate.
          */}
          <div className="text-[11px] text-muted-foreground/80 leading-snug">
            {t('marketplace.disclosure.notEnforced', {
              // One string literal, not a concatenation, so `check:i18n-keys`
              // compares it against the en pack byte for byte.
              defaultValue: 'Recorded at install, and re-confirmed if a later version asks for more — but the runtime does not yet restrict the package to this list.',
            })}
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          {t('marketplace.disclosure.noPermissions', { defaultValue: 'Requests no special permissions.' })}
        </div>
      )}
    </div>
  );
}
