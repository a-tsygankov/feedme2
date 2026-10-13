# device-sim

A fake CrowPanel for feedme2. `DeviceSim` speaks the real device API
(`/api/pair/*`, `/api/device/*`, and `/api/auth/login-token-create` for QR login) using the `@feedme2/shared` contracts; the
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

`pair` generates a random poll secret (32 hex chars), sends it with the start and every
check, and keeps it in the snapshot: the server only hands the token to the holder of
that secret, and only for about a minute after the first delivery. A `pair` that is
interrupted and restarted must start over.

Type the printed 6-digit code into Settings > Devices in the web app, then:

```
pnpm --filter @feedme2/device-sim start state
pnpm --filter @feedme2/device-sim start feed Mochi
pnpm --filter @feedme2/device-sim start sync
```

To sign a phone into the device's house (the device's Login QR screen), a paired sim
asks the API for a one-time token, valid for 60 s, and prints the URL the QR would hold:

```
pnpm --filter @feedme2/device-sim start login-qr
pnpm --filter @feedme2/device-sim start login-qr --web http://127.0.0.1:5192
```

The web base defaults to `https://feedme2-webapp.pages.dev`; `--web` points it at a
local webapp. The URL has the form `<web>/qr#deviceId=…&token=…`: the code is in the
fragment, so it never reaches a server log or a Referer header, and the webapp scrubs it
from the address bar before exchanging it. Opening the URL signs that browser in (a
browser already signed in to another house is asked first); a second open, or one after
the minute, is refused. The token is not saved in the snapshot. An unpaired sim exits 1
without calling the API.

Other commands: `status`, `log <level> <msg>`, `heartbeat`, `login-qr [--web <url>]`,
`forget-local`, `--help`. Log levels are `debug`, `info`, `warn` and `error`; a message is at
most 500 characters. A feeding amount is an integer from 1 to 5000000 mg.

Exit codes: 0 ok, 1 error (bad input, a 4xx such as a forgotten device's 401, a
network failure), 2 for `sync` when a transient failure (network, 5xx, 408, 429)
cut the round short; the queues are kept so it can be run again.
