import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, eventGamesTable, leagueMembersTable, pickEventsTable, picksTable, submissionsTable, usersTable } from "@workspace/db";
import { GetLiveBoardParams } from "@workspace/api-zod";
import { makeDisplayName } from "../lib/displayName";
import { getNflGames, type NflGame, type NflSeasonType } from "../lib/espnProvider";

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

  // Live scores from ESPN (cached ~5 min) — used for games not yet finalized
  let espnGames: NflGame[] = [];
  try {
    espnGames = await getNflGames(event.nflWeek, event.nflSeason, (event.nflSeasonType ?? "regular") as NflSeasonType);
  } catch {
    // Board still works without live scores
  }
  const findEspn = (eg: typeof eventGamesTable.$inferSelect) =>
    espnGames.find(g => g.id === eg.nflGameId) ??
    espnGames.find(g => g.homeTeam === eg.homeTeam && g.awayTeam === eg.awayTeam);
  const submissions = await db.select().from(submissionsTable).where(eq(submissionsTable.pickEventId, eventId));

  const now = new Date();
  // Picks are revealed once the event is locked — at the submission deadline or revealAt, whichever comes first
  const isRevealed = event.status === "revealed" || event.status === "finalized" || now >= event.submissionDeadline;

  // Fetch all members
  const allMembers = await db.select({
    id: leagueMembersTable.id,
    userId: leagueMembersTable.userId,
    firstName: usersTable.firstName,
      email: usersTable.email,
    lastName: usersTable.lastName,
    profileImageUrl: usersTable.profileImageUrl,
  }).from(leagueMembersTable).innerJoin(usersTable, eq(usersTable.id, leagueMembersTable.userId)).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active")));

  const rows = await Promise.all(allMembers.map(async (m) => {
    const sub = submissions.find((s) => s.userId === m.userId);
    const displayName = makeDisplayName(m);

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
      if (!pick) return sum; // no pick on this game (e.g. added after they submitted) — can't earn points from it
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
      nflSeasonType: event.nflSeasonType ?? "regular",
      submissionDeadline: event.submissionDeadline.toISOString(),
      revealAt: event.revealAt.toISOString(),
      createdAt: event.createdAt.toISOString(),
      tiebreakerQuestion: event.tiebreakerQuestion ?? null,
      tiebreakerResult: event.tiebreakerResult ?? null,
    },
    games: eventGames.map((eg) => {
      const espn = eg.isFinalized ? undefined : findEspn(eg);
      // Prefer finalized DB scores; otherwise show live ESPN scores
      const homeScore = eg.isFinalized ? (eg.homeScore ?? null) : (espn?.homeScore ?? eg.homeScore ?? null);
      const awayScore = eg.isFinalized ? (eg.awayScore ?? null) : (espn?.awayScore ?? eg.awayScore ?? null);
      const gameStatus = eg.isFinalized ? "final" : (espn?.gameStatus ?? (homeScore != null ? "in_progress" : "scheduled"));
      return {
        id: eg.id,
        pickEventId: eg.pickEventId,
        nflGameId: eg.nflGameId,
        lockedSpread: eg.lockedSpread ?? null,
        spreadTeam: eg.spreadTeam ?? null,
        lockedAt: eg.lockedAt?.toISOString() ?? null,
        displayOrder: eg.displayOrder,
        result: eg.result ?? null,
        homeScore,
        awayScore,
        isFinalized: eg.isFinalized,
        createdAt: eg.createdAt.toISOString(),
        nflGame: {
          id: eg.nflGameId,
          week: event.nflWeek,
          season: event.nflSeason,
          seasonType: event.nflSeasonType ?? "regular",
          homeTeam: eg.homeTeam,
          awayTeam: eg.awayTeam,
          kickoffAt: eg.kickoffAt.toISOString(),
          gameStatus,
          spread: eg.lockedSpread ?? null,
          favoredTeam: eg.spreadTeam ?? null,
          homeScore,
          awayScore,
          updatedAt: (espn?.updatedAt ?? eg.createdAt).toISOString(),
        },
      };
    }),
    rows,
    revealed: isRevealed,
  });
});

export default router;
