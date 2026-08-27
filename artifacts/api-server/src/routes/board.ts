import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, eventGamesTable, leagueMembersTable, pickEventsTable, picksTable, submissionsTable, usersTable } from "@workspace/db";
import { GetLiveBoardParams } from "@workspace/api-zod";
import { makeDisplayName } from "../lib/displayName";
import { getLiveScoreById, getNflGames, type NflGame, type NflSeasonType } from "../lib/espnProvider";
import { maybeAutoFinalizeGame } from "../lib/gradeGame";

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

  let eventGames = await db.select().from(eventGamesTable).where(eq(eventGamesTable.pickEventId, eventId));

  const now = new Date();

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

  // Fallback: direct score lookup by ESPN game ID for games the weekly scoreboard
  // didn't include (e.g. the stored week doesn't match ESPN's week numbering)
  const liveScoreById = new Map<number, Awaited<ReturnType<typeof getLiveScoreById>>>();
  await Promise.all(eventGames.map(async (eg) => {
    if (eg.isFinalized || findEspn(eg) || now < eg.kickoffAt) return;
    liveScoreById.set(eg.id, await getLiveScoreById(eg.nflGameId));
  }));

  // Auto-grade: the instant the provider reports a game final, finalize it and
  // grade every pick — this is what makes the board flip a game to win/loss on
  // its own, without waiting for the commissioner's event-level Finalize.
  eventGames = await Promise.all(eventGames.map(async (eg) => {
    if (eg.isFinalized) return eg;
    const espn = findEspn(eg);
    const live = espn ?? liveScoreById.get(eg.id);
    if (!live) return eg;
    const graded = await maybeAutoFinalizeGame(eg, live);
    return graded ?? eg;
  }));

  const submissions = await db.select().from(submissionsTable).where(eq(submissionsTable.pickEventId, eventId));
  // Per-game reveal: each game's picks become visible once that game kicks off.
  // The board itself is always viewable once the event is published.
  const isRevealed = event.status !== "draft";
  const isGameRevealed = (eg: typeof eventGamesTable.$inferSelect) =>
    now >= eg.kickoffAt; // kickoff-only: even a finalized event never reveals a pick before its game starts

  // Fetch all members
  const allMembers = await db.select({
    id: leagueMembersTable.id,
    userId: leagueMembersTable.userId,
    displayName: usersTable.displayName,
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
      // Hide picks for games that haven't kicked off — players can still change them
      if (!isGameRevealed(eg)) {
        const pick = picks.find((p) => p.eventGameId === eg.id);
        return {
          eventGameId: eg.id,
          selectedTeam: null as string | null,
          isMoneyPick: false,
          result: null as string | null,
          pointsAwarded: null as number | null,
          hasPick: !!pick,
        };
      }
      const pick = picks.find((p) => p.eventGameId === eg.id);
      const isMoneyPick = sub.moneyPickGameId === eg.id;
      return {
        eventGameId: eg.id,
        selectedTeam: pick?.selectedTeam ?? null,
        isMoneyPick,
        result: pick?.result ?? null,
        pointsAwarded: pick?.pointsAwarded ?? null,
        hasPick: !!pick,
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
      // Tiebreaker stays hidden until every game has kicked off (it's still editable before then)
      tiebreakerAnswer: eventGames.every(isGameRevealed) ? (sub.tiebreakerAnswer ?? null) : null,
      // Money pick stays hidden until its game kicks off
      moneyPickGameId: (() => {
        const moneyGame = eventGames.find((eg) => eg.id === sub.moneyPickGameId);
        return moneyGame && isGameRevealed(moneyGame) ? sub.moneyPickGameId : null;
      })(),
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
