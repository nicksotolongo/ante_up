import { useParams, Link, useLocation } from "wouter";
import {
  useGetLeague,
  useListPickEvents,
  useCreatePickEvent,
  useGetUpcomingNflGames,
  useAddEventGame,
} from "@workspace/api-client-react";
import { Shell } from "@/components/layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function CommissionerDashboard() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId || "0");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: league, isLoading: loadingLeague } = useGetLeague(leagueId, { query: { enabled: !!leagueId } });
  const { data: events, isLoading: loadingEvents } = useListPickEvents(leagueId, { query: { enabled: !!leagueId } });
  const { data: upcomingWeeks, isFetching: loadingGames } = useGetUpcomingNflGames();

  const createEvent = useCreatePickEvent();
  const addGame = useAddEventGame();

  // --- create form state ---
  const [name, setName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [revealAt, setRevealAt] = useState("");
  const [tiebreaker, setTiebreaker] = useState("");
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());

  const toggleGame = (gameId: string) => {
    setSelectedGames(prev => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  };

  // Derive the event's NFL week/season/seasonType from whichever games are selected
  const derivedWeekInfo = useMemo(() => {
    if (!upcomingWeeks || selectedGames.size === 0) return null;
    for (const w of upcomingWeeks) {
      for (const g of w.games) {
        if (selectedGames.has(g.id)) {
          return { nflWeek: w.week, nflSeason: w.season, nflSeasonType: w.seasonType, label: w.label };
        }
      }
    }
    return null;
  }, [upcomingWeeks, selectedGames]);

  const canCreate = name && deadline && revealAt && selectedGames.size > 0 && !createEvent.isPending;

  const handleCreateEvent = () => {
    if (!canCreate || !derivedWeekInfo) return;

    const allGames = upcomingWeeks?.flatMap(w => w.games) ?? [];

    createEvent.mutate(
      {
        leagueId,
        data: {
          name,
          nflWeek: derivedWeekInfo.nflWeek,
          nflSeason: derivedWeekInfo.nflSeason,
          nflSeasonType: derivedWeekInfo.nflSeasonType as any,
          submissionDeadline: new Date(deadline).toISOString(),
          revealAt: new Date(revealAt).toISOString(),
          tiebreakerQuestion: tiebreaker || undefined,
        },
      },
      {
        onSuccess: async (newEvent) => {
          const gamesToAdd = allGames.filter(g => selectedGames.has(g.id));
          try {
            for (let i = 0; i < gamesToAdd.length; i++) {
              const g = gamesToAdd[i];
              await addGame.mutateAsync({
                leagueId,
                eventId: newEvent.id,
                data: {
                  nflGameId: g.id,
                  displayOrder: i + 1,
                  lockedSpread: g.spread ?? undefined,
                  spreadTeam: (g.favoredTeam as any) ?? "home",
                },
              });
            }
            toast({ title: `Event created with ${gamesToAdd.length} games` });
            queryClient.invalidateQueries({ queryKey: ["/api/leagues", leagueId, "events"] });
            navigate(`/leagues/${leagueId}/commissioner/${newEvent.id}`);
          } catch (err: any) {
            toast({ title: "Failed to add games", description: err?.message ?? "Check that the games are in the ESPN schedule", variant: "destructive" });
          }
        },
        onError: (err: any) => {
          toast({ title: "Error creating event", description: err?.message, variant: "destructive" });
        },
      }
    );
  };

  if (loadingLeague || loadingEvents) {
    return (
      <Shell leagueId={leagueId} backTo={`/leagues/${leagueId}`}>
        <div className="animate-pulse h-64 bg-muted" />
      </Shell>
    );
  }

  if (!["commissioner", "deputy"].includes(league?.userRole ?? "")) {
    return (
      <Shell leagueId={leagueId} backTo={`/leagues/${leagueId}`}>
        <div className="p-8 text-center text-destructive font-bold uppercase">Unauthorized</div>
      </Shell>
    );
  }

  return (
    <Shell title="Commissioner Tools" leagueId={leagueId} backTo={`/leagues/${leagueId}`}>
      <Tabs defaultValue="events" className="w-full">
        <TabsList className="w-full justify-start rounded-none border-b-2 border-foreground bg-transparent p-0 h-auto mb-6">
          <TabsTrigger value="events" className="rounded-none border-b-4 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3 font-serif uppercase font-bold tracking-widest text-xs">
            Events
          </TabsTrigger>
          <TabsTrigger value="create" className="rounded-none border-b-4 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3 font-serif uppercase font-bold tracking-widest text-xs">
            Create Event
          </TabsTrigger>
        </TabsList>

        {/* ── Events list ── */}
        <TabsContent value="events" className="space-y-4">
          {events?.length === 0 ? (
            <div className="p-8 text-center border border-border bg-card">No events yet.</div>
          ) : (
            <div className="grid gap-4">
              {events?.map(event => (
                <Card key={event.id} className="rounded-none border-border bg-card shadow-sm">
                  <CardContent className="p-4 flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold uppercase px-2 py-0.5 bg-foreground text-background">
                          {event.nflSeasonType === "preseason" ? "Preseason" : ""} Week {event.nflWeek}
                        </span>
                        <span className="text-xs font-mono uppercase text-muted-foreground">{event.status}</span>
                      </div>
                      <h4 className="font-serif font-black uppercase text-lg">{event.name}</h4>
                    </div>
                    <Link href={`/leagues/${leagueId}/commissioner/${event.id}`}>
                      <Button variant="outline" className="rounded-none border-border uppercase font-bold text-xs tracking-wider">
                        Manage
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Create event ── */}
        <TabsContent value="create">
          <div className="space-y-6 max-w-2xl">

            {/* Event metadata */}
            <Card className="rounded-none border-2 border-foreground bg-card">
              <CardHeader className="border-b border-border bg-secondary/30">
                <CardTitle className="font-serif uppercase">Event Details</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Event Name</label>
                  <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={derivedWeekInfo ? `e.g. ${derivedWeekInfo.label} Picks` : "e.g. Week 1 Picks"}
                    className="rounded-none border-border font-serif text-lg"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Submission Deadline</label>
                    <Input
                      type="datetime-local"
                      value={deadline}
                      onChange={e => setDeadline(e.target.value)}
                      className="rounded-none border-border font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reveal At</label>
                    <Input
                      type="datetime-local"
                      value={revealAt}
                      onChange={e => setRevealAt(e.target.value)}
                      className="rounded-none border-border font-mono text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tiebreaker Question (Optional)</label>
                  <Input
                    value={tiebreaker}
                    onChange={e => setTiebreaker(e.target.value)}
                    placeholder="e.g. Total points in MNF game"
                    className="rounded-none border-border"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Game slate — live lines for next 2 weeks */}
            <Card className="rounded-none border-2 border-foreground bg-card">
              <CardHeader className="border-b border-border bg-secondary/30">
                <CardTitle className="font-serif uppercase flex items-center justify-between">
                  <span>Select Games</span>
                  {selectedGames.size > 0 && (
                    <span className="text-sm font-mono font-normal text-muted-foreground">
                      {selectedGames.size} selected · {derivedWeekInfo?.label}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loadingGames ? (
                  <div className="p-8 text-center text-muted-foreground text-sm uppercase tracking-wider animate-pulse">
                    Loading live lines…
                  </div>
                ) : !upcomingWeeks?.length || upcomingWeeks.every(w => w.games.length === 0) ? (
                  <div className="p-8 text-center text-muted-foreground text-sm uppercase tracking-wider">
                    No upcoming games found
                  </div>
                ) : (
                  <div>
                    {upcomingWeeks.map(weekGroup => (
                      weekGroup.games.length === 0 ? null : (
                        <div key={`${weekGroup.season}-${weekGroup.seasonType}-${weekGroup.week}`}>
                          {/* Week header */}
                          <div className="px-4 py-2 bg-foreground/5 border-y border-border flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-widest text-foreground">
                              {weekGroup.label}
                            </span>
                            <button
                              type="button"
                              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider"
                              onClick={() => {
                                const allIds = new Set(weekGroup.games.map(g => g.id));
                                const allSelected = weekGroup.games.every(g => selectedGames.has(g.id));
                                setSelectedGames(prev => {
                                  const next = new Set(prev);
                                  if (allSelected) {
                                    allIds.forEach(id => next.delete(id));
                                  } else {
                                    allIds.forEach(id => next.add(id));
                                  }
                                  return next;
                                });
                              }}
                            >
                              {weekGroup.games.every(g => selectedGames.has(g.id)) ? "Deselect all" : "Select all"}
                            </button>
                          </div>

                          {/* Games */}
                          <div className="divide-y divide-border">
                            {weekGroup.games.map(game => {
                              const checked = selectedGames.has(game.id);
                              const spreadLabel = game.favoredTeam
                                ? `${game.favoredTeam === "home" ? game.homeTeam : game.awayTeam} ${game.spread}`
                                : "PK";
                              const timeLabel = new Date(game.kickoffAt).toLocaleString("en-US", {
                                weekday: "short", month: "short", day: "numeric",
                                hour: "numeric", minute: "2-digit",
                              });
                              return (
                                <button
                                  key={game.id}
                                  type="button"
                                  onClick={() => toggleGame(game.id)}
                                  className={`w-full flex items-center gap-4 p-4 text-left transition-colors ${checked ? "bg-foreground/5" : "hover:bg-muted/40"}`}
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={() => toggleGame(game.id)}
                                    className="rounded-none w-5 h-5 shrink-0"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="font-mono font-bold text-base">
                                      {game.awayTeam} <span className="text-muted-foreground font-normal">@</span> {game.homeTeam}
                                    </div>
                                    <div className="text-xs uppercase text-muted-foreground mt-0.5 flex gap-3">
                                      <span>{timeLabel}</span>
                                      <span className="font-bold">Line: {spreadLabel}</span>
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Button
              className="w-full h-12 rounded-none font-bold uppercase tracking-widest"
              onClick={handleCreateEvent}
              disabled={!canCreate || !derivedWeekInfo}
            >
              {createEvent.isPending || addGame.isPending
                ? `Adding games…`
                : `Create Event with ${selectedGames.size || 0} Game${selectedGames.size !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </Shell>
  );
}
