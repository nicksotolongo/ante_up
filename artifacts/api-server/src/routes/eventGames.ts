import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, eventGamesTable, leagueMembersTable, pickEventsTable, picksTable, submissionsTable } from "@workspace/db";
import {
  AddEventGameBody,
  AddEventGameParams,
  ListEventGamesParams,
  RemoveEventGameParams,
  UpdateEventGameBody,
  UpdateEventGameParams,
} from "@workspace/api-zod";
import { getNflGame } from "../lib/espnProvider";
import { calculateAtsResult } from "../lib/mockNflGames";

const router: IRouter = Router();

function formatEventGame(eg: typeof eventGamesTable.$inferSelect) {
  // Derive live game status from DB-stored fields — no external lookup needed for display
  const gameStatus = eg.isFinalized
    ? "final"
    : eg.homeScore != null
    ? "in_progress"
    : ("scheduled" as const);

  return {
    id: eg.id,
    pickEventId: eg.pickEventId,
    nflGameId: eg.nflGameId,
    lockedSpread: eg.lockedSpread ?? null,
    spreadTeam: eg.spreadTeam ?? null,
    lockedAt: eg.lockedAt?.toISOString() ?? null,
    displayOrder: eg.displayOrder,
    result: eg.result ?? null,
    homeScore: eg.homeScore ?? null,
    awayScore: eg.awayScore ?? null,
    isFinalized: eg.isFinalized,
    createdAt: eg.createdAt.toISOString(),
    nflGame: {
      id: eg.nflGameId,
      week: 0,   // not needed for display; available via event
      season: 0,
      homeTeam: eg.homeTeam,
      awayTeam: eg.awayTeam,
      kickoffAt: eg.kickoffAt.toISOString(),
      gameStatus,
      spread: eg.lockedSpread ?? null,
      favoredTeam: eg.spreadTeam ?? null,
      homeScore: eg.homeScore ?? null,
      awayScore: eg.awayScore ?? null,
      updatedAt: eg.createdAt.toISOString(),
    },
  };
}

async function requireCommissioner(leagueId: number, userId: string) {
  const [m] = await db
    .select()
    .from(leagueMembersTable)
    .where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.userId, userId), eq(leagueMembersTable.status, "active")));
  return m && (m.role === "commissioner" || m.role === "deputy") ? m : null;
}

// GET /leagues/:leagueId/events/:eventId/games
router.get("/leagues/:leagueId/events/:eventId/games", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = ListEventGamesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const userId = req.user.id;

  const [member] = await db
    .select()
    .from(leagueMembersTable)
    .where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.userId, userId), eq(leagueMembersTable.status, "active")));
  if (!member) { res.status(403).json({ error: "Not a member" }); return; }

  const games = await db.select().from(eventGamesTable).where(eq(eventGamesTable.pickEventId, eventId));
  res.json(games.map(formatEventGame));
});

// POST /leagues/:leagueId/events/:eventId/games
router.post("/leagues/:leagueId/events/:eventId/games", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = AddEventGameParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const userId = req.user.id;

  const comm = await requireCommissioner(leagueId, userId);
  if (!comm) { res.status(403).json({ error: "Commissioner only" }); return; }

  const [event] = await db
    .select()
    .from(pickEventsTable)
    .where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }
  if (event.status !== "draft") { res.status(400).json({ error: "Cannot add games to a published event" }); return; }

  const parsed = AddEventGameBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Look up game from ESPN (real schedule) by ID + week/season
  const espnGame = await getNflGame(parsed.data.nflGameId, event.nflWeek, event.nflSeason);
  if (!espnGame) { res.status(404).json({ error: "NFL game not found in schedule for this week" }); return; }

  const [eg] = await db
    .insert(eventGamesTable)
    .values({
      pickEventId: eventId,
      nflGameId: espnGame.id,
      homeTeam: espnGame.homeTeam,
      awayTeam: espnGame.awayTeam,
      kickoffAt: espnGame.kickoffAt,
      lockedSpread: parsed.data.lockedSpread ?? espnGame.spread ?? null,
      spreadTeam: parsed.data.spreadTeam ?? espnGame.favoredTeam ?? null,
      displayOrder: parsed.data.displayOrder,
    })
    .returning();

  res.status(201).json(formatEventGame(eg));
});

