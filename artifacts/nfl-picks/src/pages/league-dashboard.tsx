import { useParams, Link } from "wouter";
import { useGetLeague, useListPickEvents } from "@workspace/api-client-react";
import { Shell } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, Calendar, Activity, Trophy } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

export default function LeagueDashboard() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId || "0");
  
  const { data: league, isLoading: loadingLeague } = useGetLeague(leagueId, {
    query: { enabled: !!leagueId }
  });
  
  const { data: events, isLoading: loadingEvents } = useListPickEvents(
    leagueId,
    { query: { enabled: !!leagueId } }
  );

  if (loadingLeague || loadingEvents) {
    return <Shell leagueId={leagueId} backTo="/leagues"><div className="animate-pulse h-64 bg-muted"></div></Shell>;
  }

  if (!league) return <Shell><div className="p-8 text-center uppercase font-bold text-destructive">League not found</div></Shell>;

  const isCommissioner = league.userRole === "commissioner";
  // Commissioners see draft events too so they can publish; players only see open/locked/revealed
  const activeEvent = events?.find(e =>
    isCommissioner
      ? ["draft", "open", "locked", "revealed"].includes(e.status)
      : ["open", "locked", "revealed"].includes(e.status)
  );
  const pastEvents = events?.filter(e => e.status === "finalized").slice(0, 5) || [];

  return (
    <Shell title={league.name} leagueId={leagueId} backTo="/leagues">
      <div className="space-y-8">
        {/* Active Event Hero */}
        <section>
          <h2 className="text-xl font-serif font-bold uppercase tracking-tight mb-4 border-b-2 border-foreground pb-2">Current Week</h2>
          {activeEvent ? (
            <Card className="rounded-none border-2 border-foreground bg-card shadow-none">
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row">
                  <div className="flex-1 p-6 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="bg-foreground text-background text-xs font-bold uppercase px-2 py-1">
                          Week {activeEvent.nflWeek}
                        </span>
                        <span className={`text-sm font-mono uppercase ${activeEvent.status === "draft" ? "text-amber-600" : "text-muted-foreground"}`}>
                          {activeEvent.status === "draft" ? "Draft — Not Published" : activeEvent.status}
                        </span>
                      </div>
                      <h3 className="text-2xl font-serif font-black uppercase mt-2">{activeEvent.name}</h3>
                      {activeEvent.status === "draft" ? (
                        <div className="text-sm font-mono mt-4 text-amber-600">
                          Publish this event so players can submit picks.
                        </div>
                      ) : (
                        <div className="text-sm font-mono mt-4 text-muted-foreground flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            Deadline: {format(new Date(activeEvent.submissionDeadline), "EEE, MMM d • h:mm a")}
                          </div>
                          {activeEvent.status === "open" && (
                            <div className="text-pick-win">
                              Closes in {formatDistanceToNow(new Date(activeEvent.submissionDeadline))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col border-t md:border-t-0 md:border-l border-border min-w-[240px]">
                    {activeEvent.status !== "draft" && (
                      <div className="flex-1 p-6 flex flex-col justify-center bg-secondary/20">
                        <div className="text-center">
                          <div className="text-3xl font-black font-mono">{activeEvent.submissionCount || 0} <span className="text-lg text-muted-foreground font-sans">/ {activeEvent.totalMembers || 0}</span></div>
                          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mt-1">Picks Submitted</div>
                        </div>
                      </div>
                    )}
                    <div className={`grid border-t border-border ${activeEvent.status === "draft" ? "grid-cols-1" : "grid-cols-2"}`}>
                      {activeEvent.status === "draft" ? (
                        <Link href={`/leagues/${leagueId}/commissioner/${activeEvent.id}`}>
                          <Button variant="ghost" className="w-full h-14 rounded-none font-bold uppercase hover:bg-foreground hover:text-background">
                            Setup &amp; Publish
                          </Button>
                        </Link>
                      ) : (
                        <>
                          <Link href={`/leagues/${leagueId}/picks/${activeEvent.id}`} className="border-r border-border">
                            <Button variant="ghost" className="w-full h-14 rounded-none font-bold uppercase hover:bg-foreground hover:text-background">
                              Make Picks
                            </Button>
                          </Link>
                          <Link href={`/leagues/${leagueId}/board/${activeEvent.id}`}>
                            <Button variant="ghost" className="w-full h-14 rounded-none font-bold uppercase hover:bg-foreground hover:text-background">
                              Live Board
                            </Button>
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="border border-dashed border-border p-8 text-center bg-secondary/10">
              <Activity className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <div className="font-bold uppercase tracking-widest text-muted-foreground">No Active Event</div>
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <section>
            <div className="flex items-center justify-between border-b border-border pb-2 mb-4">
              <h2 className="text-xl font-serif font-bold uppercase tracking-tight">Recent Results</h2>
              <Link href={`/leagues/${leagueId}/standings`} className="text-xs font-bold uppercase flex items-center hover:underline">
                Full Standings <ChevronRight className="w-3 h-3 ml-1" />
              </Link>
            </div>
            
            {pastEvents.length > 0 ? (
              <div className="space-y-2">
                {pastEvents.map(event => (
                  <Link key={event.id} href={`/leagues/${leagueId}/board/${event.id}`}>
                    <div className="group flex items-center justify-between p-3 border border-border bg-card hover:bg-muted/50 cursor-pointer">
                      <div>
                        <div className="font-bold uppercase text-sm">{event.name}</div>
                        <div className="text-xs text-muted-foreground font-mono mt-1">Week {event.nflWeek}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground p-4 border border-border bg-card">
                No past events to display.
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xl font-serif font-bold uppercase tracking-tight border-b border-border pb-2 mb-4">Quick Links</h2>
            <div className="grid grid-cols-1 gap-2">
              <Link href={`/leagues/${leagueId}/standings`}>
                <Button variant="outline" className="w-full justify-start h-12 rounded-none border-border">
                  <Trophy className="mr-3 h-4 w-4" /> Season Standings
                </Button>
              </Link>
              {league.userRole === 'commissioner' && (
                <Link href={`/leagues/${leagueId}/commissioner`}>
                  <Button variant="outline" className="w-full justify-start h-12 rounded-none border-border bg-secondary/20">
                    <Activity className="mr-3 h-4 w-4" /> Commissioner Tools
                  </Button>
                </Link>
              )}
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}
