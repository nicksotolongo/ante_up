import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before repairing event game duplicates");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  const conflictingGames = await client.query<{ pick_event_id: number; nfl_game_id: string }>(`
    SELECT pick_event_id, nfl_game_id
    FROM event_games
    GROUP BY pick_event_id, nfl_game_id
    HAVING
      count(*) > 1
      AND count(DISTINCT jsonb_build_array(
        home_team,
        away_team,
        kickoff_at,
        locked_spread,
        spread_team,
        locked_at,
        display_order,
        result,
        home_score,
        away_score,
        is_finalized
      )) > 1
  `);
  if (conflictingGames.rowCount) {
    const identifiers = conflictingGames.rows
      .map((row) => `${row.pick_event_id}:${row.nfl_game_id}`)
      .join(", ");
    throw new Error(`Non-equivalent event-game duplicates require manual review: ${identifiers}`);
  }

  await client.query(`
    CREATE TEMP TABLE event_game_repair_map ON COMMIT DROP AS
    WITH ranked AS (
      SELECT
        id,
        first_value(id) OVER (
          PARTITION BY pick_event_id, nfl_game_id
          ORDER BY is_finalized DESC, (result IS NOT NULL) DESC, id ASC
        ) AS canonical_id,
        row_number() OVER (
          PARTITION BY pick_event_id, nfl_game_id
          ORDER BY is_finalized DESC, (result IS NOT NULL) DESC, id ASC
        ) AS row_number
      FROM event_games
    )
    SELECT id AS duplicate_id, canonical_id
    FROM ranked
    WHERE row_number > 1
  `);

  await client.query(`
    CREATE TEMP TABLE normalized_picks ON COMMIT DROP AS
    SELECT
      pick.id,
      pick.submission_id,
      coalesce(repair.canonical_id, pick.event_game_id) AS event_game_id,
      pick.selected_team,
      pick.result,
      pick.points_awarded
    FROM picks pick
    LEFT JOIN event_game_repair_map repair ON repair.duplicate_id = pick.event_game_id
  `);

  const conflictingPicks = await client.query<{ submission_id: number; event_game_id: number }>(`
    SELECT submission_id, event_game_id
    FROM normalized_picks
    GROUP BY submission_id, event_game_id
    HAVING
      count(*) > 1
      AND count(DISTINCT jsonb_build_array(selected_team, result, points_awarded)) > 1
  `);
  if (conflictingPicks.rowCount) {
    const identifiers = conflictingPicks.rows
      .map((row) => `${row.submission_id}:${row.event_game_id}`)
      .join(", ");
    throw new Error(`Conflicting duplicate picks require manual review: ${identifiers}`);
  }

  await client.query(`
    WITH ranked AS (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY submission_id, event_game_id
          ORDER BY (result IS NOT NULL) DESC, (points_awarded IS NOT NULL) DESC, id ASC
        ) AS row_number
      FROM normalized_picks
    )
    DELETE FROM picks
    WHERE id IN (SELECT id FROM ranked WHERE row_number > 1)
  `);

  await client.query(`
    UPDATE picks pick
    SET event_game_id = repair.canonical_id
    FROM event_game_repair_map repair
    WHERE pick.event_game_id = repair.duplicate_id
  `);

  await client.query(`
    UPDATE submissions submission
    SET money_pick_game_id = repair.canonical_id
    FROM event_game_repair_map repair
    WHERE submission.money_pick_game_id = repair.duplicate_id
  `);

  await client.query(`
    DELETE FROM event_games
    WHERE id IN (SELECT duplicate_id FROM event_game_repair_map)
  `);

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}