// PATCH /leagues/:leagueId/events/:eventId/games/:eventGameId
router.patch("/leagues/:leagueId/events/:eventId/games/:eventGameId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = UpdateEventGameParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const eventGameId = Number(params.data.eventGameId);
  const userId = req.user.id;

  const comm = await requireCommissioner(leagueId, userId);
  if (!comm) { res.status(403).json({ error: "Commissioner only" }); return; }

  const parsed = UpdateEventGameBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [eg] = await db
    .select()
    .from(eventGamesTable)
    .where(and(eq(eventGamesTable.id, eventGameId), eq(eventGamesTable.pickEventId, eventId)));
  if (!eg) { res.status(404).json({ error: "Event game not found" }); return; }

  const updates: Partial<typeof eventGamesTable.$inferInsert> = {};
  if ("result" in parsed.data) updates.result = parsed.data.result;
  if ("homeScore" in parsed.data) updates.homeScore = parsed.data.homeScore ?? undefined;
  if ("awayScore" in parsed.data) updates.awayScore = parsed.data.awayScore ?? undefined;
  if ("isFinalized" in parsed.data) updates.isFinalized = parsed.data.isFinalized;

  // Auto-calculate ATS result from scores if not explicitly provided
  if (!updates.result && updates.homeScore != null && updates.awayScore != null && eg.lockedSpread != null && eg.spreadTeam) {
    updates.result = calculateAtsResult(updates.homeScore, updates.awayScore, eg.lockedSpread, eg.spreadTeam as "home" | "away");
  }

  const [updated] = await db
    .update(eventGamesTable)
    .set(updates)
    .where(eq(eventGamesTable.id, eventGameId))
    .returning();

  // Grade picks if the game is finalized and has a result
  if (updated.isFinalized && updated.result) {
    await gradePicks(eventGameId, updated.result as "home" | "away" | "push", eg);
  }

  res.json(formatEventGame(updated));
});

async function gradePicks(
  eventGameId: number,
  result: "home" | "away" | "push",
  eg: typeof eventGamesTable.$inferSelect,
) {
  const subs = await db.select().from(submissionsTable).where(eq(submissionsTable.pickEventId, eg.pickEventId));
  for (const sub of subs) {
    const [pick] = await db
      .select()
      .from(picksTable)
      .where(and(eq(picksTable.submissionId, sub.id), eq(picksTable.eventGameId, eventGameId)));
    if (!pick) continue;
    const isMoneyPick = sub.moneyPickGameId === eventGameId;
    const pickResult: "win" | "loss" | "push" =
      result === "push" ? "push" : pick.selectedTeam === result ? "win" : "loss";
    const pointsAwarded =
      result === "push" ? (isMoneyPick ? 1 : 0.5) :
      pick.selectedTeam === result ? (isMoneyPick ? 2 : 1) : 0;
    await db.update(picksTable).set({ result: pickResult, pointsAwarded }).where(eq(picksTable.id, pick.id));
  }
}

// DELETE /leagues/:leagueId/events/:eventId/games/:eventGameId
router.delete("/leagues/:leagueId/events/:eventId/games/:eventGameId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = RemoveEventGameParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const eventGameId = Number(params.data.eventGameId);
  const userId = req.user.id;

  const comm = await requireCommissioner(leagueId, userId);
  if (!comm) { res.status(403).json({ error: "Commissioner only" }); return; }

  const [event] = await db
    .select()
    .from(pickEventsTable)
    .where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }
  if (event.status !== "draft") { res.status(400).json({ error: "Cannot remove games from a published event" }); return; }

  await db
    .delete(eventGamesTable)
    .where(and(eq(eventGamesTable.id, eventGameId), eq(eventGamesTable.pickEventId, eventId)));
  res.sendStatus(204);
});

export default router;
