/**
 * InvitationsPage
 *
 * Lists organization invitations with filter tabs and per-invitation actions.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Separator,
} from '@object-ui/components';
import { useAuth } from '@object-ui/auth';
import type { AuthInvitation, AuthInvitationStatus } from '@object-ui/auth';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { Loader2, Copy, Check, X, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useOrgContext } from './orgContext.js';
import { canCancelInvitations, canInviteMembers } from './orgCapabilities.js';
import { resolveConsoleUrl } from '../resolveHomeUrl.js';
import { resolveOrgRoleLabel } from '../orgRoleLabel.js';
import { resolveOrgErrorMessage } from '../orgErrorMessage.js';

type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected' | 'canceled';

/**
 * Badge variant per status. Exhaustive over `AuthInvitationStatus` on purpose —
 * there is no `default:` arm any more (objectui#3879).
 *
 * The arm used to return `'secondary'` for anything unrecognized, which is how an
 * unexpected status reached the badge looking deliberate. The union is closed and
 * enforced at the auth client's wire boundary now, so a fifth member cannot
 * arrive at runtime — and if better-auth ever adds one, this switch stops
 * covering the parameter type and fails the type-check gate, which is exactly the
 * moment a human should decide what colour it is.
 */
function statusBadgeVariant(status: AuthInvitationStatus): 'outline' | 'default' | 'destructive' {
  switch (status) {
    case 'pending':
      return 'outline';
    case 'accepted':
      return 'default';
    case 'rejected':
    case 'canceled':
      return 'destructive';
  }
}

export function InvitationsPage() {
  const { t } = useObjectTranslation();
  // Dates and numbers on this surface read the display locale; a bare
  // `toLocale*()` call used the MACHINE's locale (objectui#9909).
  const displayLocale = useDisplayLocale();
  const { org } = useOrgContext();
  const { listInvitations, cancelInvitation, activeMember } = useAuth();

  /* objectui#4475 — the two pending-row affordances answer to two DIFFERENT
     server gates, so they get two predicates rather than one "can administer
     invitations" flag:

       - cancel  -> `invitation:["cancel"]`, which is owner/admin;
       - copy link -> the delivery half of `invitation:["create"]`. The link IS
         the invitation (anyone holding it can accept), so handing it out is the
         issuing capability finishing its job — which is why a `delegated_admin`,
         who may create invitations but deliberately may not cancel them, keeps
         this one and loses the other.

     What a `member` may READ here is a separate, server-side question and is
     escalated as objectstack#8095 — deliberately NOT decided by this card. Only
     the write affordances are gated; the ledger still renders. */
  const canCancel = canCancelInvitations(activeMember?.role);
  const canCopyLink = canInviteMembers(activeMember?.role);

  const [invitations, setInvitations] = useState<AuthInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [cancelingInvitation, setCancelingInvitation] = useState<AuthInvitation | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchInvitations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listInvitations(org.id);
      setInvitations(data);
    } catch (err) {
      setError(
        resolveOrgErrorMessage(err, t, {
          key: 'organization.invitations.loadFailed',
          defaultValue: 'Failed to load invitations',
        }),
      );
    } finally {
      setIsLoading(false);
    }
  }, [org.id, listInvitations, t]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  const handleCopyLink = async (inv: AuthInvitation) => {
    // The recipient opens this link outside React Router, so it must carry the
    // deployment mount (`/_console/`). Rebuilding it from `BASE_URL` produced a
    // trailing-dot host in the portable build and dropped the mount — see
    // resolveHomeUrl's header for that history (objectui#4472).
    const url = resolveConsoleUrl(`accept-invitation/${inv.id}`);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(inv.id);
      toast.success(t('organization.invitations.linkCopied', { defaultValue: 'Invitation link copied' }));
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error(t('organization.invitations.copyFailed', { defaultValue: 'Failed to copy link' }));
    }
  };

  const handleCancel = async () => {
    if (!cancelingInvitation) return;
    try {
      await cancelInvitation(cancelingInvitation.id);
      toast.success(t('organization.invitations.canceled', { defaultValue: 'Invitation canceled' }));
      setCancelingInvitation(null);
      fetchInvitations();
    } catch (err) {
      toast.error(
        resolveOrgErrorMessage(err, t, {
          key: 'organization.invitations.cancelFailed',
          defaultValue: 'Failed to cancel invitation',
        }),
      );
    }
  };

  const filtered =
    filter === 'all' ? invitations : invitations.filter((inv) => inv.status === filter);

  const statusCounts = {
    all: invitations.length,
    pending: invitations.filter((i) => i.status === 'pending').length,
    accepted: invitations.filter((i) => i.status === 'accepted').length,
    rejected: invitations.filter((i) => i.status === 'rejected').length,
    canceled: invitations.filter((i) => i.status === 'canceled').length,
  };

  const tabs: StatusFilter[] = ['all', 'pending', 'accepted', 'rejected', 'canceled'];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-sm text-destructive">
        {error}
        <Button variant="outline" size="sm" className="ml-4" onClick={fetchInvitations}>
          {t('common.retry', { defaultValue: 'Retry' })}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="invitations-page">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {t('organization.invitations.title', { defaultValue: 'Invitations' })}
        </h2>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button type="button"
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              filter === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(`organization.invitations.status.${tab}`, { defaultValue: tab })}
            {statusCounts[tab] > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">
                {statusCounts[tab]}
              </span>
            )}
          </button>
        ))}
      </div>

      <Separator />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('organization.invitations.empty', { defaultValue: 'No invitations found.' })}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center gap-3 rounded-lg border bg-card p-3"
              data-testid={`invitation-row-${inv.id}`}
            >
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="text-xs">
                  <Mail className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-sm">{inv.email}</div>
                {inv.expiresAt && (
                  <div className="text-xs text-muted-foreground">
                    {t('organization.invitations.expiresAt', { defaultValue: 'Expires' })}{' '}
                    {new Date(inv.expiresAt).toLocaleDateString(displayLocale)}
                  </div>
                )}
              </div>

              {/* Same shared role map as the members badge and the invite
                  dropdown (objectui#4474) — this one was a sibling holdout the
                  card's table did not reach. */}
              <Badge
                variant="outline"
                className="shrink-0"
                data-testid={`invitation-role-badge-${inv.id}`}
              >
                {resolveOrgRoleLabel(inv.role, t)}
              </Badge>

              <Badge variant={statusBadgeVariant(inv.status)} className="shrink-0 capitalize">
                {t(`organization.invitations.status.${inv.status}`, { defaultValue: inv.status })}
              </Badge>

              {inv.status === 'pending' && (canCopyLink || canCancel) && (
                <div className="flex shrink-0 items-center gap-1">
                  {canCopyLink && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleCopyLink(inv)}
                      aria-label={t('organization.invitations.copyLinkLabel', {
                        defaultValue: 'Copy invitation link',
                      })}
                    >
                      {copiedId === inv.id ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setCancelingInvitation(inv)}
                      aria-label={t('organization.invitations.cancelAction', {
                        defaultValue: 'Cancel invitation',
                      })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Cancel confirmation dialog */}
      <AlertDialog
        open={!!cancelingInvitation}
        onOpenChange={(open) => !open && setCancelingInvitation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('organization.invitations.cancelTitle', { defaultValue: 'Cancel invitation?' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('organization.invitations.cancelDescription', {
                defaultValue: 'The invitation for {{email}} will be revoked.',
                email: cancelingInvitation?.email ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', { defaultValue: 'Cancel' })}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleCancel}
            >
              {t('organization.invitations.cancelAction', { defaultValue: 'Cancel invitation' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
