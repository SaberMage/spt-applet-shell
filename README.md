# spt-applet-shell

The `applet` shell adapter for spt. An agent runs JS/TS scripts (applets) through it. One Node service on each node runs all applets. Each owner has one access point (a shell instance).

Requirements: spt-core 0.88.0 or later. Node 22.18 or later.

## Install

From the GitHub release (recommended):

```sh
spt adapter add --release SaberMage/spt-applet-shell
```

spt gets the `adapter.spt` asset and extracts it into its own adapter folder. No path is necessary.

From a local folder (development). Give an **absolute** path:

```sh
git clone https://github.com/SaberMage/spt-applet-shell C:\tools\spt-applet-shell
spt adapter add C:\tools\spt-applet-shell
```

`spt adapter add <folder>` copies only `manifest.toml`. The code stays in the folder. spt stores a relative path as you typed it, and then the service cannot find `src/service.mjs` (a known spt bug). Use an absolute path until the fix ships.

## Release

```sh
node scripts/pack.mjs     # makes dist/adapter.spt
```

Attach `dist/adapter.spt` to the GitHub release. Its tag is `v` + the version in `manifest.toml`.

## Use

```sh
spt shell spawn applet          # one time; prints SHELL_SPAWNED:<id> (the first id is applet-0)
spt shell cmd applet-0 run applets/timed-send.ts '{"delay_ms":60000,"text":"Check the build."}'
spt shell cmd applet-0 list
spt shell cmd applet-0 stop a1
```

A relative script path is relative to this folder. An applet exports one default async function. It gets `ctx`: `id`, `args`, `sleep(ms)`, `say(text)`, `signal`. `say` sends text to the owner only. The owner gets the text when it has a live session.

## Test

```sh
node --test                                          # unit tests
APPLET_INT=1 node --test tests/int/real-spt.int.mjs  # real spt, throwaway SPT_HOME
```

Integration options: `APPLET_INT_ARCHIVE=1` installs from the extracted `dist/adapter.spt`. `APPLET_TEST_IGNORE_QUIESCE=1` (with the archive option) makes the service ignore Quiesce (`=hang`: block the event loop), and the test checks that no service process stays after the forced stop.

The temp daemon does not pass `APPLET_*` env vars to the service. Thus the test writes the mode into the extracted package (`pkg/.applet-test-quiesce`), and the service writes each stop signal to `pkg/applet-test.log`. The forced stop is proven on Windows only. Before a Linux release, run the hang test on Linux.

The integration test starts a temporary spt daemon (docs port 55474). Ask the node owner before you run it on a shared node.

