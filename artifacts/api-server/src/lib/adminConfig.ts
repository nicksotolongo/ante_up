// App-wide admin configuration.
// Only these users (matched by email, case-insensitive) can create new leagues.
const ADMIN_EMAILS = ["nick.sotolongo@gmail.com"];

export function isAppAdmin(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
