import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

// Re-bind the `screen` singleton after registration. @testing-library/dom binds
// `screen` to `document.body` at module-eval time; under bun the transpiled
// module graph evaluates screen.js before this preload body runs (before
// happy-dom registers a document), so the shipped `screen` is the throwing
// "no global document" stub. Rebinding its queries against the now-real
// document.body makes `screen` usable in tests, matching standard jsdom setups.
import { getQueriesForElement, queries, screen } from '@testing-library/dom';

Object.assign(screen, getQueriesForElement(document.body, queries));

import { afterEach } from 'bun:test';
import { cleanup } from '@testing-library/preact';

afterEach(cleanup);
