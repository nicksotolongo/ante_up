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
import { getNflGame, getUpcomingWeeks, type NflSeasonType } from "../lib/espnProvider";
import { calculateAtsResult } from "../lib/mockNflGames";
import { gradePicksForGame } from "../lib/gradeGame";

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
  if (event.status !== "draft" && event.status !== "open") { res.status(400).json({ error: "Games can only be added while the event is in draft or open" }); return; }

  const parsed = AddEventGameBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Look up game from ESPN (real schedule) by ID — try the event's stored week first,
  // then fall back to upcoming weeks (stored week may not match ESPN's numbering)
  const seasonType = (event.nflSeasonType ?? "regular") as NflSeasonType;
  let espnGame = await getNflGame(parsed.data.nflGameId, event.nflWeek, event.nflSeason, seasonType);
  if (!espnGame) {
    for (const w of getUpcomingWeeks()) {
      espnGame = await getNflGame(parsed.data.nflGameId, w.week, w.season, w.seasonType as NflSeasonType);
      if (espnGame) break;
    }
  }
  if (!espnGame) { res.status(404).json({ error: "NFL game not found in the current schedule" }); return; }

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

  const [event] = await db
    .select()
    .from(pickEventsTable)
    .where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const [eg] = await db
    .select()
    .from(eventGamesTable)
    .where(and(eq(eventGamesTable.id, eventGameId), eq(eventGamesTable.pickEventId, eventId)));
  if (!eg) { res.status(404).json({ error: "Event game not found" }); return; }

  // Spread corrections are only allowed while the event is still in draft
  if (
    ("lockedSpread" in parsed.data && parsed.data.lockedSpread !== undefined) ||
    ("spreadTeam" in parsed.data && parsed.data.spreadTeam !== undefined)
  ) {
    if (event.status !== "draft") {
      res.status(400).json({ error: "Spread can only be corrected while the event is in draft" });
      return;
    }
  }

  const updates: Partial<typeof eventGamesTable.$inferInsert> = {};
  if ("result" in parsed.data) updates.result = parsed.data.result;
  if ("homeScore" in parsed.data) updates.homeScore = parsed.data.homeScore ?? undefined;
  if ("awayScore" in parsed.data) updates.awayScore = parsed.data.awayScore ?? undefined;
  if ("isFinalized" in parsed.data) updates.isFinalized = parsed.data.isFinalized;
  if ("lockedSpread" in parsed.data) updates.lockedSpread = parsed.data.lockedSpread ?? undefined;
  if ("spreadTeam" in parsed.data) updates.spreadTeam = parsed.data.spreadTeam ?? undefined;

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
    await gradePicksForGame(eg.pickEventId, eventGameId, updated.result as "home" | "away" | "push");
  }

  res.json(formatEventGame(updated));
});

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

  // Verify the event game actually belongs to this event before touching any picks
  const [eg] = await db
    .select()
    .from(eventGamesTable)
    .where(and(eq(eventGamesTable.id, eventGameId), eq(eventGamesTable.pickEventId, eventId)));
  if (!eg) { res.status(404).json({ error: "Event game not found" }); return; }

  // Count picks first so we can return the number deleted to the caller
  const existingPicks = await db
    .select({ id: picksTable.id })
    .from(picksTable)
    .where(eq(picksTable.eventGameId, eventGameId));
  const deletedPicksCount = existingPicks.length;

  // Cascade-delete picks then the game atomically so a partial failure leaves no orphans
  await db.transaction(async (tx) => {
    await tx.delete(picksTable).where(eq(picksTable.eventGameId, eventGameId));
    await tx.delete(eventGamesTable).where(eq(eventGamesTable.id, eventGameId));
  });

  res.json({ deletedPicksCount });
});

export default router;
