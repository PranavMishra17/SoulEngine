# ERR-003: Serve Realtime Voice WebSocket on Main HTTP Port

## Problem
The voice WebSocket is currently served on `port+1` via a separate WebSocketServer instance, making it unreachable on PaaS platforms (Render, Heroku, etc.) that expose only one port. The client also incorrectly derives the WS URL as `httpPort+1`, causing connection failures in production.

## Acceptance Criteria
1. Voice WebSocket served on SAME port as HTTP API using Node http server's `upgrade` event, routing only `/ws/voice`
2. Client connects to `/ws/voice` on page origin with NO port arithmetic
3. Non-`/ws/voice` upgrade requests rejected; missing/unknown `session_id` connections closed with existing code/reason
4. `npm run build` clean and `npm test` green

## Approach
Replace the separate `WebSocketServer({ port: port+1 })` with a `noServer: true` configuration and wire the existing Node http server's `upgrade` event. On upgrade requests to `/ws/voice`, perform the handshake; reject all other paths. Preserve the existing session verification and handoff to `handleVoiceWebSocket`. Update client to derive WS URL from window.location.host without port arithmetic.

## Files to Touch
- `src/index.ts` - Replace separate WSS with upgrade event handler
- `web/js/api.js` - Fix client WS URL derivation
- `tests/e2e/err-003-ws-same-port.test.ts` - E2E test proving same-port connectivity
- `package.json` - Add Vitest and test script
- `vitest.config.ts` - Minimal Vitest configuration

## Test Plan
1. **E2E test**: Start HTTP server on ephemeral port, connect WS client to `ws://127.0.0.1:<samePort>/ws/voice?session_id=test`, assert upgrade succeeds (or expected close for unknown session)
2. **Rejection test**: Connect to non-`/ws/voice` path, assert upgrade is rejected
3. **Integration test**: Run `npm test` - must pass
4. **Build test**: Run `npm run build` - must complete with no errors
