/**
 * Demo seed: 1 league, 8 players, 1 commissioner, 1 open event, 6 games
 * Run: pnpm --filter @workspace/db run seed
 */
import { db } from "./index";
import {
  usersTable,
  leaguesTable,
  leagueMembersTable,
  pickEventsTable,
  eventGamesTable,
  submissionsTable,
  picksTable,
} from "./schema";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("Seeding demo data...");

  // Clear existing demo data
  await db.execute(sql`TRUNCATE picks, submissions, event_games, pick_events, league_members, leagues, sessions, users RESTART IDENTITY CASCADE`);

  // 1. Create users
  const now = new Date();
  const users = await db.insert(usersTable).values([
    { id: "u-comm-01", firstName: "Alex", lastName: "Rivera", profileImageUrl: null },
    { id: "u-player-02", firstName: "Jordan", lastName: "Kim", profileImageUrl: null },
    { id: "u-player-03", firstName: "Morgan", lastName: "Patel", profileImageUrl: null },
    { id: "u-player-04", firstName: "Casey", lastName: "Chen", profileImageUrl: null },
    { id: "u-player-05", firstName: "Taylor", lastName: "Okafor", profileImageUrl: null },
    { id: "u-player-06", firstName: "Drew", lastName: "Martinez", profileImageUrl: null },
    { id: "u-player-07", firstName: "Sam", lastName: "Johnson", profileImageUrl: null },
    { id: "u-player-08", firstName: "Jamie", lastName: "Williams", profileImageUrl: null },
  ]).returning();
  console.log(`Created ${users.length} users`);

  // 2. Create league
  const [league] = await db.insert(leaguesTable).values({
    name: "Sunday Sharps",
    slug: "sunday-sharps",
    commissionerId: "u-comm-01",
    inviteCode: "SHARP2025",
  }).returning();
  console.log(`Created league: ${league.name}`);

  // 3. Add all users as members
  await db.insert(leagueMembersTable).values([
    { leagueId: league.id, userId: "u-comm-01", role: "commissioner", status: "active" },
    { leagueId: league.id, userId: "u-player-02", role: "player", status: "active" },
    { leagueId: league.id, userId: "u-player-03", role: "player", status: "active" },
    { leagueId: league.id, userId: "u-player-04", role: "player", status: "active" },
    { leagueId: league.id, userId: "u-player-05", role: "player", status: "active" },
    { leagueId: league.id, userId: "u-player-06", role: "player", status: "active" },
    { leagueId: league.id, userId: "u-player-07", role: "player", status: "active" },
    { leagueId: league.id, userId: "u-player-08", role: "player", status: "active" },
  ]);
  console.log("Added 8 members");

  // 4. Create pick event (Week 1, open)
  const deadline = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days from now
  const revealAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const [event] = await db.insert(pickEventsTable).values({
    leagueId: league.id,
    name: "Week 1 — Sunday Slate",
    nflWeek: 1,
    nflSeason: 2026,
    status: "open",
    submissionDeadline: deadline,
    revealAt,
    tiebreakerQuestion: "How many total points will be scored in the SNF game?",
    notes: "Good luck everyone. Pick 6 games, choose your money pick wisely.",
    createdBy: "u-comm-01",
    publishedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
  }).returning();
  console.log(`Created event: ${event.name}`);

  // 5. Create 6 event games (mock IDs matching our mock generator format)
  const kickoffBase = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 2 days out
  kickoffBase.setHours(13, 0, 0, 0);

  const games = await db.insert(eventGamesTable).values([
    { pickEventId: event.id, nflGameId: "2026-W1-S1", homeTeam: "KC", awayTeam: "BAL", kickoffAt: new Date(kickoffBase), lockedSpread: -3.5, spreadTeam: "home", displayOrder: 1 },
    { pickEventId: event.id, nflGameId: "2026-W1-S2", homeTeam: "BUF", awayTeam: "MIA", kickoffAt: new Date(kickoffBase), lockedSpread: -6.5, spreadTeam: "home", displayOrder: 2 },
    { pickEventId: event.id, nflGameId: "2026-W1-S3", homeTeam: "SF", awayTeam: "LAR", kickoffAt: new Date(kickoffBase), lockedSpread: -4.5, spreadTeam: "home", displayOrder: 3 },
    { pickEventId: event.id, nflGameId: "2026-W1-S4", homeTeam: "DAL", awayTeam: "PHI", kickoffAt: new Date(new Date(kickoffBase).setHours(16, 30)), lockedSpread: 2.5, spreadTeam: "home", displayOrder: 4 },
    { pickEventId: event.id, nflGameId: "2026-W1-S5", homeTeam: "DET", awayTeam: "GB", kickoffAt: new Date(new Date(kickoffBase).setHours(16, 30)), lockedSpread: -3, spreadTeam: "home", displayOrder: 5 },
    { pickEventId: event.id, nflGameId: "2026-W1-S6", homeTeam: "SEA", awayTeam: "LAC", kickoffAt: new Date(new Date(kickoffBase).setHours(20, 20)), lockedSpread: -1.5, spreadTeam: "home", displayOrder: 6 },
  ]).returning();
  console.log(`Created ${games.length} event games`);

  // 6. Create submissions for 6 of the 8 players (Alex and Jordan haven't submitted yet)
  const submitters = [
    { userId: "u-player-03", money: games[2].id, tiebreaker: 47, picks: ["home", "away", "home", "away", "home", "away"] },
    { userId: "u-player-04", money: games[0].id, tiebreaker: 44, picks: ["home", "home", "away", "home", "away", "home"] },
    { userId: "u-player-05", money: games[1].id, tiebreaker: 51, picks: ["away", "home", "home", "home", "home", "home"] },
    { userId: "u-player-06", money: games[3].id, tiebreaker: 38, picks: ["home", "away", "away", "away", "home", "away"] },
    { userId: "u-player-07", money: games[0].id, tiebreaker: 55, picks: ["home", "home", "home", "home", "away", "home"] },
    { userId: "u-player-08", money: games[4].id, tiebreaker: 42, picks: ["away", "away", "home", "home", "home", "home"] },
  ];

  for (const s of submitters) {
    const [sub] = await db.insert(submissionsTable).values({
      pickEventId: event.id,
      userId: s.userId,
      moneyPickGameId: s.money,
      tiebreakerAnswer: s.tiebreaker,
    }).returning();

    await db.insert(picksTable).values(games.map((g, i) => ({
      submissionId: sub.id,
      eventGameId: g.id,
      selectedTeam: s.picks[i],
    })));
  }
  console.log("Created 6 submissions with picks");

  // 7. Create a finalized past event to show standings
  const pastDeadline = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [pastEvent] = await db.insert(pickEventsTable).values({
    leagueId: league.id,
    name: "Preseason Week 1",
    nflWeek: 0,
    nflSeason: 2026,
    status: "finalized",
    submissionDeadline: pastDeadline,
    revealAt: new Date(pastDeadline.getTime() + 24 * 60 * 60 * 1000),
    tiebreakerQuestion: "Total points in opener?",
    tiebreakerResult: 48,
    createdBy: "u-comm-01",
    publishedAt: new Date(pastDeadline.getTime() - 24 * 60 * 60 * 1000),
    finalizedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
  }).returning();

  const pastKickoff = new Date(pastDeadline.getTime() - 48 * 60 * 60 * 1000);
  const pastGames = await db.insert(eventGamesTable).values([
    { pickEventId: pastEvent.id, nflGameId: "2026-W0-S1", homeTeam: "KC", awayTeam: "DET", kickoffAt: pastKickoff, lockedSpread: -3, spreadTeam: "home", displayOrder: 1, result: "home", homeScore: 27, awayScore: 17, isFinalized: true },
    { pickEventId: pastEvent.id, nflGameId: "2026-W0-S2", homeTeam: "BUF", awayTeam: "MIA", kickoffAt: pastKickoff, lockedSpread: -7, spreadTeam: "home", displayOrder: 2, result: "away", homeScore: 21, awayScore: 20, isFinalized: true },
    { pickEventId: pastEvent.id, nflGameId: "2026-W0-S3", homeTeam: "PHI", awayTeam: "DAL", kickoffAt: pastKickoff, lockedSpread: -4, spreadTeam: "home", displayOrder: 3, result: "home", homeScore: 31, awayScore: 14, isFinalized: true },
    { pickEventId: pastEvent.id, nflGameId: "2026-W0-S4", homeTeam: "SF", awayTeam: "SEA", kickoffAt: pastKickoff, lockedSpread: -5.5, spreadTeam: "home", displayOrder: 4, result: "home", homeScore: 24, awayScore: 10, isFinalized: true },
  ]).returning();

  // past submissions for all 8 players
  const pastSubmitters = [
    { userId: "u-comm-01", money: pastGames[0].id, tiebreaker: 44, picks: ["home", "away", "home", "home"] },
    { userId: "u-player-02", money: pastGames[1].id, tiebreaker: 48, picks: ["home", "home", "home", "away"] },
    { userId: "u-player-03", money: pastGames[2].id, tiebreaker: 50, picks: ["home", "away", "home", "home"] },
    { userId: "u-player-04", money: pastGames[0].id, tiebreaker: 47, picks: ["away", "home", "away", "home"] },
    { userId: "u-player-05", money: pastGames[3].id, tiebreaker: 52, picks: ["home", "away", "home", "home"] },
    { userId: "u-player-06", money: pastGames[1].id, tiebreaker: 41, picks: ["home", "away", "away", "home"] },
    { userId: "u-player-07", money: pastGames[2].id, tiebreaker: 55, picks: ["home", "home", "home", "away"] },
    { userId: "u-player-08", money: pastGames[0].id, tiebreaker: 38, picks: ["away", "away", "home", "home"] },
  ];

  for (const s of pastSubmitters) {
    const [sub] = await db.insert(submissionsTable).values({
      pickEventId: pastEvent.id,
      userId: s.userId,
      moneyPickGameId: s.money,
      tiebreakerAnswer: s.tiebreaker,
      lockedAt: pastDeadline,
    }).returning();

    // Insert picks with results
    const pickRows = pastGames.map((g, i) => {
      const selected = s.picks[i];
      const isMoneyPick = s.money === g.id;
      const result = g.result === selected ? "win" : g.result === "push" ? "push" : "loss";
      const pointsAwarded = result === "win" ? (isMoneyPick ? 2 : 1) : result === "push" ? (isMoneyPick ? 1 : 0.5) : 0;
      return { submissionId: sub.id, eventGameId: g.id, selectedTeam: selected, result, pointsAwarded };
    });

    await db.insert(picksTable).values(pickRows);
  }
  console.log("Created past event with finalized results");

  console.log("\nSeed complete! Demo data:");
  console.log(`  League: "${league.name}" (id=${league.id})`);
  console.log(`  Invite code: ${league.inviteCode}`);
  console.log(`  Commissioner: Alex Rivera (id=u-comm-01)`);
  console.log(`  Active event: ${event.name} (id=${event.id})`);
  console.log(`  Submissions: 6/8 players have submitted`);
  process.exit(0);
}

seed().catch((err) => { console.error(err); process.exit(1); });
