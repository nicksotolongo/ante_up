import { useParams } from "wouter";
import { useGetPickEvent, useListEventGames, useUpdatePickEvent, useUpdateEventGame, useLockPickEvent, useFinalizePickEvent, useListNflGames, useAddEventGame, useRemoveEventGame, EventGameUpdateResult } from "@workspace/api-client-react";
import { Shell } from "@/components/layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";

export default function EventManagement() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId || "0");
  const eventId = parseInt(params.eventId || "0");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: event, isLoading: loadingEvent } = useGetPickEvent(leagueId, eventId, { query: { enabled: !!leagueId && !!eventId } });
  const { data: eventGames, isLoading: loadingGames } = useListEventGames(leagueId, eventId, { query: { enabled: !!leagueId && !!eventId } });
  
  const { data: nflGames } = useListNflGames(
    { week: event?.nflWeek, season: event?.nflSeason }, 
    { query: { enabled: !!event?.nflWeek } }
  );

  const addGame = useAddEventGame();
  const removeGame = useRemoveEventGame();
  const updateGame = useUpdateEventGame();
  const lockEvent = useLockPickEvent();
  const finalizeEvent = useFinalizePickEvent();
  const updateEvent = useUpdatePickEvent();

  const [tiebreakerResult, setTiebreakerResult] = useState("");
  
  useEffect(() => {
    if (event?.tiebreakerResult != null) {
      setTiebreakerResult(event.tiebreakerResult.toString());
    }
  }, [event?.tiebreakerResult]);

  if (loadingEvent || loadingGames) return <Shell leagueId={leagueId} backTo={`/leagues/${leagueId}/commissioner`}><div className="animate-pulse h-64 bg-muted"></div></Shell>;
  if (!event) return <Shell><div className="p-8 text-center">Event not found</div></Shell>;

  const handleToggleGame = (nflGameId: string, isIncluded: boolean, spread?: number | null, favoredTeam?: string | null) => {
    if (isIncluded) {
      const existing = eventGames?.find(eg => eg.nflGameId === nflGameId);
      if (existing) {
        removeGame.mutate({ leagueId, eventId, eventGameId: existing.id }, {
          onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/leagues", leagueId, "events", eventId, "games"] })
        });
      }
    } else {
      addGame.mutate({
        leagueId,
        eventId,
        data: {
          nflGameId,
          displayOrder: (eventGames?.length || 0) + 1,
          lockedSpread: spread,
          spreadTeam: favoredTeam as any
        }
      }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/leagues", leagueId, "events", eventId, "games"] })
      });
    }
  };

  const handleUpdateResult = (eventGameId: number, result: EventGameUpdateResult) => {
    updateGame.mutate({ leagueId, eventId, eventGameId, data: { result } }, {
      onSuccess: () => {
        toast({ title: "Result updated" });
        queryClient.invalidateQueries({ queryKey: ["/api/leagues", leagueId, "events", eventId, "games"] });
      }
    });
  };

  const handleAction = (action: any, actionName: string) => {
    action.mutate({ leagueId, eventId }, {
      onSuccess: () => {
        toast({ title: `${actionName} successful` });
        queryClient.invalidateQueries({ queryKey: ["/api/leagues", leagueId, "events", eventId] });
      },
      onError: (err: any) => {
        toast({ title: `Error`, description: err?.message, variant: "destructive" });
      }
    });
  };

  const handleSaveTiebreaker = () => {
    if (!tiebreakerResult) return;
    updateEvent.mutate({ leagueId, eventId, data: { tiebreakerResult: parseInt(tiebreakerResult) } }, {
      onSuccess: () => {
        toast({ title: "Tiebreaker saved" });
        queryClient.invalidateQueries({ queryKey: ["/api/leagues", leagueId, "events", eventId] });
      }
    });
  };

  return (
    <Shell title="Event Management" leagueId={leagueId} backTo={`/leagues/${leagueId}/commissioner`}>
      <div className="flex justify-between items-end border-b-4 border-foreground pb-2 mb-6">
        <div>
          <h2 className="text-2xl font-serif font-black uppercase tracking-tight">{event.name}</h2>
          <div className="text-sm font-mono text-muted-foreground uppercase mt-1">Status: {event.status}</div>
        </div>
        <div className="flex gap-2">
          {event.status === "draft" && (
            <Button className="rounded-none uppercase font-bold" onClick={() => handleAction(lockEvent, "Publish Event")}>
              Publish & Open
            </Button>
          )}
          {["locked", "revealed"].includes(event.status) && (
            <Button className="rounded-none uppercase font-bold bg-foreground text-background" onClick={() => handleAction(finalizeEvent, "Finalize Event")}>
              Finalize & Score
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="games" className="w-full">
        <TabsList className="w-full justify-start rounded-none border-b-2 border-foreground bg-transparent p-0 h-auto mb-6">
          <TabsTrigger value="games" className="rounded-none border-b-4 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3 font-serif uppercase font-bold tracking-widest text-xs">Included Games</TabsTrigger>
          <TabsTrigger value="feed" className="rounded-none border-b-4 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3 font-serif uppercase font-bold tracking-widest text-xs">NFL Odds Feed</TabsTrigger>
          <TabsTrigger value="results" className="rounded-none border-b-4 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3 font-serif uppercase font-bold tracking-widest text-xs">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="games" className="space-y-4">
          {eventGames?.length === 0 ? (
            <div className="p-8 text-center border border-border bg-card text-sm uppercase text-muted-foreground">No games added. Go to NFL Odds Feed to add games.</div>
          ) : (
            <div className="grid gap-2">
              {eventGames?.map(eg => (
                <div key={eg.id} className="flex items-center justify-between p-4 border border-border bg-card">
                  <div>
                    <div className="font-mono font-bold text-lg">{eg.nflGame?.awayTeam} @ {eg.nflGame?.homeTeam}</div>
                    <div className="text-xs uppercase text-muted-foreground mt-1">Spread: {eg.spreadTeam} {eg.lockedSpread != null ? eg.lockedSpread : 'PK'}</div>
                  </div>
                  {event.status === "draft" && (
                    <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 uppercase font-bold text-xs rounded-none" onClick={() => handleToggleGame(eg.nflGameId, true)}>
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="feed" className="space-y-4">
          {event.status !== "draft" ? (
            <div className="p-8 text-center border border-border bg-card text-sm text-destructive uppercase font-bold">Games cannot be modified after publishing.</div>
          ) : (
            <div className="grid gap-2">
              {nflGames?.map(game => {
                const isIncluded = !!eventGames?.find(eg => eg.nflGameId === game.id);
                return (
                  <div key={game.id} className="flex items-center gap-4 p-4 border border-border bg-card">
                    <Checkbox 
                      checked={isIncluded} 
                      onCheckedChange={() => handleToggleGame(game.id, isIncluded, game.spread, game.favoredTeam)}
                      className="rounded-none w-5 h-5"
                    />
                    <div>
                      <div className="font-mono font-bold text-lg">{game.awayTeam} @ {game.homeTeam}</div>
                      <div className="text-xs uppercase text-muted-foreground mt-1">Live Spread: {game.favoredTeam || 'PK'} {game.spread != null ? game.spread : ''}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="results" className="space-y-6">
          <Card className="rounded-none border-border bg-card">
            <CardHeader className="bg-secondary/30 border-b border-border">
              <CardTitle className="font-serif uppercase text-sm">Game Results</CardTitle>
            </CardHeader>
            <CardContent className="p-4 grid gap-4">
              {eventGames?.map(eg => (
                <div key={eg.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-border">
                  <div className="font-mono font-bold text-base">{eg.nflGame?.awayTeam} @ {eg.nflGame?.homeTeam}</div>
                  <div className="flex gap-2">
                    <Button 
                      variant={eg.result === "away" ? "default" : "outline"} 
                      className="rounded-none uppercase font-bold text-xs"
                      onClick={() => handleUpdateResult(eg.id, "away")}
                    >
                      Away ({eg.nflGame?.awayTeam})
                    </Button>
                    <Button 
                      variant={eg.result === "home" ? "default" : "outline"} 
                      className="rounded-none uppercase font-bold text-xs"
                      onClick={() => handleUpdateResult(eg.id, "home")}
                    >
                      Home ({eg.nflGame?.homeTeam})
                    </Button>
                    <Button 
                      variant={eg.result === "push" ? "default" : "outline"} 
                      className="rounded-none uppercase font-bold text-xs"
                      onClick={() => handleUpdateResult(eg.id, "push")}
                    >
                      Push
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {event.tiebreakerQuestion && (
            <Card className="rounded-none border-border bg-card">
              <CardHeader className="bg-secondary/30 border-b border-border">
                <CardTitle className="font-serif uppercase text-sm">Tiebreaker Result</CardTitle>
              </CardHeader>
              <CardContent className="p-4 flex gap-4 items-end">
                <div className="flex-1 space-y-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">{event.tiebreakerQuestion}</label>
                  <Input type="number" value={tiebreakerResult} onChange={e => setTiebreakerResult(e.target.value)} className="rounded-none border-border font-mono text-lg max-w-[200px]" />
                </div>
                <Button className="rounded-none uppercase font-bold" onClick={handleSaveTiebreaker}>Save</Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </Shell>
  );
}
