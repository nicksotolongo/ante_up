import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  eventGamesTable,
  leagueMembersTable,
  picksTable,
  pickEventsTable,
  submissionsTable,
  usersTable,
} from "@workspace/db";
import {
  GetMySubmissionParams,
  ListSubmissionsParams,
  SubmitPicksBody,
  SubmitPicksParams,
  UpdateSubmissionBody,
  UpdateSubmissionParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function requireMember(leagueId: number, userId: string) {
  const [m] = await db.select().from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.userId, userId), eq(leagueMembersTable.status, "active")));
  return m ?? null;
}

/**
 * Validates a pick set against the event game list with per-game kickoff locking.
 * Each game locks at its own kickoff — picks on kicked-off games can't be added or changed.
 * Returns an error string or null on success.
 */
function validatePicksAgainstGames(
  picks: { eventGameId: number; selectedTeam: string }[],
  moneyPickGameId: number,
  tiebreakerAnswer: number | null | undefined,
  eventGames: typeof eventGamesTable.$inferSelect[],
  tiebreakerQuestion: string | null | undefined,
  existing: { picks: typeof picksTable.$inferSelect[]; moneyPickGameId: number | null } | null,
  now: Date,
): string | null {
  // No duplicate game IDs
  const pickedIds = picks.map(p => p.eventGameId);
  if (new Set(pickedIds).size !== pickedIds.length) return "Duplicate game IDs in picks";

  const gameMap = new Map(eventGames.map(g => [g.id, g]));
  const hasKicked = (g: typeof eventGamesTable.$inferSelect) => now >= g.kickoffAt;
  const existingByGame = new Map((existing?.picks ?? []).map(p => [p.eventGameId, p]));

  for (const pick of picks) {
    const game = gameMap.get(pick.eventGameId);
    if (!game) return `Pick references unknown game ${pick.eventGameId}`;
    if (pick.selectedTeam !== "home" && pick.selectedTeam !== "away")
      return `Invalid team "${pick.selectedTeam}" for game ${pick.eventGameId} (${game.awayTeam} @ ${game.homeTeam})`;
    if (hasKicked(game)) {
      const prior = existingByGame.get(game.id);
      // A pick on a started game is only OK if it's the unchanged existing pick
      if (!prior) return `${game.awayTeam} @ ${game.homeTeam} has already kicked off — too late to pick it`;
      if (prior.selectedTeam !== pick.selectedTeam)
        return `${game.awayTeam} @ ${game.homeTeam} has already kicked off — that pick is locked`;
    }
  }

  // Every game that hasn't kicked off yet must be picked
  for (const game of eventGames) {
    if (!hasKicked(game) && !pickedIds.includes(game.id))
      return `Missing pick for ${game.awayTeam} @ ${game.homeTeam}`;
  }

  // Existing picks on kicked-off games must be preserved — omitting one would silently delete it
  for (const prior of existing?.picks ?? []) {
    const game = gameMap.get(prior.eventGameId);
    if (game && hasKicked(game) && !pickedIds.includes(prior.eventGameId))
      return `Your pick for ${game.awayTeam} @ ${game.homeTeam} is locked and can't be removed`;
  }

  // Money pick must be one of the submitted games
  if (!new Set(pickedIds).has(moneyPickGameId)) return "Money pick must be one of your selected games";

  // Money pick can't move once its game (old or new) has kicked off
  if (existing && existing.moneyPickGameId != null && moneyPickGameId !== existing.moneyPickGameId) {
    const oldGame = gameMap.get(existing.moneyPickGameId);
    const newGame = gameMap.get(moneyPickGameId);
    if (oldGame && hasKicked(oldGame)) return "Your money pick's game already kicked off — the money pick is locked";
    if (newGame && hasKicked(newGame)) return "Can't move your money pick onto a game that already kicked off";
  }
  if (!existing) {
    const moneyGame = gameMap.get(moneyPickGameId);
    if (moneyGame && hasKicked(moneyGame)) return "Can't put your money pick on a game that already kicked off";
  }

  // Tiebreaker required if question is set
  if (tiebreakerQuestion && tiebreakerAnswer == null) return "Tiebreaker answer required";

  return null;
}

