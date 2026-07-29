import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import Login from '@/pages/login';
import LeagueHub from '@/pages/leagues';
import LeagueDashboard from '@/pages/league-dashboard';
import Standings from '@/pages/standings';
import LeagueSettings from '@/pages/league-settings';
import CommissionerDashboard from '@/pages/commissioner-dashboard';
import EventManagement from '@/pages/event-management';
import LiveBoardPage from '@/pages/live-board';
import PlayerPicksForm from '@/pages/player-picks';

const queryClient = new QueryClient();

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <h1 className="text-4xl font-serif font-black uppercase">404 - Not Found</h1>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      <Route path="/leagues" component={LeagueHub} />
      <Route path="/leagues/:leagueId" component={LeagueDashboard} />
      <Route path="/leagues/:leagueId/standings" component={Standings} />
      <Route path="/leagues/:leagueId/settings" component={LeagueSettings} />
      <Route path="/leagues/:leagueId/commissioner" component={CommissionerDashboard} />
      <Route path="/leagues/:leagueId/commissioner/:eventId" component={EventManagement} />
      <Route path="/leagues/:leagueId/board/:eventId" component={LiveBoardPage} />
      <Route path="/leagues/:leagueId/picks/:eventId" component={PlayerPicksForm} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
