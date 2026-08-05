'use client';

/**
 * Web · components/ExtensionHost.tsx
 * Rendering a third party's UI without giving them the page (§22.2).
 *
 * The extension's code never runs here. It runs in a Web Worker, which has no
 * `document`, no `window` and no access to this page's memory — the browser
 * enforces that, not us. All it can do is post a description of what it would
 * like shown, and this component renders that description using components it
 * chose from a fixed vocabulary.
 *
 * So there are two independent walls, and both are structural rather than
 * defensive. The worker means the extension cannot touch the DOM even if it
 * wants to. The vocabulary means the thing it CAN send has no way to express a
 * script, a URL or raw markup — `assertTreeValid` refuses those shapes before
 * anything is rendered, and it is written assuming the tree is hostile.
 *
 * What this deliberately does not do is take HTML and sanitise it. There is no
 * amount of sanitising that makes "here is the page, do what you like" safe,
 * and §22.4 exists precisely so we are never in that position.
 * Layer: web.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  assertTreeValid,
  type ExtensionNode,
  type ExtensionPropValue,
} from '@deservefirst/contracts';
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Divider,
  InlineStack,
  Text,
  TextField,
} from '@deservefirst/ui';

export interface ExtensionHostProps {
  /** Where the extension's worker script is served from. */
  readonly scriptUrl: string;
  readonly extensionName: string;
  /**
   * What the extension is told about the screen it is on.
   *
   * Whatever goes in here is visible to a third party, so it is passed
   * explicitly by the surface rather than being "the page's state" — a prop
   * somebody adds without thinking is a field somebody else's code can read.
   */
  readonly context: Readonly<Record<string, string | number | boolean | null>>;
  /** Actions the surface will honour. Anything else the extension raises is ignored. */
  readonly onAction?: (action: string) => void;
  /** How long the extension gets to produce its first tree. */
  readonly timeoutMs?: number;
}

const tone = (value: ExtensionPropValue | undefined) =>
  typeof value === 'string' ? (value as never) : undefined;
const text = (value: ExtensionPropValue | undefined) =>
  value === null || value === undefined ? '' : String(value);

export function ExtensionHost({
  scriptUrl,
  extensionName,
  context,
  onAction,
  timeoutMs = 2_000,
}: ExtensionHostProps) {
  const [tree, setTree] = useState<ExtensionNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Serialised so the effect does not re-run on a new object with the same
  // contents, which would restart the worker on every parent render.
  const contextKey = useMemo(() => JSON.stringify(context), [context]);

  useEffect(() => {
    let cancelled = false;
    let worker: Worker | null = null;

    const stop = (message: string | null) => {
      if (cancelled) return;
      cancelled = true;
      worker?.terminate();
      if (message !== null) setError(message);
    };

    try {
      // `type: 'module'` and nothing else. No `credentials`, so the worker
      // fetches without the merchant's cookies.
      worker = new Worker(scriptUrl, { type: 'module', credentials: 'omit' });
    } catch {
      setError('This extension could not be loaded.');
      return;
    }

    /**
     * Terminated, not asked to stop.
     *
     * An extension stuck in a loop never returns from its own code, so a
     * cooperative deadline is one it ignores — the same reasoning as the
     * Functions tier.
     */
    const timer = setTimeout(
      () => stop(`${extensionName} did not respond, so it has been stopped.`),
      timeoutMs,
    );

    worker.onmessage = (event: MessageEvent) => {
      if (cancelled) return;
      clearTimeout(timer);

      const message = event.data as { type?: string; tree?: unknown; action?: unknown };

      if (message?.type === 'action') {
        // The extension asking the HOST to do something. Only ids the surface
        // declared are honoured; an unknown one is dropped rather than guessed.
        if (typeof message.action === 'string') onAction?.(message.action);
        return;
      }

      try {
        // The wall. Runs before anything reaches React, and assumes hostility.
        assertTreeValid(message?.tree);
        setTree(message.tree as ExtensionNode);
        setError(null);
      } catch (treeError) {
        stop(
          treeError instanceof Error
            ? `${extensionName} sent something we will not render: ${treeError.message}`
            : `${extensionName} sent something we will not render.`,
        );
      }
    };

    worker.onerror = () => stop(`${extensionName} failed to start.`);

    worker.postMessage({ type: 'render', context: JSON.parse(contextKey) });

    return () => {
      clearTimeout(timer);
      cancelled = true;
      worker?.terminate();
    };
  }, [scriptUrl, extensionName, contextKey, timeoutMs]);

  if (error) {
    return (
      <Banner tone="warning" title={`${extensionName} is not showing`}>
        <Text as="p">{error}</Text>
      </Banner>
    );
  }

  if (!tree) return null;

  return <>{render(tree, onAction)}</>;
}

/**
 * One switch, over a closed vocabulary.
 *
 * There is no default branch that renders an unknown component, and no path
 * that passes an extension's props through to a real component untouched —
 * every prop below is read by name and coerced. `assertTreeValid` has already
 * refused anything else, and this reads as if it had not.
 */
function render(node: ExtensionNode, onAction?: (action: string) => void, key = '0'): ReactNode {
  const props = node.props ?? {};
  const children = (node.children ?? []).map((child, index) =>
    render(child, onAction, `${key}.${index}`),
  );

  switch (node.component) {
    case 'Stack':
      return props.direction === 'horizontal' ? (
        <InlineStack key={key} gap={tone(props.gap) ?? '200'}>
          {children}
        </InlineStack>
      ) : (
        <BlockStack key={key} gap={tone(props.gap) ?? '200'}>
          {children}
        </BlockStack>
      );

    case 'Heading':
      return (
        <Text key={key} as="h3" variant="headingMd">
          {text(props.content)}
        </Text>
      );

    case 'Text':
      return (
        <Text key={key} as="p" tone={tone(props.tone)} variant={tone(props.variant)}>
          {text(props.content)}
        </Text>
      );

    case 'Badge':
      return (
        <Badge key={key} tone={tone(props.tone)}>
          {text(props.content)}
        </Badge>
      );

    case 'Button':
      return (
        <Button
          key={key}
          tone={tone(props.tone)}
          disabled={props.disabled === true}
          // The extension names an action; the host decides what it does. It
          // never supplies a handler and never supplies a URL.
          onClick={() => {
            if (typeof props.action === 'string') onAction?.(props.action);
          }}
        >
          {text(props.label)}
        </Button>
      );

    case 'Divider':
      return <Divider key={key} />;

    case 'Banner':
      return (
        <Banner key={key} tone={tone(props.tone)} title={text(props.title)}>
          <Text as="p">{text(props.content)}</Text>
        </Banner>
      );

    case 'List':
      return (
        <BlockStack key={key} gap="100">
          {children}
        </BlockStack>
      );

    case 'ListItem':
      return (
        <Text key={key} as="p" tone="subdued">
          {text(props.content)}
        </Text>
      );

    case 'Field':
      return (
        <TextField
          key={key}
          label={text(props.label)}
          value={text(props.value)}
          disabled={props.disabled === true}
          autoComplete="off"
          // Read-only from the extension's side. A field it could write back
          // into would be a field it could use to move data off the screen.
          onChange={() => {}}
        />
      );
  }
}
