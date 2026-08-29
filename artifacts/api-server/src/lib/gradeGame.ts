import { and, eq } from "drizzle-orm";
import { db, eventGamesTable, picksTable, submissionsTable } from "@workspace/db";
import { calculateAtsResult } from "./mockNflGames";

export type AtsResult = "home" | "away" | "push";

/** Grades every submitted pick for a single event game against its final ATS result. */
export async function gradePicksForGame(pickEventId: number, eventGameId: number, result: AtsResult) {
  const subs = await db.select().from(submissionsTable).where(eq(submissionsTable.pickEventId, pickEventId));
  for (const sub of subs) {
    const picks = await db
      .select()
      .from(picksTable)
      .where(and(eq(picksTable.submissionId, sub.id), eq(picksTable.eventGameId, eventGameId)));
    for (const pick of picks) {
      const isMoneyPick = sub.moneyPickGameId === eventGameId;
      const pickResult: "win" | "loss" | "push" =
        result === "push" ? "push" : pick.selectedTeam === result ? "win" : "loss";
      const pointsAwarded =
        result === "push" ? 0 : pick.selectedTeam === result ? (isMoneyPick ? 2 : 1) : 0;
      await db.update(picksTable).set({ result: pickResult, pointsAwarded }).where(eq(picksTable.id, pick.id));
    }
  }
}

/**
 * Auto-grades a single event game the moment the NFL provider reports it final,
 * independent of the commissioner's event-level Finalize action. This is what
 * lets the live board flip a game to win/loss as soon as it ends, rather than
 * waiting for the whole week to be finalized.
 *
 * Safe to call repeatedly — it's a no-op once the game is already finalized in
 * our DB, and a no-op if we don't have a locked spread to grade against.
 *
 * Returns the updated event game row when it graded something, else null.
 */
export async function maybeAutoFinalizeGame(
  eg: typeof eventGamesTable.$inferSelect,
  live: { gameStatus: string; homeScore: number | null; awayScore: number | null } | null | undefined,
): Promise<typeof eventGamesTable.$inferSelect | null> {
  if (eg.isFinalized) return null;
  if (!live || live.gameStatus !== "final" || live.homeScore == null || live.awayScore == null) return null;
  if (eg.lockedSpread == null || !eg.spreadTeam) return null; // can't grade ATS without a spread

  const result = calculateAtsResult(live.homeScore, live.awayScore, eg.lockedSpread, eg.spreadTeam as "home" | "away");

  await db
    .update(eventGamesTable)
    .set({ result, homeScore: live.homeScore, awayScore: live.awayScore, isFinalized: true })
    .where(eq(eventGamesTable.id, eg.id));
  await gradePicksForGame(eg.pickEventId, eg.id, result);

  return { ...eg, result, homeScore: live.homeScore, awayScore: live.awayScore, isFinalized: true };
}
