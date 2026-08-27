import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetLeague, useListMembers, useUpdateMember, useUpdateCurrentUser, useRemoveMember, useGenerateInviteCode, useDeleteLeague, MemberUpdateRole, getGetLeagueQueryKey, getListMembersQueryKey, getGetCurrentAuthUserQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Shell } from "@/components/layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Key, Trash2, Pencil, Check, X } from "lucide-react";

function roleLabel(role: string) {
  if (role === "player") return "Player";
  if (role === "deputy") return "Deputy Commissioner";
  return "Commissioner";
}

export default function LeagueSettings() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId || "0");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: me } = useAuth();

  const { data: league, isLoading: loadingLeague } = useGetLeague(leagueId, { query: { enabled: !!leagueId } });
  const { data: members, isLoading: loadingMembers } = useListMembers(leagueId, { query: { enabled: !!leagueId } });

  const updateMember = useUpdateMember();
  const updateCurrentUser = useUpdateCurrentUser();
  const removeMember = useRemoveMember();
  const generateInvite = useGenerateInviteCode();
  const deleteLeague = useDeleteLeague();
  const [, navigate] = useLocation();
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const isCommish = league?.userRole === "commissioner";
  const canManage = isCommish || league?.userRole === "deputy";

  if (loadingLeague || loadingMembers) return <Shell leagueId={leagueId} backTo={`/leagues/${leagueId}`}><div className="animate-pulse h-64 bg-muted"></div></Shell>;
  if (!league) return <Shell><div className="p-8 text-center uppercase font-bold text-destructive">League not found</div></Shell>;

  const handleRoleChange = (userId: string, role: string) => {
    updateMember.mutate({ leagueId, userId, data: { role: role as MemberUpdateRole } }, {
      onSuccess: () => {
        toast({ title: "Role updated" });
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(leagueId) });
      }
    });
  };

  const handleRemove = (userId: string) => {
    if (!confirm("Remove this member?")) return;
    removeMember.mutate({ leagueId, userId }, {
      onSuccess: () => {
        toast({ title: "Member removed" });
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(leagueId) });
      }
    });
  };

  const handleNewInvite = () => {
    generateInvite.mutate({ leagueId }, {
      onSuccess: (data) => {
        toast({ title: "Invite code generated", description: `New code: ${data.inviteCode}` });
        queryClient.invalidateQueries({ queryKey: getGetLeagueQueryKey(leagueId) });
      }
    });
  };

  const startEditingName = (userId: string, currentName: string) => {
    setEditingUserId(userId);
    setNameDraft(currentName);
  };

  const cancelEditingName = () => {
    setEditingUserId(null);
    setNameDraft("");
  };

  const saveName = (userId: string) => {
    const trimmed = nameDraft.trim();
    const value = trimmed.length ? trimmed : null;
    const onDone = () => {
      setEditingUserId(null);
      setNameDraft("");
      toast({ title: "Name updated" });
      queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(leagueId) });
    };
    if (userId === me?.id) {
      updateCurrentUser.mutate({ data: { displayName: value } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCurrentAuthUserQueryKey() });
          onDone();
        }
      });
    } else {
      updateMember.mutate({ leagueId, userId, data: { displayName: value } }, { onSuccess: onDone });
    }
  };

  return (
    <Shell title="League Settings" leagueId={leagueId} backTo={`/leagues/${leagueId}`}>
      <div className="space-y-8">
        
        <section className="p-6 border border-border bg-card">
          <h3 className="text-lg font-serif font-bold uppercase mb-4">Invite Code</h3>
          <div className="flex items-center gap-4">
            <div className="font-mono text-xl font-black bg-secondary px-4 py-2 border border-border">
              {league.inviteCode || "None"}
            </div>
            {canManage && (
              <Button variant="outline" className="rounded-none border-border" onClick={handleNewInvite}>
                <Key className="mr-2 h-4 w-4" /> Generate New
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2 font-mono uppercase tracking-widest">Share this code with friends to let them join.</p>
        </section>

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
                  {canManage && <TableHead className="text-right font-bold text-xs uppercase tracking-wider text-foreground">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members?.map((m) => {
                  const canEditName = canManage || m.userId === me?.id;
                  const isEditing = editingUserId === m.userId;
                  return (
                  <TableRow key={m.id}>
                    <TableCell>
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveName(m.userId);
                              if (e.key === "Escape") cancelEditingName();
                            }}
                            placeholder="Display name"
                            className="h-8 w-40 rounded-none border-border"
                          />
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => saveName(m.userId)}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={cancelEditingName}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-none bg-muted flex items-center justify-center text-xs font-bold border border-border">
                            {m.displayName?.[0] || "?"}
                          </div>
                          <span className="font-bold">{m.displayName || "Unknown"}</span>
                          {m.userId === league.commissionerId && (
                            <Badge variant="outline" className="rounded-none font-mono uppercase text-[9px] tracking-wider border-border text-muted-foreground">
                              Owner
                            </Badge>
                          )}
                          {canEditName && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={() => startEditingName(m.userId, m.displayName || "")}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage && m.role !== "commissioner" ? (
                        <Select defaultValue={m.role} onValueChange={(val) => handleRoleChange(m.userId, val)}>
                          <SelectTrigger className="w-32 h-8 rounded-none border-border font-mono text-xs uppercase">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-none font-mono text-xs uppercase">
                            <SelectItem value="player">Player</SelectItem>
                            <SelectItem value="deputy">Deputy Commissioner</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className="rounded-none font-mono uppercase text-[10px] tracking-wider border-border">
                          {roleLabel(m.role)}
                        </Badge>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {m.role !== "commissioner" && (
                          <Button variant="ghost" size="icon" onClick={() => handleRemove(m.userId)} className="h-8 w-8 text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>

        {isCommish && (
          <section className="p-6 border border-destructive/50 bg-card">
            <h3 className="text-lg font-serif font-bold uppercase mb-2 text-destructive">Danger Zone</h3>
            <p className="text-xs text-muted-foreground mb-4 font-mono uppercase tracking-widest">Deleting the league permanently removes all events, picks, and standings.</p>
            <Button
              variant="destructive"
              className="rounded-none"
              disabled={deleteLeague.isPending}
              onClick={() => {
                if (!confirm(`Delete "${league.name}" and ALL its data? This cannot be undone.`)) return;
                if (!confirm("Are you absolutely sure? Every event, pick, and standing in this league will be permanently deleted.")) return;
                deleteLeague.mutate({ leagueId }, {
                  onSuccess: () => {
                    toast({ title: "League deleted" });
                    queryClient.invalidateQueries();
                    navigate("/");
                  },
                  onError: (err: any) => toast({ title: "Failed to delete league", description: err?.error || "Error", variant: "destructive" }),
                });
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete League
            </Button>
          </section>
        )}
      </div>
    </Shell>
  );
}
