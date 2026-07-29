import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { Menu, LogOut, ChevronLeft, Trophy, Users, Settings, Home, LayoutDashboard } from "lucide-react";
import { useState } from "react";

export function Shell({ children, title, backTo, leagueId }: { children: React.ReactNode, title?: string, backTo?: string, leagueId?: number }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background">
        <div className="flex h-14 items-center px-4 md:px-6">
          <div className="flex items-center gap-2">
            {backTo ? (
              <Link href={backTo} className="mr-2">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="mr-2 h-8 w-8">
                    <Menu className="h-4 w-4" />
                    <span className="sr-only">Toggle Menu</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-64 border-r border-border p-0">
                  <SheetHeader className="p-4 border-b border-border text-left">
                    <SheetTitle className="font-serif font-bold text-lg uppercase tracking-tight">NFL Picks</SheetTitle>
                  </SheetHeader>
                  <div className="flex flex-col gap-1 p-2">
                    <Link href="/leagues" onClick={() => setOpen(false)}>
                      <Button variant={location === "/leagues" ? "secondary" : "ghost"} className="w-full justify-start rounded-none">
                        <Home className="mr-2 h-4 w-4" />
                        My Leagues
                      </Button>
                    </Link>
                    {leagueId && (
                      <>
                        <div className="my-2 border-t border-border" />
                        <Link href={`/leagues/${leagueId}`} onClick={() => setOpen(false)}>
                          <Button variant={location === `/leagues/${leagueId}` ? "secondary" : "ghost"} className="w-full justify-start rounded-none">
                            <LayoutDashboard className="mr-2 h-4 w-4" />
                            League Dashboard
                          </Button>
                        </Link>
                        <Link href={`/leagues/${leagueId}/standings`} onClick={() => setOpen(false)}>
                          <Button variant={location.endsWith("/standings") ? "secondary" : "ghost"} className="w-full justify-start rounded-none">
                            <Trophy className="mr-2 h-4 w-4" />
                            Standings
                          </Button>
                        </Link>
                        <Link href={`/leagues/${leagueId}/settings`} onClick={() => setOpen(false)}>
                          <Button variant={location.endsWith("/settings") ? "secondary" : "ghost"} className="w-full justify-start rounded-none">
                            <Users className="mr-2 h-4 w-4" />
                            Members & Settings
                          </Button>
                        </Link>
                        <div className="my-2 border-t border-border" />
                        <Link href={`/leagues/${leagueId}/commissioner`} onClick={() => setOpen(false)}>
                          <Button variant={location.includes("/commissioner") ? "secondary" : "ghost"} className="w-full justify-start rounded-none">
                            <Settings className="mr-2 h-4 w-4" />
                            Commissioner
                          </Button>
                        </Link>
                      </>
                    )}
                  </div>
                  <div className="absolute bottom-4 left-4 right-4">
                    <div className="flex items-center gap-3 mb-4 px-2">
                      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-sm font-bold border border-border">
                        {user?.firstName?.[0] || user?.displayName?.[0] || "?"}
                      </div>
                      <div className="text-sm font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                        {user?.displayName || user?.firstName || "Player"}
                      </div>
                    </div>
                    <Button variant="outline" className="w-full rounded-none justify-start border-border" onClick={logout}>
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign Out
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            )}
            {title ? (
              <h1 className="text-lg font-serif font-bold tracking-tight uppercase">{title}</h1>
            ) : (
              <span className="font-serif font-bold text-lg tracking-tight uppercase">NFL Picks</span>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 md:p-6 overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
