import { pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const leaguesTable = pgTable("leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  commissionerId: varchar("commissioner_id")
    .notNull()
    .references(() => usersTable.id),
  inviteCode: text("invite_code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLeagueSchema = createInsertSchema(leaguesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLeague = z.infer<typeof insertLeagueSchema>;
export type League = typeof leaguesTable.$inferSelect;

export const leagueMembersTable = pgTable("league_members", {
  id: serial("id").primaryKey(),
  leagueId: serial("league_id").notNull().references(() => leaguesTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => usersTable.id),
  role: text("role").notNull().default("player"), // commissioner, deputy, player
  status: text("status").notNull().default("active"), // active, removed
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLeagueMemberSchema = createInsertSchema(leagueMembersTable).omit({ id: true, joinedAt: true });
export type InsertLeagueMember = z.infer<typeof insertLeagueMemberSchema>;
export type LeagueMember = typeof leagueMembersTable.$inferSelect;
