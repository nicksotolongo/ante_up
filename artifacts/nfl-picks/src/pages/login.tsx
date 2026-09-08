import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Redirect } from "wouter";

export default function Login() {
  const { isAuthenticated, isLoading, login } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><div className="animate-pulse">Loading...</div></div>;
  }

  if (isAuthenticated) {
    return <Redirect to="/leagues" />;
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background text-foreground px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <h1 className="text-4xl font-serif font-black tracking-tighter uppercase border-b-4 border-foreground pb-2 inline-block">
          Ante Up
        </h1>

        <Button
          className="w-full rounded-none font-bold uppercase tracking-wider text-sm h-12"
          onClick={login}
        >
          Fade Yourself
        </Button>
      </div>
    </div>
  );
}
