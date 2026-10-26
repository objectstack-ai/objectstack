/**
 * Identifier helpers shared by the login surfaces for phone sign-in
 * (framework#2780).
 *
 * These MIRROR the backend's `normalizePhoneNumber`
 * (`@objectstack/plugin-auth`): strip spaces / dashes / parens / dots, then
 * validate `^\+?[0-9]{6,15}$`. They deliberately do NOT force E.164 or inject a
 * country code — accounts are stored in exactly this light-stripped form, so
 * anything heavier would fail the `phoneNumber` lookup at sign-in. Keep this in
 * lock-step with the backend regex.
 */

/** Strip formatting and validate; returns the canonical string or `null`. */
export function normalizePhoneIdentifier(raw: string): string | null {
  const stripped = String(raw ?? '').replace(/[\s\-().]/g, '');
  return /^\+?[0-9]{6,15}$/.test(stripped) ? stripped : null;
}

/**
 * Whether an identifier should be treated as a phone number rather than an
 * email. An `@` always means email; otherwise it is a phone only when it
 * normalizes to a valid number.
 */
export function looksLikePhoneIdentifier(raw: string): boolean {
  if (typeof raw !== 'string' || raw.includes('@')) return false;
  return normalizePhoneIdentifier(raw) !== null;
}
