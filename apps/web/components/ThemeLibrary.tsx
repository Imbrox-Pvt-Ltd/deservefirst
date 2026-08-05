'use client';

/**
 * Web · components/ThemeLibrary.tsx
 * The themes a store has, and the one its customers see.
 *
 * `/store/{handle}/themes` fell through to the "this part is not installed"
 * placeholder — which the smoke test scores as a rendered screen, correctly,
 * because a placeholder is a real screen. It just was not this one.
 *
 * The live theme is separated from the rest rather than being a row with a
 * badge. Every action here is safe except one, and that one replaces what every
 * customer sees; a list where publish sits in the same row as edit, three
 * pixels apart, is a list where somebody publishes a half-finished theme on a
 * Friday.
 *
 * Installing does NOT publish, and the screen says so where the merchant is
 * deciding whether to press the button.
 * Layer: web.
 */

import { useRef, useState, useTransition } from 'react';

import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Text,
} from '@deservefirst/ui';

import { installTheme, publishTheme, type InstallResult } from '../app/actions/themes';

export interface ThemeDto {
  readonly id: string;
  readonly name: string;
  readonly role: 'main' | 'unpublished' | 'development';
  readonly versionRef: string;
}

export interface ThemeLibraryProps {
  readonly handle: string;
  readonly themes: readonly ThemeDto[];
}

export function ThemeLibrary({ handle, themes }: ThemeLibraryProps) {
  const [result, setResult] = useState<InstallResult | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const live = themes.find((theme) => theme.role === 'main');
  const others = themes.filter((theme) => theme.role !== 'main');

  const upload = (file: File) => {
    setResult(null);
    startTransition(async () => {
      /**
       * Read in the browser and sent as base64.
       *
       * `FileReader` gives a data URL, so the prefix up to the comma is
       * stripped — sending it would make the first bytes of every archive
       * `data:application/zip;base64,` and nothing would ever parse.
       */
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('That file could not be read.'));
        reader.readAsDataURL(file);
      }).catch((error: Error) => {
        setResult({ ok: false, error: error.message });
        return null;
      });

      if (base64 === null) return;

      setResult(await installTheme(handle, base64));
      if (fileInput.current) fileInput.current.value = '';
    });
  };

  return (
    <Box padding="400">
      <BlockStack gap="400">
        <Text as="h1" variant="headingLg">
          Themes
        </Text>

        {result?.ok && (
          <Banner tone="success" onDismiss={() => setResult(null)}>
            <BlockStack gap="100">
              <Text as="p">
                Installed “{result.name}” — {result.fileCount} files. It is not live yet; publish it
                when you are ready.
              </Text>
              {(result.warningCount ?? 0) > 0 && (
                <Text as="p" tone="subdued" variant="bodySm">
                  {result.warningCount} advisory warning
                  {result.warningCount === 1 ? '' : 's'}. The theme works; run theme:check to see
                  them.
                </Text>
              )}
            </BlockStack>
          </Banner>
        )}

        {result && !result.ok && (
          <Banner tone="critical" onDismiss={() => setResult(null)}>
            <BlockStack gap="150">
              <Text as="p">{result.error}</Text>
              {/* Every problem, so one upload produces one round of fixes. */}
              {(result.problems ?? []).map((problem, index) => (
                <Text as="p" key={index} variant="bodySm">
                  {problem.pointer ? `${problem.pointer} — ` : ''}
                  {problem.detail}
                </Text>
              ))}
            </BlockStack>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Add a theme
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Upload a theme archive. It is checked before anything is stored, and installing it
                does not change what customers see — you publish it separately.
              </Text>
            </BlockStack>

            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip"
              disabled={pending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
              }}
            />
            {pending && (
              <Text as="p" tone="subdued" variant="bodySm">
                Checking and installing…
              </Text>
            )}
          </BlockStack>
        </Card>

        {live && (
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {live.name}
                </Text>
                <Badge tone="success">Live</Badge>
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                What customers see now · {live.versionRef}
              </Text>
              <InlineStack gap="200">
                <Button url={`/store/${handle}/themes/editor?theme=${live.id}`}>Customise</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Not live
          </Text>

          {others.length === 0 && (
            <Text as="p" tone="subdued" variant="bodySm">
              Every theme on this store is live or there are no others yet.
            </Text>
          )}

          {others.map((theme) => (
            <Card key={theme.id}>
              <InlineStack align="space-between" blockAlign="center" gap="200">
                <BlockStack gap="0">
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {theme.name}
                  </Text>
                  <Text as="span" variant="bodyXs" tone="subdued">
                    {theme.versionRef}
                  </Text>
                </BlockStack>

                <InlineStack gap="200">
                  <Button url={`/store/${handle}/themes/editor?theme=${theme.id}`}>Customise</Button>
                  {/**
                   * The one action that changes what customers see, and the
                   * only one on this screen that cannot be undone by pressing
                   * something else.
                   */}
                  <Button
                    variant="primary"
                    loading={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setResult(await publishTheme(handle, theme.id));
                      })
                    }
                  >
                    Publish
                  </Button>
                </InlineStack>
              </InlineStack>
            </Card>
          ))}
        </BlockStack>
      </BlockStack>
    </Box>
  );
}
