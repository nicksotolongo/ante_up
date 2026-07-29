import { Router, type IRouter } from "express";
import { getMockNflGames, getCurrentNflWeek } from "../lib/mockNflGames";
import { ListNflGamesQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /nfl-games
router.get("/nfl-games", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const params = ListNflGamesQueryParams.safeParse(req.query);
  const week = params.success ? params.data.week : undefined;
  const season = params.success ? params.data.season : undefined;

  const games = getMockNflGames(week ? Number(week) : undefined, season ? Number(season) : undefined);

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
router.get("/nfl-games/current-week", async (_req, res): Promise<void> => {
  const { week, season } = getCurrentNflWeek();
  res.json({ week, season });
});

export default router;
