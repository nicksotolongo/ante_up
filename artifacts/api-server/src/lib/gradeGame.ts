import { and, eq, sql } from "drizzle-orm";
import { db, eventGamesTable, picksTable, submissionsTable } from "@workspace/db";
import { calculateAtsResult } from "./mockNflGames";

export type AtsResult = "home" | "away" | "push";

/** Grades every submitted pick for a single event game against its final ATS result. */
export async function gradePicksForGame(pickEventId: number, eventGameId: number, result: AtsResult) {
  await db.execute(sql`
    UPDATE ${picksTable} AS pick
    SET
      result = CASE
        WHEN ${result} = 'push' THEN 'push'
        WHEN pick.selected_team = ${result} THEN 'win'
        ELSE 'loss'
      END,
      points_awarded = CASE
        WHEN ${result} = 'push' THEN 0
        WHEN pick.selected_team = ${result}
          THEN CASE WHEN submission.money_pick_game_id = ${eventGameId} THEN 2 ELSE 1 END
        ELSE 0
      END
    FROM ${submissionsTable} AS submission
    WHERE
      pick.submission_id = submission.id
      AND submission.pick_event_id = ${pickEventId}
      AND pick.event_game_id = ${eventGameId}
  `);
}

export async function finalizeAndGradeGame(
  eg: typeof eventGamesTable.$inferSelect,
  result: AtsResult,
  scores: { homeScore: number | null; awayScore: number | null },
): Promise<typeof eventGamesTable.$inferSelect | null> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(eventGamesTable)
      .set({
        result,
        homeScore: scores.homeScore ?? undefined,
        awayScore: scores.awayScore ?? undefined,
        isFinalized: true,
      })
      .where(and(eq(eventGamesTable.id, eg.id), eq(eventGamesTable.isFinalized, false)))
      .returning();
    if (!updated) return null;

    await tx.execute(sql`
      UPDATE ${picksTable} AS pick
      SET
        result = CASE
          WHEN ${result} = 'push' THEN 'push'
          WHEN pick.selected_team = ${result} THEN 'win'
          ELSE 'loss'
        END,
        points_awarded = CASE
          WHEN ${result} = 'push' THEN 0
          WHEN pick.selected_team = ${result}
            THEN CASE WHEN submission.money_pick_game_id = ${eg.id} THEN 2 ELSE 1 END
          ELSE 0
        END
      FROM ${submissionsTable} AS submission
      WHERE
        pick.submission_id = submission.id
        AND submission.pick_event_id = ${eg.pickEventId}
        AND pick.event_game_id = ${eg.id}
    `);

    return updated;
  });
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

  return finalizeAndGradeGame(eg, result, {
    homeScore: live.homeScore,
    awayScore: live.awayScore,
  });
}
