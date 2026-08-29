import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  eventGamesTable,
  leagueMembersTable,
  leaguesTable,
  pickEventsTable,
  picksTable,
  pool,
  submissionsTable,
  usersTable,
} from "@workspace/db";
import eventGamesRouter from "../src/routes/eventGames";
import submissionsRouter from "../src/routes/submissions";

const runId = `${Date.now()}-${process.pid}`;
const userId = `integrity-test-${runId}`;
let leagueId: number;
let baseUrl: string;
let server: ReturnType<ReturnType<typeof express>["listen"]>;

const nflGame = {
  id: `nfl-${runId}`,
  week: 1,
  season: 2026,
  homeTeam: "Home",
  awayTeam: "Away",
  kickoffAt: new Date(Date.now() + 86_400_000),
  gameStatus: "scheduled" as const,
  spread: -3,
  favoredTeam: "home" as const,
  homeScore: null,
  awayScore: null,
  updatedAt: new Date(),
};

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  return { status: response.status, body: await response.json() };
}

async function createEvent(status: "draft" | "open" = "open") {
  const [event] = await db
    .insert(pickEventsTable)
    .values({
      leagueId,
      name: `Integrity ${runId}`,
      nflWeek: 1,
      nflSeason: 2026,
      status,
      createdBy: userId,
    })
    .returning();
  return event;
}

async function createGame(eventId: number, overrides = {}) {
  const [game] = await db
    .insert(eventGamesTable)
    .values({
      pickEventId: eventId,
      nflGameId: `game-${runId}-${Math.random()}`,
      homeTeam: "Home",
      awayTeam: "Away",
      kickoffAt: new Date(Date.now() + 86_400_000),
      lockedSpread: -3,
      spreadTeam: "home",
      displayOrder: 1,
      ...overrides,
    })
    .returning();
  return game;
}

before(async () => {
  await db
    .insert(usersTable)
    .values({ id: userId, email: `${userId}@example.test` });
  const [league] = await db
    .insert(leaguesTable)
    .values({
      name: `Integrity ${runId}`,
      slug: `integrity-${runId}`,
      commissionerId: userId,
      inviteCode: `invite-${runId}`,
    })
    .returning();
  leagueId = league.id;
  await db.insert(leagueMembersTable).values({
    leagueId,
    userId,
    role: "commissioner",
    status: "active",
  });

  const app = express();
  app.locals.eventGamesDependencies = {
    getNflGame: async (gameId: string) =>
      gameId === nflGame.id ? nflGame : undefined,
    getUpcomingWeeks: () => [],
  };
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId };
    req.isAuthenticated = function () {
      return true;
    };
    next();
  });
  app.use("/api", eventGamesRouter);
  app.use("/api", submissionsRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (leagueId)
    await db.delete(leaguesTable).where(eq(leaguesTable.id, leagueId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await pool.end();
});

test("concurrent duplicate game-add requests leave one event-game row", async () => {
  const event = await createEvent("draft");
  const path = `/api/leagues/${leagueId}/events/${event.id}/games`;
  const body = JSON.stringify({ nflGameId: nflGame.id, displayOrder: 1 });

  const responses = await Promise.all([
    request(path, { method: "POST", body }),
    request(path, { method: "POST", body }),
  ]);

  assert.deepEqual(
    responses.map(({ status }) => status),
    [201, 201],
  );
  assert.equal(responses[0].body.id, responses[1].body.id);
  const rows = await db
    .select()
    .from(eventGamesTable)
    .where(
      and(
        eq(eventGamesTable.pickEventId, event.id),
        eq(eventGamesTable.nflGameId, nflGame.id),
      ),
    );
  assert.equal(rows.length, 1);
});

test("finalization racing a stale score update leaves one coherent final result", async () => {
  const event = await createEvent();
  const game = await createGame(event.id);
  const path = `/api/leagues/${leagueId}/events/${event.id}/games/${game.id}`;

  const [finalizeResponse, staleResponse] = await Promise.all([
    request(path, {
      method: "PATCH",
      body: JSON.stringify({
        result: "home",
        homeScore: 24,
        awayScore: 17,
        isFinalized: true,
      }),
    }),
    request(path, {
      method: "PATCH",
      body: JSON.stringify({
        result: "away",
        homeScore: 17,
        awayScore: 24,
      }),
    }),
  ]);

  assert.equal(finalizeResponse.status, 200);
  assert.ok([200, 400].includes(staleResponse.status));
  const [stored] = await db
    .select()
    .from(eventGamesTable)
    .where(eq(eventGamesTable.id, game.id));
  assert.equal(stored.isFinalized, true);
  assert.equal(stored.result, "home");
  assert.equal(stored.homeScore, 24);
  assert.equal(stored.awayScore, 17);
});

test("concurrent updates add one new pick and preserve the graded pick row and points", async () => {
  const event = await createEvent();
  const gradedGame = await createGame(event.id, {
    nflGameId: `graded-${runId}`,
    kickoffAt: new Date(Date.now() - 86_400_000),
    result: "home",
    homeScore: 24,
    awayScore: 17,
    isFinalized: true,
  });
  const newGame = await createGame(event.id, {
    nflGameId: `new-${runId}`,
    displayOrder: 2,
  });
  const [submission] = await db
    .insert(submissionsTable)
    .values({
      pickEventId: event.id,
      userId,
      moneyPickGameId: gradedGame.id,
    })
    .returning();
  const [gradedPick] = await db
    .insert(picksTable)
    .values({
      submissionId: submission.id,
      eventGameId: gradedGame.id,
      selectedTeam: "home",
      result: "win",
      pointsAwarded: 2,
    })
    .returning();

  const path = `/api/leagues/${leagueId}/events/${event.id}/submissions/${submission.id}`;
  const options = {
      method: "PATCH",
      body: JSON.stringify({
        moneyPickGameId: gradedGame.id,
        tiebreakerAnswer: 0,
        picks: [
          { eventGameId: gradedGame.id, selectedTeam: "home" },
          { eventGameId: newGame.id, selectedTeam: "away" },
        ],
      }),
    };
  const responses = await Promise.all([
    request(path, options),
    request(path, options),
  ]);

  assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
  const storedPicks = await db
    .select()
    .from(picksTable)
    .where(eq(picksTable.submissionId, submission.id));
  assert.equal(storedPicks.length, 2);
  const preserved = storedPicks.find(
    (pick) => pick.eventGameId === gradedGame.id,
  );
  assert.equal(preserved?.id, gradedPick.id);
  assert.equal(preserved?.selectedTeam, "home");
  assert.equal(preserved?.result, "win");
  assert.equal(preserved?.pointsAwarded, 2);
  const inserted = storedPicks.find((pick) => pick.eventGameId === newGame.id);
  assert.equal(inserted?.selectedTeam, "away");
  assert.equal(inserted?.result, null);
  assert.equal(inserted?.pointsAwarded, null);
});
