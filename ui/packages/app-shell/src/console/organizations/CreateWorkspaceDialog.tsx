/**
 * CreateWorkspaceDialog
 *
 * Dialog for creating a new workspace (organization). It asks for the NAME
 * only (objectui#11659): the URL slug is generated from the name and never
 * shown here. A customer creating a workspace never sees the slug take effect
 * at this step, so a field for it was a question with no visible answer. The
 * owner can still change it later, in organization settings (`SettingsPage`'s
 * slug input).
 *
 * @module
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Label,
} from '@object-ui/components';
import { useAuth } from '@object-ui/auth';
import type { AuthOrganization } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { Loader2 } from 'lucide-react';
import { provisionProductionEnvironment } from './provisionEnvironment.js';
import { resolveOrgErrorMessage } from './orgErrorMessage.js';

/**
 * Convert a display name to a URL-friendly slug.
 *
 * The ASCII pass strips everything outside [a-z0-9 _-]. For a name written
 * entirely in a non-Latin script (中文 / 日本語 / 한국어 / العربية …) that pass
 * yields the empty string — and an empty slug left the "Create workspace"
 * button permanently disabled (`!slug.trim()`), dead-ending the FIRST step of
 * onboarding for every non-Latin-name user. Rather than block them, fall back
 * to a deterministic, non-empty slug, which the owner can still change in
 * organization settings.
 *
 * Deterministic (not random) on purpose: a name-derived hash means the slug
 * doesn't jitter on every keystroke while typing a CJK name, and re-typing the
 * same name reproduces the same slug. Uniqueness across different names comes
 * from the hash; the server still enforces global slug uniqueness on submit.
 */
function nameToSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  if (ascii) return ascii;
  // Empty name → empty slug (keep the button disabled; nothing to create yet).
  const trimmed = name.trim();
  if (!trimmed) return '';
  // Non-empty name with no ASCII-sluggable chars → deterministic fallback.
  let hash = 0;
  for (const ch of trimmed) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  return `workspace-${hash.toString(36).slice(0, 6)}`;
}

/**
 * The two answers better-auth gives when the requested slug is already in use.
 * `createOrganization` refuses a taken slug with `ORGANIZATION_ALREADY_EXISTS`
 * (its create route looks the slug up before inserting); a runtime that maps
 * the collision itself answers `ORGANIZATION_SLUG_ALREADY_TAKEN`.
 */
const SLUG_TAKEN_CODES = new Set(['ORGANIZATION_ALREADY_EXISTS', 'ORGANIZATION_SLUG_ALREADY_TAKEN']);

/** Attempts per submit: the generated slug, then two suffixed variants. */
const SLUG_ATTEMPTS = 3;

function isSlugTaken(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && SLUG_TAKEN_CODES.has(code);
}

/**
 * A variant of `base` for a retry after a slug collision: a short random
 * suffix, kept inside the 48-character budget `nameToSlug` writes to.
 */
function suffixedSlug(base: string): string {
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `${base.slice(0, 43).replace(/-+$/, '')}-${suffix}`;
}

/**
 * The creator's browser zone, or `undefined` when the browser reports none
 * (objectui#11908). A new workspace takes this zone at creation, so its first
 * administrator is not asked for a zone the browser already knows. The same
 * read as the console's `browserTimeZone()`, which this package cannot import;
 * the server judges the value and keeps its default for one it refuses.
 */
function browserTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 ? zone : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Create the organization under the generated slug, retrying a slug collision
 * with a suffixed variant (at most `SLUG_ATTEMPTS` calls in all). The user
 * cannot see or edit the slug in this dialog, so a collision is not theirs to
 * resolve; any other refusal is rethrown unchanged. Every attempt carries the
 * same `timezone`, and none carries the key when there is no zone.
 */
