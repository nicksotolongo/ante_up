import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  leaguesTable,
  leagueMembersTable,
} from "@workspace/db";
import { CreateLeagueBody, JoinLeagueBody, UpdateLeagueBody } from "@workspace/api-zod";
import { randomBytes } from "crypto";

const router: IRouter = Router();

function generateInviteCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// GET /leagues — list my leagues
router.get("/leagues", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = req.user.id;

  const memberships = await db
    .select()
    .from(leagueMembersTable)
    .where(and(eq(leagueMembersTable.userId, userId), eq(leagueMembersTable.status, "active")));

  if (memberships.length === 0) {
    res.json([]);
    return;
  }

  const leagueIds = memberships.map((m) => m.leagueId);

  const leagues = await db
    .select({
      league: leaguesTable,
      memberCount: sql<number>`count(distinct ${leagueMembersTable.id})`.as("member_count"),
    })
    .from(leaguesTable)
    .leftJoin(leagueMembersTable, and(eq(leagueMembersTable.leagueId, leaguesTable.id), eq(leagueMembersTable.status, "active")))
    .where(sql`${leaguesTable.id} = ANY(${leagueIds})`)
    .groupBy(leaguesTable.id);

  const result = leagues.map(({ league, memberCount }) => {
    const membership = memberships.find((m) => m.leagueId === league.id);
    return {
      id: league.id,
      name: league.name,
      slug: league.slug,
      commissionerId: league.commissionerId,
      inviteCode: league.commissionerId === userId ? league.inviteCode : undefined,
      memberCount: Number(memberCount),
      userRole: membership?.role ?? null,
      createdAt: league.createdAt.toISOString(),
    };
  });

  res.json(result);
});

// POST /leagues — create league
router.post("/leagues", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = CreateLeagueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, slug: rawSlug } = parsed.data;
  const slug = rawSlug || generateSlug(name);
  const userId = req.user.id;

  // Check slug uniqueness
  const existing = await db.select().from(leaguesTable).where(eq(leaguesTable.slug, slug));
  if (existing.length > 0) {
    res.status(400).json({ error: "A league with that slug already exists" });
    return;
  }

  const inviteCode = generateInviteCode();
  const [league] = await db.insert(leaguesTable).values({ name, slug, commissionerId: userId, inviteCode }).returning();
  await db.insert(leagueMembersTable).values({ leagueId: league.id, userId, role: "commissioner", status: "active" });

  res.status(201).json({
    id: league.id,
    name: league.name,
    slug: league.slug,
    commissionerId: league.commissionerId,
    inviteCode: league.inviteCode,
    memberCount: 1,
    userRole: "commissioner",
    createdAt: league.createdAt.toISOString(),
  });
});

// POST /leagues/join
router.post("/leagues/join", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = JoinLeagueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { inviteCode } = parsed.data;
  const userId = req.user.id;

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.inviteCode, inviteCode));
  if (!league) {
    res.status(404).json({ error: "League not found with that invite code" });
    return;
  }

  const existing = await db.select().from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, league.id), eq(leagueMembersTable.userId, userId)));
  if (existing.length > 0 && existing[0].status === "active") {
    res.status(400).json({ error: "You are already a member of this league" });
    return;
  }

  if (existing.length > 0) {
    await db.update(leagueMembersTable).set({ status: "active" }).where(eq(leagueMembersTable.id, existing[0].id));
  } else {
    await db.insert(leagueMembersTable).values({ leagueId: league.id, userId, role: "player", status: "active" });
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, league.id), eq(leagueMembersTable.status, "active")));

  res.json({
    id: league.id,
    name: league.name,
    slug: league.slug,
    commissionerId: league.commissionerId,
    memberCount: Number(count),
    userRole: "player",
    createdAt: league.createdAt.toISOString(),
  });
});

// GET /leagues/:leagueId
router.get("/leagues/:leagueId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const raw = Array.isArray(req.params.leagueId) ? req.params.leagueId[0] : req.params.leagueId;
  const leagueId = parseInt(raw, 10);
  const userId = req.user.id;

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }

  const [membership] = await db.select().from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.userId, userId), eq(leagueMembersTable.status, "active")));
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active")));

  res.json({
    id: league.id,
    name: league.name,
    slug: league.slug,
    commissionerId: league.commissionerId,
    inviteCode: membership.role === "commissioner" ? league.inviteCode : undefined,
    memberCount: Number(count),
    userRole: membership.role,
    createdAt: league.createdAt.toISOString(),
  });
});

// PATCH /leagues/:leagueId
router.patch("/leagues/:leagueId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const raw = Array.isArray(req.params.leagueId) ? req.params.leagueId[0] : req.params.leagueId;
  const leagueId = parseInt(raw, 10);
  const userId = req.user.id;

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (league.commissionerId !== userId) { res.status(403).json({ error: "Commissioner only" }); return; }

  const parsed = UpdateLeagueBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db.update(leaguesTable).set(parsed.data).where(eq(leaguesTable.id, leagueId)).returning();
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(leagueMembersTable).where(and(eq(leagueMembersTable.leagueId, leagueId), eq(leagueMembersTable.status, "active")));

  res.json({ id: updated.id, name: updated.name, slug: updated.slug, commissionerId: updated.commissionerId, inviteCode: updated.inviteCode, memberCount: Number(count), userRole: "commissioner", createdAt: updated.createdAt.toISOString() });
});

// POST /leagues/:leagueId/invite — regenerate invite code
router.post("/leagues/:leagueId/invite", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const raw = Array.isArray(req.params.leagueId) ? req.params.leagueId[0] : req.params.leagueId;
  const leagueId = parseInt(raw, 10);
  const userId = req.user.id;

  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "League not found" }); return; }
  if (league.commissionerId !== userId) { res.status(403).json({ error: "Commissioner only" }); return; }

  const newCode = generateInviteCode();
  await db.update(leaguesTable).set({ inviteCode: newCode }).where(eq(leaguesTable.id, leagueId));
  res.json({ inviteCode: newCode });
});

export default router;
