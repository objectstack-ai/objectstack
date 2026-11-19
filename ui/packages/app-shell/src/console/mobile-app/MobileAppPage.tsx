// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The account app's Mobile App page (`account:mobile_app`): a QR code and a
 * copyable link that connect the ObjectOS mobile app to this server.
 *
 * The server URL is the one the server publishes (`features.publicBaseUrl` on
 * the public auth config), never `window.location`, which can be an internal
 * or proxied host. A loopback or private address, or a public host on plain
 * `http:`, gets a refusal naming `OS_AUTH_URL` instead of a code a phone
 * cannot use; a server that does not serve the key gets a refusal saying so.
 * The code carries the normalised server address only, never a credential.
 */

import { useEffect, useState } from 'react';
import { toString as renderQrSvg } from 'qrcode';
import { Check, Copy, Smartphone } from 'lucide-react';
import { useAuth } from '@object-ui/auth';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { PageHeader } from '../../layout/PageHeader.js';
import { mobileConnectTarget, PUBLIC_ADDRESS_SETTING, type MobileConnectTarget } from './mobileConnect.js';

/** An address the remedy shows as the shape `OS_AUTH_URL` takes. */
const PUBLIC_ADDRESS_EXAMPLE = 'https://os.example.com';

type Load = { readonly state: 'loading' } | { readonly state: 'failed' } | { readonly state: 'read'; readonly target: MobileConnectTarget };

export function MobileAppPage() {
  const { t } = useObjectTranslation();
  const { getAuthConfig } = useAuth();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then((config) => {
        if (!cancelled) setLoad({ state: 'read', target: mobileConnectTarget(config?.features?.publicBaseUrl) });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [getAuthConfig]);

  return (
    <div data-testid="mobile-app-page">
      <PageHeader
        title={t('mobileApp.title')}
        subtitle={t('mobileApp.subtitle')}
        icon={<Smartphone className="h-5 w-5" aria-hidden="true" />}
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6 max-w-2xl">
        {load.state === 'loading' ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : load.state === 'failed' ? (
          <Alert variant="destructive" data-testid="mobile-app-load-failed">
            <AlertDescription>{t('mobileApp.loadFailed')}</AlertDescription>
          </Alert>
        ) : load.target.kind === 'ready' ? (
          <ConnectCard key={load.target.connectLink} connectLink={load.target.connectLink} />
        ) : (
          <Alert variant="destructive" data-testid="mobile-app-refusal">
            <AlertTitle>{t(refusalKeys(load.target).title)}</AlertTitle>
            <AlertDescription>
              {load.target.kind === 'unreachable'
                ? t(refusalKeys(load.target).body, {
                    address: load.target.serverUrl,
                    setting: PUBLIC_ADDRESS_SETTING,
                    example: PUBLIC_ADDRESS_EXAMPLE,
                  })
                : t(refusalKeys(load.target).body)}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

/** The title and body keys for a target that shows no code. */
function refusalKeys(target: Exclude<MobileConnectTarget, { kind: 'ready' }>): { title: string; body: string } {
  if (target.kind === 'unpublished') return { title: 'mobileApp.unpublishedTitle', body: 'mobileApp.unpublishedBody' };
  if (target.reason === 'not-https') return { title: 'mobileApp.insecureTitle', body: 'mobileApp.insecureBody' };
  return { title: 'mobileApp.unreachableTitle', body: 'mobileApp.unreachableBody' };
}

function ConnectCard({ connectLink }: { connectLink: string }) {
  const { t } = useObjectTranslation();
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Rendered here, client side: the link never leaves the browser to draw it.
  useEffect(() => {
    let cancelled = false;
    renderQrSvg(connectLink, { type: 'svg', margin: 1 })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connectLink]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(connectLink);
      setCopied(true);
    } catch {
      // Clipboard permission denied: the link stays on screen to copy by hand.
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <p className="text-sm">{t('mobileApp.scanHint')}</p>
        {/* A QR code needs a light field to scan, in either theme. */}
        <div className="flex justify-center self-center rounded-md border bg-white p-3">
          {svg ? (
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
              alt={t('mobileApp.qrAlt')}
              className="h-48 w-48"
              data-testid="mobile-app-qr"
            />
          ) : (
            <div className="h-48 w-48" aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground" id="mobile-app-link-label">
            {t('mobileApp.linkLabel')}
          </span>
          <div className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs"
              aria-labelledby="mobile-app-link-label"
              data-testid="mobile-app-link"
            >
              {connectLink}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              <span className="ml-2">{t('mobileApp.copy')}</span>
            </Button>
            <span role="status" className="sr-only">
              {copied ? t('mobileApp.copied') : ''}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="mobile-app-privacy">
          {t('mobileApp.privacy')}
        </p>
      </CardContent>
    </Card>
  );
}
