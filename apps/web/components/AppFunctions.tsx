'use client';

/**
 * Web · components/AppFunctions.tsx
 * Deploying WebAssembly to an extension point.
 *
 * The screen's job is to set expectations before the upload, because the tier
 * refuses modules for reasons that are obvious once known and baffling
 * otherwise. It states the two limits, names the only import available, and
 * says what happens when a function breaks — taken from the point's own
 * declaration rather than written here, so it cannot disagree with what the
 * platform actually does.
 * Layer: web.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from '@deservefirst/ui';

import { deployFunction, disableFunction } from '../app/actions/functions';
import type { FunctionDeploymentDto, FunctionPointDto } from '../lib/types';

export interface AppFunctionsProps {
  readonly partnerId: string;
  readonly appId: string;
  readonly appName: string;
  readonly deployments: readonly FunctionDeploymentDto[];
  readonly points: readonly FunctionPointDto[];
}

export function AppFunctions({
  partnerId,
  appId,
  appName,
  deployments,
  points,
}: AppFunctionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [point, setPoint] = useState(points[0]?.key ?? '');
  const [name, setName] = useState('');
  const [wasmBase64, setWasmBase64] = useState('');
  const [fileName, setFileName] = useState('');

  const selected = points.find((entry) => entry.key === point);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Base64 in the browser, so the upload is ordinary JSON rather than
    // multipart — the artefacts are small by construction (the tier caps
    // memory), and one content type is one thing to get right.
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    setWasmBase64(btoa(binary));
  };

  const deploy = () =>
    startTransition(async () => {
      setError(null);
      const result = await deployFunction(partnerId, appId, { point, name: name.trim(), wasmBase64 });
      if (!result.ok) {
        setError(result.error ?? 'Could not deploy this function');
        return;
      }
      setName('');
      setWasmBase64('');
      setFileName('');
      router.refresh();
    });

  return (
    <Page
      title={`${appName} — functions`}
      backAction={{ content: 'Apps', url: `/partners/${partnerId}/apps` }}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="This function was not deployed">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Deployed
            </Text>
            {deployments.length === 0 ? (
              <Text as="p" tone="subdued">
                Nothing deployed. A function runs on our servers, in a sandbox, when the point below
                is reached in a store that has installed this app.
              </Text>
            ) : (
              deployments.map((entry) => (
                <InlineStack key={entry.id} align="space-between" blockAlign="start" gap="200">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="medium">
                        {entry.name}
                      </Text>
                      <Badge tone={entry.status === 'active' ? 'success' : 'critical'}>
                        {entry.status}
                      </Badge>
                    </InlineStack>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {entry.point} · {entry.timeoutMs}ms · {Math.round(entry.sizeBytes / 1024)} KB
                    </Text>
                    {entry.disabledReason ? (
                      <Text as="span" tone="critical" variant="bodySm">
                        {entry.disabledReason}
                      </Text>
                    ) : null}
                  </BlockStack>

                  {entry.status === 'active' ? (
                    <Button
                      variant="plain"
                      tone="critical"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await disableFunction(partnerId, appId, entry.id);
                          if (!result.ok) setError(result.error ?? 'Could not disable it');
                          router.refresh();
                        })
                      }
                    >
                      Disable
                    </Button>
                  ) : null}
                </InlineStack>
              ))
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Deploy a function
            </Text>

            <Select
              label="Runs at"
              value={point}
              onChange={setPoint}
              options={points.map((entry) => ({ value: entry.key, label: entry.label }))}
            />

            {selected ? (
              <Banner
                tone={selected.onFailure === 'deny' ? 'warning' : 'info'}
                title={
                  selected.onFailure === 'deny'
                    ? 'If your function breaks, this action is blocked'
                    : 'If your function breaks, the merchant carries on'
                }
              >
                <BlockStack gap="200">
                  <Text as="p">{selected.description}</Text>
                  {/*
                    * Taken from the point's declaration, not written here, so
                    * the screen cannot disagree with what the platform does.
                    */}
                  <Text as="p" variant="bodySm">
                    Your function receives: <code>{selected.inputExample}</code>
                  </Text>
                  <Text as="p" variant="bodySm">
                    Answer with <code>{'{"allow":true}'}</code> or{' '}
                    <code>{'{"allow":false,"reason":"…"}'}</code>. Anything else counts as a
                    failure — silence is not consent.
                  </Text>
                </BlockStack>
              </Banner>
            ) : null}

            <Banner tone="info" title="What the sandbox allows">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm">
                  Your module may import <code>deservefirst.log</code> and{' '}
                  <code>deservefirst.abort</code>, and nothing else. No network, no filesystem, no
                  clock — a module built against WASI is refused.
                </Text>
                <Text as="p" variant="bodySm">
                  It must export <code>run</code> and its <code>memory</code>. Limits are 200ms and
                  5 MB.
                </Text>
              </BlockStack>
            </Banner>

            <TextField label="Name" value={name} onChange={setName} autoComplete="off" />

            <BlockStack gap="100">
              <Text as="span" variant="bodySm">
                WebAssembly module (.wasm)
              </Text>
              <input
                type="file"
                accept=".wasm,application/wasm"
                onChange={(event) => void onFile(event.target.files?.[0])}
              />
              {fileName ? (
                <Text as="span" tone="subdued" variant="bodySm">
                  {fileName} — {Math.round((wasmBase64.length * 3) / 4 / 1024)} KB
                </Text>
              ) : null}
            </BlockStack>

            <InlineStack>
              <Button
                variant="primary"
                disabled={pending || !name.trim() || !wasmBase64 || !point}
                onClick={deploy}
              >
                Deploy
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
