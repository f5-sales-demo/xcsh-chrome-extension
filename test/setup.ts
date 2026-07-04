import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

// Explicitly unmount every render after each test. @testing-library/preact only
// auto-registers this when it detects a global `afterEach`; under some bun
// versions the test globals aren't exposed that way, so its auto-cleanup never
// runs and rendered nodes accumulate in the single shared happy-dom document.
// That cross-test leak made body-scoped queries (getBy*) match elements from a
// prior file — a CI-only failure. Registering cleanup here guarantees isolation
// in every environment, independent of that detection.
import { afterEach } from 'bun:test';
import { cleanup } from '@testing-library/preact';

afterEach(cleanup);
