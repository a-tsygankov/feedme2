# device-sim

A fake CrowPanel for feedme2. `DeviceSim` speaks the real device API
(`/api/pair/*`, `/api/device/*`) using the `@feedme2/shared` contracts; the
Playwright system e2e imports it, and the CLI drives it by hand. The device
state (id, token, ETag, cached state, queued feedings and logs) lives in a JSON
snapshot file (`./device-sim.json`, override with `--state`).

```
pnpm --filter @feedme2/device-sim start pair --api http://127.0.0.1:8787
```

Type the printed 6-digit code into Settings > Devices in the web app, then:

```
pnpm --filter @feedme2/device-sim start state
pnpm --filter @feedme2/device-sim start feed Mochi
pnpm --filter @feedme2/device-sim start sync
```

Other commands: `status`, `log <level> <msg>`, `heartbeat`, `forget-local`.
