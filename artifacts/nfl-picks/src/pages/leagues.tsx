import { useListLeagues, useGetDashboard, useJoinLeague, useCreateLeague, getListLeaguesQueryKey, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { Shell } from "@/components/layout";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Link } from "wouter";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trophy, ChevronRight, Plus, Key, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function LeagueHub() {
  const { data: dashboard, isLoading } = useGetDashboard();
  const joinLeague = useJoinLeague();
  const createLeague = useCreateLeague();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [inviteCode, setInviteCode] = useState("");
  const [leagueName, setLeagueName] = useState("");
  const [leagueSlug, setLeagueSlug] = useState("");

  const handleJoin = () => {
    if (!inviteCode) return;
    joinLeague.mutate({ data: { inviteCode } }, {
      onSuccess: () => {
        toast({ title: "League joined" });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        setInviteCode("");
      },
      onError: (err: any) => {
        toast({ title: "Failed to join league", description: err.error || "Invalid code", variant: "destructive" });
      }
    });
  };

  const handleCreate = () => {
    if (!leagueName || !leagueSlug) return;
    createLeague.mutate({ data: { name: leagueName, slug: leagueSlug } }, {
      onSuccess: () => {
        toast({ title: "League created" });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        setLeagueName("");
        setLeagueSlug("");
      },
      onError: (err: any) => {
        toast({ title: "Failed to create league", description: err.error || "Error", variant: "destructive" });
      }
    });
  };

  return (
    <Shell title="My Leagues">
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
          <div>
            <h2 className="text-2xl font-serif font-bold uppercase tracking-tight">Active Leagues</h2>
            {dashboard?.currentNflWeek && (
              <p className="text-sm text-muted-foreground uppercase tracking-widest mt-1">
                NFL Season {dashboard.currentNflWeek.season} • Week {dashboard.currentNflWeek.week}
              </p>
            )}
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" className="rounded-none border-border w-full sm:w-auto">
                  <Key className="mr-2 h-4 w-4" />
                  Join
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-none border-border">
                <DialogHeader>
                  <DialogTitle className="font-serif uppercase">Join a League</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase">Invite Code</label>
                    <Input 
                      placeholder="Enter code..." 
                      className="rounded-none border-border font-mono"
                      value={inviteCode}
                      onChange={e => setInviteCode(e.target.value)}
                    />
                  </div>
                  <Button 
                    className="w-full rounded-none uppercase font-bold" 
                    onClick={handleJoin}
                    disabled={joinLeague.isPending || !inviteCode}
                  >
                    {joinLeague.isPending ? "Joining..." : "Join League"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog>
              <DialogTrigger asChild>
                <Button className="rounded-none w-full sm:w-auto">
                  <Plus className="mr-2 h-4 w-4" />
                  Create
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-none border-border">
                <DialogHeader>
                  <DialogTitle className="font-serif uppercase">Create League</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase">League Name</label>
                    <Input 
                      placeholder="e.g. Sunday Ticket Heroes" 
                      className="rounded-none border-border"
                      value={leagueName}
                      onChange={e => setLeagueName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase">Short Slug (URL)</label>
                    <Input 
                      placeholder="e.g. sunday-heroes" 
                      className="rounded-none border-border font-mono"
                      value={leagueSlug}
                      onChange={e => setLeagueSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    />
                  </div>
                  <Button 
                    className="w-full rounded-none uppercase font-bold" 
                    onClick={handleCreate}
                    disabled={createLeague.isPending || !leagueName || !leagueSlug}
                  >
                    {createLeague.isPending ? "Creating..." : "Create League"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-24 bg-muted border border-border"></div>
            <div className="h-24 bg-muted border border-border"></div>
          </div>
        ) : dashboard?.leagues.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border">
            <h3 className="text-lg font-serif font-bold uppercase text-muted-foreground">No Leagues Yet</h3>
            <p className="text-sm mt-2 text-muted-foreground">Join an existing league or create your own to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {dashboard?.leagues.map(({ league, myRank, totalMembers, activeEvent }) => (
              <Link key={league.id} href={`/leagues/${league.id}`}>
                <Card className="rounded-none border-border hover:bg-muted/50 transition-colors cursor-pointer group">
                  <CardContent className="p-0">
                    <div className="flex items-stretch min-h-24">
                      <div className="flex-1 p-4 md:p-6 flex flex-col justify-center">
                        <h3 className="font-serif font-bold text-xl uppercase tracking-tight">{league.name}</h3>
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground font-mono">
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" /> {totalMembers}
                          </span>
                          <span className="flex items-center gap-1">
                            <Trophy className="w-3 h-3" /> Rank: {myRank}
                          </span>
                        </div>
                      </div>
                      <div className="w-48 border-l border-border bg-secondary/30 p-4 hidden sm:flex flex-col justify-center items-end text-right">
                        {activeEvent ? (
                          <>
                            <div className="text-xs font-bold uppercase text-primary mb-1">
                              Week {activeEvent.event.nflWeek}
                            </div>
                            <div className="text-sm font-mono">
                              {activeEvent.hasSubmitted ? (
                                <span className="text-pick-win flex items-center gap-1">Picks In</span>
                              ) : (
                                <span className="text-pick-loss">Needs Picks</span>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="text-xs uppercase text-muted-foreground">No Active Event</div>
                        )}
                      </div>
                      <div className="w-12 border-l border-border flex items-center justify-center group-hover:bg-foreground group-hover:text-background transition-colors">
                        <ChevronRight className="w-5 h-5" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
