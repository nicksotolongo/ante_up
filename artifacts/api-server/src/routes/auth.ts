import { db, usersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { isAppAdmin } from '../lib/adminConfig';

const router: IRouter = Router();

router.get('/auth/user', async (req: Request, res: Response) => {
  let user = null;
  if (req.isAuthenticated()) {
    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.user.id));
    user = {
      ...req.user,
      displayName: row?.displayName ?? null,
      canCreateLeagues: isAppAdmin(row?.email),
    };
  }
  res.json({ user });
});

router.patch('/auth/user', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const rawDisplayName = req.body?.displayName;
  if (
    rawDisplayName !== undefined &&
    rawDisplayName !== null &&
    typeof rawDisplayName !== 'string'
  ) {
    res.status(400).json({ error: 'displayName must be a string or null' });
    return;
  }

  const trimmed =
    typeof rawDisplayName === 'string' ? rawDisplayName.trim() || null : null;

  const [row] = await db
    .update(usersTable)
    .set({ displayName: trimmed })
    .where(eq(usersTable.id, req.user.id))
    .returning();

  const user = {
    ...req.user,
    displayName: row.displayName,
    canCreateLeagues: isAppAdmin(row.email),
  };
  res.json({ user });
});

export default router;
