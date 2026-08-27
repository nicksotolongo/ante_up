import { Router, type IRouter } from "express";
import { makeDisplayName } from "../lib/displayName";
import { and, eq, or, sql } from "drizzle-orm";
import { db, leagueMembersTable, pickEventsTable, picksTable, submissionsTable, usersTable } from "@workspace/db";
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

  const [allMembers, finalizedEvents] = await Promise.all([
    db.select({
      userId: leagueMembersTable.userId,
      displayName: usersTable.displayName,
      firstName: usersTable.firstName,
      email: usersTable.email,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
    }).from(leagueMembersTable).innerJoin(usersTable, eq(usersTable.id, leagueMembersTable.userId)).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active"))),
    db.select().from(pickEventsTable).where(and(eq(pickEventsTable.leagueId, leagueId), sql`${pickEventsTable.status} IN ('revealed', 'finalized')`)),
  ]);

  const eventIds = finalizedEvents.map((e) => e.id);

  // Short-circuit: no finalized events yet
  if (eventIds.length === 0) {
    const standings = allMembers.map((m, i) => ({
      userId: m.userId,
      displayName: makeDisplayName(m),
      profileImageUrl: m.profileImageUrl ?? null,
      totalPoints: 0, eventsEntered: 0, weeklyWins: 0,
      normalCorrect: 0, normalTotal: 0, moneyCorrect: 0, moneyTotal: 0, rank: i + 1,
    }));
    res.json(standings);
    return;
  }

  // Bulk-fetch all submissions + picks for all finalized events in two queries
  // Use or(...eq()) to avoid ANY() serialization issues
  const allSubs = await db.select().from(submissionsTable)
    .where(or(...eventIds.map(id => eq(submissionsTable.pickEventId, id)))!);

  const subIds = allSubs.map(s => s.id);
  const allPicks = subIds.length > 0
    ? await db.select().from(picksTable)
        .where(or(...subIds.map(id => eq(picksTable.submissionId, id)))!)
    : [];

  // Pre-compute event winner (highest points) per event
  const eventTopScore = new Map<number, number>();
  for (const eid of eventIds) {
    const eventSubs = allSubs.filter(s => s.pickEventId === eid);
    const scores = eventSubs.map(s => allPicks.filter(p => p.submissionId === s.id).reduce((sum, p) => sum + (p.pointsAwarded ?? 0), 0));
    eventTopScore.set(eid, scores.length > 0 ? Math.max(...scores) : 0);
  }

  const standings = allMembers.map((m) => {
    const mySubs = allSubs.filter(s => s.userId === m.userId);
    let totalPoints = 0, normalCorrect = 0, normalTotal = 0, moneyCorrect = 0, moneyTotal = 0, weeklyWins = 0;

    for (const sub of mySubs) {
      const picks = allPicks.filter(p => p.submissionId === sub.id);
      const eventPoints = picks.reduce((sum, p) => sum + (p.pointsAwarded ?? 0), 0);
      totalPoints += eventPoints;

      for (const pick of picks) {
        if (sub.moneyPickGameId === pick.eventGameId) {
          moneyTotal++;
          if (pick.result === "win") moneyCorrect++;
        } else {
          normalTotal++;
          if (pick.result === "win") normalCorrect++;
        }
      }

      const top = eventTopScore.get(sub.pickEventId) ?? 0;
      if (eventPoints > 0 && eventPoints === top) weeklyWins++;
    }

    return {
      userId: m.userId,
      displayName: makeDisplayName(m),
      profileImageUrl: m.profileImageUrl ?? null,
      totalPoints, eventsEntered: mySubs.length, weeklyWins,
      normalCorrect, normalTotal, moneyCorrect, moneyTotal, rank: 0,
    };
  });

  standings.sort((a, b) => b.totalPoints - a.totalPoints);
  standings.forEach((s, i) => {
    s.rank = i > 0 && s.totalPoints === standings[i - 1].totalPoints ? standings[i - 1].rank : i + 1;
  });
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

  const [allMembers, allSubs] = await Promise.all([
    db.select({
      userId: leagueMembersTable.userId,
      displayName: usersTable.displayName,
      firstName: usersTable.firstName,
      email: usersTable.email,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
    }).from(leagueMembersTable).innerJoin(usersTable, eq(usersTable.id, leagueMembersTable.userId)).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active"))),
    db.select().from(submissionsTable).where(eq(submissionsTable.pickEventId, eventId)),
  ]);

  const subIds = allSubs.map(s => s.id);
  const allPicks = subIds.length > 0
    ? await db.select().from(picksTable).where(or(...subIds.map(id => eq(picksTable.submissionId, id)))!)
    : [];

  const standings = allMembers.map((m) => {
    const sub = allSubs.find(s => s.userId === m.userId);
    const displayName = makeDisplayName(m);
    const base = { userId: m.userId, displayName, profileImageUrl: m.profileImageUrl ?? null };

    if (!sub) {
      return { ...base, submitted: false, points: 0, maxPossible: 0, normalCorrect: 0, normalTotal: 0, moneyCorrect: 0, moneyTotal: 0, tiebreakerAnswer: null, isEliminated: false, rank: 0 };
    }

    const picks = allPicks.filter(p => p.submissionId === sub.id);
    const points = picks.reduce((sum, p) => sum + (p.pointsAwarded ?? 0), 0);

    // maxPossible: current points + potential from ungraded picks
    const maxPossible = picks.reduce((sum, p) => {
      if (p.result === "loss") return sum; // already lost
      const potential = sub.moneyPickGameId === p.eventGameId ? 2 : 1;
      return sum + (p.result === "win" ? (p.pointsAwarded ?? potential) : potential);
    }, 0);

    const normalPicks = picks.filter(p => sub.moneyPickGameId !== p.eventGameId);
    const moneyPick = picks.find(p => sub.moneyPickGameId === p.eventGameId);

    return {
      ...base,
      submitted: true,
      points,
      maxPossible,
      normalCorrect: normalPicks.filter(p => p.result === "win").length,
      normalTotal: normalPicks.filter(p => p.result != null).length,
      moneyCorrect: moneyPick?.result === "win" ? 1 : 0,
      moneyTotal: moneyPick != null ? 1 : 0,
      tiebreakerAnswer: sub.tiebreakerAnswer ?? null,
      isEliminated: false, // set after sorting
      rank: 0,
    };
  });

  // Submitted players first (by points desc), then DNS players after
  standings.sort((a, b) => {
    if (a.submitted !== b.submitted) return a.submitted ? -1 : 1;
    return b.points - a.points;
  });

  // Mark eliminated: maxPossible < leader's current points (only for submitted players)
  const leaderPoints = standings[0]?.points ?? 0;
  standings.forEach((s, i) => {
    s.rank = i > 0 && s.submitted && s.points === standings[i - 1].points ? standings[i - 1].rank : i + 1;
    s.isEliminated = s.submitted && s.maxPossible < leaderPoints;
  });

  res.json(standings);
});

export default router;
