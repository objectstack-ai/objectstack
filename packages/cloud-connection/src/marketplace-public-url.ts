// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Marketplace public R2 base URL — when set, points at a Cloudflare R2
 * bucket (custom domain or `pub-*.r2.dev`) that serves pre-rendered
 * marketplace browse + install JSON snapshots. The snapshots are
 * written by the ObjectOS Cloud control plane
 * (`packages/service-cloud/src/marketplace-snapshot.ts`).
 *
 * Architecture: cloud writes, tenants read directly from R2 → CDN.
 * Marketplace browse + install never touch the cloud control plane,
 * so Cloud cold-start (~12s) is bypassed entirely and the read path
 * scales to CF's edge capacity for free.
 *
 * Default: when OS_MARKETPLACE_PUBLIC_BASE_URL is unset we skip the
 * public fast-path and fall back to the legacy cloud proxy. Once the
 * R2 bucket public domain is wired up in operations, set
 * `OS_MARKETPLACE_PUBLIC_BASE_URL=https://marketplace.objectos.ai`
 * (or your own custom domain) to enable. Set to "off" / "none" to
 * explicitly disable even if a default is configured.
 *
 * Path layout under the base URL (matches the snapshot writer):
 *   <base>/packages.json
 *   <base>/packages/{id}.json
 *   <base>/packages/{id}/versions/{versionId}/manifest.json
 *   <base>/packages/{id}/versions/latest/manifest.json
 *
 * Each JSON file is already in the same `{ success: true, data: ... }`
 * shape as the corresponding cloud API endpoint, so callers can
 * substitute one for the other transparently.
 */

/**
 * Resolve the effective public marketplace base URL. Returns an empty
 * string when the public fast-path is disabled — callers should fall
 * back to fetching via the cloud control plane.
 */
export function resolveMarketplacePublicBaseUrl(explicit?: string | null): string {
    const raw = (explicit ?? process.env.OS_MARKETPLACE_PUBLIC_BASE_URL ?? '').trim();
    const lower = raw.toLowerCase();
    if (!raw || lower === 'off' || lower === 'none' || lower === 'disabled' || lower === 'false') {
        return '';
    }
    return raw.replace(/\/+$/, '');
}

/**
 * Map an incoming `/api/v1/marketplace/...` API path to a public R2
 * object key (relative — caller prepends the base URL).
 *
 * Returns `null` when the path is not snapshot-backed. Today three
 * paths are covered (list, detail, manifest); anything else (search
 * with non-trivial filters, install actions, etc.) routes via cloud.
 *
 * Query strings are NOT included in the returned key — R2 is static.
 * Callers that need filtering must fetch the full snapshot and filter
 * client-side.
 */
export function publicMarketplaceKeyForApiPath(pathname: string): string | null {
    const prefix = '/api/v1/marketplace/packages';
    if (pathname === prefix) return 'packages.json';
    if (!pathname.startsWith(`${prefix}/`)) return null;
    const tail = pathname.slice(prefix.length + 1);
    if (!tail) return null;
    const parts = tail.split('/');
    // /packages/{id}
    if (parts.length === 1) {
        const id = decodeURIComponent(parts[0] ?? '');
        if (!id) return null;
        return `packages/${encodeURIComponent(id)}.json`;
    }
    // /packages/{id}/versions/{versionId}/manifest
    if (parts.length === 4 && parts[1] === 'versions' && parts[3] === 'manifest') {
        const id = decodeURIComponent(parts[0] ?? '');
        const versionId = decodeURIComponent(parts[2] ?? '');
        if (!id || !versionId) return null;
        return `packages/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/manifest.json`;
    }
    return null;
}
