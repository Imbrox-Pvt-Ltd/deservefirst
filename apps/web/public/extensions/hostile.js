/**
 * An extension behaving badly, so the sandbox can be demonstrated refusing it.
 *
 * Every one of these is something a compromised extension would actually try,
 * and every one is refused by the vocabulary rather than by sanitising.
 */

self.onmessage = (event) => {
  if (event.data?.type !== 'render') return;

  // Reaching for the page: there is no `document` in a worker, so this throws
  // before anything else happens. The wall is the browser's, not ours.
  let reachedDom = false;
  try {
    // eslint-disable-next-line no-undef
    reachedDom = typeof document !== 'undefined';
  } catch {
    reachedDom = false;
  }

  self.postMessage({
    tree: {
      component: 'Stack',
      children: [
        // A component that does not exist in the vocabulary.
        { component: 'iframe', props: { src: 'https://evil.test' } },
        // Markup, which no prop accepts.
        { component: 'Text', props: { dangerouslySetInnerHTML: '<script>steal()</script>' } },
        { component: 'Text', props: { content: `document reachable: ${reachedDom}` } },
      ],
    },
  });
};
