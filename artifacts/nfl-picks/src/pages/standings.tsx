import { useParams } from "wouter";
import { useGetSeasonStandings, useGetLeague } from "@workspace/api-client-react";
import { Shell } from "@/components/layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Standings() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId || "0");
  
  const { data: standings, isLoading } = useGetSeasonStandings(leagueId, {
    query: { enabled: !!leagueId }
  });
  
  return (
    <Shell title="Season Standings" leagueId={leagueId} backTo={`/leagues/${leagueId}`}>
      <div className="space-y-6">
        <div className="border-b-4 border-foreground pb-2">
          <h2 className="text-2xl font-serif font-black uppercase tracking-tight">Leaderboard</h2>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-12 bg-muted border border-border"></div>
            ))}
          </div>
        ) : !standings?.length ? (
          <div className="p-8 text-center border border-border bg-card">
            <p className="text-muted-foreground uppercase tracking-widest text-sm font-bold">No standings available yet.</p>
          </div>
        ) : (
          <div className="border border-border bg-card overflow-x-auto">
            <Table>
              <TableHeader className="bg-secondary/50">
                <TableRow>
                  <TableHead className="w-16 text-center font-bold text-xs uppercase tracking-wider text-foreground">Rnk</TableHead>
                  <TableHead className="font-bold text-xs uppercase tracking-wider text-foreground">Player</TableHead>
                  <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground">Pts</TableHead>
                  <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground">Weekly W</TableHead>
                  <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground">Record</TableHead>
                  <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground">Money</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standings.map((entry) => (
                  <TableRow key={entry.userId} className="hover:bg-muted/30">
                    <TableCell className="text-center font-mono font-bold">{entry.rank}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-none bg-muted flex items-center justify-center text-[10px] font-bold border border-border">
                          {entry.displayName?.[0] || "?"}
                        </div>
                        <span className="font-bold">{entry.displayName || "Unknown"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-black text-lg">{entry.totalPoints}</TableCell>
                    <TableCell className="text-right font-mono">{entry.weeklyWins}</TableCell>
                    <TableCell className="text-right font-mono">
                      <span className="text-pick-win">{entry.normalCorrect}</span>-<span className="text-pick-loss">{entry.normalTotal - entry.normalCorrect}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {entry.moneyCorrect}/{entry.moneyTotal}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Shell>
  );
}
