import { useParams, Link, useLocation } from "wouter";
import { useGetPickEvent, useListEventGames, useGetMySubmission, useSubmitPicks, useUpdateSubmission, PickInput, PickInputSelectedTeam } from "@workspace/api-client-react";
import { Shell } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export default function PlayerPicksForm() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId || "0");
  const eventId = parseInt(params.eventId || "0");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: event, isLoading: loadingEvent } = useGetPickEvent(leagueId, eventId, { query: { enabled: !!leagueId && !!eventId } });
  const { data: games, isLoading: loadingGames } = useListEventGames(leagueId, eventId, { query: { enabled: !!leagueId && !!eventId } });
  const { data: submissionEnvelope, isLoading: loadingSubmission } = useGetMySubmission(leagueId, eventId, { query: { enabled: !!leagueId && !!eventId } });

  const [picks, setPicks] = useState<Record<number, PickInputSelectedTeam>>({});
  const [moneyPick, setMoneyPick] = useState<number | null>(null);
  const [tiebreaker, setTiebreaker] = useState<string>("");
  const [, setNowTick] = useState(0);

  // Re-render every 15s so the form locks itself the moment the deadline passes
  useEffect(() => {
    const t = setInterval(() => setNowTick(n => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const submitPicks = useSubmitPicks();
  const updateSubmission = useUpdateSubmission();

  useEffect(() => {
    if (submissionEnvelope?.submission) {
      const sub = submissionEnvelope.submission;
      const initialPicks: Record<number, PickInputSelectedTeam> = {};
      sub.picks.forEach(p => {
        initialPicks[p.eventGameId] = p.selectedTeam;
      });
      setPicks(initialPicks);
      setMoneyPick(sub.moneyPickGameId || null);
      setTiebreaker(sub.tiebreakerAnswer?.toString() || "");
    }
  }, [submissionEnvelope]);

  const isLoading = loadingEvent || loadingGames || loadingSubmission;

  if (isLoading) {
    return <Shell leagueId={leagueId} backTo={`/leagues/${leagueId}`}><div className="animate-pulse h-64 bg-muted"></div></Shell>;
  }

  if (!event || !games) return <Shell leagueId={leagueId} backTo={`/leagues/${leagueId}`}><div>Not found</div></Shell>;

  if (event.status === "draft") {
    return (
      <Shell title="Make Picks" leagueId={leagueId} backTo={`/leagues/${leagueId}`}>
        <div className="p-8 text-center border border-dashed border-border bg-secondary/10">
          <div className="font-serif font-black uppercase text-xl mb-2">{event.name}</div>
          <div className="text-muted-foreground uppercase tracking-widest text-sm">This event hasn&apos;t been published yet. Check back soon.</div>
        </div>
      </Shell>
    );
  }

  const isLocked = event.status !== "open"; // locked, revealed, finalized all block edits
  const hasSubmitted = !!submissionEnvelope?.submission;

  // Each game locks at its own kickoff
  const isGameLocked = (g: (typeof games)[number]) =>
    isLocked || Date.now() >= new Date(g.nflGame?.kickoffAt ?? 0).getTime();
  const openGames = games.filter(g => !isGameLocked(g));
  const moneyGame = games.find(g => g.id === moneyPick);
  const moneyLocked = !!moneyGame && isGameLocked(moneyGame) && hasSubmitted;

  const allPicked = openGames.every(g => picks[g.id]);
  const isValid = allPicked && moneyPick && (event.tiebreakerQuestion ? tiebreaker.trim() !== "" : true);

  const handleSave = () => {
    if (!isValid) return;

    // Send picks for open games plus any existing picks on locked games (unchanged)
    const picksArray: PickInput[] = Object.entries(picks)
      .filter(([gameId]) => {
        const g = games.find(gm => gm.id === parseInt(gameId));
        if (!g) return false;
        if (!isGameLocked(g)) return true;
        // locked game: only resend if it was part of the saved submission
        return !!submissionEnvelope?.submission?.picks.find(p => p.eventGameId === g.id);
      })
      .map(([gameId, team]) => ({
        eventGameId: parseInt(gameId),
        selectedTeam: team
      }));

    const data = {
      picks: picksArray,
      moneyPickGameId: moneyPick!,
      tiebreakerAnswer: tiebreaker ? parseInt(tiebreaker) : 0
    };

    if (hasSubmitted) {
      updateSubmission.mutate(
        { leagueId, eventId, submissionId: submissionEnvelope.submission!.id, data },
        {
          onSuccess: () => {
            toast({ title: "Picks updated!" });
            queryClient.invalidateQueries({ queryKey: ["/api/leagues", leagueId, "events", eventId, "my-submission"] });
            setLocation(`/leagues/${leagueId}`);
          },
          onError: (err: any) => {
            toast({ title: "Error saving picks", description: err?.message, variant: "destructive" });
          }
        }
      );
    } else {
      submitPicks.mutate(
        { leagueId, eventId, data },
        {
          onSuccess: () => {
            toast({ title: "Picks submitted!" });
            queryClient.invalidateQueries({ queryKey: ["/api/leagues", leagueId, "events", eventId, "my-submission"] });
            setLocation(`/leagues/${leagueId}`);
          },
          onError: (err: any) => {
            toast({ title: "Error submitting picks", description: err?.message, variant: "destructive" });
          }
        }
      );
    }
  };

  const togglePick = (gameId: number, team: PickInputSelectedTeam) => {
    const g = games.find(gm => gm.id === gameId);
    if (!g || isGameLocked(g)) return;
    setPicks(prev => ({ ...prev, [gameId]: team }));
  };

  const toggleMoneyPick = (gameId: number) => {
    const g = games.find(gm => gm.id === gameId);
    if (!g || isGameLocked(g) || moneyLocked) return;
    setMoneyPick(prev => prev === gameId ? null : gameId);
  };

  return (
    <Shell title="Make Picks" leagueId={leagueId} backTo={`/leagues/${leagueId}`}>
      <div className="space-y-6">
        <div className="border-b-4 border-foreground pb-2 flex justify-between items-end">
          <div>
            <h2 className="text-2xl font-serif font-black uppercase tracking-tight">{event.name}</h2>
            <div className="text-sm font-mono text-muted-foreground uppercase mt-1">
              Each game locks at kickoff
            </div>
          </div>
          {isLocked && <div className="bg-destructive text-destructive-foreground px-3 py-1 font-bold uppercase text-xs">Locked</div>}
        </div>

        {!isLocked && (
          <div className="bg-secondary/50 p-4 border border-border text-sm flex flex-col gap-1">
            <div className="font-bold uppercase tracking-wider">Instructions:</div>
            <ul className="list-disc pl-5 font-mono">
              <li>Pick one team against the spread for each game.</li>
              <li>Select EXACTLY ONE money pick (worth 2 points).</li>
              <li>Enter the tiebreaker.</li>
            </ul>
          </div>
        )}

        <div className="space-y-4">
          {games.map(game => {
            const spreadStr = game.lockedSpread != null 
              ? `${game.lockedSpread > 0 ? '+' : ''}${game.lockedSpread}` 
              : "PK";
            
            const isMoney = moneyPick === game.id;
            const pickedTeam = picks[game.id];
            const gameLocked = isGameLocked(game);

            return (
              <Card key={game.id} className={cn(
                "rounded-none border-2 transition-all",
                isMoney ? "border-foreground" : "border-border",
                gameLocked ? "opacity-90" : "hover:border-foreground/50"
              )}>
                {gameLocked && (
                  <div className="bg-secondary/60 text-muted-foreground text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1 border-b border-border flex justify-between">
                    <span>Locked — kicked off</span>
                    <span>{format(new Date(game.nflGame?.kickoffAt ?? 0), "EEE h:mm a")}</span>
                  </div>
                )}
                {!gameLocked && (
                  <div className="bg-card text-muted-foreground text-[10px] font-mono uppercase tracking-widest px-3 py-1 border-b border-border">
                    Locks {format(new Date(game.nflGame?.kickoffAt ?? 0), "EEE, MMM d • h:mm a")}
                  </div>
                )}
                <CardContent className="p-0 flex flex-col sm:flex-row">
                  <div className="flex-1 grid grid-cols-2">
                    {/* Away Team */}
                    <div 
                      className={cn(
                        "p-4 flex flex-col items-center justify-center cursor-pointer border-r border-border transition-colors",
                        pickedTeam === "away" ? "bg-foreground text-background" : "bg-card hover:bg-muted/50",
                        gameLocked && "cursor-default pointer-events-none"
                      )}
                      onClick={() => togglePick(game.id, "away")}
                    >
                      <div className="text-xl font-black font-mono">{game.nflGame?.awayTeam}</div>
                      <div className="text-xs font-bold mt-1 uppercase tracking-widest opacity-80">
                        {game.spreadTeam === "away" ? spreadStr : (game.spreadTeam === "home" && game.lockedSpread != null ? `${-game.lockedSpread > 0 ? '+' : ''}${-game.lockedSpread}` : "PK")}
                      </div>
                    </div>
                    {/* Home Team */}
                    <div 
                      className={cn(
                        "p-4 flex flex-col items-center justify-center cursor-pointer transition-colors",
                        pickedTeam === "home" ? "bg-foreground text-background" : "bg-card hover:bg-muted/50",
                        gameLocked && "cursor-default pointer-events-none"
                      )}
                      onClick={() => togglePick(game.id, "home")}
                    >
                      <div className="text-xl font-black font-mono">{game.nflGame?.homeTeam}</div>
                      <div className="text-xs font-bold mt-1 uppercase tracking-widest opacity-80">
                        {game.spreadTeam === "home" ? spreadStr : (game.spreadTeam === "away" && game.lockedSpread != null ? `${-game.lockedSpread > 0 ? '+' : ''}${-game.lockedSpread}` : "PK")}
                      </div>
                    </div>
                  </div>
                  {/* Money Pick Toggle */}
                  <div 
                    className={cn(
                      "sm:w-32 border-t sm:border-t-0 sm:border-l border-border flex items-center justify-center p-3 cursor-pointer select-none transition-colors",
                      isMoney ? "bg-foreground text-background font-black" : "bg-secondary/30 text-muted-foreground hover:bg-secondary",
                      (gameLocked || moneyLocked) && "cursor-default pointer-events-none"
                    )}
                    onClick={() => toggleMoneyPick(game.id)}
                  >
                    <span className="uppercase text-sm tracking-widest">Money Pick</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {event.tiebreakerQuestion && (
          <div className="border-2 border-border p-6 bg-card">
            <h3 className="font-serif font-bold uppercase mb-2">Tiebreaker</h3>
            <label className="text-sm font-mono text-muted-foreground block mb-4">
              {event.tiebreakerQuestion}
            </label>
            <Input 
              type="number" 
              className="rounded-none border-border font-mono text-lg h-12 max-w-xs" 
              placeholder="Enter number..." 
              value={tiebreaker}
              onChange={(e) => setTiebreaker(e.target.value)}
              disabled={isLocked}
            />
          </div>
        )}

        {!isLocked && (
          <div className="pt-4 border-t border-border flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="text-sm font-mono text-muted-foreground">
              {!allPicked ? <span className="text-pick-loss">Missing picks</span> : !moneyPick ? <span className="text-pick-loss">Missing money pick</span> : <span className="text-pick-win font-bold">Ready to submit</span>}
            </div>
            <Button 
              className="w-full sm:w-auto h-14 px-12 rounded-none uppercase font-black tracking-widest" 
              onClick={handleSave}
              disabled={!isValid || submitPicks.isPending || updateSubmission.isPending}
            >
              {hasSubmitted ? "Update Picks" : "Submit Picks"}
            </Button>
          </div>
        )}
      </div>
    </Shell>
  );
}
