/**
 * User Profile Page
 *
 * Allows the authenticated user to view and edit their profile,
 * change their password, and manage account settings.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useAuth,
  getUserInitials,
  useWorkspaceAdminStatus,
  ORG_ROLE_ADMIN,
  ORG_ROLE_MEMBER,
  ORG_ROLE_LABELS,
} from '@object-ui/auth';
import {
  Button,
  Input,
  Label,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Badge,
  Alert,
  AlertDescription,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { useUpload } from '@object-ui/providers';
import { ConsolePageHeader } from '@object-ui/app-shell';
import { useObjectTranslation, type TranslateFn } from '@object-ui/i18n';
import { useAdapter, extractFieldErrors, extractWriteErrorMessage } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { resolveFieldAffordance } from '@object-ui/core';
import { CheckCircle2, AlertCircle, User, Lock, Upload, Loader2, X, Globe } from 'lucide-react';

/**
 * The access the console resolves for the signed-in user, as a translated word
 * — or `null` while that answer is still settling (objectui#11866).
 *
 * The source is `useWorkspaceAdminStatus`, the same verdict every console gate
 * acts on (Setup, Studio, the marketplace, the storage and read-rate banners).
 * ⛔ Not the session's `user.role`: that is better-auth's own scalar, which the
 * server deliberately no longer overwrites, so a platform administrator whose
 * standing comes from the posture rung (`isPlatformAdmin`) still carries
 * better-auth's default there and the page used to tell them they were a
 * plain "user". The hook reads the rung, the membership row and the narrow
 * `positions[]` vocabulary — what the console actually grants on.
 *
 * The words are the console's existing membership-grade labels
 * (`ORG_ROLE_LABELS`, the one list the organization screens read), because
 * the verdict is the same two-way grade those screens print: an administrator
 * of this workspace, or a member of it. No second vocabulary is introduced.
 *
 * Before the verdict settles (`isResolved` false), this answers `null` and the
 * page shows nothing: "not an admin yet" is not "not an admin", and a word the
 * page would have to take back is worse than a blank.
 */
function useResolvedAccessLabel(t: TranslateFn): string | null {
  const { isAdmin, isResolved } = useWorkspaceAdminStatus();
  if (!isResolved) return null;
  const label = ORG_ROLE_LABELS[isAdmin ? ORG_ROLE_ADMIN : ORG_ROLE_MEMBER];
  return t(label.key, { defaultValue: label.defaultValue });
}

