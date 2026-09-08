import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
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
    ? createClient(supabaseUrl, supabasePublishableKey)
    : null;

async function fetchCurrentUser(): Promise<AuthUser | null> {
  if (!supabase) return null;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token;
  if (!accessToken) return null;

  const res = await fetch('/api/auth/user', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { user: AuthUser | null };
  return data.user ?? null;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchCurrentUser()
      .then((currentUser) => {
        if (!cancelled) {
          setUser(currentUser);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
      });

    const { data: listener } =
      supabase?.auth.onAuthStateChange(async () => {
        const currentUser = await fetchCurrentUser();
        if (!cancelled) {
          setUser(currentUser);
          setIsLoading(false);
        }
      }) ?? { data: { subscription: null } };

    return () => {
      cancelled = true;
      listener.subscription?.unsubscribe();
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
