# 32. Persist sprite prefetch responses before service-worker control

## Status

Accepted

## Context

The party-creation checkbox started image downloads but relied on the service worker's fetch handler to store them. On a first visit the worker may not control the page yet, leaving downloaded sprites absent from Cache Storage. A separate synchronous form re-render during `createParty()` reset an unchecked choice before the submit handler read it.

## Decision

- Prefetch writes successful or opaque image responses directly to the shared sprite cache, using a `no-cors` request and an opaque-compatible response clone, before a task settles. This preserves WebKit's offline sprite behavior and does not require an active controller.
- Use the same 4000-entry cache bound as the worker. Failed readable HTTP responses are never cached.
- Snapshot the checkbox before mutating the store so synchronous rendering cannot change the submitted preference. Existing automatic modern-sprite warming remains separate from explicit game-specific caching.
- Test party creation on an intercepted secure non-localhost origin with service workers blocked. Check that the opted-in game sprites are actually stored and survive reload. The unchecked source-level test observes that the creation flow does not invoke game prefetch; it does not make a manual test-only call to trigger the behavior.

## Consequences

Prefetch may store a response already written by an active worker; both use the same cache and request mode. Offline preparation no longer depends on worker activation timing. Cache writes and trimming are part of the task's asynchronous completion.