function formatPick(pick: typeof picksTable.$inferSelect) {
  return {
    id: pick.id,
    submissionId: pick.submissionId,
    eventGameId: pick.eventGameId,
    selectedTeam: pick.selectedTeam,
    result: pick.result ?? null,
    pointsAwarded: pick.pointsAwarded ?? null,
  };
}

function formatSubmission(sub: typeof submissionsTable.$inferSelect, picks: typeof picksTable.$inferSelect[]) {
  return {
    id: sub.id,
    pickEventId: sub.pickEventId,
    userId: sub.userId,
    moneyPickGameId: sub.moneyPickGameId ?? null,
    tiebreakerAnswer: sub.tiebreakerAnswer ?? null,
    submittedAt: sub.submittedAt.toISOString(),
    lockedAt: sub.lockedAt?.toISOString() ?? null,
    picks: picks.map(formatPick),
  };
}

// GET /leagues/:leagueId/events/:eventId/my-submission
router.get("/leagues/:leagueId/events/:eventId/my-submission", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = GetMySubmissionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const userId = req.user.id;

  const member = await requireMember(leagueId, userId);
  if (!member) { res.status(403).json({ error: "Not a member" }); return; }

  const [sub] = await db.select().from(submissionsTable).where(and(eq(submissionsTable.pickEventId, eventId), eq(submissionsTable.userId, userId)));
  if (!sub) { res.json({ submission: null }); return; }

  const picks = await db.select().from(picksTable).where(eq(picksTable.submissionId, sub.id));
  res.json({ submission: formatSubmission(sub, picks) });
});

// GET /leagues/:leagueId/events/:eventId/submissions
router.get("/leagues/:leagueId/events/:eventId/submissions", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = ListSubmissionsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const userId = req.user.id;

  const member = await requireMember(leagueId, userId);
  if (!member) { res.status(403).json({ error: "Not a member" }); return; }

  const [event] = await db.select().from(pickEventsTable).where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const allMembers = await db.select().from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active")));
  const subs = await db.select().from(submissionsTable).where(eq(submissionsTable.pickEventId, eventId));

  const now = new Date();
  const eventGames = await db.select().from(eventGamesTable).where(eq(eventGamesTable.pickEventId, eventId));
  const isGameRevealed = (eg: typeof eventGamesTable.$inferSelect) =>
    now >= eg.kickoffAt; // kickoff-only reveal
  const anyRevealed = eventGames.some(isGameRevealed);
  const allRevealed = eventGames.length > 0 && eventGames.every(isGameRevealed);

  if (!anyRevealed) {
    // Nothing kicked off yet: only count, no picks
    res.json({
      revealed: false,
      submittedCount: subs.length,
      totalMembers: allMembers.length,
    });
    return;
  }

  // Per-game reveal: only include picks for games that have kicked off
  const revealedGameIds = new Set(eventGames.filter(isGameRevealed).map(g => g.id));
  const subsWithPicks = await Promise.all(subs.map(async (sub) => {
    const allPicksForSub = await db.select().from(picksTable).where(eq(picksTable.submissionId, sub.id));
    const picks = allPicksForSub.filter(p => revealedGameIds.has(p.eventGameId));
    const user = await db.select().from(usersTable).where(eq(usersTable.id, sub.userId)).then(rows => rows[0]);
    return {
      id: sub.id,
      pickEventId: sub.pickEventId,
      userId: sub.userId,
      displayName: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || sub.userId,
      profileImageUrl: user?.profileImageUrl ?? null,
      moneyPickGameId: sub.moneyPickGameId != null && revealedGameIds.has(sub.moneyPickGameId) ? sub.moneyPickGameId : null,
      tiebreakerAnswer: allRevealed ? (sub.tiebreakerAnswer ?? null) : null,
      submittedAt: sub.submittedAt.toISOString(),
      lockedAt: sub.lockedAt?.toISOString() ?? null,
      picks: picks.map(formatPick),
    };
  }));

  res.json({
    revealed: true,
    submittedCount: subs.length,
    totalMembers: allMembers.length,
    submissions: subsWithPicks,
  });
});

