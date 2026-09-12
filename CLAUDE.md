# CLAUDE.md

`README.md` covers what this is, how to set it up, and how to author a template. This file covers what you need to change it safely.

## Two deploy surfaces

A push to `main` runs one workflow with two jobs, and which one carries your change decides how it reaches production:

- **`app/`** → container image → Cloud Run. Live as soon as the workflow finishes.
- **`templates/` and `scripts/`** → release tarball. A VM only picks this up when it is created, or when you run `sandbox-rerun` on it.

An already-running VM is pinned to the release it booted from. Editing a template changes nothing on existing boxes until you rerun.

## Verifying a change

There is no local path for anything VM-side. `nub run dev` in `app/` exercises the UI and the GCE calls against the real project, but boot, Tailscale, and the exit node only exist on a real instance.

The loop for a template or script change:

1. push, wait for the release
2. `sandbox-rerun` on an existing VM (fast), or create a fresh one when the change affects first-boot ordering (slow, but the only honest test of ordering)
3. `gcloud compute instances get-serial-port-output <name> --zone=northamerica-northeast1-b`

Prefer `sandbox-rerun` while iterating. Reach for a fresh VM when boot order matters — a fix that works on a rerun can still be wrong on a cold boot, which is exactly how the metadata-route bug survived its first fix.

A running e2-standard-4 costs about $0.15/hr, so delete test VMs when you are done rather than leaving them for later.

## Invariants

These were decided deliberately. Changing one is a product decision, not a refactor:

- **No database.** VM list is `instances.list` filtered on `labels.managed-by=sb`; the template is a label; provisioning stage is a guest attribute. Keep new state on the instance rather than introducing a store.
- **Disk size comes from `template.yaml`,** never from the request. `create()` ignores any caller-supplied size on purpose.
- **`sb-sandbox-vm` holds no project roles.** It reads one secret. Agents on these boxes run with broad local permissions, so widening this identity is the one change most likely to hurt.
- **Reboot is stop-then-start,** never `instances.reset`.
- **No idle auto-stop.** Connection-based shutdown would fight herdr's persistence and kill running agents; deliberately deferred.

Constants live in `app/src/lib/config.ts` — zone, image family, machine types, name pattern, service account. Change them there, not inline.

## Traps that cost real debugging time

None of these are visible in the code or config, and each one was found the hard way.

**Guest attributes come back as `queryValue.items[]`, not `variableValue`.** A `queryPath` query never populates `variableValue`, so reading it returns null and the stage silently never advances.

**`gcloud ... --format="value(queryValue.items[0].value)"` returns empty, without erroring.** Indexing into that field does not work. Parse the table output or call the REST API. This one wastes time by making a working system look broken.

**The serial port 404s for a few seconds after an instance is created.** The SSE loop tolerates roughly a minute of consecutive errors for this reason. A stream opened from the create modal races the instance; treating the first error as fatal leaves the log drawer permanently empty.

**Status reporting ends in `|| true`.** A VM that cannot reach its metadata server still finishes provisioning and looks healthy, while the stage badge sits on "provisioning" forever. When you touch anything in the boot path, verify the stage actually reaches `ready` rather than trusting that setup exited 0.

`README.md` has the operational gotchas that bite at runtime rather than while editing: the metadata route and tailscaled ordering, the serial ring buffer, the Cloud Run SSE timeout, and the startup script running on every boot.

## Prose

Load the `humanizer` skill before writing README prose, release notes, or anything else a person reads as writing. Commit subjects and comments do not need it.
