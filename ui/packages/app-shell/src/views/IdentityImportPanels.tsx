// Identity import UI panels — framework#2782.
//
// Injected into the stock ImportWizard through its generic slots
// (`extraOptionsContent` / `renderResultExtra`); the wizard itself stays
// backend-agnostic. See identityImport.ts for the matching dataSource wrapper.

import React, { useMemo } from 'react';
import {
  Button,
  Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@object-ui/components';
import { Download, KeyRound, ShieldAlert } from 'lucide-react';
import type { ImportRecordsResult } from '@object-ui/types';
import type { ImportWizardProps } from '@object-ui/plugin-grid';
import { useSafeTranslate } from '@object-ui/i18n';
import {
  buildTemporaryPasswordCsv,
  collectTemporaryPasswords,
  type IdentityPasswordPolicy,
} from './identityImport.js';

const POLICY_FALLBACKS: Record<IdentityPasswordPolicy, { label: string; hint: string }> = {
  auto: {
    label: 'Automatic (recommended)',
    hint: 'Reachable users get an invitation (email or SMS); anyone we can\'t reach gets a one-time password, shown ONCE on the result screen. Works with or without an email/SMS service.',
  },
  invite: {
    label: 'Send invitations',
    hint: 'Every created user gets a set-your-password email (or an invitation SMS for phone-only rows). Requires a configured email/SMS service — unreachable rows fail.',
  },
  temporary: {
    label: 'Temporary passwords',
    hint: 'For deployments without email/SMS: every created user gets a one-time password, shown ONCE on the result screen. First sign-in forces a change.',
  },
  none: {
    label: 'No password (identity only)',
    hint: 'Users first sign in with a phone OTP, magic link, or password-reset link, then set their own password.',
  },
};

export function IdentityImportOptions({
  policy,
  onPolicyChange,
}: {
  policy: IdentityPasswordPolicy;
  onPolicyChange: (p: IdentityPasswordPolicy) => void;
}) {
  const t = useSafeTranslate();
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-md border border-border p-3" data-testid="identity-import-options">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <Label className="text-xs font-medium">
          {t('console.identityImport.policyTitle', 'Sign-in setup for imported users')}
        </Label>
      </div>
      <Select value={policy} onValueChange={(v) => onPolicyChange(v as IdentityPasswordPolicy)}>
        <SelectTrigger className="h-8 w-full sm:w-80" data-testid="identity-import-policy">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(POLICY_FALLBACKS) as IdentityPasswordPolicy[]).map((p) => (
            <SelectItem key={p} value={p}>
              {t(`console.identityImport.policy.${p}`, POLICY_FALLBACKS[p].label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {t(`console.identityImport.policyHint.${policy}`, POLICY_FALLBACKS[policy].hint)}
      </p>
    </div>
  );
}

/** One-shot reveal of the temporary passwords a `temporary`-policy import
 *  returned. They exist only in this component's props (server keeps no
 *  copy); closing the dialog discards them permanently. */
export function IdentityImportResultExtra({ serverResult }: { serverResult?: ImportRecordsResult }) {
  const t = useSafeTranslate();
  const entries = useMemo(() => collectTemporaryPasswords(serverResult), [serverResult]);
  if (entries.length === 0) return null;

  const handleDownload = () => {
    const csv = buildTemporaryPasswordCsv(entries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'temporary-passwords.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-2 flex w-full flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3" data-testid="identity-import-passwords">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <p className="text-xs font-medium">
          {t(
            'console.identityImport.passwordsNote',
            'Temporary passwords — shown once, never stored. Save them now; each user must change theirs at first sign-in.',
          )}
        </p>
      </div>
      <div className="max-h-40 overflow-auto rounded border bg-background p-2 font-mono text-xs">
        {entries.slice(0, 50).map((e) => (
          <p key={e.row} data-testid={`identity-import-password-row-${e.row}`}>
            {e.identity}: {e.temporaryPassword}
          </p>
        ))}
        {entries.length > 50 && (
          <p className="text-muted-foreground">
            {t('console.identityImport.passwordsMore', 'More entries omitted — use the download.')}
          </p>
        )}
      </div>
      <div>
        <Button variant="outline" size="sm" onClick={handleDownload} data-testid="identity-import-passwords-download">
          <Download className="mr-1 h-4 w-4" />
          {t('console.identityImport.passwordsDownload', 'Download CSV')} ({entries.length})
        </Button>
      </div>
    </div>
  );
}

/** Curated importable columns for sys_user. The generic writable-field filter
 *  would drop `phone_number` (readonly for CRUD — identity writes go through
 *  better-auth), so identity import declares its own target set.
 *
 *  The email column is typed `email` and flagged `emailRule: 'identity'`, so
 *  the wizard's preview checks it by the identity endpoint's rule: a non-ASCII
 *  or placeholder address is marked, as the endpoint refuses it with
 *  `INVALID_EMAIL` (objectui#11913).
 *
 *  The flag is typed where it is written, against the wizard's own field type,
 *  and the return type does not name it. `ObjectView` passes this list or
 *  `importTargetFields`' list into the wizard's `fields` through one
 *  conditional, and that expression compiles only while this return type is a
 *  supertype of `ImportTargetField`, which declares no `emailRule`. */
export function identityImportFields(
  objectFields: Record<string, any> | undefined,
): Array<{ name: string; label: string; type: string; required?: boolean }> {
  const label = (name: string, fallback: string) => objectFields?.[name]?.label || fallback;
  const email: ImportWizardProps['fields'][number] = {
    name: 'email', label: label('email', 'Email'), type: 'email', emailRule: 'identity',
  };
  return [
    email,
    { name: 'phone_number', label: label('phone_number', 'Phone Number'), type: 'text' },
    { name: 'name', label: label('name', 'Name'), type: 'text' },
    { name: 'role', label: label('role', 'Platform Role'), type: 'text' },
  ];
}
