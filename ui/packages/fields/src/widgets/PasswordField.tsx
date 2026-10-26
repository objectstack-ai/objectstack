import React, { useState } from 'react';
import { Input, EmptyValue } from '@object-ui/components';
import { Button } from '@object-ui/components';
import { isEmptyValue } from '@object-ui/core';
import { Eye, EyeOff } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { coerceToSafeValue } from '../coerceToSafeValue.js';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';

/**
 * Name words that mark a field as the user's EXISTING password — the one a
 * change-password form asks for to verify before it accepts a new one.
 */
const CURRENT_PASSWORD_WORDS = new Set(['current', 'old', 'existing']);

/**
 * The `autocomplete` token for a password control (objectui#13295).
 *
 * No metadata key declares it — `@objectstack/spec` has no autocomplete
 * property on a field or an action param — so it is derived from the one thing
 * every caller already supplies, the field's `name`, split into words at
 * `_` / `-` / `.` / spaces and camelCase boundaries:
 *
 *   - `current-password` when a word is `current`, `old` or `existing`
 *     (`current_password`, `oldPassword`, `existing-pass`);
 *   - `new-password` for everything else.
 *
 * `new-password` is the safe default rather than `off`: browsers ignore `off`
 * on password inputs and fall back to offering the saved login password,
 * which is exactly the wrong answer for a new password, an API key or any
 * other `secret`, while `new-password` keeps the saved login out and lets a
 * password manager suggest and store a fresh value.
 */
function passwordAutoComplete(name: unknown): 'current-password' | 'new-password' {
  const words = String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return words.some((word) => CURRENT_PASSWORD_WORDS.has(word)) ? 'current-password' : 'new-password';
}

/**
 * PasswordField - Secure password input with visibility toggle
 * Includes show/hide toggle button and masks value in readonly mode
 *
 * Readonly draws the mask for a credential that is SET, and the shared
 * `EmptyValue` affordance for one that is NOT (objectui#10639). The platform's
 * read contract is presence-preserving: `@objectstack/spec`'s `SECRET_MASK`
 * docblock says an unset credential "reads back `null` instead, never this
 * mask", which is what lets a reader tell "configured" from "not configured".
 *
 * "Empty" is the password CELL's predicate (`MaskedCellRenderer` in this
 * package's barrel, objectui#8678), called on the same two helpers, so `{}`
 * and a whitespace-only string stay values and keep the mask. The helpers are
 * imported from their own modules, never from the barrel, which lazy-loads
 * this widget. ⛔ The value is never printed, and a set value keeps exactly
 * the mask it drew before. `__tests__/PasswordField.readonlyEmpty-10639`
 * pins the widget's "empty" to the cell's.
 *
 * The editable control always carries an `autocomplete` token (objectui#13295):
 * without one a browser treats every masked box as a login field, offering the
 * user's saved site password for an API key or a NEW password, and its
 * password manager cannot tell "verify the old one" from "store the new one".
 * See {@link passwordAutoComplete} for how the token is picked.
 */
export function PasswordField({ value, onChange, field, readonly, className, ...props }: FieldWidgetComponentProps<string>) {
  const { t } = useObjectTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const config = field;

  if (readonly) {
    if (isEmptyValue(coerceToSafeValue(value))) return <EmptyValue />;
    return <span className="text-sm">••••••••</span>;
  }

  const domProps = toDomProps(props);

  return (
    <div className="relative">
      <Input
        {...domProps}
        type={showPassword ? 'text' : 'password'}
        autoComplete={passwordAutoComplete(config?.name)}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={config?.placeholder}
        disabled={readonly || domProps.disabled}
        className={`pr-10 ${className || ''}`}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
        onClick={() => setShowPassword(!showPassword)}
        tabIndex={-1}
        aria-label={showPassword ? t('fields.password.hide') : t('fields.password.show')}
      >
        {showPassword ? (
          <EyeOff className="size-4 text-gray-500" />
        ) : (
          <Eye className="size-4 text-gray-500" />
        )}
      </Button>
    </div>
  );
}
