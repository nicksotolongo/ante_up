import { createClient } from '@supabase/supabase-js';
import { type NextFunction, type Request, type Response } from 'express';

import { db, usersTable } from '@workspace/db';
import { getBearerToken, type AuthUser } from '../lib/auth';

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

function getSupabaseClient() {
  if (!supabaseUrl || !supabasePublishableKey) return null;
  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request['isAuthenticated'];

  const token = getBearerToken(req.headers.authorization);
  if (!token) {
    console.info('[auth] request has no bearer token', { path: req.path });
    next();
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('[auth] Supabase backend environment is not configured', {
      hasUrl: Boolean(supabaseUrl),
      hasPublishableKey: Boolean(supabasePublishableKey),
    });
    next();
    return;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    console.warn('[auth] bearer token validation failed', {
      path: req.path,
      error: error?.message ?? 'No user returned',
    });
    next();
    return;
  }

  console.info('[auth] bearer token validated', {
    path: req.path,
    userId: data.user.id,
    hasEmail: Boolean(data.user.email),
  });

  const metadata = data.user.user_metadata ?? {};
  const authUser: AuthUser = {
    id: data.user.id,
    email: data.user.email ?? null,
    firstName:
      typeof metadata.first_name === 'string' ? metadata.first_name : null,
    lastName:
      typeof metadata.last_name === 'string' ? metadata.last_name : null,
    profileImageUrl:
      typeof metadata.avatar_url === 'string'
        ? metadata.avatar_url
        : typeof metadata.picture === 'string'
          ? metadata.picture
          : null,
  };

  try {
    const [dbUser] = await db
      .insert(usersTable)
      .values(authUser)
      .onConflictDoUpdate({
        target: usersTable.id,
        set: {
          email: authUser.email,
          firstName: authUser.firstName,
          lastName: authUser.lastName,
          profileImageUrl: authUser.profileImageUrl,
          updatedAt: new Date(),
        },
      })
      .returning();

    console.info('[auth] application user upserted', {
      path: req.path,
      userId: data.user.id,
    });

    req.user = {
      ...authUser,
      displayName: dbUser.displayName ?? null,
    };
  } catch (error) {
    console.error('[auth] application user upsert failed', {
      path: req.path,
      userId: data.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    next(error);
    return;
  }

  next();
}
