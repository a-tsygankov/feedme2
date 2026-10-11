# device-sim

A fake CrowPanel for feedme2. `DeviceSim` speaks the real device API
(`/api/pair/*`, `/api/device/*`) using the `@feedme2/shared` contracts; the
Playwright system e2e imports it, and the CLI drives it by hand. The device
state (id, token, ETag, cached state, queued feedings and logs, and the API
base) lives in a JSON snapshot file, `./device-sim.json` relative to the
current directory (override with `--state`). `pnpm --filter ... start` runs in
this package's directory, so the file lands in `tools/device-sim/`. The API base
defaults to `http://127.0.0.1:8787`; once saved in the snapshot it is reused, and
`--api <url>` overrides (and re-saves) it.

```
pnpm --filter @feedme2/device-sim start pair --api http://127.0.0.1:8787
```

Type the printed 6-digit code into Settings > Devices in the web app, then:

```
pnpm --filter @feedme2/device-sim start state
pnpm --filter @feedme2/device-sim start feed Mochi
pnpm --filter @feedme2/device-sim start sync
```

Other commands: `status`, `log <level> <msg>`, `heartbeat`, `forget-local`,
`--help`. Log levels are `debug`, `info`, `warn` and `error`; a message is at
most 500 characters. A feeding amount is an integer from 1 to 5000000 mg.

Exit codes: 0 ok, 1 error (bad input, a 4xx such as a forgotten device's 401, a
network failure), 2 for `sync` when a transient failure (network, 5xx, 408, 429)
cut the round short; the queues are kept so it can be run again.
