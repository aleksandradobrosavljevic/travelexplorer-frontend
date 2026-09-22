export const PHONE_FORMAT_EXAMPLE = '+381 60 1234567';
export const PHONE_FORMAT_HELPER = `Allowed: digits, spaces, hyphens, parentheses and optional leading +. Example: ${PHONE_FORMAT_EXAMPLE}`;
export const PHONE_INVALID_MESSAGE = `Phone number is not in a valid format. Example: ${PHONE_FORMAT_EXAMPLE}.`;

export const PHONE_PATTERN = /^\+?[0-9\s\-()]{6,20}$/;

export function sanitizePhoneInput(value: string | null | undefined): string {
  const raw = `${value ?? ''}`;
  const hasLeadingPlus = raw.trimStart().startsWith('+');
  let sanitized = raw.replace(/[^\d\s\-()+]/g, '').replace(/\+/g, '');

  if (hasLeadingPlus) {
    sanitized = `+${sanitized.trimStart()}`;
  }

  return sanitized.slice(0, 20);
}

export function normalizePhone(value: string | null | undefined): string | null {
  const normalized = sanitizePhoneInput(value).trim();
  return normalized || null;
}

export function isValidPhone(value: string | null | undefined): boolean {
  const phone = `${value ?? ''}`.trim();
  return !phone || PHONE_PATTERN.test(phone);
}
