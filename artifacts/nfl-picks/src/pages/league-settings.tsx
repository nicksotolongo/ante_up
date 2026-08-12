import { useParams } from "wouter";
import { useGetLeague, useListMembers, useUpdateMember, useRemoveMember, useGenerateInviteCode, MemberUpdateRole } from "@workspace/api-client-react";
import { Shell } from "@/components/layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Key, Trash2 } from "lucide-react";

export default function LeagueSettings() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId || "0");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: league, isLoading: loadingLeague } = useGetLeague(leagueId, { query: { enabled: !!leagueId } });
  const { data: members, isLoading: loadingMembers } = useListMembers(leagueId, { query: { enabled: !!leagueId } });
  
  const updateMember = useUpdateMember();
  const removeMember = useRemoveMember();
  const generateInvite = useGenerateInviteCode();

  const isCommish = league?.userRole === "commissioner";
  const canManage = isCommish || league?.userRole === "deputy";

  if (loadingLeague || loadingMembers) return <Shell leagueId={leagueId} backTo={`/leagues/${leagueId}`}><div className="animate-pulse h-64 bg-muted"></div></Shell>;
  if (!league) return <Shell><div className="p-8 text-center uppercase font-bold text-destructive">League not found</div></Shell>;

  const handleRoleChange = (userId: string, role: string) => {
    updateMember.mutate({ leagueId, userId, data: { role: role as MemberUpdateRole } }, {
      onSuccess: () => {
        toast({ title: "Role updated" });
        queryClient.invalidateQueries({ queryKey: ["/api/leagues", leagueId, "members"] });
      }
    });
  };

  const handleRemove = (userId: string) => {
    if (!confirm("Remove this member?")) return;
    removeMember.mutate({ leagueId, userId }, {
      onSuccess: () => {
        toast({ title: "Member removed" });
        queryClient.invalidateQueries({ queryKey: ["/api/leagues", leagueId, "members"] });
      }
    });
  };

  const handleNewInvite = () => {
    generateInvite.mutate({ leagueId }, {
      onSuccess: (data) => {
        toast({ title: "Invite code generated", description: `New code: ${data.inviteCode}` });
        queryClient.invalidateQueries({ queryKey: ["/api/leagues", leagueId] });
      }
    });
  };

  return (
    <Shell title="League Settings" leagueId={leagueId} backTo={`/leagues/${leagueId}`}>
      <div className="space-y-8">
        
        {isCommish && (
          <section className="p-6 border border-border bg-card">
            <h3 className="text-lg font-serif font-bold uppercase mb-4">Invite Code</h3>
            <div className="flex items-center gap-4">
              <div className="font-mono text-xl font-black bg-secondary px-4 py-2 border border-border">
                {league.inviteCode || "None"}
              </div>
              <Button variant="outline" className="rounded-none border-border" onClick={handleNewInvite}>
                <Key className="mr-2 h-4 w-4" /> Generate New
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 font-mono uppercase tracking-widest">Share this code with friends to let them join.</p>
          </section>
        )}

        <section>
          <div className="border-b-4 border-foreground pb-2 mb-4">
            <h2 className="text-xl font-serif font-bold uppercase tracking-tight">Members</h2>
          </div>
          
          <div className="border border-border bg-card">
            <Table>
              <TableHeader className="bg-secondary/50">
                <TableRow>
                  <TableHead className="font-bold text-xs uppercase tracking-wider text-foreground">Player</TableHead>
                  <TableHead className="font-bold text-xs uppercase tracking-wider text-foreground">Role</TableHead>
                  {isCommish && <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members?.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-none bg-muted flex items-center justify-center text-xs font-bold border border-border">
                          {m.displayName?.[0] || "?"}
                        </div>
                        <span className="font-bold">{m.displayName || "Unknown"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isCommish && m.role !== "commissioner" ? (
                        <Select defaultValue={m.role} onValueChange={(val) => handleRoleChange(m.userId, val)}>
                          <SelectTrigger className="w-32 h-8 rounded-none border-border font-mono text-xs uppercase">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-none font-mono text-xs uppercase">
                            <SelectItem value="player">Player</SelectItem>
                            <SelectItem value="deputy">Deputy</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className="rounded-none font-mono uppercase text-[10px] tracking-wider border-border">
                          {m.role === "deputy" ? "Deputy Commissioner" : m.role}
                        </Badge>
                      )}
                    </TableCell>
                    {isCommish && (
                      <TableCell className="text-right">
                        {m.role !== "commissioner" && (
                          <Button variant="ghost" size="icon" onClick={() => handleRemove(m.userId)} className="h-8 w-8 text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </Shell>
  );
}
