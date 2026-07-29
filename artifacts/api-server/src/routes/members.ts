import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, leagueMembersTable, leaguesTable, usersTable } from "@workspace/db";
import { UpdateMemberBody } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /leagues/:leagueId/members
router.get("/leagues/:leagueId/members", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const raw = Array.isArray(req.params.leagueId) ? req.params.leagueId[0] : req.params.leagueId;
  const leagueId = parseInt(raw, 10);
  const userId = req.user.id;

  const [myMembership] = await db.select().from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.userId, userId), eq(leagueMembersTable.status, "active")));
  if (!myMembership) { res.status(403).json({ error: "Not a member" }); return; }

  const members = await db
    .select({
      id: leagueMembersTable.id,
      leagueId: leagueMembersTable.leagueId,
      userId: leagueMembersTable.userId,
      role: leagueMembersTable.role,
      joinedAt: leagueMembersTable.joinedAt,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
    })
    .from(leagueMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, leagueMembersTable.userId))
    .where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active")));

  res.json(members.map((m) => ({
    id: m.id,
    leagueId: m.leagueId,
    userId: m.userId,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
    displayName: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.userId,
    firstName: m.firstName,
    lastName: m.lastName,
    profileImageUrl: m.profileImageUrl,
  })));
});

// PATCH /leagues/:leagueId/members/:userId
router.patch("/leagues/:leagueId/members/:userId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const raw = Array.isArray(req.params.leagueId) ? req.params.leagueId[0] : req.params.leagueId;
  const leagueId = parseInt(raw, 10);
  const targetUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const requesterId = req.user.id;

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (league.commissionerId !== requesterId) { res.status(403).json({ error: "Commissioner only" }); return; }

  const parsed = UpdateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [member] = await db.select().from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.userId, targetUserId), eq(leagueMembersTable.status, "active")));
  if (!member) { res.status(404).json({ error: "Member not found" }); return; }

  const [updated] = await db.update(leagueMembersTable).set({ role: parsed.data.role }).where(eq(leagueMembersTable.id, member.id)).returning();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));

  res.json({
    id: updated.id,
    leagueId: updated.leagueId,
    userId: updated.userId,
    role: updated.role,
    joinedAt: updated.joinedAt.toISOString(),
    displayName: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || targetUserId,
    firstName: user?.firstName,
    lastName: user?.lastName,
    profileImageUrl: user?.profileImageUrl,
  });
});

// DELETE /leagues/:leagueId/members/:userId
router.delete("/leagues/:leagueId/members/:userId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const raw = Array.isArray(req.params.leagueId) ? req.params.leagueId[0] : req.params.leagueId;
  const leagueId = parseInt(raw, 10);
  const targetUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const requesterId = req.user.id;

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (league.commissionerId !== requesterId) { res.status(403).json({ error: "Commissioner only" }); return; }
  if (targetUserId === requesterId) { res.status(400).json({ error: "Cannot remove yourself" }); return; }

  await db.update(leagueMembersTable).set({ status: "removed" }).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.userId, targetUserId)));
  res.sendStatus(204);
});

export default router;
