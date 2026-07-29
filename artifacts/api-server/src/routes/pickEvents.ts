import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, leagueMembersTable, leaguesTable, pickEventsTable, submissionsTable } from "@workspace/db";
import {
  CreatePickEventBody,
  CreatePickEventParams,
  GetPickEventParams,
  LockPickEventParams,
  FinalizePickEventParams,
  UpdatePickEventBody,
  UpdatePickEventParams,
  ListPickEventsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function formatEvent(event: typeof pickEventsTable.$inferSelect, submissionCount: number, totalMembers: number) {
  return {
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
    notes: event.notes ?? null,
    submissionCount,
    totalMembers,
    publishedAt: event.publishedAt?.toISOString() ?? null,
    finalizedAt: event.finalizedAt?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

async function requireMember(leagueId: number, userId: string) {
  const [m] = await db.select().from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.userId, userId), eq(leagueMembersTable.status, "active")));
  return m ?? null;
}

async function getEventCounts(eventId: number, leagueId: number) {
  const [{ subs }] = await db.select({ subs: sql<number>`count(*)` }).from(submissionsTable).where(eq(submissionsTable.pickEventId, eventId));
  const [{ members }] = await db.select({ members: sql<number>`count(*)` }).from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active")));
  return { submissionCount: Number(subs), totalMembers: Number(members) };
}

// GET /leagues/:leagueId/events
router.get("/leagues/:leagueId/events", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = ListPickEventsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const userId = req.user.id;

  const member = await requireMember(leagueId, userId);
  if (!member) { res.status(403).json({ error: "Not a member" }); return; }

  const events = await db.select().from(pickEventsTable).where(eq(pickEventsTable.leagueId, leagueId));
  const totalMembers = (await db.select({ c: sql<number>`count(*)` }).from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active"))))[0].c;

  const result = await Promise.all(events.map(async (event) => {
    const [{ subs }] = await db.select({ subs: sql<number>`count(*)` }).from(submissionsTable).where(eq(submissionsTable.pickEventId, event.id));
    return formatEvent(event, Number(subs), Number(totalMembers));
  }));

  res.json(result);
});

// POST /leagues/:leagueId/events
router.post("/leagues/:leagueId/events", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = CreatePickEventParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const userId = req.user.id;

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }

  const member = await requireMember(leagueId, userId);
  if (!member || (member.role !== "commissioner" && member.role !== "deputy")) {
    res.status(403).json({ error: "Commissioner only" }); return;
  }

  const parsed = CreatePickEventBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { name, nflWeek, nflSeason, submissionDeadline, revealAt, tiebreakerQuestion, notes } = parsed.data;

  const [event] = await db.insert(pickEventsTable).values({
    leagueId,
    name,
    nflWeek,
    nflSeason,
    status: "draft",
    submissionDeadline: new Date(submissionDeadline),
    revealAt: new Date(revealAt),
    tiebreakerQuestion: tiebreakerQuestion ?? null,
    notes: notes ?? null,
    createdBy: userId,
  }).returning();

  const totalMembers = (await db.select({ c: sql<number>`count(*)` }).from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active"))))[0].c;
  res.status(201).json(formatEvent(event, 0, Number(totalMembers)));
});

// GET /leagues/:leagueId/events/:eventId
router.get("/leagues/:leagueId/events/:eventId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = GetPickEventParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const userId = req.user.id;

  const member = await requireMember(leagueId, userId);
  if (!member) { res.status(403).json({ error: "Not a member" }); return; }

  const [event] = await db.select().from(pickEventsTable).where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const { submissionCount, totalMembers } = await getEventCounts(eventId, leagueId);
  res.json(formatEvent(event, submissionCount, totalMembers));
});

// PATCH /leagues/:leagueId/events/:eventId
router.patch("/leagues/:leagueId/events/:eventId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = UpdatePickEventParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const userId = req.user.id;

  const member = await requireMember(leagueId, userId);
  if (!member || (member.role !== "commissioner" && member.role !== "deputy")) { res.status(403).json({ error: "Commissioner only" }); return; }

  const [event] = await db.select().from(pickEventsTable).where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const parsed = UpdatePickEventBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updates: Partial<typeof pickEventsTable.$inferInsert> = {};
  if (parsed.data.name != null) updates.name = parsed.data.name;
  if (parsed.data.submissionDeadline != null) updates.submissionDeadline = new Date(parsed.data.submissionDeadline);
  if (parsed.data.revealAt != null) updates.revealAt = new Date(parsed.data.revealAt);
  if ("tiebreakerQuestion" in parsed.data) updates.tiebreakerQuestion = parsed.data.tiebreakerQuestion;
  if ("tiebreakerResult" in parsed.data) updates.tiebreakerResult = parsed.data.tiebreakerResult ?? undefined;
  if ("notes" in parsed.data) updates.notes = parsed.data.notes;

  const [updated] = await db.update(pickEventsTable).set(updates).where(eq(pickEventsTable.id, eventId)).returning();
  const { submissionCount, totalMembers } = await getEventCounts(eventId, leagueId);
  res.json(formatEvent(updated, submissionCount, totalMembers));
});

// POST /leagues/:leagueId/events/:eventId/lock
router.post("/leagues/:leagueId/events/:eventId/lock", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = LockPickEventParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const userId = req.user.id;

  const member = await requireMember(leagueId, userId);
  if (!member || (member.role !== "commissioner" && member.role !== "deputy")) { res.status(403).json({ error: "Commissioner only" }); return; }

  const [event] = await db.select().from(pickEventsTable).where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }
  if (event.status !== "draft") { res.status(400).json({ error: "Only draft events can be locked and published" }); return; }

  const now = new Date();
  const [updated] = await db.update(pickEventsTable).set({ status: "open", publishedAt: now }).where(eq(pickEventsTable.id, eventId)).returning();
  const { submissionCount, totalMembers } = await getEventCounts(eventId, leagueId);
  res.json(formatEvent(updated, submissionCount, totalMembers));
});

// POST /leagues/:leagueId/events/:eventId/finalize
router.post("/leagues/:leagueId/events/:eventId/finalize", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = FinalizePickEventParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const leagueId = Number(params.data.leagueId);
  const eventId = Number(params.data.eventId);
  const userId = req.user.id;

  const member = await requireMember(leagueId, userId);
  if (!member || (member.role !== "commissioner" && member.role !== "deputy")) { res.status(403).json({ error: "Commissioner only" }); return; }

  const [event] = await db.select().from(pickEventsTable).where(and(eq(pickEventsTable.id, eventId), eq(pickEventsTable.leagueId, leagueId)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  const [updated] = await db.update(pickEventsTable).set({ status: "finalized", finalizedAt: new Date() }).where(eq(pickEventsTable.id, eventId)).returning();
  const { submissionCount, totalMembers } = await getEventCounts(eventId, leagueId);
  res.json(formatEvent(updated, submissionCount, totalMembers));
});

export default router;
