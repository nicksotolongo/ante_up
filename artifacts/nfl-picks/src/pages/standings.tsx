import { useState } from "react";
import { useParams } from "wouter";
import {
  useGetSeasonStandings,
  useGetEventStandings,
  useListPickEvents,
} from "@workspace/api-client-react";
import { Shell } from "@/components/layout";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ── helpers ──────────────────────────────────────────────────────────────────

function Avatar({ name }: { name?: string | null }) {
  return (
    <div className="w-6 h-6 rounded-none bg-muted flex items-center justify-center text-[10px] font-bold border border-border shrink-0">
      {name?.[0] ?? "?"}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const gold = rank === 1;
  return (
    <span
      className={`font-mono font-black text-base tabular-nums ${gold ? "text-yellow-600" : "text-foreground"}`}
    >
      {rank}
    </span>
  );
}

// ── Season tab ────────────────────────────────────────────────────────────────

function SeasonStandings({ leagueId }: { leagueId: number }) {
  const { data: standings, isLoading } = useGetSeasonStandings(leagueId, {
    query: { enabled: !!leagueId },
  });

  if (isLoading) return <Skeleton />;
  if (!standings?.length)
    return <Empty label="No season data yet — complete an event to see standings." />;

  return (
    <div className="border border-border bg-card overflow-x-auto">
      <Table>
        <TableHeader className="bg-secondary/50">
          <TableRow>
            <TableHead className="w-12 text-center font-bold text-xs uppercase tracking-wider text-foreground">#</TableHead>
            <TableHead className="font-bold text-xs uppercase tracking-wider text-foreground">Player</TableHead>
            <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground">Pts</TableHead>
            <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground hidden sm:table-cell">Wins</TableHead>
            <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground">Record</TableHead>
            <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground hidden sm:table-cell">Money</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {standings.map((entry) => (
            <TableRow
              key={entry.userId}
              className={`hover:bg-muted/30 ${entry.rank === 1 ? "bg-yellow-50/30 dark:bg-yellow-900/10" : ""}`}
            >
              <TableCell className="text-center"><RankBadge rank={entry.rank} /></TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar name={entry.displayName} />
                  <span className="font-bold">{entry.displayName || "Unknown"}</span>
                </div>
              </TableCell>
              <TableCell className="text-right font-mono font-black text-lg">{entry.totalPoints}</TableCell>
              <TableCell className="text-right font-mono hidden sm:table-cell">{entry.weeklyWins}</TableCell>
              <TableCell className="text-right font-mono">
                <span className="text-pick-win">{entry.normalCorrect}</span>
                <span className="text-muted-foreground">-</span>
                <span className="text-pick-loss">{(entry.normalTotal ?? 0) - (entry.normalCorrect ?? 0)}</span>
              </TableCell>
              <TableCell className="text-right font-mono text-sm hidden sm:table-cell">
                {entry.moneyCorrect}/{entry.moneyTotal}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Weekly tab ────────────────────────────────────────────────────────────────

const SCOREABLE_STATUSES = ["open", "locked", "revealed", "finalized"] as const;

function WeeklyStandings({ leagueId }: { leagueId: number }) {
  const { data: events } = useListPickEvents(leagueId, {
    query: { enabled: !!leagueId },
  });

  // Default to the most recent event that has picks activity (non-draft)
  const scoreable = (events ?? [])
    .filter((e) => (SCOREABLE_STATUSES as readonly string[]).includes(e.status))
    .sort((a, b) => b.id - a.id);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const eventId = selectedId ?? scoreable[0]?.id ?? null;
  const selectedEvent = (events ?? []).find((e) => e.id === eventId);

  const { data: standings, isLoading } = useGetEventStandings(
    leagueId,
    eventId ?? 0,
    { query: { enabled: !!leagueId && !!eventId } },
  );

  const isLive = selectedEvent && ["open", "locked"].includes(selectedEvent.status);
  const isRevealed = selectedEvent && ["revealed", "finalized"].includes(selectedEvent.status);

  return (
    <div className="space-y-4">
      {/* Event selector */}
      {scoreable.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground shrink-0">Week</span>
          <select
            value={eventId ?? ""}
            onChange={(e) => setSelectedId(Number(e.target.value))}
            className="border border-border bg-card font-bold text-sm px-3 py-1.5 rounded-none focus:outline-none focus:ring-2 focus:ring-foreground w-full"
          >
            {scoreable.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}{" "}
                {ev.status === "open" ? "— Live" :
                 ev.status === "locked" ? "— In Progress" :
                 ev.status === "revealed" ? "— Results" :
                 ev.status === "finalized" ? "— Final" : ""}
              </option>
            ))}
          </select>
          {isLive && (
            <span className="shrink-0 text-[10px] font-black uppercase tracking-widest bg-green-600 text-white px-2 py-0.5">
              Live
            </span>
          )}
        </div>
      )}

      {!eventId ? (
        <Empty label="No events available yet." />
      ) : isLoading ? (
        <Skeleton />
      ) : !standings?.length ? (
        <Empty label="No picks submitted for this week." />
      ) : (
        <div className="border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow>
                <TableHead className="w-12 text-center font-bold text-xs uppercase tracking-wider text-foreground">#</TableHead>
                <TableHead className="font-bold text-xs uppercase tracking-wider text-foreground">Player</TableHead>
                <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground">Pts</TableHead>
                {isLive && (
                  <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground hidden sm:table-cell">
                    Max
                  </TableHead>
                )}
                <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground">Record</TableHead>
                <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground hidden sm:table-cell">Money</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {standings.map((entry) => (
                <TableRow
                  key={entry.userId}
                  className={[
                    "hover:bg-muted/30",
                    entry.rank === 1 ? "bg-yellow-50/30 dark:bg-yellow-900/10" : "",
                    entry.isEliminated ? "opacity-50" : "",
                  ].join(" ")}
                >
                  <TableCell className="text-center">
                    <RankBadge rank={entry.rank} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar name={entry.displayName} />
                      <div className="flex flex-col min-w-0">
                        <span className="font-bold leading-tight">{entry.displayName || "Unknown"}</span>
                        {entry.isEliminated && isLive && (
                          <span className="text-[10px] uppercase text-muted-foreground tracking-wider font-bold">
                            Eliminated
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono font-black text-lg tabular-nums">
                    {entry.points}
                  </TableCell>
                  {isLive && (
                    <TableCell className="text-right font-mono text-muted-foreground text-sm tabular-nums hidden sm:table-cell">
                      {entry.maxPossible}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono">
                    <span className="text-pick-win">{entry.normalCorrect}</span>
                    <span className="text-muted-foreground">-</span>
                    <span className="text-pick-loss">{(entry.normalTotal ?? 0) - (entry.normalCorrect ?? 0)}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm hidden sm:table-cell">
                    {entry.moneyCorrect}/{entry.moneyTotal}
                    {isRevealed && entry.moneyCorrect === 1 && (
                      <span className="ml-1 text-pick-win text-xs">✓</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {isLive && (
            <div className="border-t border-border px-4 py-2 bg-secondary/20">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-bold">
                Max = maximum achievable points if all remaining picks win
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared UI pieces ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-12 bg-muted border border-border" />
      ))}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="p-8 text-center border border-border bg-card">
      <p className="text-muted-foreground uppercase tracking-widest text-sm font-bold">{label}</p>
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

type Tab = "season" | "weekly";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "season", label: "Season" },
    { id: "weekly", label: "This Week" },
  ];
  return (
    <div className="flex border-b-2 border-foreground gap-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={[
            "px-5 py-2 text-sm font-black uppercase tracking-widest transition-colors",
            active === t.id
              ? "bg-foreground text-background"
              : "bg-card text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Standings() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId || "0");
  const [tab, setTab] = useState<Tab>("season");

  return (
    <Shell title="Standings" leagueId={leagueId} backTo={`/leagues/${leagueId}`}>
      <div className="space-y-5">
        <div className="border-b-4 border-foreground pb-2">
          <h2 className="text-2xl font-serif font-black uppercase tracking-tight">Leaderboard</h2>
        </div>

        <TabBar active={tab} onChange={setTab} />

        {tab === "season" ? (
          <SeasonStandings leagueId={leagueId} />
        ) : (
          <WeeklyStandings leagueId={leagueId} />
        )}
      </div>
    </Shell>
  );
}