// POST /leagues/:leagueId/events/:eventId/submissions
router.post("/leagues/:leagueId/events/:eventId/submissions", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = SubmitPicksParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const userId = req.user.id;

  const member = await requireMember(leagueId, userId);
  if (!member) { res.status(403).json({ error: "Not a member" }); return; }

  const [event] = await db.select().from(pickEventsTable).where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }
  if (event.status !== "open") { res.status(400).json({ error: "Event is not open for submissions" }); return; }

  const now = new Date();

  // Check if already submitted
  const [existing] = await db.select().from(submissionsTable).where(and(eq(submissionsTable.pickEventId, eventId), eq(submissionsTable.userId, userId)));
  if (existing) { res.status(400).json({ error: "Already submitted. Use PATCH to update." }); return; }

  const parsed = SubmitPicksBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { picks, moneyPickGameId, tiebreakerAnswer } = parsed.data;

  const eventGames = await db.select().from(eventGamesTable).where(eq(eventGamesTable.pickEventId, eventId));
  const validationError = validatePicksAgainstGames(picks, moneyPickGameId, tiebreakerAnswer, eventGames, event.tiebreakerQuestion, null, now);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  const [sub] = await db.insert(submissionsTable).values({
    pickEventId: eventId,
    userId,
    moneyPickGameId,
    tiebreakerAnswer,
  }).returning();

  await db.insert(picksTable).values(picks.map((p) => ({
    submissionId: sub.id,
    eventGameId: p.eventGameId,
    selectedTeam: p.selectedTeam,
  })));

  const insertedPicks = await db.select().from(picksTable).where(eq(picksTable.submissionId, sub.id));
  res.status(201).json(formatSubmission(sub, insertedPicks));
});

// PATCH /leagues/:leagueId/events/:eventId/submissions/:submissionId
router.patch("/leagues/:leagueId/events/:eventId/submissions/:submissionId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = UpdateSubmissionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const submissionId = Number(params.data.submissionId);
  const userId = req.user.id;

  const [event] = await db.select().from(pickEventsTable).where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  if (event.status !== "open") { res.status(400).json({ error: "Event is not open for pick changes" }); return; }
  const now = new Date();

  const [sub] = await db.select().from(submissionsTable).where(and(eq(submissionsTable.id, submissionId), eq(submissionsTable.pickEventId, eventId)));
  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }
  if (sub.userId !== userId) { res.status(403).json({ error: "Not your submission" }); return; }

  const parsed = UpdateSubmissionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { picks, moneyPickGameId, tiebreakerAnswer } = parsed.data;

  const eventGames = await db.select().from(eventGamesTable).where(eq(eventGamesTable.pickEventId, eventId));
  const existingPicks = await db.select().from(picksTable).where(eq(picksTable.submissionId, submissionId));
  const validationError = validatePicksAgainstGames(picks, moneyPickGameId, tiebreakerAnswer, eventGames, event.tiebreakerQuestion, { picks: existingPicks, moneyPickGameId: sub.moneyPickGameId ?? null }, now);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  // Atomic update: delete + update + re-insert in one transaction to prevent pick loss on failure
  await db.transaction(async (tx) => {
    await tx.delete(picksTable).where(eq(picksTable.submissionId, submissionId));
    await tx.update(submissionsTable).set({ moneyPickGameId, tiebreakerAnswer }).where(eq(submissionsTable.id, submissionId));
    await tx.insert(picksTable).values(picks.map((p) => ({ submissionId, eventGameId: p.eventGameId, selectedTeam: p.selectedTeam })));
  });

  const [updatedSub] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, submissionId));
  const updatedPicks = await db.select().from(picksTable).where(eq(picksTable.submissionId, submissionId));
  res.json(formatSubmission(updatedSub, updatedPicks));
});

export default router;
