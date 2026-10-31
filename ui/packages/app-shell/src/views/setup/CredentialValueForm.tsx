// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The masked input that sets or replaces one connector credential — the same
 * control on Setup → Integrations → Connector Credentials and in the credential
 * step after a marketplace install.
 *
 * Two rules it keeps (ADR-0007's render rules for a secret input):
 *
 *   - the input is masked, and it starts EMPTY whatever is stored: no value is
 *     ever read back from the door, so there is none to show;
 *   - an empty input means "leave it unchanged", so Save is disabled until
 *     something is typed and nothing is sent for an empty field.
 *
 * The typed value is dropped from state as soon as the door accepts it.
 */

import { useId, useState, type FormEvent } from 'react';
import { Button, Input } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import type { ConnectorCredentialRef } from '@objectstack/spec/contracts';
import { putConnectorCredential } from './connectorCredentials.js';

export interface CredentialValueFormProps {
  /** The reference this input writes. */
  credentialRef: string;
  /** Whether a value is stored or supplied now: only the placeholder differs. */
  hasValue: boolean;
  /** The reference's entry after the door stored the value and reconciled. */
  onWritten: (entry: ConnectorCredentialRef) => void;
}

export function CredentialValueForm({ credentialRef, hasValue, onWritten }: CredentialValueFormProps) {
  const { t } = useObjectTranslation();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalId = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || value.length === 0) return;
    setBusy(true);
    setRefusal(null);
    const out = await putConnectorCredential(credentialRef, value);
    setBusy(false);
    if (!out) return;
    if (out.ok) {
      setValue('');
      onWritten(out.entry);
    } else {
      setRefusal(out.message);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-1" data-testid={`credential-form-${credentialRef}`}>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          placeholder={hasValue
            ? t('connectorCredentials.placeholderReplace', { defaultValue: 'Enter a new value to replace it' })
            : t('connectorCredentials.placeholderSet', { defaultValue: 'Enter the value' })}
          aria-label={t('connectorCredentials.valueLabel', { defaultValue: 'New value for {{ref}}', ref: credentialRef })}
          aria-describedby={refusal ? refusalId : undefined}
          className="h-8 max-w-xs font-mono text-xs"
        />
        <Button type="submit" size="sm" disabled={busy || value.length === 0}>
          {busy
            ? t('connectorCredentials.saving', { defaultValue: 'Saving' })
            : t('connectorCredentials.save', { defaultValue: 'Save' })}
        </Button>
      </div>
      {refusal ? (
        <p id={refusalId} role="alert" className="text-xs text-destructive">
          {refusal}
        </p>
      ) : null}
    </form>
  );
}
