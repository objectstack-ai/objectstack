/**
 * MembersPage
 *
 * Lists organization members, supports changing roles and removing members.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Separator,
} from '@object-ui/components';
import { useAuth, assignableOrgRoles, ORG_ROLE_LABELS } from '@object-ui/auth';
import type { AuthOrganizationMember, OrgRole } from '@object-ui/auth';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { Loader2, MoreHorizontal, UserMinus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useOrgContext } from './orgContext.js';
import { InviteMemberDialog } from './InviteMemberDialog.js';
import { canInviteMembers, canRemoveMembers } from './orgCapabilities.js';
import { resolveOrgRoleLabel } from '../orgRoleLabel.js';
import { resolveOrgErrorMessage } from '../orgErrorMessage.js';

function getMemberInitials(name?: string): string {
  if (!name) return '?';
  return name
    .split(/[\s_-]+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function MembersPage() {
  const { t } = useObjectTranslation();
  // Dates and numbers on this surface read the display locale; a bare
  // `toLocale*()` call used the MACHINE's locale (objectui#9909).
  const displayLocale = useDisplayLocale();
  const { org } = useOrgContext();
  const { getMembers, removeMember, updateMemberRole, activeMember, getAuthConfig } = useAuth();

  /* objectui#4475 — what this viewer may actually do here. Both read the SAME
     `activeMember.role` the role-change narrowing below already keys on (one
     role source per screen), and both are measured against the server gate they
     mirror — see `orgCapabilities`. `canInvite` is the wider set: it includes
     `delegated_admin`, which may invite and may not remove. */
  const canRemove = canRemoveMembers(activeMember?.role);

  /* objectui#13330 — on a cloud-managed environment (`features.cloudManaged`)
     people join through the hosting organisation in the cloud, and the server
     refuses an invitation made here (the objectstack-ai/objectstack#25083
     ruling, Q3 A). So the button gives its place to a note that says where to
     invite, the #4475 convention below. Until `/auth/config` answers, and
     whenever it cannot, the page is what it was. */
  const [managed, setManaged] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(getAuthConfig?.())
      .then((config) => {
        if (!cancelled) setManaged(config?.features?.cloudManaged === true);
      })
      .catch(() => { /* unknown → unchanged */ });
    return () => { cancelled = true; };
  }, [getAuthConfig]);
  const canInvite = canInviteMembers(activeMember?.role) && !managed;

  const [members, setMembers] = useState<AuthOrganizationMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  // AlertDialog state
  const [removingMember, setRemovingMember] = useState<AuthOrganizationMember | null>(null);

  const fetchMembers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getMembers(org.id);
      setMembers(data);
    } catch (err) {
      setError(
        resolveOrgErrorMessage(err, t, {
          key: 'organization.members.loadFailed',
          defaultValue: 'Failed to load members',
        }),
      );
    } finally {
      setIsLoading(false);
    }
  }, [org.id, getMembers, t]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleChangeRole = async (member: AuthOrganizationMember, role: OrgRole) => {
    try {
      await updateMemberRole({ organizationId: org.id, memberId: member.id, role });
      toast.success(t('organization.members.roleUpdated', { defaultValue: 'Role updated' }));
      fetchMembers();
    } catch (err) {
      toast.error(
        resolveOrgErrorMessage(err, t, {
          key: 'organization.members.roleUpdateFailed',
          defaultValue: 'Failed to update role',
        }),
      );
    }
  };

  const handleRemove = async () => {
    if (!removingMember) return;
    try {
      await removeMember({ organizationId: org.id, memberIdOrUserId: removingMember.id });
      toast.success(t('organization.members.memberRemoved', { defaultValue: 'Member removed' }));
      setRemovingMember(null);
      fetchMembers();
    } catch (err) {
      toast.error(
        resolveOrgErrorMessage(err, t, {
          key: 'organization.members.removeFailed',
          defaultValue: 'Failed to remove member',
        }),
      );
    }
  };

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
        <Button variant="outline" size="sm" className="ml-4" onClick={fetchMembers}>
          {t('common.retry', { defaultValue: 'Retry' })}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="members-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {t('organization.members.title', { defaultValue: 'Members' })} ({members.length})
        </h2>
        {/* objectui#4475 — the Settings tab's convention, applied to this slot:
            the explanatory copy takes the PLACE of the affordance it replaces
            (there a form, here the button), in the same `text-sm
            text-muted-foreground` voice, so the space says why instead of going
            blank. It is not a disabled button: a control that exists only to
            refuse is still an invitation to try. */}
        {managed ? (
          <p className="text-sm text-muted-foreground" data-testid="invite-managed-note">
            {t('organization.members.inviteManagedNote', {
              defaultValue: 'People join through your organization in the cloud. Invite them there.',
            })}
          </p>
        ) : canInvite ? (
          <Button onClick={() => setIsInviteOpen(true)} data-testid="invite-member-btn">
            {t('organization.members.inviteMember', { defaultValue: 'Invite member' })}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="invite-restricted-note">
            {t('organization.members.inviteRestrictedNote', {
              defaultValue: 'Only organization admins can invite members.',
            })}
          </p>
        )}
      </div>

      <Separator />

      {/* Member list */}
      <div className="space-y-2">
        {members.map((member) => {
          /* [objectstack-ai/objectstack#3697] Roles this actor may SET on THIS member — see the
             menu below for what the list mirrors. Hoisted out of the JSX because
             objectui#4475 needs its emptiness twice: an actor with no assignable
             role AND no remove permission gets no menu at all, rather than a
             trigger that opens onto nothing. */
          const assignable = assignableOrgRoles(activeMember?.role, member.role);
          const hasRowActions = assignable.length > 0 || canRemove;
          return (
          <div
            key={member.id}
            className="flex items-center gap-3 rounded-lg border bg-card p-3"
            data-testid={`member-row-${member.id}`}
          >
            <Avatar className="h-9 w-9 shrink-0">
              {member.user?.image && <AvatarImage src={member.user.image} alt={member.user.name} />}
              <AvatarFallback className="text-xs font-medium">
                {getMemberInitials(member.user?.name)}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-sm">{member.user?.name ?? '—'}</div>
              <div className="truncate text-xs text-muted-foreground">{member.user?.email ?? '—'}</div>
            </div>

            {/* objectui#4474 — the role badge used to render the raw server
                identifier under CSS `capitalize`, which made `owner` look like
                a label in English and left it untranslated everywhere else. It
                now reads the same shared map the role dropdown and the
                role-change menu below already read, so one role has one name
                across the whole feature. `capitalize` goes with it: the map's
                values are already cased. */}
            <Badge
              variant="outline"
              className="shrink-0"
              data-testid={`member-role-badge-${member.id}`}
            >
              {resolveOrgRoleLabel(member.role, t)}
            </Badge>

            {member.createdAt && (
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                {new Date(member.createdAt).toLocaleDateString(displayLocale)}
              </span>
            )}

            {hasRowActions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  {/* Icon-only: this aria-label is the ONLY name a screen reader
                      gets for the row's action menu (objectui#4474). */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label={t('organization.members.memberActions', {
                      defaultValue: 'Member actions',
                    })}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {/* Mirrors better-auth's `update-member-role` route: it needs
                      the `member:["update"]` permission (owner/admin only — a
                      `delegated_admin` is built from `memberAc` and holds
                      `member: []`), and only an owner may set `owner` or re-role
                      someone who already is one. An actor who may re-role nobody
                      gets no items rather than three that would 403. */}
                  {assignable.map((role) => (
                    <DropdownMenuItem
                      key={role}
                      onClick={() => handleChangeRole(member, role)}
                      disabled={member.role === role}
                      data-testid={`member-role-${role}`}
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      {t(ORG_ROLE_LABELS[role].key, {
                        defaultValue: ORG_ROLE_LABELS[role].defaultValue,
                      })}
                    </DropdownMenuItem>
                  ))}
                  {/* objectui#4475 — the card's headline: this item used to be
                      unconditional, so a `member` was offered Remove on every
                      row INCLUDING the Owner's, and only the server's 403 (or,
                      on the remove route, a 400 from the lookup that runs first)
                      told them otherwise. `member:["delete"]` is owner/admin. */}
                  {canRemove && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setRemovingMember(member)}
                    >
                      <UserMinus className="mr-2 h-4 w-4" />
                      {t('organization.members.removeMember', { defaultValue: 'Remove member' })}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          );
        })}
      </div>

      {/* Remove confirmation dialog */}
      <AlertDialog open={!!removingMember} onOpenChange={(open) => !open && setRemovingMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('organization.members.removeConfirmTitle', { defaultValue: 'Remove member?' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('organization.members.removeConfirmDescription', {
                defaultValue:
                  'This will remove {{name}} from the organization. They will lose access immediately.',
                name: removingMember?.user?.name ?? removingMember?.userId ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', { defaultValue: 'Cancel' })}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleRemove}
            >
              {t('organization.members.removeConfirmAction', { defaultValue: 'Remove' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invite dialog — not mounted for an actor who may not invite. Nothing
          can open it either way (the trigger is gone), but leaving it out keeps
          its delegable-scope fetch from running for a viewer who has no use for
          the answer. */}
      {canInvite && (
        <InviteMemberDialog
          organizationId={org.id}
          open={isInviteOpen}
          onOpenChange={setIsInviteOpen}
          onInvited={() => fetchMembers()}
        />
      )}
    </div>
  );
}
