import { useCallback, useEffect, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import type { AuthUser } from '@workspace/api-client-react';

export type { AuthUser };

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase =
  supabaseUrl && supabasePublishableKey
    ? createClient(supabaseUrl, supabasePublishableKey, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;

async function fetchUserForSession(session: Session | null): Promise<AuthUser | null> {
  const accessToken = session?.access_token;
  if (!accessToken) return null;

  const res = await fetch('/api/auth/user', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Auth API returned ${res.status}${detail ? `: ${detail}` : ''}`);
  }

  const data = (await res.json()) as { user: AuthUser | null };
  return data.user ?? null;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let requestVersion = 0;

    if (!supabase) {
      setIsLoading(false);
      return;
    }

    const applySession = (session: Session | null) => {
      const version = ++requestVersion;

      if (!session) {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      // Supabase recommends keeping onAuthStateChange callbacks synchronous.
      // Defer our API request until after the auth callback has returned.
      window.setTimeout(() => {
        void fetchUserForSession(session)
          .then((currentUser) => {
            if (!cancelled && version === requestVersion) {
              setUser(currentUser);
              setIsLoading(false);
            }
          })
          .catch((error) => {
            console.error('Unable to finish Ante Up sign-in', error);
            if (!cancelled && version === requestVersion) {
              setUser(null);
              setIsLoading(false);
            }
          });
      }, 0);
    };

    // INITIAL_SESSION is emitted after Supabase has finished loading a stored
    // session or processing a magic-link redirect. Using that event avoids
    // racing getSession() against redirect initialization.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(() => {
    if (!supabase) {
      window.alert('Supabase auth is not configured for this deployment.');
      return;
    }

    const email = window.prompt('Email address');
    if (!email) return;

    void supabase.auth
      .signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
        },
      })
      .then(({ error }) => {
        if (error) {
          window.alert(`Unable to send sign-in link: ${error.message}`);
          return;
        }

        window.alert('Check your email for the sign-in link.');
      });
  }, []);

  const logout = useCallback(() => {
    if (!supabase) return;
    void supabase.auth.signOut();
    setUser(null);
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
  };
}
