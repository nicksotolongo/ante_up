/** Best-effort display name: full name → email username → user ID. */
export function makeDisplayName(m: { firstName?: string | null; lastName?: string | null; email?: string | null; userId: string }): string {
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
  if (name) return name;
  if (m.email) return m.email.split("@")[0];
  return m.userId;
}
