// Mock NFL odds/games data provider
// Replace with real API (The Odds API, ESPN, etc.) when ready

export interface MockNflGame {
  id: string;
  week: number;
  season: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  gameStatus: "scheduled" | "in_progress" | "final" | "postponed";
  spread: number | null; // negative = home favored, positive = home underdog
  favoredTeam: "home" | "away" | null;
  homeScore: number | null;
  awayScore: number | null;
  updatedAt: Date;
}

const NFL_TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB",  "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV",  "MIA", "MIN", "NE",  "NO",  "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF",  "TB",  "TEN", "WAS",
];

function getCurrentNflWeekAndSeason(): { week: number; season: number } {
  const now = new Date();
  const year = now.getFullYear();
  // NFL season typically starts first full week of September
  const seasonStart = new Date(year, 8, 5); // ~Sept 5
  if (now < seasonStart) {
    return { week: 18, season: year - 1 }; // offseason, show last season week 18
  }
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weekNum = Math.min(18, Math.floor((now.getTime() - seasonStart.getTime()) / msPerWeek) + 1);
  return { week: weekNum, season: year };
}

function generateMockGames(week: number, season: number): MockNflGame[] {
  // Deterministic game pairs for a given week using team index shuffling
  const seed = week + season * 100;
  const shuffled = [...NFL_TEAMS].sort((a, b) => {
    const ha = hashCode(`${seed}-${a}`);
    const hb = hashCode(`${seed}-${b}`);
    return ha - hb;
  });

  const games: MockNflGame[] = [];
  const sundayBase = getSundayOfWeek(week, season);
  const thursday = new Date(sundayBase);
  thursday.setDate(sundayBase.getDate() - 3);
  thursday.setHours(20, 20, 0, 0); // 8:20 PM ET Thursday

  const monday = new Date(sundayBase);
  monday.setDate(sundayBase.getDate() + 1);
  monday.setHours(20, 15, 0, 0); // 8:15 PM ET Monday

  // 1 Thursday night game
  games.push(makeGame(`${season}-W${week}-TNF`, week, season, shuffled[0], shuffled[1], thursday, seed));

  // 6 Sunday games (1pm, 4pm, 8:20pm)
  const sundaySlots = [
    new Date(sundayBase.getTime() + 13 * 3600000), // 1 PM
    new Date(sundayBase.getTime() + 13 * 3600000),
    new Date(sundayBase.getTime() + 13 * 3600000),
    new Date(sundayBase.getTime() + 16.5 * 3600000), // 4:30 PM
    new Date(sundayBase.getTime() + 16.5 * 3600000),
    new Date(sundayBase.getTime() + 20.333 * 3600000), // 8:20 PM SNF
  ];

  for (let i = 0; i < 6; i++) {
    games.push(makeGame(`${season}-W${week}-S${i + 1}`, week, season, shuffled[2 + i * 2], shuffled[3 + i * 2], sundaySlots[i], seed + i));
  }

  // 1 Monday night game
  games.push(makeGame(`${season}-W${week}-MNF`, week, season, shuffled[14], shuffled[15], monday, seed + 10));

  return games;
}

function makeGame(id: string, week: number, season: number, homeTeam: string, awayTeam: string, kickoffAt: Date, seed: number): MockNflGame {
  const spread = spreadFromSeed(seed);
  const favoredTeam = spread < 0 ? "home" : spread > 0 ? "away" : null;
  const now = new Date();
  const isOver = kickoffAt < new Date(now.getTime() - 3.5 * 3600000);
  const inProgress = kickoffAt < now && !isOver;

  let homeScore: number | null = null;
  let awayScore: number | null = null;
  let gameStatus: MockNflGame["gameStatus"] = "scheduled";

  if (isOver) {
    gameStatus = "final";
    const scores = scoresFromSeed(seed);
    homeScore = scores[0];
    awayScore = scores[1];
  } else if (inProgress) {
    gameStatus = "in_progress";
    const scores = scoresFromSeed(seed);
    homeScore = Math.floor(scores[0] * 0.6);
    awayScore = Math.floor(scores[1] * 0.6);
  }

  return {
    id,
    week,
    season,
    homeTeam,
    awayTeam,
    kickoffAt,
    gameStatus,
    spread,
    favoredTeam,
    homeScore,
    awayScore,
    updatedAt: new Date(),
  };
}

function getSundayOfWeek(week: number, season: number): Date {
  const seasonStart = new Date(season, 8, 5); // ~Sept 5
  const date = new Date(seasonStart.getTime() + (week - 1) * 7 * 24 * 3600000);
  // Find the next Sunday
  const dayOfWeek = date.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  date.setDate(date.getDate() + daysUntilSunday);
  date.setHours(0, 0, 0, 0);
  return date;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function spreadFromSeed(seed: number): number {
  const options = [-14, -10.5, -7, -6.5, -5.5, -4.5, -3.5, -3, -2.5, -1.5, 1.5, 2.5, 3, 3.5, 4.5, 5.5, 6.5, 7, 10.5, 14];
  return options[Math.abs(seed) % options.length];
}

function scoresFromSeed(seed: number): [number, number] {
  const homeOptions = [10, 13, 17, 20, 21, 24, 27, 28, 30, 31, 34, 35, 38, 41, 42];
  const margins = [3, 4, 6, 7, 10, 13, 14, 17, 20, 21];
  const homeScore = homeOptions[Math.abs(seed) % homeOptions.length];
  const margin = margins[Math.abs(seed * 7) % margins.length];
  const awayScore = seed % 2 === 0 ? homeScore - margin : homeScore + margin;
  return [homeScore, Math.max(0, awayScore)];
}

export function getMockNflGames(week?: number, season?: number): MockNflGame[] {
  const current = getCurrentNflWeekAndSeason();
  const w = week ?? current.week;
  const s = season ?? current.season;
  return generateMockGames(w, s);
}

export function getMockNflGame(gameId: string): MockNflGame | undefined {
  // Parse week and season from gameId format: `SEASON-WWEEK-TYPE`
  const match = gameId.match(/^(\d+)-W(\d+)-/);
  if (!match) return undefined;
  const season = parseInt(match[1]);
  const week = parseInt(match[2]);
  return generateMockGames(week, season).find((g) => g.id === gameId);
}

export function getCurrentNflWeek(): { week: number; season: number } {
  return getCurrentNflWeekAndSeason();
}

export function calculateAtsResult(
  homeScore: number,
  awayScore: number,
  lockedSpread: number,
  spreadTeam: "home" | "away"
): "home" | "away" | "push" {
  // lockedSpread is always the spread for the spreadTeam (negative = favored)
  // If spreadTeam = 'home', home covers if: homeScore + lockedSpread > awayScore
  // If spreadTeam = 'away', away covers if: awayScore + lockedSpread > homeScore
  let adjustedMargin: number;
  if (spreadTeam === "home") {
    adjustedMargin = homeScore + lockedSpread - awayScore;
  } else {
    adjustedMargin = awayScore + lockedSpread - homeScore;
  }

  if (adjustedMargin > 0) return spreadTeam;
  if (adjustedMargin < 0) return spreadTeam === "home" ? "away" : "home";
  return "push";
}
