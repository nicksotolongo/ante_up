/**
 * The Odds API — real NFL point spreads.
 * https://the-odds-api.com
 * Uses ODDS_API_KEY env secret. Falls back gracefully if unavailable.
 */

export interface GameOdds {
  /** Home team abbreviation (e.g. "KC") */
  homeTeam: string;
  /** Away team abbreviation (e.g. "BUF") */
  awayTeam: string;
  /**
   * Home-team spread from the home team's perspective.
   * Negative = home favored (e.g. -3.5 means home -3.5).
   * Positive = home underdog (e.g. +3.5 means home +3.5).
   */
  spread: number;
  favoredTeam: "home" | "away" | null;
}

// Cache: key = "YYYY-MM-DD" (week window start), value = list of odds + fetch time
const oddsCache = new Map<string, { data: GameOdds[]; fetchedAt: number }>();
const ODDS_CACHE_TTL = 30 * 60 * 1000; // 30 min — lines don't move that fast

/** Fetch NFL spreads for all upcoming/recent games from The Odds API. */
export async function fetchNflOdds(): Promise<GameOdds[]> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.warn("[Odds] ODDS_API_KEY not set — skipping real spreads");
    return [];
  }

  const cacheKey = new Date().toISOString().slice(0, 10); // daily bucket
  const cached = oddsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ODDS_CACHE_TTL) return cached.data;

  try {
    const url =
      "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds" +
      `?apiKey=${apiKey}&regions=us&markets=spreads&oddsFormat=american&dateFormat=iso`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[Odds] API error ${res.status}:`, body);
      return [];
    }

    const json = await res.json() as OddsApiGame[];
    const data: GameOdds[] = [];

    for (const game of json) {
      const homeAbbr = fullNameToAbbr(game.home_team);
      const awayAbbr = fullNameToAbbr(game.away_team);
      if (!homeAbbr || !awayAbbr) continue;

      // Prefer DraftKings or FanDuel; fall back to first bookmaker with spreads
      const bookmaker =
        game.bookmakers.find(b => b.key === "draftkings") ??
        game.bookmakers.find(b => b.key === "fanduel") ??
        game.bookmakers[0];
      if (!bookmaker) continue;

      const spreadsMarket = bookmaker.markets.find(m => m.key === "spreads");
      if (!spreadsMarket) continue;

      const homeOutcome = spreadsMarket.outcomes.find(o => o.name === game.home_team);
      if (!homeOutcome) continue;

      const spread = homeOutcome.point; // negative = home favored
      const favoredTeam: "home" | "away" | null =
        spread < 0 ? "home" : spread > 0 ? "away" : null;

      data.push({ homeTeam: homeAbbr, awayTeam: awayAbbr, spread, favoredTeam });
    }

    console.log(`[Odds] Fetched ${data.length} spreads (${json.length} games from API)`);
    oddsCache.set(cacheKey, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    console.error("[Odds] Fetch failed:", err);
    return [];
  }
}

/**
 * Look up the spread for a specific game.
 * Returns null if The Odds API doesn't have it (game may be in the future or past).
 */
export async function getSpreadForGame(
  homeTeam: string,
  awayTeam: string,
): Promise<{ spread: number; favoredTeam: "home" | "away" | null } | null> {
  const odds = await fetchNflOdds();
  const match = odds.find(g => g.homeTeam === homeTeam && g.awayTeam === awayTeam);
  return match ? { spread: match.spread, favoredTeam: match.favoredTeam } : null;
}

// ---------------------------------------------------------------------------
// The Odds API types
// ---------------------------------------------------------------------------
interface OddsApiGame {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}
interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
}
interface OddsApiMarket {
  key: string;
  outcomes: Array<{ name: string; price: number; point: number }>;
}

// ---------------------------------------------------------------------------
// Full team name → abbreviation map (matches ESPN normalizations)
// ---------------------------------------------------------------------------
const TEAM_NAME_TO_ABBR: Record<string, string> = {
  "Arizona Cardinals": "ARI",
  "Atlanta Falcons": "ATL",
  "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR",
  "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN",
  "Detroit Lions": "DET",
  "Green Bay Packers": "GB",
  "Houston Texans": "HOU",
  "Indianapolis Colts": "IND",
  "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV",
  "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LAR",
  "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN",
  "New England Patriots": "NE",
  "New Orleans Saints": "NO",
  "New York Giants": "NYG",
  "New York Jets": "NYJ",
  "Philadelphia Eagles": "PHI",
  "Pittsburgh Steelers": "PIT",
  "Seattle Seahawks": "SEA",
  "San Francisco 49ers": "SF",
  "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN",
  "Washington Commanders": "WAS",
  // legacy names The Odds API may still return
  "Washington Football Team": "WAS",
  "Washington Redskins": "WAS",
  "Oakland Raiders": "LV",
  "San Diego Chargers": "LAC",
  "St. Louis Rams": "LAR",
};

function fullNameToAbbr(name: string): string | null {
  return TEAM_NAME_TO_ABBR[name] ?? null;
}
