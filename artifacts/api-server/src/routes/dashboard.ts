import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, leagueMembersTable, leaguesTable, pickEventsTable, picksTable, submissionsTable, usersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.user.id;

  const memberships = await db.select({
    leagueId: leagueMembersTable.leagueId,
    role: leagueMembersTable.role,
  }).from(leagueMembersTable).where(and(eq(leagueMembersTable.userId, userId), eq(leagueMembersTable.status, "active")));

  if (memberships.length === 0) {
    res.json({ leagues: [] }); return;
  }

  const leagueIds = memberships.map((m) => m.leagueId);

  const leagues = await db.select().from(leaguesTable).where(inArray(leaguesTable.id, leagueIds));

  const dashboardLeagues = await Promise.all(leagues.map(async (league) => {
    const membership = memberships.find((m) => m.leagueId === league.id)!;

    const [{ count: memberCount }] = await db.select({ count: sql<number>`count(*)` }).from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, league.id), eq(leagueMembersTable.status, "active")));

    // Get active event (most recent open/locked/revealed)
    const [activeEvent] = await db.select().from(pickEventsTable).where(and(eq(pickEventsTable.leagueId, league.id), sql`${pickEventsTable.status} IN ('open', 'locked', 'revealed')`)).limit(1);

    let activeEventData = null;
    if (activeEvent) {
      const [sub] = await db.select().from(submissionsTable).where(and(eq(submissionsTable.pickEventId, activeEvent.id), eq(submissionsTable.userId, userId)));
      const [{ submittedCount }] = await db.select({ submittedCount: sql<number>`count(*)` }).from(submissionsTable).where(eq(submissionsTable.pickEventId, activeEvent.id));

      let myCurrentPoints = 0;
      if (sub) {
        const picks = await db.select().from(picksTable).where(eq(picksTable.submissionId, sub.id));
        myCurrentPoints = picks.reduce((sum, p) => sum + (p.pointsAwarded ?? 0), 0);
      }

      activeEventData = {
        event: {
          id: activeEvent.id,
          leagueId: activeEvent.leagueId,
          name: activeEvent.name,
          nflWeek: activeEvent.nflWeek,
          nflSeason: activeEvent.nflSeason,
          status: activeEvent.status,
          submissionDeadline: activeEvent.submissionDeadline.toISOString(),
          revealAt: activeEvent.revealAt.toISOString(),
          tiebreakerQuestion: activeEvent.tiebreakerQuestion ?? null,
          tiebreakerResult: activeEvent.tiebreakerResult ?? null,
          notes: activeEvent.notes ?? null,
          submissionCount: Number(submittedCount),
          totalMembers: Number(memberCount),
          publishedAt: activeEvent.publishedAt?.toISOString() ?? null,
          finalizedAt: activeEvent.finalizedAt?.toISOString() ?? null,
          createdAt: activeEvent.createdAt.toISOString(),
        },
        hasSubmitted: !!sub,
        submittedCount: Number(submittedCount),
        myCurrentPoints,
      };
    }

    return {
      league: {
        id: league.id,
        name: league.name,
        slug: league.slug,
        commissionerId: league.commissionerId,
        memberCount: Number(memberCount),
        userRole: membership.role,
        createdAt: league.createdAt.toISOString(),
      },
      myRank: null,
      totalMembers: Number(memberCount),
      activeEvent: activeEventData,
    };
  }));

  res.json({ leagues: dashboardLeagues });
});

export default router;
