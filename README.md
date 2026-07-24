# @quantpad/pine-runner

Process-isolated Pine Script execution runner. **Licensed under GNU AGPL-3.0-only**
(see [LICENSE](./LICENSE)).

> **⚠ Publish/sync reminder (AGPL §13).** This folder is the _published_
> Corresponding Source for an engine QuantPad runs as a network service, mirrored
> at <https://github.com/QuantPad/pine-runner> and linked in-product. **Any time
> you edit this folder and deploy it, re-publish the mirror** — otherwise the
> running service falls out of AGPL compliance:
>
> ```bash
> npm run pine:publish   # from the monorepo root; no-op if already in sync
> ```
>
> This lives in the monorepo under `pine-runner/`; the sync script is
> `scripts/publish-pine-runner.sh`.

This package wraps a third-party **AGPL-3.0** Pine transpiler/runtime engine and
exposes it as a **spawned child process** that communicates with the host
application over an arm's-length JSON protocol only (request file + bars file in,
one JSON response envelope on stdout). It contains no host application code and
depends on nothing outside this folder — a boundary enforced by the
`self-containment` test.

## Why a separate process

The engine is licensed AGPL-3.0. Running it in-process would arguably combine it
with the surrounding proprietary application. Isolating it behind a process
boundary with only data crossing the boundary follows the recognized GPL-FAQ
"separate programs communicating at arm's length" pattern. This package — its
complete Corresponding Source — is what is published to satisfy AGPL.

## Corresponding Source (AGPL §1 / §13)

This repository is the Corresponding Source for the AGPL-covered Pine engine as
deployed in QuantPad. It contains everything required to build and run the exact
binary the service executes:

- All engine-side source under [`src/`](./src) (the only code that touches the
  engine; the host application communicates with it solely over the JSON
  protocol in [`src/protocol.ts`](./src/protocol.ts)).
- The exact upstream engine version, pinned in
  [`package.json`](./package.json): **`pinets@0.9.27`** (AGPL-3.0-only,
  published on the public npm registry). Bundling that package's source into the
  runner is what makes the AGPL apply here.
- The exact, reproducible build command (below) that produces the deployed
  `dist/main.mjs`.

If you received this as a network user of QuantPad, this repository (linked from
the product) is your offer of Corresponding Source under AGPL §13.

### Modifications to the covered work

Per AGPL §5, the following files carry in-file "Modified by QuantPad" notices;
they adapt or patch the upstream engine and normalize its output:

- [`src/engine.ts`](./src/engine.ts) — neutral loader seam for the upstream package.
- [`src/runtime-compat.ts`](./src/runtime-compat.ts) — patches engine internals for TradingView parity.
- [`src/provider.ts`](./src/provider.ts) — feeds OHLCV into the engine's market-data provider interface.
- [`src/settings.ts`](./src/settings.ts) — wraps the engine's input/prop introspection and override application.
- [`src/normalize.ts`](./src/normalize.ts) — normalizes engine plot/drawing output into the chart artifact shape.

All other files in `src/` are original glue (protocol, codec, CLI, resample,
types) and are likewise licensed AGPL-3.0 as part of this package.

## Protocol

The parent spawns `node dist/main.mjs <requestFile>`. See
[`src/protocol.ts`](./src/protocol.ts).

- `scan` — resolve a script's input/property schema for the settings UI.
- `run` — execute a script over OHLCV bars and return normalized visuals plus a
  bounded raw strategy-state snapshot for parent-side backtest stats.

Numbers use a NaN/Infinity sentinel codec ([`src/codec.ts`](./src/codec.ts))
because plain JSON would coerce Pine's `na` (NaN) to `null`.

## Reproducible build

Requires Node.js 18+ and the pinned `pinets@0.9.27` installed from the npm
registry (the host repo's root `package.json` pins the same version). From this
folder:

```
npm install        # installs pinets@0.9.27
npm run build      # esbuild-bundles src/main.ts (engine included) -> dist/main.mjs
```

The exact build command is also recorded in `package.json` `scripts.build` and,
at the repo root, as the `pine:build` script (run automatically by the
`prebuild`/`predev`/`pretest` hooks). The resulting `dist/main.mjs` is the
binary the service executes; `dist/` is git-ignored because it is fully
regenerated from this source.

## License

AGPL-3.0-only. See [LICENSE](./LICENSE). This program is distributed WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.
