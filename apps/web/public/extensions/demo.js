/**
 * A demonstration UI extension, as a third party would write one.
 *
 * It runs in a Web Worker. There is no `document` here and no `window` — the
 * browser does not provide them to a worker — so this file could not reach the
 * merchant's page even if it tried. All it can do is describe what it would
 * like shown, using the vocabulary the platform publishes.
 *
 * Served from /public so the sandbox can be demonstrated end to end. A real
 * one would be uploaded by a partner and served from an isolated origin.
 */

self.onmessage = (event) => {
  const { type, context } = event.data ?? {};
  if (type !== 'render') return;

  // Everything this extension knows is what the surface chose to pass in.
  const total = Number(context?.subtotal ?? 0);

  self.postMessage({
    tree: {
      component: 'Stack',
      props: { direction: 'vertical', gap: '200' },
      children: [
        { component: 'Heading', props: { content: 'Delivery estimate' } },
        {
          component: 'Text',
          props: {
            content:
              total > 100
                ? 'Free express delivery — arrives in 2 days.'
                : 'Standard delivery, 5 to 7 days.',
            tone: 'subdued',
          },
        },
        {
          component: 'Badge',
          props: { content: total > 100 ? 'Express' : 'Standard', tone: 'info' },
        },
        { component: 'Button', props: { label: 'Recalculate', action: 'recalculate' } },
      ],
    },
  });
};
