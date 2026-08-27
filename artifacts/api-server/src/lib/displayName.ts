/** Best-effort display name: custom override → full name → email username → user ID. */
export function makeDisplayName(m: { displayName?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null; userId: string }): string {
  if (m.displayName) return m.displayName;
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
  if (name) return name;
  if (m.email) return m.email.split("@")[0];
  return m.userId;
}
