'use client';

/**
 * Web · app/login/page.tsx
 * Sign in. Deliberately outside /store, because it is the one screen that must
 * render without a store — or a session.
 * Layer: web.
 */

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { SignIn } from '../../components/SignIn';

function LoginForm() {
  const params = useSearchParams();
  // Round-tripped so signing in returns you to what you were opening, rather
  // than dumping you on a home page you did not ask for.
  return <SignIn returnPath={params.get('returnPath') ?? '/'} />;
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
