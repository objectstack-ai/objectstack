// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Configuration → Public forms (objectstack#36444): every public form
 * of the environment, with its object and address; switch it on or off, copy
 * its address, open it in a new tab. For system administrators only: the page
 * asks the capability its Setup entry asks ({@link PUBLIC_FORMS_CAPABILITY}).
 *
 * A switch writes the form's metadata, which the server lets only an author
 * (`manage_metadata`, {@link AUTHORING_CAPABILITY}) do: without it the
 * switches are shown off-limits, with a sentence saying why, rather than
 * answering every flip with the server's refusal.
 *
 * Operations only: a form is designed (created, deleted, its fields and title
 * changed) in Studio. Which forms are listed and where a switch is saved are
 * `publicForms.ts`'s.
 *
 * The address is the router's answer for the anonymous form route `/f/:slug`
 * (`useHref`, which prefixes the console's basename), as Studio's page builds
 * it (objectui#11769), so it follows the mount the console runs under.
 */

import * as React from 'react';
import { useHref } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, ExternalLink, FormInput, Link2, Loader2, RefreshCw } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { useMetadata } from '@object-ui/react';
import { useAdapter } from '../../providers/AdapterProvider.js';
import { PageHeader } from '../../layout/PageHeader.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { formatMetadataError } from '@object-ui/data-objectstack';
import { AUTHORING_CAPABILITY } from '../../hooks/useCanAuthorMetadata.js';
import { PUBLIC_FORMS_CAPABILITY } from './publicFormsRef.js';
import {
  PublicFormSwitchRefusal,
  markShippedOff,
  publicFormRowsOf,
  switchPublicForm,
  type PublicFormRow,
} from './publicForms.js';

/** The anonymous form route, as the console's router declares it (`/f/:slug`). */
const PUBLIC_FORM_ROUTE = '/f';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The sentence for a switch the console refused before writing. */
function refusalText(t: Translate, err: PublicFormSwitchRefusal): string {
  switch (err.reason) {
    case 'no-package':
      return t('publicFormsSetup.refusalNoPackage');
    case 'no-version':
      return t('publicFormsSetup.refusalNoVersion');
    case 'shipped-off':
      return t('publicFormsSetup.refusalShippedOff');
    default:
      return t('publicFormsSetup.refusalLoadFailed');
  }
}

/**
 * The sentence for a write the server refused: business words, never the
 * server's own message (that goes to the console log for whoever debugs it).
 */
function serverRefusalText(t: Translate, err: unknown): string {
  const e = err as { status?: unknown; statusCode?: unknown } | null | undefined;
  if (e?.status === 403 || e?.statusCode === 403) return t('publicFormsSetup.refusalForbidden');
  console.warn('[public forms] switch refused:', formatMetadataError(err));
  return t('publicFormsSetup.refusalServer');
}

type Read = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; rows: PublicFormRow[] };

