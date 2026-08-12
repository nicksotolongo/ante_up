/**
 * ESPN public scoreboard API — real game schedules and final scores.
 * Spreads come from The Odds API (ODDS_API_KEY); falls back to mock if unavailable.
 * No key required for schedules/scores.
 */

export type NflSeasonType = "preseason" | "regular";

export interface NflGame {
  id: string; // ESPN game ID (e.g. "401671789")
  week: number;
  season: number;
  seasonType: NflSeasonType;
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

function toEspnSeasonType(t: NflSeasonType): number {
  return t === "preseason" ? 1 : 2;
}

export async function getNflGames(
  week: number,
  season: number,
  seasonType: NflSeasonType = "regular",
): Promise<NflGame[]> {
  const key = `${season}-${seasonType}-W${week}`;
  const cached = cache.get(key);
  if (cached && isCacheValid(cached)) return cached.data;

  try {
    const espnSeasonType = toEspnSeasonType(seasonType);
    const url =
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
      `?seasontype=${espnSeasonType}&week=${week}&dates=${season}`;

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

      games.push({
        id: event.id,
        week,
        season,
        seasonType,
        homeTeam,
        awayTeam,
        kickoffAt: new Date(comp.startDate ?? event.date),
        gameStatus,
        spread: null,      // filled in below after odds fetch
        favoredTeam: null,
        homeScore: gameStatus !== "scheduled" ? parseInt(homeComp.score ?? "0", 10) : null,
        awayScore: gameStatus !== "scheduled" ? parseInt(awayComp.score ?? "0", 10) : null,
        updatedAt: new Date(),
      });
    }

    // Overlay real spreads from The Odds API; fall back to mock per game if missing
    // Preseason lines are often unavailable — mock spread is fine as a fallback
    await overlayOdds(games, week, season);

    const isFinished = games.length > 0 && games.every(g => g.gameStatus === "final" || g.gameStatus === "postponed");
    cache.set(key, { data: games, fetchedAt: Date.now(), isFinished });
    return games;
  } catch (err) {
    console.error(`[ESPN] Failed to fetch ${seasonType} Week ${week} ${season}:`, err);
    return seasonType === "regular" ? fallbackMockGames(week, season) : [];
  }
}

export async function getNflGame(
  gameId: string,
  week: number,
  season: number,
  seasonType: NflSeasonType = "regular",
): Promise<NflGame | undefined> {
  const games = await getNflGames(week, season, seasonType);
  return games.find(g => g.id === gameId);
}

/** Find a game by home+away team names (for matching against DB records). */
export async function getNflGameByTeams(
  homeTeam: string,
  awayTeam: string,
  week: number,
  season: number,
  seasonType: NflSeasonType = "regular",
): Promise<NflGame | undefined> {
  const games = await getNflGames(week, season, seasonType);
  return games.find(
    g =>
      g.homeTeam.toLowerCase() === homeTeam.toLowerCase() &&
      g.awayTeam.toLowerCase() === awayTeam.toLowerCase(),
  );
}

// ---------------------------------------------------------------------------
// Current week helpers
// ---------------------------------------------------------------------------

export function getCurrentNflWeek(): { week: number; season: number; seasonType: NflSeasonType } {
  const now = new Date();
  const year = now.getFullYear();

  // Preseason runs roughly Aug 1 – Sep 3; regular season starts ~Sep 4
  const preseasonStart = new Date(year, 7, 1);   // Aug 1
  const regularSeasonStart = new Date(year, 8, 4); // Sep 4

  if (now >= preseasonStart && now < regularSeasonStart) {
    const weekNum = Math.min(4, Math.floor((now.getTime() - preseasonStart.getTime()) / (7 * 24 * 3600_000)) + 1);
    return { week: weekNum, season: year, seasonType: "preseason" };
  }

  if (now < preseasonStart) {
    // Off-season: show last regular-season week of prior year
    return { week: 18, season: year - 1, seasonType: "regular" };
  }

  const weekNum = Math.min(18, Math.floor((now.getTime() - regularSeasonStart.getTime()) / (7 * 24 * 3600_000)) + 1);
  return { week: weekNum, season: year, seasonType: "regular" };
}

/** Returns the next two upcoming NFL weeks (current + next). */
export function getUpcomingWeeks(): Array<{ week: number; season: number; seasonType: NflSeasonType }> {
  const current = getCurrentNflWeek();
  const { week, season, seasonType } = current;

  const maxWeek = seasonType === "preseason" ? 4 : 18;

  if (week < maxWeek) {
    return [current, { week: week + 1, season, seasonType }];
  }

  if (seasonType === "preseason") {
    // Last preseason week → next is regular-season Week 1
    return [current, { week: 1, season, seasonType: "regular" }];
  }

  // Last regular-season week — just return current
  return [current];
}

// ---------------------------------------------------------------------------
// Odds overlay
// ---------------------------------------------------------------------------

import { fetchNflOdds } from "./oddsProvider";

async function overlayOdds(games: NflGame[], week: number, season: number): Promise<void> {
  try {
    const odds = await fetchNflOdds();
    for (const g of games) {
      const match = odds.find(o => o.homeTeam === g.homeTeam && o.awayTeam === g.awayTeam);
      if (match) {
        g.spread = match.spread;
        g.favoredTeam = match.favoredTeam;
      } else {
        // No line from Odds API (common for preseason) — fall back to mock
        const fb = mockSpread(g.homeTeam, g.awayTeam, week, season);
        g.spread = fb.spread;
        g.favoredTeam = fb.favoredTeam;
      }
    }
  } catch (err) {
    console.warn("[Odds] Failed to overlay odds, using mock spreads:", err);
    for (const g of games) {
      const fb = mockSpread(g.homeTeam, g.awayTeam, week, season);
      g.spread = fb.spread;
      g.favoredTeam = fb.favoredTeam;
    }
  }
}

function normalizeAbbr(abbr: string): string {
  // ESPN sometimes uses "WSH" or "WAS" interchangeably — normalise a few known cases
  const map: Record<string, string> = { WSH: "WAS", LA: "LAR" };
  return map[abbr.toUpperCase()] ?? abbr.toUpperCase();
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
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
    seasonType: "regular" as NflSeasonType,
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
