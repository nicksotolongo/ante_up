import { useParams } from "wouter";
import { useGetLiveBoard } from "@workspace/api-client-react";
import { Shell } from "@/components/layout";
import { cn } from "@/lib/utils";

export default function LiveBoardPage() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId || "0");
  const eventId = parseInt(params.eventId || "0");

  const { data: board, isLoading } = useGetLiveBoard(leagueId, eventId, {
    query: { enabled: !!leagueId && !!eventId, refetchInterval: 10000 }
  });

  if (isLoading) {
    return <Shell leagueId={leagueId} backTo={`/leagues/${leagueId}`}><div className="animate-pulse h-64 bg-muted"></div></Shell>;
  }

  if (!board) {
    return <Shell leagueId={leagueId} backTo={`/leagues/${leagueId}`}><div className="p-8 text-center">Board not found</div></Shell>;
  }

  const { event, games, rows, revealed } = board;

  return (
    <Shell title="Live Board" leagueId={leagueId} backTo={`/leagues/${leagueId}`}>
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-2 border-b-4 border-foreground pb-2">
          <div>
            <h2 className="text-2xl font-serif font-black uppercase tracking-tight leading-none">{event.name}</h2>
            <div className="text-sm font-mono text-muted-foreground uppercase mt-1">Week {event.nflWeek} • {event.status}</div>
          </div>
          <div className="flex gap-4 text-xs font-mono font-bold uppercase tracking-wider">
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-pick-win border border-border"></div> Win</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-pick-loss border border-border"></div> Loss</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-pick-pending border border-border"></div> Pending</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 border-[3px] border-foreground"></div> Money</div>
          </div>
        </div>

        {!revealed ? (
          <div className="p-12 text-center border-2 border-dashed border-border bg-card">
            <h3 className="text-xl font-serif font-bold uppercase mb-2">Picks are Locked</h3>
            <p className="text-muted-foreground">The board will be revealed at {new Date(event.revealAt).toLocaleString()}</p>
          </div>
        ) : (
          <div className="relative border-2 border-foreground bg-card overflow-hidden">
            <div className="overflow-x-auto w-full">
              <table className="w-full text-sm border-collapse min-w-max">
                <thead>
                  <tr className="border-b-2 border-foreground bg-secondary/50">
                    <th className="p-3 text-left font-bold uppercase tracking-wider text-xs border-r-2 border-foreground sticky left-0 z-20 bg-secondary w-40 sm:w-48 shadow-[1px_0_0_0_hsl(var(--foreground))]">
                      Player
                    </th>
                    {games.map(game => (
                      <th key={game.id} className="p-2 text-center border-r border-border min-w-[80px] w-[80px]">
                        <div className="flex flex-col gap-1 items-center">
                          <div className="font-mono font-black text-xs">
                            {game.nflGame?.awayTeam}
                            <br/>@<br/>
                            {game.nflGame?.homeTeam}
                          </div>
                          {game.lockedSpread != null && game.spreadTeam && (
                            <div className="text-[10px] font-mono text-muted-foreground">
                              {game.spreadTeam === "away" ? game.nflGame?.awayTeam : game.nflGame?.homeTeam} {game.lockedSpread > 0 ? "+" : ""}{game.lockedSpread}
                            </div>
                          )}
                          {game.result && (
                            <div className="text-[10px] uppercase font-bold text-muted-foreground bg-background px-1 border border-border mt-1">
                              {game.result}
                            </div>
                          )}
                          {game.nflGame?.homeScore != null ? (
                            <div className="text-[10px] font-mono mt-1 flex items-center gap-1">
                              <span className="font-bold">{game.nflGame.awayScore}-{game.nflGame.homeScore}</span>
                              {game.nflGame.gameStatus === "in_progress" && (
                                <span className="uppercase font-bold text-[9px] text-red-600 animate-pulse">Live</span>
                              )}
                              {game.nflGame.gameStatus === "final" && (
                                <span className="uppercase text-[9px] text-muted-foreground">F</span>
                              )}
                            </div>
                          ) : (
                            <div className="text-[10px] font-mono text-muted-foreground mt-1">TBD</div>
                          )}
                        </div>
                      </th>
                    ))}
                    {event.tiebreakerQuestion && (
                      <th className="p-2 text-center font-bold uppercase tracking-wider text-[10px] border-l border-border bg-secondary/50 w-16 hidden sm:table-cell">
                        TB
                      </th>
                    )}
                    <th className="p-3 text-center font-bold uppercase tracking-wider text-[10px] border-l-2 border-foreground sticky right-0 z-10 bg-secondary/90 w-16">
                      Pts
                    </th>
                    <th className="p-3 text-center font-bold uppercase tracking-wider text-[10px] border-l border-border bg-secondary/50 w-16">
                      Max
                    </th>
                    <th className="p-3 text-center font-bold uppercase tracking-wider text-[10px] border-l border-border bg-secondary/50 w-16 hidden sm:table-cell">
                      Rnk
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={row.userId} className={cn("border-b border-border transition-colors hover:bg-muted/30", row.isEliminated && "opacity-50 grayscale")}>
                      <td className={cn(
                        "p-3 border-r-2 border-foreground font-bold sticky left-0 z-20 bg-card shadow-[1px_0_0_0_hsl(var(--foreground))]",
                        row.isEliminated && "line-through text-muted-foreground"
                      )}>
                        <div className="flex items-center gap-2 overflow-hidden">
                          <span className="truncate">{row.displayName || "Unknown"}</span>
                          {row.isEliminated && <span className="text-xs">🚫</span>}
                        </div>
                      </td>
                      {games.map(game => {
                        const cell = row.cells.find(c => c.eventGameId === game.id);
                        
                        let bgColor = "bg-card";
                        let textColor = "text-foreground";
                        
                        if (cell?.result === "win") {
                          bgColor = "bg-pick-win";
                          textColor = "text-white";
                        } else if (cell?.result === "loss") {
                          bgColor = "bg-pick-loss";
                          textColor = "text-white";
                        } else if (cell?.selectedTeam) {
                          bgColor = "bg-pick-pending";
                          textColor = "text-foreground";
                        }

                        return (
                          <td key={game.id} className="p-1 border-r border-border text-center relative">
                            <div className={cn(
                              "w-full h-full min-h-[44px] flex items-center justify-center font-mono font-black text-xs transition-all",
                              bgColor, textColor,
                              cell?.isMoneyPick && "border-[3px] border-foreground money-pick-border"
                            )}>
                              {cell?.selectedTeam ? (cell.selectedTeam === "away" ? game.nflGame?.awayTeam : game.nflGame?.homeTeam) : "-"}
                            </div>
                          </td>
                        );
                      })}
                      {event.tiebreakerQuestion && (
                        <td className="p-2 text-center font-mono text-muted-foreground border-l border-border hidden sm:table-cell">
                          {row.tiebreakerAnswer ?? "—"}
                        </td>
                      )}
                      <td className="p-2 text-center font-mono font-black border-l-2 border-foreground sticky right-0 z-10 bg-card text-lg">
                        {row.currentPoints}
                      </td>
                      <td className="p-2 text-center font-mono text-muted-foreground border-l border-border">
                        {row.maxPossiblePoints}
                      </td>
                      <td className="p-2 text-center font-mono font-bold border-l border-border hidden sm:table-cell">
                        {row.rank}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {event.tiebreakerQuestion && (
              <div className="bg-secondary/50 p-3 border-t-2 border-foreground text-xs font-mono space-y-1">
                <div className="font-bold uppercase tracking-wider">Tiebreaker — manually scored by commissioner</div>
                <div className="text-muted-foreground">{event.tiebreakerQuestion}</div>
                {event.tiebreakerResult != null && (
                  <div className="text-foreground font-bold">Answer: {event.tiebreakerResult}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
