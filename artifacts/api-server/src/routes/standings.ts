import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, eventGamesTable, leagueMembersTable, pickEventsTable, picksTable, submissionsTable, usersTable } from "@workspace/db";
import { GetSeasonStandingsParams, GetEventStandingsParams } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /leagues/:leagueId/standings
router.get("/leagues/:leagueId/standings", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = GetSeasonStandingsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const userId = req.user.id;

  const [member] = await db.select().from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.userId, userId), eq(leagueMembersTable.status, "active")));
  if (!member) { res.status(403).json({ error: "Not a member" }); return; }

  const allMembers = await db.select({
    userId: leagueMembersTable.userId,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    profileImageUrl: usersTable.profileImageUrl,
  }).from(leagueMembersTable).innerJoin(usersTable, eq(usersTable.id, leagueMembersTable.userId)).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active")));

  // Get all finalized events for this league
  const finalizedEvents = await db.select().from(pickEventsTable).where(and(eq(pickEventsTable.leagueId, leagueId), sql`${pickEventsTable.status} IN ('revealed', 'finalized')`));
  const eventIds = finalizedEvents.map((e) => e.id);

  const standings = await Promise.all(allMembers.map(async (m) => {
    if (eventIds.length === 0) {
      return {
        userId: m.userId,
        displayName: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.userId,
        profileImageUrl: m.profileImageUrl ?? null,
        totalPoints: 0,
        eventsEntered: 0,
        weeklyWins: 0,
        normalCorrect: 0,
        normalTotal: 0,
        moneyCorrect: 0,
        moneyTotal: 0,
        rank: 0,
      };
    }

    const subs = await db.select().from(submissionsTable).where(and(inArray(submissionsTable.pickEventId, eventIds), eq(submissionsTable.userId, m.userId)));
    const eventsEntered = subs.length;

    let totalPoints = 0;
    let normalCorrect = 0;
    let normalTotal = 0;
    let moneyCorrect = 0;
    let moneyTotal = 0;
    let weeklyWins = 0;

    for (const sub of subs) {
      const picks = await db.select().from(picksTable).where(eq(picksTable.submissionId, sub.id));
      const eventPoints = picks.reduce((sum, p) => sum + (p.pointsAwarded ?? 0), 0);
      totalPoints += eventPoints;

      for (const pick of picks) {
        const isMoneyPick = sub.moneyPickGameId === pick.eventGameId;
        if (isMoneyPick) {
          moneyTotal++;
          if (pick.result === "win") moneyCorrect++;
        } else {
          normalTotal++;
          if (pick.result === "win") normalCorrect++;
        }
      }

      // Check if this sub won the event
      const allSubs = await db.select().from(submissionsTable).where(eq(submissionsTable.pickEventId, sub.pickEventId));
      const eventScores = await Promise.all(allSubs.map(async (s) => {
        const spicks = await db.select().from(picksTable).where(eq(picksTable.submissionId, s.id));
        return spicks.reduce((sum, p) => sum + (p.pointsAwarded ?? 0), 0);
      }));
      const myScore = eventPoints;
      const maxScore = Math.max(...eventScores);
      if (myScore === maxScore && myScore > 0) weeklyWins++;
    }

    return {
      userId: m.userId,
      displayName: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.userId,
      profileImageUrl: m.profileImageUrl ?? null,
      totalPoints,
      eventsEntered,
      weeklyWins,
      normalCorrect,
      normalTotal,
      moneyCorrect,
      moneyTotal,
      rank: 0,
    };
  }));

  standings.sort((a, b) => b.totalPoints - a.totalPoints);
  standings.forEach((s, i) => { s.rank = i + 1; });
  res.json(standings);
});

// GET /leagues/:leagueId/events/:eventId/standings
router.get("/leagues/:leagueId/events/:eventId/standings", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = GetEventStandingsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const userId = req.user.id;

  const [member] = await db.select().from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.userId, userId), eq(leagueMembersTable.status, "active")));
  if (!member) { res.status(403).json({ error: "Not a member" }); return; }

  const [event] = await db.select().from(pickEventsTable).where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const allMembers = await db.select({
    userId: leagueMembersTable.userId,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    profileImageUrl: usersTable.profileImageUrl,
  }).from(leagueMembersTable).innerJoin(usersTable, eq(usersTable.id, leagueMembersTable.userId)).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active")));

  const eventGames = await db.select().from(eventGamesTable).where(eq(eventGamesTable.pickEventId, eventId));

  const standings = await Promise.all(allMembers.map(async (m) => {
    const [sub] = await db.select().from(submissionsTable).where(and(eq(submissionsTable.pickEventId, eventId), eq(submissionsTable.userId, m.userId)));
    if (!sub) {
      return {
        userId: m.userId,
        displayName: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.userId,
        profileImageUrl: m.profileImageUrl ?? null,
        totalPoints: 0,
        eventsEntered: 0,
        weeklyWins: 0,
        normalCorrect: 0,
        normalTotal: 0,
        moneyCorrect: 0,
        moneyTotal: 0,
        rank: 0,
      };
    }

    const picks = await db.select().from(picksTable).where(eq(picksTable.submissionId, sub.id));
    const totalPoints = picks.reduce((sum, p) => sum + (p.pointsAwarded ?? 0), 0);
    const normalPicks = picks.filter((p) => sub.moneyPickGameId !== p.eventGameId);
    const moneyPick = picks.find((p) => sub.moneyPickGameId === p.eventGameId);

    return {
      userId: m.userId,
      displayName: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.userId,
      profileImageUrl: m.profileImageUrl ?? null,
      totalPoints,
      eventsEntered: 1,
      weeklyWins: 0,
      normalCorrect: normalPicks.filter((p) => p.result === "win").length,
      normalTotal: normalPicks.filter((p) => p.result != null).length,
      moneyCorrect: moneyPick?.result === "win" ? 1 : 0,
      moneyTotal: moneyPick != null ? 1 : 0,
      rank: 0,
    };
  }));

  standings.sort((a, b) => b.totalPoints - a.totalPoints);
  standings.forEach((s, i) => { s.rank = i + 1; });
  res.json(standings);
});

export default router;
