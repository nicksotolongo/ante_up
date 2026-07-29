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

/** Validates a pick set against the event game list. Returns an error string or null on success. */
function validatePicksAgainstGames(
  picks: { eventGameId: number; selectedTeam: string }[],
  moneyPickGameId: number,
  tiebreakerAnswer: number | null | undefined,
  eventGames: typeof eventGamesTable.$inferSelect[],
  tiebreakerQuestion: string | null | undefined,
): string | null {
  // No duplicate game IDs
  const pickedIds = picks.map(p => p.eventGameId);
  if (new Set(pickedIds).size !== pickedIds.length) return "Duplicate game IDs in picks";

  // Exact game set — no missing, no extras
  if (picks.length !== eventGames.length) return `Expected ${eventGames.length} picks, got ${picks.length}`;

  const gameMap = new Map(eventGames.map(g => [g.id, g]));
  for (const pick of picks) {
    const game = gameMap.get(pick.eventGameId);
    if (!game) return `Pick references unknown game ${pick.eventGameId}`;
    if (pick.selectedTeam !== game.homeTeam && pick.selectedTeam !== game.awayTeam)
      return `Invalid team "${pick.selectedTeam}" for game ${pick.eventGameId} (${game.awayTeam} @ ${game.homeTeam})`;
  }

  // Money pick must be one of the submitted games
  if (!new Set(pickedIds).has(moneyPickGameId)) return "Money pick must be one of your selected games";

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
  const isRevealed = event.status === "revealed" || event.status === "finalized" || now >= event.revealAt;

  if (!isRevealed) {
    // Before reveal: only count, no picks
    res.json({
      revealed: false,
      submittedCount: subs.length,
      totalMembers: allMembers.length,
    });
    return;
  }

  // After reveal: full submissions
  const subsWithPicks = await Promise.all(subs.map(async (sub) => {
    const picks = await db.select().from(picksTable).where(eq(picksTable.submissionId, sub.id));
    const user = await db.select().from(usersTable).where(eq(usersTable.id, sub.userId)).then(rows => rows[0]);
    return {
      id: sub.id,
      pickEventId: sub.pickEventId,
      userId: sub.userId,
      displayName: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || sub.userId,
      profileImageUrl: user?.profileImageUrl ?? null,
      moneyPickGameId: sub.moneyPickGameId ?? null,
      tiebreakerAnswer: sub.tiebreakerAnswer ?? null,
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
  if (now > event.submissionDeadline) { res.status(400).json({ error: "Submission deadline has passed" }); return; }

  // Check if already submitted
  const [existing] = await db.select().from(submissionsTable).where(and(eq(submissionsTable.pickEventId, eventId), eq(submissionsTable.userId, userId)));
  if (existing) { res.status(400).json({ error: "Already submitted. Use PATCH to update." }); return; }

  const parsed = SubmitPicksBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { picks, moneyPickGameId, tiebreakerAnswer } = parsed.data;

  const eventGames = await db.select().from(eventGamesTable).where(eq(eventGamesTable.pickEventId, eventId));
  const validationError = validatePicksAgainstGames(picks, moneyPickGameId, tiebreakerAnswer, eventGames, event.tiebreakerQuestion);
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

  const now = new Date();
  if (now > event.submissionDeadline) { res.status(400).json({ error: "Submission deadline has passed — picks are locked" }); return; }

  const [sub] = await db.select().from(submissionsTable).where(and(eq(submissionsTable.id, submissionId), eq(submissionsTable.pickEventId, eventId)));
  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }
  if (sub.userId !== userId) { res.status(403).json({ error: "Not your submission" }); return; }

  const parsed = UpdateSubmissionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { picks, moneyPickGameId, tiebreakerAnswer } = parsed.data;

  const eventGames = await db.select().from(eventGamesTable).where(eq(eventGamesTable.pickEventId, eventId));
  const validationError = validatePicksAgainstGames(picks, moneyPickGameId, tiebreakerAnswer, eventGames, event.tiebreakerQuestion);
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
