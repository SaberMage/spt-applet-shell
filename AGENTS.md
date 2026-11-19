# spt-applet-shell: agent working rules

`spt-applet-shell` is the `applet` shell adapter for spt. Agents use it to run JS/TS applets on Node. One node-wide service runs all applets. Each owner has one access point (a shell instance).

Read before you work: `README.md` (install, use, test) and `CONTEXT.md` (glossary, authoritative for meaning).

## Requirement traceability

`traceable-reqs.toml` is the registry of `REQ-*` requirements.

1. Tag the evidence in the same change, on or immediately above it: `// [impl->REQ-FOO]`, `// [unit->REQ-FOO]`, `// [int->REQ-FOO]`.
2. Run `traceable-reqs check` before you declare work done. Exit 1 means missing evidence.
3. Add a new requirement to `traceable-reqs.toml` before you satisfy it.

## Writing standard

Write all prose (docs, comments, commit bodies, issues) in ASD-STE100 Simplified Technical English. Code, identifiers, commands, and quoted text keep their exact form.

## Conventions

- The spt shell manifest and the frame contract are upstream formats. Copy their field names exactly.
- `node --test` must pass. Run the integration test (`README.md`) for a change to the service or to spt use.
- Commit messages end with the trailer `Co-authored by: applewright`.
