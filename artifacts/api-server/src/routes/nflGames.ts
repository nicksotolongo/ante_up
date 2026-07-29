import { Router, type IRouter } from "express";
import { getNflGames, getCurrentNflWeek } from "../lib/espnProvider";
import { ListNflGamesQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /nfl-games
router.get("/nfl-games", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const params = ListNflGamesQueryParams.safeParse(req.query);
  const { week: currentWeek, season: currentSeason } = getCurrentNflWeek();
  const week = params.success && params.data.week ? Number(params.data.week) : currentWeek;
  const season = params.success && params.data.season ? Number(params.data.season) : currentSeason;

  const games = await getNflGames(week, season);

  res.json(games.map((g) => ({
    id: g.id,
    week: g.week,
    season: g.season,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    kickoffAt: g.kickoffAt.toISOString(),
    gameStatus: g.gameStatus,
    spread: g.spread,
    favoredTeam: g.favoredTeam,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    updatedAt: g.updatedAt.toISOString(),
  })));
});

// GET /nfl-games/current-week
router.get("/nfl-games/current-week", (_req, res): void => {
  const { week, season } = getCurrentNflWeek();
  res.json({ week, season });
});

export default router;
