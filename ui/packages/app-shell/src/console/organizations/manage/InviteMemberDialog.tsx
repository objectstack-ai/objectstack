/**
 * InviteMemberDialog
 *
 * Invites a new member to an organization. After creation, switches to a
 * "share link" view so operators can copy the accept-invitation URL when no
 * mailer is configured server-side.
 */

import { useCallback, useEffect, useState } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { useAuth, invitableOrgRoles, ORG_ROLE_MEMBER } from '@object-ui/auth';
import type { AuthInvitation, DelegableScope, OrgRole } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { Loader2, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { resolveConsoleUrl } from '../resolveHomeUrl.js';
import { resolveOrgRoleLabel } from '../orgRoleLabel.js';
import { resolveOrgErrorMessage } from '../orgErrorMessage.js';

interface InviteMemberDialogProps {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited?: (invitation: AuthInvitation) => void;
}

export function InviteMemberDialog({
  organizationId,
  open,
  onOpenChange,
  onInvited,
}: InviteMemberDialogProps) {
  const { t } = useObjectTranslation();
  const { inviteMember, describeDelegableScope, activeMember } = useAuth();

  // [objectstack-ai/objectstack#3697] The roles this issuer may actually confer. Mirrors the
  // server's invitation role cap — a below-admin issuer (e.g. a
  // `delegated_admin`) may invite as `member` only, and nobody may invite above
  // their own grade. Same property as the placement picker below: it NARROWS,
  // it does not decide; the server re-checks and rejects the whole invitation
  // when it is out of cap.
  const roleOptions = invitableOrgRoles(activeMember?.role);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>(ORG_ROLE_MEMBER);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInvitation, setCreatedInvitation] = useState<AuthInvitation | null>(null);
  const [copied, setCopied] = useState(false);

  // ── [framework ADR-0105 D8] Placement intent ────────────────────────────
  // The invitation may carry the unit the invitee lands in and the positions
  // they get on acceptance. The options are NARROWED to what this issuer may
  // actually delegate (`my-delegable-scope`); the server still authorizes the
  // pair against their adminScope, so this is convenience, not the boundary.
  // No delegable authority (or no runtime exposing it) ⇒ the whole section is
  // hidden rather than offering a form the server would refuse.
  const [delegable, setDelegable] = useState<DelegableScope | null>(null);
  const [businessUnitId, setBusinessUnitId] = useState<string>('');
  const [positions, setPositions] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setEmail('');
      setRole(ORG_ROLE_MEMBER);
      setError(null);
      setCreatedInvitation(null);
      setCopied(false);
      setBusinessUnitId('');
      setPositions([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    describeDelegableScope?.()
      .then((scope) => {
        if (!cancelled) setDelegable(scope);
      })
      .catch(() => {
        /* absent surface — placement stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [open, describeDelegableScope]);

  const canPlace =
    !!delegable &&
    delegable.placeableBusinessUnitIds.length > 0 &&
    delegable.assignablePositions.length > 0;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim()) return;
      setIsSubmitting(true);
      setError(null);
      try {
        const inv = await inviteMember({
          organizationId,
          email: email.trim(),
          role,
          // Placement travels only when BOTH halves are chosen — a unit with
          // no positions (or the reverse) is not a placement, and sending a
          // half-intent would have the server reject an otherwise fine invite.
          ...(canPlace && businessUnitId && positions.length > 0
            ? { businessUnitId, positions }
            : {}),
        });
        setCreatedInvitation(inv);
        onInvited?.(inv);
      } catch (err) {
        // objectui#4474 — better-auth's refusal carries a machine `code` beside
        // its English sentence; map the code, never the text.
        setError(
          resolveOrgErrorMessage(err, t, {
            key: 'organization.invitations.inviteFailed',
            defaultValue: 'Failed to invite member',
          }),
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, role, organizationId, inviteMember, onInvited, canPlace, businessUnitId, positions, t],
  );

  // The invitee opens this link outside React Router, so it must carry the
  // deployment mount (`/_console/`). Rebuilding it from `BASE_URL` produced a
  // trailing-dot host in the portable build and dropped the mount — see
  // resolveHomeUrl's header for that history (objectui#4472). Resolved once so
  // the displayed field and the clipboard cannot drift apart.
  const acceptUrl = createdInvitation
    ? resolveConsoleUrl(`accept-invitation/${createdInvitation.id}`)
    : null;

  const handleCopy = useCallback(async () => {
    if (!acceptUrl) return;
    try {
      await navigator.clipboard.writeText(acceptUrl);
      setCopied(true);
      toast.success(t('organization.invitations.linkCopied', { defaultValue: 'Invitation link copied' }));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('organization.invitations.copyFailed', { defaultValue: 'Failed to copy link' }));
    }
  }, [acceptUrl, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]" data-testid="invite-member-dialog">
        {createdInvitation ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {t('organization.invitations.sentTitle', { defaultValue: 'Invitation created' })}
              </DialogTitle>
              <DialogDescription>
                {t('organization.invitations.sentDescription', {
                  defaultValue: 'Share the link below with the invitee. They will need to sign in to accept.',
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <Label>{t('organization.invitations.linkLabel', { defaultValue: 'Accept link' })}</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={acceptUrl ?? ''}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                {/* Icon-only, and it was labelled with a bare English "Copy"
                    (objectui#4474) — a seventh site of the same class as the
                    card's three. Shares the invitations row's key: same action,
                    same words. */}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  aria-label={t('organization.invitations.copyLinkLabel', {
                    defaultValue: 'Copy invitation link',
                  })}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('organization.invitations.invitedAs', {
                  defaultValue: '{{email}} invited as {{role}}',
                  email: createdInvitation.email,
                  role: resolveOrgRoleLabel(createdInvitation.role, t),
                })}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>
                {t('common.done', { defaultValue: 'Done' })}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>
                {t('organization.invitations.inviteTitle', { defaultValue: 'Invite a member' })}
              </DialogTitle>
              <DialogDescription>
                {t('organization.invitations.inviteDescription', {
                  defaultValue: 'They will receive an invitation to join this organization.',
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="invite-email">
                  {t('organization.invitations.emailLabel', { defaultValue: 'Email' })}
                </Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  data-testid="invite-email-input"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-role">
                  {t('organization.invitations.roleLabel', { defaultValue: 'Role' })}
                </Label>
                <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
                  <SelectTrigger id="invite-role" data-testid="invite-role-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((r) => (
                      <SelectItem key={r} value={r} data-testid={`invite-role-${r}`}>
                        {resolveOrgRoleLabel(r, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* [framework ADR-0105 D8] Placement — only for issuers who
                  actually hold delegated authority. Options come from
                  `my-delegable-scope`, so a delegate sees their own subtree and
                  the positions they may hand out; the server re-checks. */}
              {canPlace && (
                <div
                  className="grid gap-3 rounded-md border border-dashed p-3"
                  data-testid="invite-placement-section"
                >
                  <div className="grid gap-1">
                    <Label className="text-sm">
                      {t('organization.invitations.placementLabel', {
                        defaultValue: 'Placement (optional)',
                      })}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t('organization.invitations.placementDescription', {
                        defaultValue:
                          'Applied when the invitation is accepted. Only units and positions you may delegate are listed.',
                      })}
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="invite-business-unit" className="text-xs">
                      {t('organization.invitations.businessUnitLabel', { defaultValue: 'Business unit' })}
                    </Label>
                    <Select value={businessUnitId} onValueChange={setBusinessUnitId}>
                      <SelectTrigger id="invite-business-unit" data-testid="invite-business-unit-select">
                        <SelectValue
                          placeholder={t('organization.invitations.businessUnitPlaceholder', {
                            defaultValue: 'No placement',
                          })}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {delegable!.placeableBusinessUnitIds.map((id) => (
                          <SelectItem key={id} value={id}>
                            {id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {businessUnitId && (
                    <div className="grid gap-2" data-testid="invite-positions">
                      <Label className="text-xs">
                        {t('organization.invitations.positionsLabel', { defaultValue: 'Positions' })}
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {delegable!.assignablePositions.map((name) => {
                          const selected = positions.includes(name);
                          return (
                            <Button
                              key={name}
                              type="button"
                              size="sm"
                              variant={selected ? 'default' : 'outline'}
                              data-testid={`invite-position-${name}`}
                              aria-pressed={selected}
                              onClick={() =>
                                setPositions((prev) =>
                                  prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name],
                                )
                              }
                            >
                              {name}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {error && (
                <p className="text-sm text-destructive" data-testid="invite-error">{error}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button type="submit" disabled={isSubmitting || !email.trim()} data-testid="invite-submit">
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('organization.invitations.sendInvite', { defaultValue: 'Send invite' })}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
