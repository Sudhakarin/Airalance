// lib/time.ts
// Central timestamp helper — normalizes everything to ISO Z format
// Why: Supabase returns '2026-10-07T19:06:35.831+00:00' but JS toISOString()
// returns '2026-10-07T19:06:35.831Z'. Mixing them breaks string comparison
// and sorting everywhere.

export function toIso(input: string | null | undefined | Date): string | null {
  if (!input) return null;
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input.toISOString();
  }
  // Already canonical (ends with Z, has T)
  if (typeof input === 'string' && input.endsWith('Z') && input.includes('T')) {
    return input;
  }
  try {
    const d = new Date(input);
    if (isNaN(d.getTime())) return input as string;
    return d.toISOString();
  } catch {
    return input as string;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