export function ProfilePage() {
  const { t } = useObjectTranslation();
  const { user, updateUser, isLoading, changePassword, setInitialPassword, hasLocalPassword } = useAuth();
  const accessLabel = useResolvedAccessLabel(t);
  const { upload } = useUpload();
  const [name, setName] = useState(user?.name ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Sync local `name` state when the user object arrives or changes.
  // useState's initial value is only evaluated on first render, so when
  // this component mounts under <Suspense> (e.g. via the Account App's
  // `account:profile_card` registry entry) before AuthProvider has
  // resolved, `user` is null and `name` stays empty until we sync it.
  useEffect(() => {
    setName(user?.name ?? '');
  }, [user?.name]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);

    try {
      await updateUser({ name });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (avatarInputRef.current) avatarInputRef.current.value = '';
    if (!file) return;
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const result = await upload(file);
      await updateUser({ image: result.url });
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : String(err));
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleAvatarRemove = async () => {
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      await updateUser({ image: null as unknown as string });
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : String(err));
    } finally {
      setAvatarUploading(false);
    }
  };

  if (!user) return null;

  return (
    <div>
    {/* The console's one page header (objectui#12553), the one an object list,
        a dashboard and the Approvals Inbox draw: the title, and the subtitle
        beside it from `sm` up, in one row across the page above the padded
        body. This page draws no icon, so the header draws no chip. Below `sm`
        the header hides the subtitle. */}
    <ConsolePageHeader
      title={t('profile.title', { defaultValue: 'Profile' })}
      subtitle={t('profile.subtitle', { defaultValue: 'Manage your account settings' })}
    />
    <div className="flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 max-w-2xl">
      {/* Avatar & Identity */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={user.image ?? undefined} alt={user.name ?? 'User'} />
              <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                {getUserInitials(user)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold truncate">{user.name ?? 'User'}</p>
              <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              {accessLabel !== null && (
                <Badge variant="secondary" className="mt-1" data-testid="profile-access-badge">
                  {accessLabel}
                </Badge>
              )}
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarFile}
                data-testid="profile-avatar-file"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={avatarUploading}
                onClick={() => avatarInputRef.current?.click()}
                data-testid="profile-avatar-upload-btn"
              >
                {avatarUploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {user.image
                  ? t('profile.avatar.replace', { defaultValue: 'Replace' })
                  : t('profile.avatar.upload', { defaultValue: 'Upload' })}
              </Button>
              {user.image && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={avatarUploading}
                  onClick={handleAvatarRemove}
                  data-testid="profile-avatar-remove-btn"
                >
                  <X className="mr-2 h-4 w-4" />
                  {t('profile.avatar.remove', { defaultValue: 'Remove' })}
                </Button>
              )}
            </div>
          </div>
          {avatarError && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{avatarError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Personal Information */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base sm:text-lg">
              {t('profile.info.title', { defaultValue: 'Personal Information' })}
            </CardTitle>
          </div>
          <CardDescription>
            {t('profile.info.description', { defaultValue: 'Update your name and view account details' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {saved && (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800 dark:text-green-400">
                  {t('profile.info.saved', { defaultValue: 'Profile updated successfully.' })}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="profile-name">{t('profile.info.name', { defaultValue: 'Name' })}</Label>
              <Input
                id="profile-name"
                type="text"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                required
                aria-required="true"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-email">{t('profile.info.email', { defaultValue: 'Email' })}</Label>
              <Input
                id="profile-email"
                type="email"
                value={user.email}
                disabled
                className="bg-muted text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                {t('profile.info.emailImmutable', { defaultValue: 'Email cannot be changed.' })}
              </p>
            </div>

            {accessLabel !== null && (
              <div className="space-y-2">
                <Label htmlFor="profile-role">{t('profile.info.role', { defaultValue: 'Role' })}</Label>
                <Input
                  id="profile-role"
                  type="text"
                  value={accessLabel}
                  disabled
                  className="bg-muted text-muted-foreground"
                />
              </div>
            )}

            <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
              {isLoading
                ? t('profile.saving', { defaultValue: 'Saving…' })
                : t('profile.info.save', { defaultValue: 'Save Changes' })}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Language — the user's own `sys_user.locale` */}
      <LanguageCard userId={user.id} />

      {/* Password Change */}
      <PasswordCard
        changePassword={changePassword}
        setInitialPassword={setInitialPassword}
        hasLocalPassword={hasLocalPassword}
      />
    </div>
    </div>
  );
}

/**
 * Name a language in its own language.
 *
 * `Intl.DisplayNames` in the locale itself, capitalized, with the bare code as
 * the last resort — `Intl.DisplayNames` is absent on old runtimes, throws
 * `RangeError` on a malformed tag, and hands back the input unchanged for a tag
 * it has no name for. A code is still an honest, selectable entry.
 *
 * ⚠️ This is deliberately NOT a copy of `@object-ui/app-shell`'s hand-kept
 * `BUILT_IN_LABELS` map. That package's `localeLabel` is the same idea and is
 * the one this control would rather call, but it is not on the
 * `@object-ui/app-shell` entry (only `LocaleSwitcher` itself is) and the
 * package's `exports` map has no subpath to reach it — so there is nothing to
 * import today. Re-typing its ten strings here would create the second source
 * of truth for language NAMES that nothing re-derives, so the derived name is
 * used instead and the export gap is filed rather than worked around. The list
 * itself is not duplicated: it comes from `offerableLanguages`.
 */
function nativeLanguageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (!name || name === code) return code;
    // CLDR names many languages lowercase (`português (Brasil)`); a menu that
    // mixes cases reads as a bug. A no-op for caseless scripts.
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}

/** The picker option's value standing for "no stored tag" — see {@link LanguageCard}. */
const USE_DEPLOYMENT_DEFAULT = '';

/** The item a value none of the picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — the language picker, drawn with the shared `Select` the rest
 * of the console picks with. It used to be a browser-native `<select>`. What a
 * pick writes is unchanged: `onPick` receives the picked option's own `value`,
 * the string the native control's `change` carried, and {@link LanguageCard}
 * saves it as before. Re-picking the current option writes nothing, as it did
 * there.
 *
 * - Items carry their option's INDEX, not its value. The first option is
 *   {@link USE_DEPLOYMENT_DEFAULT}, whose value is `''`, which `SelectItem`
 *   refuses; an index cannot collide with a language tag, as any stand-in
 *   string could.
 * - The card already lists a stored tag the deployment no longer publishes.
 *   A value none of the options carries all the same (a pick the offered list
 *   dropped since) gets an item of its own, labelled with the value, so the
 *   trigger shows what Save would write. The native control showed its first
 *   option there. Picking that item writes nothing.
 * - Read-only follows the primitive (objectui#11781): `disabled` disables the
 *   trigger itself.
 * - `id` lands on the trigger, so the card's `<Label htmlFor>` names it as it
 *   named the native control, and the refusal stays attached to it.
 */
function LanguagePicker({
  id,
  testId,
  value,
  options,
  onPick,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  testId: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the card's own value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        data-testid={testId}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className="h-9"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface LanguageCardProps {
  /** The signed-in user's `sys_user` record id. */
  userId: string;
}

/**
 * The signed-in user's own `sys_user.locale` — a BCP-47 tag such as `zh-CN`.
 *
 * ## Why this is not part of the Personal Information form above
 *
 * `name` and `image` are written by `useAuth().updateUser`, which posts to
 * better-auth's `/update-user`. `locale` is deliberately NOT a better-auth
 * `additionalFields` entry, so that endpoint does not know the column and
 * cannot carry it — the card that asked for this control says so, and
 * `createAuthClient`'s `updateUser` is a thin pass-through to
 * `betterAuth.updateUser`, so there is no seam to widen on this side either.
 * The write therefore goes through the data API (`PATCH` on the `sys_user`
 * row) via the adapter, which is a different writer from the form above.
 *
 * A different writer gets its own card with its own submit and its own
 * feedback — the shape `PasswordCard` below already establishes in this file,
 * for the same reason (`changePassword` is not `updateUser` either). What is
 * kept identical to the `name` form is the FEEDBACK vocabulary: the same
 * `Alert` success/failure pair, the same disabled-while-saving submit, the
 * same `profile.saving` label.
 *
 * ## The UI language is a different thing, and is deliberately not touched
 *
 * `@object-ui/i18n`'s provider keeps the interface language in `localStorage`
 * (`LOCALE_STORAGE_KEY`), seeded per device from the server's resolved locale
 * for the last signed-in owner (`/auth/me/localization`). `sys_user.locale` is a server-stored, per-user
 * column that the messaging channels read per recipient at delivery time.
 * Saving here therefore does NOT call `changeLanguage`, and switching the UI
 * language from the globe menu does NOT write this column. Wiring the two
 * together is a product decision nobody has made; this control states the
 * distinction in its own description instead of guessing.
 *
 * ## What is offered, and what happens when the write route is not there
 *
 * The option list is `offerableLanguages` — the i18n provider's own answer
 * (the deployment's published locales ∩ what this renderer can resolve), which
 * is what `LocaleSwitcher` renders too. ⛔ No second list is introduced here.
 * A stored tag that is not in that set is prepended so the control shows the
 * truth rather than rendering blank.
 *
 * Availability is asked, not discovered from a rejection: the card renders
 * nothing until the row has been read, and the field question an edit asks —
 * the `editFormFields` row of the affordance-to-grant map, read through
 * `resolveFieldAffordance` from `@object-ui/core` (objectui#12082): it consults
 * field-level permissions and falls back to the object gate's `allowEdit` —
 * decides between an editable control and a
 * read-only one carrying the reason. A failed read hides the card, the same
 * "render nothing rather than something you will have to retract" idiom
 * `LocaleSwitcher` uses for a locale list it does not have yet. That is the
 * card's own "hidden ... rather than rendering a control that answers 403".
 */
function LanguageCard({ userId }: LanguageCardProps) {
  const { t, offerableLanguages } = useObjectTranslation();
  const adapter = useAdapter();
  const perms = usePermissions();

  const [stored, setStored] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>(USE_DEPLOYMENT_DEFAULT);
  const [rowRead, setRowRead] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (!adapter || !userId) return;
    let cancelled = false;
    adapter
      .findOne('sys_user', userId)
      .then((row) => {
        if (cancelled) return;
        const raw = (row as { locale?: unknown } | null)?.locale;
        const value = typeof raw === 'string' && raw.length > 0 ? raw : USE_DEPLOYMENT_DEFAULT;
        setStored(value);
        setChoice(value);
        setRowRead(true);
      })
      .catch((err) => {
        if (cancelled) return;
        // Stay hidden. A deployment that does not expose `sys_user` to this
        // caller, and one that refuses the read outright, both arrive here —
        // and a control that cannot state the current value is worse than no
        // control. The warning is the diagnosable half.
        console.warn('[profile] Could not read your language preference:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, userId]);

  const codes = useMemo(() => {
    const offered = offerableLanguages ?? [];
    // A stored tag the deployment no longer publishes is still this account's
    // truth; showing it beats a select whose value matches no option.
    return stored && stored.length > 0 && !offered.includes(stored)
      ? [stored, ...offered]
      : [...offered];
  }, [offerableLanguages, stored]);

  if (!adapter || !rowRead || offerableLanguages === null) return null;

  const writable = resolveFieldAffordance('editFormFields', perms, 'sys_user', 'locale');
  const dirty = choice !== (stored ?? USE_DEPLOYMENT_DEFAULT);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      // `null`, not `''`: an unset column is the documented "use the
      // deployment default", and it is the only way back once a tag has been
      // stored. The avatar's remove path in this file clears `image` the same
      // way.
      await adapter.update('sys_user', userId, {
        locale: choice === USE_DEPLOYMENT_DEFAULT ? null : choice,
      });
      setStored(choice);
      setSaved(true);
    } catch (err) {
      // A malformed tag comes back as `400 VALIDATION_FAILED` carrying
      // `{ field: 'locale', code: 'invalid_format' }` and a localized message.
      // `extractFieldErrors` is this repo's one normaliser for that envelope;
      // the message it yields is rendered ON the item, which is the whole
      // point of asking for it rather than showing an undirected alert.
      const perField = extractFieldErrors(err);
      const onLocale = perField?.find((entry) => entry.field === 'locale');
      if (onLocale && onLocale.message) {
        setFieldError(onLocale.message);
      } else {
        setError(
          extractWriteErrorMessage(err) ?? (err instanceof Error ? err.message : String(err)),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base sm:text-lg">
            {t('profile.language.title', { defaultValue: 'Language' })}
          </CardTitle>
        </div>
        <CardDescription>
          {t('profile.language.description', {
            defaultValue:
              'The language used for notifications and messages sent to you. The interface language is chosen separately, from the globe menu.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4 max-w-md">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {saved && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800 dark:text-green-400">
                {t('profile.language.saved', { defaultValue: 'Language preference updated.' })}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="profile-language">
              {t('profile.language.label', { defaultValue: 'Preferred language' })}
            </Label>
            <LanguagePicker
              id="profile-language"
              testId="profile-language-select"
              value={choice}
              options={[
                {
                  value: USE_DEPLOYMENT_DEFAULT,
                  label: t('profile.language.systemDefault', {
                    defaultValue: 'Use the deployment default',
                  }),
                },
                ...codes.map((code) => ({ value: code, label: nativeLanguageName(code) })),
              ]}
              onPick={(next) => {
                setChoice(next);
                setFieldError(null);
                setSaved(false);
              }}
              disabled={!writable || submitting}
              invalid={!!fieldError}
              describedBy={fieldError ? 'profile-language-error' : undefined}
            />
            {fieldError && (
              <p id="profile-language-error" className="text-sm text-destructive">
                {fieldError}
              </p>
            )}
            {!writable && (
              <p className="text-xs text-muted-foreground">
                {t('profile.language.readOnly', {
                  defaultValue: 'Your administrator manages the language for your account.',
                })}
              </p>
            )}
          </div>

          {writable && (
            <Button type="submit" disabled={submitting || !dirty} className="w-full sm:w-auto">
              {submitting
                ? t('profile.saving', { defaultValue: 'Saving…' })
                : t('profile.language.save', { defaultValue: 'Save' })}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

interface PasswordCardProps {
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  setInitialPassword: (newPassword: string) => Promise<void>;
  hasLocalPassword: () => Promise<boolean>;
  highlight?: boolean;
  onPasswordSet?: () => void;
}

function PasswordCard({ changePassword, setInitialPassword, hasLocalPassword, highlight, onPasswordSet }: PasswordCardProps) {
  const { t } = useObjectTranslation();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    hasLocalPassword()
      .then((value) => { if (!cancelled) setHasPassword(value); })
      .catch(() => { if (!cancelled) setHasPassword(false); });
    return () => { cancelled = true; };
  }, [hasLocalPassword]);

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < 8) {
      setError(t('profile.password.tooShort', { defaultValue: 'Password must be at least 8 characters' }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('profile.password.mismatch', { defaultValue: 'Passwords do not match' }));
      return;
    }

    setSubmitting(true);
    try {
      if (hasPassword) {
        if (!currentPassword) {
          setError(t('profile.password.enterCurrent', { defaultValue: 'Enter your current password' }));
          setSubmitting(false);
          return;
        }
        await changePassword(currentPassword, newPassword);
        setSuccess(t('profile.password.changed', { defaultValue: 'Password changed.' }));
      } else {
        await setInitialPassword(newPassword);
        setSuccess(t('profile.password.localSet', {
          defaultValue: 'Local password set. You can now sign in with email and password.',
        }));
        setHasPassword(true);
        onPasswordSet?.();
      }
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state — keep the card visible to avoid layout shift.
  const initializing = hasPassword === null;

  return (
    <Card className={highlight ? 'ring-2 ring-amber-300 dark:ring-amber-700' : undefined}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base sm:text-lg">
            {hasPassword
              ? t('profile.password.changeTitle', { defaultValue: 'Change Password' })
              : t('profile.password.setTitle', { defaultValue: 'Set Local Password' })}
          </CardTitle>
        </div>
        <CardDescription>
          {hasPassword
            ? t('profile.password.changeDescription', {
                defaultValue: 'Update the password you use to sign in.',
              })
            : t('profile.password.setDescription', {
                defaultValue:
                  'You signed in via single sign-on. Set a local password to also sign in with email and password.',
              })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          {hasPassword && (
            <div className="space-y-2">
              <Label htmlFor="current-password">
                {t('profile.password.current', { defaultValue: 'Current password' })}
              </Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={submitting || initializing}
                required
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-password">
              {hasPassword
                ? t('profile.password.new', { defaultValue: 'New password' })
                : t('profile.password.password', { defaultValue: 'Password' })}
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={submitting || initializing}
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">
              {t('profile.password.confirm', { defaultValue: 'Confirm password' })}
            </Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting || initializing}
              minLength={8}
              required
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {success && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={submitting || initializing} className="w-full sm:w-auto">
            {submitting
              ? t('profile.saving', { defaultValue: 'Saving…' })
              : hasPassword
                ? t('profile.password.changeAction', { defaultValue: 'Change password' })
                : t('profile.password.setAction', { defaultValue: 'Set password' })}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
