# CONTEXT: glossary

This file is authoritative for meaning. When code or prose disagrees with a definition here, this file is correct and the other text has the bug.

## Glossary

**Applet**: a JS or TS script that an agent runs through the `applet` shell. It exports one default async function. The applet service gives each applet an id (`a1`, `a2`, ...).

**Access point**: the one `applet` shell instance of an owner (for example `applet-0`). The owner sends `run`, `stop`, and `list` to it. An applet does not end its access point.

**Applet service**: the one Node process of the `applet` adapter on a node (`src/service.mjs`). spt starts and stops it. It runs each applet in its own worker thread.

**Applet context** (`ctx`): the object that the applet service gives to an applet: `id`, `args`, `sleep`, `say`, `signal`. `say` sends text to the owner only.
