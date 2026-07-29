import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, eventGamesTable, leagueMembersTable, pickEventsTable, picksTable, submissionsTable, usersTable } from "@workspace/db";
import { GetLiveBoardParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/leagues/:leagueId/events/:eventId/board", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = GetLiveBoardParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const userId = req.user.id;

  const [member] = await db.select().from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.userId, userId), eq(leagueMembersTable.status, "active")));
  if (!member) { res.status(403).json({ error: "Not a member" }); return; }

  const [event] = await db.select().from(pickEventsTable).where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const eventGames = await db.select().from(eventGamesTable).where(eq(eventGamesTable.pickEventId, eventId));
  const submissions = await db.select().from(submissionsTable).where(eq(submissionsTable.pickEventId, eventId));

  const now = new Date();
  const isRevealed = event.status === "revealed" || event.status === "finalized" || now >= event.revealAt;

  // Fetch all members
  const allMembers = await db.select({
    id: leagueMembersTable.id,
    userId: leagueMembersTable.userId,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    profileImageUrl: usersTable.profileImageUrl,
  }).from(leagueMembersTable).innerJoin(usersTable, eq(usersTable.id, leagueMembersTable.userId)).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active")));

  const rows = await Promise.all(allMembers.map(async (m) => {
    const sub = submissions.find((s) => s.userId === m.userId);
    const displayName = [m.firstName, m.lastName].filter(Boolean).join(" ") || m.userId;

    if (!sub || !isRevealed) {
      // No submission or not yet revealed — blank row
      const cells = eventGames.map((eg) => ({
        eventGameId: eg.id,
        selectedTeam: null as string | null,
        isMoneyPick: false,
        result: null as string | null,
        pointsAwarded: null as number | null,
      }));
      return {
        userId: m.userId,
        displayName,
        profileImageUrl: m.profileImageUrl ?? null,
        hasSubmitted: !!sub,
        cells,
        currentPoints: 0,
        maxPossiblePoints: isRevealed ? 0 : eventGames.length + 1,
        rank: 0,
        isEliminated: false,
        tiebreakerAnswer: null as number | null,
        moneyPickGameId: null as number | null,
      };
    }

    const picks = await db.select().from(picksTable).where(eq(picksTable.submissionId, sub.id));

    const cells = eventGames.map((eg) => {
      const pick = picks.find((p) => p.eventGameId === eg.id);
      const isMoneyPick = sub.moneyPickGameId === eg.id;
      return {
        eventGameId: eg.id,
        selectedTeam: pick?.selectedTeam ?? null,
        isMoneyPick,
        result: pick?.result ?? null,
        pointsAwarded: pick?.pointsAwarded ?? null,
      };
    });

    const currentPoints = picks.reduce((sum, p) => sum + (p.pointsAwarded ?? 0), 0);
    const pendingGames = eventGames.filter((eg) => !eg.isFinalized);
    const maxFromPending = pendingGames.reduce((sum, eg) => {
      const pick = picks.find((p) => p.eventGameId === eg.id);
      const isMoneyPick = sub.moneyPickGameId === eg.id;
      return sum + (isMoneyPick ? 2 : 1);
    }, 0);
    const maxPossiblePoints = currentPoints + maxFromPending;

    return {
      userId: m.userId,
      displayName,
      profileImageUrl: m.profileImageUrl ?? null,
      hasSubmitted: true,
      cells,
      currentPoints,
      maxPossiblePoints,
      rank: 0,
      isEliminated: false,
      tiebreakerAnswer: sub.tiebreakerAnswer ?? null,
      moneyPickGameId: sub.moneyPickGameId ?? null,
    };
  }));

  // Sort by current points desc, assign ranks
  rows.sort((a, b) => b.currentPoints - a.currentPoints);
  const maxPointsInEvent = Math.max(...rows.map((r) => r.maxPossiblePoints));
  rows.forEach((row, i) => {
    row.rank = i + 1;
    // Eliminated if they cannot reach 1st place even if they win everything
    const leader = rows[0];
    row.isEliminated = event.status === "finalized" ? false : (leader.currentPoints > row.maxPossiblePoints && i > 0);
  });

  res.json({
    event: {
      id: event.id,
      leagueId: event.leagueId,
      name: event.name,
      nflWeek: event.nflWeek,
      nflSeason: event.nflSeason,
      status: event.status,
      submissionDeadline: event.submissionDeadline.toISOString(),
      revealAt: event.revealAt.toISOString(),
      tiebreakerQuestion: event.tiebreakerQuestion ?? null,
      tiebreakerResult: event.tiebreakerResult ?? null,
    },
    games: eventGames.map((eg) => ({
      id: eg.id,
      nflGameId: eg.nflGameId,
      homeTeam: eg.homeTeam,
      awayTeam: eg.awayTeam,
      kickoffAt: eg.kickoffAt.toISOString(),
      lockedSpread: eg.lockedSpread ?? null,
      spreadTeam: eg.spreadTeam ?? null,
      result: eg.result ?? null,
      homeScore: eg.homeScore ?? null,
      awayScore: eg.awayScore ?? null,
      isFinalized: eg.isFinalized,
      displayOrder: eg.displayOrder,
    })),
    rows,
    isRevealed,
  });
});

export default router;
