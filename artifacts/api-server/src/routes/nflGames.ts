import { Router, type IRouter } from "express";
import { getNflGames, getCurrentNflWeek, getUpcomingWeeks, type NflSeasonType } from "../lib/espnProvider";
import { ListNflGamesQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

function formatGame(g: Awaited<ReturnType<typeof getNflGames>>[number]) {
  return {
    id: g.id,
    week: g.week,
    season: g.season,
    seasonType: g.seasonType,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    kickoffAt: g.kickoffAt.toISOString(),
    gameStatus: g.gameStatus,
    spread: g.spread,
    favoredTeam: g.favoredTeam,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    updatedAt: g.updatedAt.toISOString(),
  };
}

// GET /nfl-games/upcoming  (must be before /nfl-games with dynamic params)
router.get("/nfl-games/upcoming", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const weeks = getUpcomingWeeks();

  const results = await Promise.all(
    weeks.map(async ({ week, season, seasonType }) => {
      const games = await getNflGames(week, season, seasonType as NflSeasonType);
      const label =
        seasonType === "preseason"
          ? `Preseason Week ${week}`
          : `Week ${week}`;
      return { week, season, seasonType, label, games: games.map(formatGame) };
    }),
  );

  res.json(results);
});

// GET /nfl-games
router.get("/nfl-games", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const params = ListNflGamesQueryParams.safeParse(req.query);
  const { week: currentWeek, season: currentSeason, seasonType: currentSeasonType } = getCurrentNflWeek();
  const week = params.success && params.data.week ? Number(params.data.week) : currentWeek;
  const season = params.success && params.data.season ? Number(params.data.season) : currentSeason;
  const seasonType: NflSeasonType =
    (params.success && (params.data as any).seasonType) || currentSeasonType;

  const games = await getNflGames(week, season, seasonType);
  res.json(games.map(formatGame));
});

// GET /nfl-games/current-week
router.get("/nfl-games/current-week", (_req, res): void => {
  const { week, season, seasonType } = getCurrentNflWeek();
  res.json({ week, season, seasonType });
});

export default router;