export function PublicFormsSetupPage() {
  const { t } = useObjectTranslation();
  const { hasCapabilities } = usePermissions();
  const allowed = hasCapabilities([PUBLIC_FORMS_CAPABILITY]);
  return (
    <div data-testid="public-forms-setup-page">
      <PageHeader
        title={t('publicFormsSetup.title')}
        subtitle={t('publicFormsSetup.subtitle')}
        icon={<FormInput className="h-4 w-4" aria-hidden="true" />}
      />
      <div className="space-y-4 p-4 sm:p-6">
        {allowed ? (
          <PublicFormsSetupBody />
        ) : (
          <Alert data-testid="public-forms-not-allowed">
            <AlertDescription>{t('publicFormsSetup.notAllowed')}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

function PublicFormsSetupBody() {
  const { t } = useObjectTranslation();
  const adapter = useAdapter();
  const metadata = useMetadata();
  const metadataClient = useMetadataClient();
  const { hasCapabilities } = usePermissions();
  const canSwitch = hasCapabilities([AUTHORING_CAPABILITY]);
  const [read, setRead] = React.useState<Read>({ kind: 'loading' });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    const client: any = (adapter as any)?.getClient?.();
    setRead({ kind: 'loading' });
    (async () => {
      try {
        if (!client?.meta?.getItems) throw new Error('meta.getItems is not available on this client');
        const answer = await client.meta.getItems('view');
        const rows = await markShippedOff(publicFormRowsOf(answer), metadataClient as any);
        if (live) setRead({ kind: 'ready', rows });
      } catch (err) {
        if (live) setRead({ kind: 'failed', message: formatMetadataError(err) });
      }
    })();
    return () => {
      live = false;
    };
  }, [adapter, metadataClient, nonce]);

  const objectLabel = React.useCallback(
    (name: string | undefined) => {
      if (!name) return null;
      const found = (metadata.objects ?? []).find((o: { name?: unknown } | null) => o?.name === name) as
        | { label?: unknown }
        | undefined;
      return typeof found?.label === 'string' && found.label ? found.label : name;
    },
    [metadata.objects],
  );

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const formPath = useHref(PUBLIC_FORM_ROUTE);
  const addressOf = (slug: string) => `${origin}${formPath}/${slug}`;

  const copy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success(t('publicFormsSetup.copied'));
    } catch {
      toast.error(t('publicFormsSetup.clipboardUnavailable'));
    }
  };

  const flip = async (row: PublicFormRow, on: boolean) => {
    setBusy(row.name);
    try {
      const outcome = await switchPublicForm(row, on, metadataClient as any, { dataSource: adapter as any });
      if (outcome === 'pending-draft') {
        toast.error(t('publicFormsSetup.pendingDraft', { name: row.title }));
        return;
      }
      if (typeof outcome === 'object') {
        toast.success(t('publicFormsSetup.switchedOnEarlierVersion', { name: row.title, version: outcome.basedOn }));
      } else {
        toast.success(t(on ? 'publicFormsSetup.switchedOn' : 'publicFormsSetup.switchedOff', { name: row.title }));
      }
      // The row reads back as the server now serves it.
      setRead((prev) =>
        prev.kind === 'ready'
          ? { kind: 'ready', rows: prev.rows.map((r) => (r.name === row.name ? { ...r, on } : r)) }
          : prev,
      );
      setNonce((n) => n + 1);
    } catch (err) {
      const message = err instanceof PublicFormSwitchRefusal ? refusalText(t, err) : serverRefusalText(t, err);
      toast.error(t('publicFormsSetup.switchFailed', { name: row.title, message }));
      if (err instanceof PublicFormSwitchRefusal && err.reason === 'shipped-off') setNonce((n) => n + 1);
    } finally {
      setBusy(null);
    }
  };

  const refresh = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setNonce((n) => n + 1)}
      disabled={read.kind === 'loading'}
      data-testid="public-forms-refresh"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${read.kind === 'loading' ? 'animate-spin' : ''}`} />
      <span className="ml-1.5">{t('publicFormsSetup.refresh')}</span>
    </Button>
  );

  if (read.kind === 'loading') {
    return (
      <div className="space-y-2" data-testid="public-forms-loading">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (read.kind === 'failed') {
    return (
      <Alert variant="destructive" data-testid="public-forms-load-failed">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex flex-wrap items-center gap-2">
          {t('publicFormsSetup.loadFailed', { message: read.message })}
          {refresh}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('publicFormsSetup.designHint')}</p>
        {refresh}
      </div>
      {!canSwitch && (
        <Alert data-testid="public-forms-no-switch">
          <AlertDescription>{t('publicFormsSetup.noSwitchPermission')}</AlertDescription>
        </Alert>
      )}
      {read.rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="public-forms-empty">
          <p className="font-medium text-foreground">{t('publicFormsSetup.emptyTitle')}</p>
          <p className="mt-1">{t('publicFormsSetup.emptyBody')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table data-testid="public-forms-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t('publicFormsSetup.columnName')}</TableHead>
                <TableHead>{t('publicFormsSetup.columnObject')}</TableHead>
                <TableHead>{t('publicFormsSetup.columnAddress')}</TableHead>
                <TableHead>{t('publicFormsSetup.columnStatus')}</TableHead>
                <TableHead className="text-right">{t('publicFormsSetup.columnActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {read.rows.map((row) => {
                const address = addressOf(row.slug);
                const label = objectLabel(row.object);
                return (
                  <TableRow
                    key={row.name}
                    data-testid={`public-form-row-${row.name}`}
                    data-on={row.on ? 'true' : 'false'}
                    data-shipped-off={row.shippedOff ? 'true' : undefined}
                  >
                    <TableCell className="font-medium">{row.title}</TableCell>
                    <TableCell>{label ? <Badge variant="secondary">{label}</Badge> : null}</TableCell>
                    <TableCell>
                      <code className="break-all text-xs text-muted-foreground">{address}</code>
                    </TableCell>
                    <TableCell>
                      <div className="inline-flex items-center gap-2">
                        <Switch
                          checked={row.on}
                          disabled={busy !== null || !canSwitch || !!row.shippedOff}
                          onCheckedChange={(next) => void flip(row, next)}
                          aria-label={t(row.on ? 'publicFormsSetup.switchOffLabel' : 'publicFormsSetup.switchOnLabel', {
                            name: row.title,
                          })}
                          data-testid={`public-form-switch-${row.name}`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {busy === row.name ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : row.on ? (
                            t('publicFormsSetup.on')
                          ) : row.shippedOff ? (
                            <span data-testid={`public-form-shipped-off-${row.name}`}>{t('publicFormsSetup.shippedOff')}</span>
                          ) : (
                            t('publicFormsSetup.off')
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('publicFormsSetup.copy')}
                          aria-label={t('publicFormsSetup.copy')}
                          onClick={() => void copy(address)}
                          data-testid={`public-form-copy-${row.name}`}
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          title={t('publicFormsSetup.open')}
                          data-testid={`public-form-open-${row.name}`}
                        >
                          <a href={address} target="_blank" rel="noreferrer" aria-label={t('publicFormsSetup.open')}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