async function createWithGeneratedSlug(
  create: (data: { name: string; slug: string; timezone?: string }) => Promise<AuthOrganization>,
  name: string,
  slug: string,
  timezone: string | undefined,
): Promise<AuthOrganization> {
  let attemptSlug = slug;
  for (let attempt = 1; ; attempt++) {
    try {
      return await create({ name, slug: attemptSlug, ...(timezone ? { timezone } : {}) });
    } catch (err) {
      if (attempt >= SLUG_ATTEMPTS || !isSlugTaken(err)) throw err;
      attemptSlug = suffixedSlug(slug);
    }
  }
}

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (org: AuthOrganization) => void;
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateWorkspaceDialogProps) {
  const { t } = useObjectTranslation();
  const { createOrganization, getAuthConfig } = useAuth();

  const [name, setName] = useState('');
  // The slug is not asked for (objectui#11659): it is derived from the name on
  // every render and sent with the create call. Empty exactly when the trimmed
  // name is empty, so the submit gate below stays a name check.
  const slug = nameToSlug(name);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Defense-in-depth: the toolbar button that opens this dialog is already
  // hidden when `multiOrgEnabled === false`, but if a future caller opens the
  // dialog by another path we still want to fail fast with a friendly message
  // instead of bouncing off the server's FORBIDDEN.
  const [multiOrgDisabled, setMultiOrgDisabled] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getAuthConfig()
      .then((cfg) => {
        if (cancelled) return;
        setMultiOrgDisabled(cfg?.features?.multiOrgEnabled === false);
      })
      .catch(() => {
        /* leave default — server still enforces */
      });
    return () => {
      cancelled = true;
    };
  }, [open, getAuthConfig]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setName('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !slug.trim()) return;
      if (multiOrgDisabled) {
        setError(
          t('workspace.multiOrgDisabled', {
            defaultValue: 'Creating new organizations is disabled on this instance.',
          }),
        );
        return;
      }

      setIsSubmitting(true);
      setError(null);

      try {
        const org = await createWithGeneratedSlug(
          createOrganization,
          name.trim(),
          slug.trim(),
          browserTimeZone(),
        );
        // Born-with-env: eagerly ensure the new org's production environment so
        // the user lands in a ready workspace with no onboarding-wizard detour.
        // `createOrganization` already switched the active org; we also pass
        // `organizationId` explicitly so the target is unambiguous. Idempotent +
        // best-effort: a control plane that auto-provisions the env on create
        // resolves this to `alreadyProvisioned`; a genuine failure falls through
        // to the onboarding gate (lazy provision on first navigation).
        try {
          // PR-5 (naming collapse): name the production environment after the
          // workspace, so the user sees one consistent name instead of a
          // workspace "Bloom Studio" whose environment is a generic "Production".
          // The control plane inherits this displayName verbatim; auto-provision
          // races that skip this call fall back to the org name server-side.
          await provisionProductionEnvironment({ organizationId: org.id, displayName: name.trim() });
        } catch (provisionErr) {
          console.warn(
            '[CreateWorkspace] eager env provision failed; onboarding gate will provision lazily',
            provisionErr,
          );
        }
        onCreated?.(org);
      } catch (err) {
        // objectui#4474 — the card's site 4: a taken slug surfaced better-auth's
        // `Organization already exists` verbatim in a zh session. Mapped by code.
        setError(
          resolveOrgErrorMessage(err, t, {
            key: 'workspace.createFailed',
            defaultValue: 'Failed to create organization',
          }),
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [name, slug, multiOrgDisabled, t, createOrganization, onCreated],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" data-testid="create-workspace-dialog">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {t('workspace.createTitle', { defaultValue: 'Create an organization' })}
            </DialogTitle>
            <DialogDescription>
              {t('workspace.createDescription', {
                defaultValue: 'An organization is a shared space for your team to collaborate.',
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="workspace-name">
                {t('workspace.nameLabel', { defaultValue: 'Organization name' })}
              </Label>
              <Input
                id="workspace-name"
                placeholder={t('workspace.namePlaceholder', { defaultValue: 'e.g., Acme Inc' })}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                data-testid="workspace-name-input"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" data-testid="workspace-create-error">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !name.trim() || !slug.trim()}
              data-testid="workspace-create-submit"
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('workspace.createButton', { defaultValue: 'Create organization' })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
