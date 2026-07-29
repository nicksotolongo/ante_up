import { useParams, Link } from "wouter";
import { useGetLeague, useListPickEvents, useCreatePickEvent, useGetCurrentNflWeek } from "@workspace/api-client-react";
import { Shell } from "@/components/layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

export default function CommissionerDashboard() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId || "0");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: league, isLoading: loadingLeague } = useGetLeague(leagueId, { query: { enabled: !!leagueId } });
  const { data: events, isLoading: loadingEvents } = useListPickEvents({ leagueId }, { query: { enabled: !!leagueId } });
  const { data: currentWeek } = useGetCurrentNflWeek();
  
  const createEvent = useCreatePickEvent();

  const [name, setName] = useState("");
  const [week, setWeek] = useState("");
  const [deadline, setDeadline] = useState("");
  const [revealAt, setRevealAt] = useState("");
  const [tiebreaker, setTiebreaker] = useState("");

  if (loadingLeague || loadingEvents) return <Shell leagueId={leagueId} backTo={`/leagues/${leagueId}`}><div className="animate-pulse h-64 bg-muted"></div></Shell>;
  
  if (league?.userRole !== "commissioner") {
    return <Shell leagueId={leagueId} backTo={`/leagues/${leagueId}`}><div className="p-8 text-center text-destructive font-bold uppercase">Unauthorized</div></Shell>;
  }

  const handleCreateEvent = () => {
    if (!name || !week || !deadline || !revealAt) return;
    
    createEvent.mutate({
      data: {
        name,
        nflWeek: parseInt(week),
        nflSeason: currentWeek?.season || new Date().getFullYear(),
        submissionDeadline: new Date(deadline).toISOString(),
        revealAt: new Date(revealAt).toISOString(),
        tiebreakerQuestion: tiebreaker || undefined
      }
    }, {
      onSuccess: () => {
        toast({ title: "Event created" });
        queryClient.invalidateQueries({ queryKey: ["/api/events"] });
        setName("");
        setTiebreaker("");
      }
    });
  };

  return (
    <Shell title="Commissioner Tools" leagueId={leagueId} backTo={`/leagues/${leagueId}`}>
      <Tabs defaultValue="events" className="w-full">
        <TabsList className="w-full justify-start rounded-none border-b-2 border-foreground bg-transparent p-0 h-auto mb-6">
          <TabsTrigger value="events" className="rounded-none border-b-4 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3 font-serif uppercase font-bold tracking-widest text-xs">Events</TabsTrigger>
          <TabsTrigger value="create" className="rounded-none border-b-4 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3 font-serif uppercase font-bold tracking-widest text-xs">Create Event</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="space-y-4">
          {events?.length === 0 ? (
            <div className="p-8 text-center border border-border bg-card">No events found.</div>
          ) : (
            <div className="grid gap-4">
              {events?.map(event => (
                <Card key={event.id} className="rounded-none border-border bg-card shadow-sm">
                  <CardContent className="p-4 flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold uppercase px-2 py-0.5 bg-foreground text-background">Week {event.nflWeek}</span>
                        <span className="text-xs font-mono uppercase text-muted-foreground">{event.status}</span>
                      </div>
                      <h4 className="font-serif font-black uppercase text-lg">{event.name}</h4>
                    </div>
                    <Link href={`/leagues/${leagueId}/commissioner/${event.id}`}>
                      <Button variant="outline" className="rounded-none border-border uppercase font-bold text-xs tracking-wider">Manage</Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="create">
          <Card className="rounded-none border-2 border-foreground bg-card">
            <CardHeader className="border-b border-border bg-secondary/30">
              <CardTitle className="font-serif uppercase">Create New Event</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Event Name</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Week 1 Picks" className="rounded-none border-border font-serif text-lg" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">NFL Week</label>
                  <Input type="number" value={week} onChange={e => setWeek(e.target.value)} placeholder={currentWeek?.week.toString()} className="rounded-none border-border" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">NFL Season</label>
                  <Input type="number" value={currentWeek?.season || ""} disabled className="rounded-none border-border bg-muted" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Submission Deadline</label>
                  <Input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="rounded-none border-border font-mono text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reveal At</label>
                  <Input type="datetime-local" value={revealAt} onChange={e => setRevealAt(e.target.value)} className="rounded-none border-border font-mono text-sm" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tiebreaker Question (Optional)</label>
                <Input value={tiebreaker} onChange={e => setTiebreaker(e.target.value)} placeholder="e.g. Total points in MNF game" className="rounded-none border-border" />
              </div>
              <Button 
                className="w-full mt-4 h-12 rounded-none font-bold uppercase tracking-widest" 
                onClick={handleCreateEvent}
                disabled={!name || !week || !deadline || !revealAt || createEvent.isPending}
              >
                {createEvent.isPending ? "Creating..." : "Create Event"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Shell>
  );
}
