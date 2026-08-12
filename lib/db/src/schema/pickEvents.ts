import { boolean, jsonb, pgTable, real, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";
import { usersTable } from "./auth";

export const pickEventsTable = pgTable("pick_events", {
  id: serial("id").primaryKey(),
  leagueId: serial("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nflWeek: serial("nfl_week").notNull(),
  nflSeason: serial("nfl_season").notNull(),
  nflSeasonType: text("nfl_season_type").notNull().default("regular"), // 'preseason' | 'regular'
  status: text("status").notNull().default("draft"), // draft, open, locked, revealed, finalized
  submissionDeadline: timestamp("submission_deadline", { withTimezone: true }).notNull(),
  revealAt: timestamp("reveal_at", { withTimezone: true }).notNull(),
  tiebreakerQuestion: text("tiebreaker_question"),
  tiebreakerResult: real("tiebreaker_result"),
  notes: text("notes"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdBy: varchar("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPickEventSchema = createInsertSchema(pickEventsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPickEvent = z.infer<typeof insertPickEventSchema>;
export type PickEvent = typeof pickEventsTable.$inferSelect;

export const eventGamesTable = pgTable("event_games", {
  id: serial("id").primaryKey(),
  pickEventId: serial("pick_event_id").notNull().references(() => pickEventsTable.id, { onDelete: "cascade" }),
  // NFL game identifier from the mock/live provider
  nflGameId: text("nfl_game_id").notNull(),
  // Stored game data at time of locking (so we don't need a separate nfl_games table for mock)
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
  // Spread info (locked when event is published)
  lockedSpread: real("locked_spread"),
  spreadTeam: text("spread_team"), // 'home' or 'away' — which team the spread applies to (negative = favored)
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  displayOrder: serial("display_order").notNull(),
  // Results
  result: text("result"), // 'home', 'away', 'push'
  homeScore: real("home_score"),
  awayScore: real("away_score"),
  isFinalized: boolean("is_finalized").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEventGameSchema = createInsertSchema(eventGamesTable).omit({ id: true, createdAt: true });
export type InsertEventGame = z.infer<typeof insertEventGameSchema>;
export type EventGame = typeof eventGamesTable.$inferSelect;

export const submissionsTable = pgTable("submissions", {
  id: serial("id").primaryKey(),
  pickEventId: serial("pick_event_id").notNull().references(() => pickEventsTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => usersTable.id),
  moneyPickGameId: serial("money_pick_game_id").references(() => eventGamesTable.id),
  tiebreakerAnswer: real("tiebreaker_answer"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSubmissionSchema = createInsertSchema(submissionsTable).omit({ id: true, submittedAt: true, updatedAt: true });
export type InsertSubmission = z.infer<typeof insertSubmissionSchema>;
export type Submission = typeof submissionsTable.$inferSelect;

export const picksTable = pgTable("picks", {
  id: serial("id").primaryKey(),
  submissionId: serial("submission_id").notNull().references(() => submissionsTable.id, { onDelete: "cascade" }),
  eventGameId: serial("event_game_id").notNull().references(() => eventGamesTable.id, { onDelete: "cascade" }),
  selectedTeam: text("selected_team").notNull(), // 'home' or 'away'
  result: text("result"), // 'win', 'loss', 'push', null = pending
  pointsAwarded: real("points_awarded"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPickSchema = createInsertSchema(picksTable).omit({ id: true, createdAt: true });
export type InsertPick = z.infer<typeof insertPickSchema>;
export type Pick = typeof picksTable.$inferSelect;

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  leagueId: serial("league_id").notNull(),
  actorUserId: varchar("actor_user_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogsTable.$inferSelect;
