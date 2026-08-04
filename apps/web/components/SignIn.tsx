'use client';

/**
 * Web · components/SignIn.tsx
 * The sign-in form, and choosing a store when there is more than one.
 *
 * Two steps rather than one screen, because they are two different questions:
 * who are you, and which of your stores are you working in. A person with one
 * store never sees the second — the API scopes the session for them.
 * Layer: web.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Page,
  Text,
  TextField,
} from '@deservefirst/ui';

import { chooseStore, signIn } from '../app/actions/auth';

type Store = { id: string; handle: string; name: string };

export function SignIn({ returnPath }: { returnPath: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [stores, setStores] = useState<readonly Store[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await signIn(email, password);
      if (!result.ok) {
        setError(result.error ?? 'Could not sign in');
        return;
      }
      setError(null);

      if (result.step === 'store-select' && result.stores?.length) {
        setStores(result.stores);
        return;
      }
      router.push(returnPath);
      router.refresh();
    });

  const pick = (store: Store) =>
    startTransition(async () => {
      const result = await chooseStore(store.id);
      if (!result.ok) {
        setError(result.error ?? 'Could not open that store');
        return;
      }
      router.push(`/store/${store.handle}`);
      router.refresh();
    });

  return (
    <Page title={stores ? 'Choose a store' : 'Sign in'} narrowWidth>
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not sign in">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        <Card>
          <Box padding="500">
            {stores ? (
              <BlockStack gap="300">
                <Text as="p" tone="subdued">
                  You have access to more than one store. Everything after this is scoped to the
                  one you pick, and you can switch without signing in again.
                </Text>
                {stores.map((store) => (
                  <Button key={store.id} disabled={pending} onClick={() => pick(store)}>
                    {store.name}
                  </Button>
                ))}
              </BlockStack>
            ) : (
              <BlockStack gap="400">
                <TextField
                  label="Email"
                  type="email"
                  value={email}
                  autoComplete="username"
                  disabled={pending}
                  onChange={setEmail}
                />
                <TextField
                  label="Password"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  disabled={pending}
                  onChange={setPassword}
                />
                <Button
                  variant="primary"
                  loading={pending}
                  disabled={!email.trim() || !password}
                  onClick={submit}
                >
                  Sign in
                </Button>
              </BlockStack>
            )}
          </Box>
        </Card>
      </BlockStack>
    </Page>
  );
}
