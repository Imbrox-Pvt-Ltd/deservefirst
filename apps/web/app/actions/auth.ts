'use server';

/**
 * Web · app/actions/auth.ts
 * Signing in and out, from the server.
 *
 * The API sets an httpOnly cookie, which the browser cannot read and this
 * action must therefore forward by hand — that is the cost of a cookie a script
 * cannot steal, and it is worth paying.
 * Layer: web/actions.
 */

import { cookies } from 'next/headers';

const API_VERSION = '2026-01';
const BASE_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';
const SESSION_COOKIE = 'df_session';

export interface SignInResult {
  readonly ok: boolean;
  readonly step?: string;
  readonly stores?: readonly { id: string; handle: string; name: string }[];
  readonly error?: string;
}

/** Copies a Set-Cookie the API issued into this response. */
async function adoptSessionCookie(header: string | null): Promise<void> {
  if (!header) return;
  const value = /df_session=([^;]*)/.exec(header)?.[1];
  if (value === undefined) return;

  const jar = await cookies();
  if (value === '') {
    jar.delete(SESSION_COOKIE);
    return;
  }
  jar.set(SESSION_COOKIE, decodeURIComponent(value), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const response = await fetch(`${BASE_URL}/${API_VERSION}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });

  const body = await response.json();
  if (body.errors?.length) {
    // The API says "incorrect email or password" without saying which. Passing
    // it through unchanged keeps it that way — narrowing it here would turn the
    // login form into an account-existence oracle.
    return { ok: false, error: body.errors[0].detail };
  }

  await adoptSessionCookie(response.headers.get('set-cookie'));
  return { ok: true, step: body.data.step, stores: body.data.stores };
}

export async function chooseStore(storeId: string): Promise<{ ok: boolean; error?: string }> {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE);

  const response = await fetch(`${BASE_URL}/${API_VERSION}/auth/switch-store`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(session ? { cookie: `${SESSION_COOKIE}=${session.value}` } : {}),
    },
    body: JSON.stringify({ storeId }),
    cache: 'no-store',
  });

  const body = await response.json();
  return body.errors?.length ? { ok: false, error: body.errors[0].detail } : { ok: true };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE);

  await fetch(`${BASE_URL}/${API_VERSION}/auth/logout`, {
    method: 'POST',
    headers: session ? { cookie: `${SESSION_COOKIE}=${session.value}` } : {},
    cache: 'no-store',
  });

  // Cleared locally too: the server has revoked it, and leaving it in the jar
  // means every later request carries a cookie that can only ever fail.
  jar.delete(SESSION_COOKIE);
}
