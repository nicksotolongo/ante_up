/**
 * ESPN public scoreboard API — real game schedules and final scores.
 * Spreads are still deterministic mock values until an odds API is added.
 * No API key required.
 */

export interface NflGame {
  id: string; // ESPN game ID (e.g. "401671789")
  week: number;
  season: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  gameStatus: "scheduled" | "in_progress" | "final" | "postponed";
  spread: number | null;
  favoredTeam: "home" | "away" | null;
  homeScore: number | null;
  awayScore: number | null;
  updatedAt: Date;
}

// In-memory cache — 5 min TTL for live games, 30 min for finished weeks
const cache = new Map<string, { data: NflGame[]; fetchedAt: number; isFinished: boolean }>();

function isCacheValid(entry: { fetchedAt: number; isFinished: boolean }): boolean {
  const ttl = entry.isFinished ? 30 * 60 * 1000 : 5 * 60 * 1000;
  return Date.now() - entry.fetchedAt < ttl;
}

export async function getNflGames(week: number, season: number): Promise<NflGame[]> {
  const key = `${season}-W${week}`;
  const cached = cache.get(key);
  if (cached && isCacheValid(cached)) return cached.data;

  try {
    // seasontype=2 = regular season; use dates param for the season year
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
      `?seasontype=2&week=${week}&dates=${season}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`ESPN ${res.status}`);

    const json = await res.json() as any;
    const games: NflGame[] = [];

    for (const event of json.events ?? []) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const homeComp = comp.competitors?.find((c: any) => c.homeAway === "home");
      const awayComp = comp.competitors?.find((c: any) => c.homeAway === "away");
      if (!homeComp || !awayComp) continue;

      const statusName: string = event.status?.type?.name ?? "";
      const gameStatus: NflGame["gameStatus"] =
        statusName === "STATUS_FINAL" || statusName === "STATUS_FINAL_OVERTIME"
          ? "final"
          : statusName.includes("STATUS_IN_")
          ? "in_progress"
          : statusName === "STATUS_POSTPONED"
          ? "postponed"
          : "scheduled";

      const homeTeam = normalizeAbbr(homeComp.team?.abbreviation ?? "");
      const awayTeam = normalizeAbbr(awayComp.team?.abbreviation ?? "");
      const { spread, favoredTeam } = mockSpread(homeTeam, awayTeam, week, season);

      games.push({
        id: event.id,
        week,
        season,
        homeTeam,
        awayTeam,
        kickoffAt: new Date(comp.startDate ?? event.date),
        gameStatus,
        spread,
        favoredTeam,
        homeScore: gameStatus !== "scheduled" ? parseInt(homeComp.score ?? "0", 10) : null,
        awayScore: gameStatus !== "scheduled" ? parseInt(awayComp.score ?? "0", 10) : null,
        updatedAt: new Date(),
      });
    }

    const isFinished = games.length > 0 && games.every(g => g.gameStatus === "final" || g.gameStatus === "postponed");
    cache.set(key, { data: games, fetchedAt: Date.now(), isFinished });
    return games;
  } catch (err) {
    console.error(`[ESPN] Failed to fetch Week ${week} ${season}:`, err);
    return fallbackMockGames(week, season);
  }
}

export async function getNflGame(gameId: string, week: number, season: number): Promise<NflGame | undefined> {
  const games = await getNflGames(week, season);
  return games.find(g => g.id === gameId);
}

/** Find a game by home+away team names (for matching against DB records). */
export async function getNflGameByTeams(
  homeTeam: string,
  awayTeam: string,
  week: number,
  season: number,
): Promise<NflGame | undefined> {
  const games = await getNflGames(week, season);
  return games.find(
    g => g.homeTeam === homeTeam && g.awayTeam === awayTeam,
  );
}

// ---------------------------------------------------------------------------
// ESPN uses a few different abbreviations than the standard short codes
// ---------------------------------------------------------------------------
const ESPN_ABBR_MAP: Record<string, string> = {
  WSH: "WAS",
  LVR: "LV",
  JAC: "JAX",
};
function normalizeAbbr(abbr: string): string {
  return ESPN_ABBR_MAP[abbr.toUpperCase()] ?? abbr.toUpperCase();
}

// ---------------------------------------------------------------------------
// Mock spread generator — deterministic by teams + week, used until odds API
// ---------------------------------------------------------------------------
function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function mockSpread(
  homeTeam: string,
  awayTeam: string,
  week: number,
  season: number,
): { spread: number; favoredTeam: "home" | "away" | null } {
  const seed = hashCode(`${homeTeam}-${awayTeam}-${week}-${season}`);
  const options = [
    -14, -10.5, -7, -6.5, -5.5, -4.5, -3.5, -3, -2.5, -1.5,
    1.5, 2.5, 3, 3.5, 4.5, 5.5, 6.5, 7, 10.5, 14,
  ];
  const spread = options[seed % options.length];
  const favoredTeam: "home" | "away" | null =
    spread < 0 ? "home" : spread > 0 ? "away" : null;
  return { spread, favoredTeam };
}

// ---------------------------------------------------------------------------
// Fallback: generate deterministic mock games if ESPN is unreachable
// ---------------------------------------------------------------------------
import { getMockNflGames } from "./mockNflGames";
function fallbackMockGames(week: number, season: number): NflGame[] {
  return getMockNflGames(week, season).map(g => ({
    id: g.id,
    week: g.week,
    season: g.season,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    kickoffAt: g.kickoffAt,
    gameStatus: g.gameStatus,
    spread: g.spread,
    favoredTeam: g.favoredTeam,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    updatedAt: g.updatedAt,
  }));
}

export function getCurrentNflWeek(): { week: number; season: number } {
  const now = new Date();
  const year = now.getFullYear();
  const seasonStart = new Date(year, 8, 5); // ~Sept 5
  if (now < seasonStart) return { week: 18, season: year - 1 };
  const weekNum = Math.min(18, Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 3600000)) + 1);
  return { week: weekNum, season: year };
}
