# sb

A small web app for running throwaway Linux boxes on GCE, built for using Claude Code with subagents on projects that are too heavy for a laptop.

Create a VM from a template, watch it boot, work on it over Tailscale SSH, stop it when you're done. A stopped GCE VM only bills for its disk, which is the whole reason this targets GCE instead of something simpler.

## How it works

The control plane is a TanStack Start app on Cloud Run, behind IAP so only you can open it. It has no database. The list of VMs is a `instances.list` call filtered by label, each VM's template is stored as a label on the instance, and provisioning progress comes from guest attributes the VM writes about itself. There is nothing to keep in sync and nothing to back up.

Each VM gets an ephemeral external IP (it needs internet to reach Tailscale before Tailscale exists) but no ingress firewall rule, so in practice the IP is outbound only. Once Tailscale is up, the box joins your tailnet as `sb-<name>` and routes its egress through the `ko-nas` exit node at home. You reach it as `sb-<name>.tail8e363.ts.net` with no key management, because Tailscale SSH handles auth.

Templates do not live in the container image the VM talks to. A GitHub Action tars up `templates/` and `scripts/` on every push to main and publishes them as a release; the VM's startup script downloads that tarball. The same workflow run deploys the app, so the template list in the dropdown and the tarball on disk always come from one commit.

## Repo layout

```
app/          TanStack Start control plane (Mantine UI, server routes)
templates/    _base runs on every VM; each other directory is a selectable template
scripts/      bootstrap.sh (the startup-script) and rerun
Dockerfile    builds from the repo root so templates/ lands in the image
```

## Writing a template

A template is a directory under `templates/` with two files.

`template.yaml` describes the VM:

```yaml
description: "Full-stack: Postgres 16 in Docker, Node dev server"
disk:
  sizeGb: 80
```

Both fields are required. There is no default disk size on purpose: how much disk a workload needs is a property of that workload, and a template that silently inherits 50 GB will eventually surprise you. A missing or malformed `template.yaml` fails the release build and shows up as an error in the UI rather than quietly disappearing from the dropdown.

`setup.sh` does the work. It runs as root after `_base/setup.sh`, and **it must be idempotent**, because `sandbox-rerun` on a live VM re-executes both. Guard your installs with `command -v` checks and your `docker run` calls with a container-exists check. `templates/fullstack/setup.sh` is a worked example.

Anything else in the directory is copied along with it and available at `$SANDBOX_ROOT/templates/<name>/`.

To iterate on a template without rebuilding a VM: push, wait for the release, then `sandbox-rerun` on the box.

## First-time setup

These steps need a human. Everything after them is automated.

**GCP.** Link billing to `alan-ko-playground`, then enable the APIs:

```sh
gcloud services enable compute.googleapis.com run.googleapis.com iap.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com \
  --project=alan-ko-playground
gcloud artifacts repositories create sb --repository-format=docker \
  --location=northamerica-northeast1 --project=alan-ko-playground
```

**Service accounts.** Three, each with as little as possible:

| Account | Used by | Permissions |
|---|---|---|
| `sb-sandbox-vm` | every sandbox VM | read the `tailscale-authkey` secret, nothing else |
| `sb-control-plane` | Cloud Run | `compute.instanceAdmin.v1`, `iam.serviceAccountUser` on `sb-sandbox-vm`, read `tailscale-oauth-client` |
| `sb-deployer` | GitHub Actions | `run.admin`, `artifactregistry.writer`, `iam.serviceAccountUser` on `sb-control-plane` |

`sb-sandbox-vm` is minimal for a reason. Agents on these boxes run with broad local permissions, and there is no case where one of them should be able to touch the project.

The `iam.serviceAccountUser` grant on `sb-control-plane` is easy to forget and fails in a confusing way: instance creation is rejected because the caller cannot attach `sb-sandbox-vm` to a new VM.

**Tailscale.** In the admin console, mint an auth key that is reusable, pre-approved, and **not** ephemeral. Ephemeral nodes get reaped when they go offline, so every stop/start would churn the node identity and break the hostname. Tailscale state lives in `/var/lib/tailscale`, so the key is only consumed on first boot.

Then create an OAuth client with the `devices:core` scope, which covers listing and removing devices on delete.

Store both:

```sh
printf '%s' "tskey-auth-..." | gcloud secrets create tailscale-authkey --data-file=-
printf '{"clientId":"...","clientSecret":"..."}' | gcloud secrets create tailscale-oauth-client --data-file=-
```

Your tailnet ACL needs an SSH rule allowing you to connect as the `alanko` user on `tag:sandbox` nodes.

**GitHub.** Set up Workload Identity Federation (no JSON key, the repo is public) and add `WIF_PROVIDER` and `WIF_SERVICE_ACCOUNT` as repo secrets, plus a `TAILNET` repo variable.

**IAP.** The first enable has to happen in the Cloud Console, because OAuth clients cannot be created through the API. Deploy once, turn IAP on in the console, then grant yourself access:

```sh
gcloud beta iap web add-iam-policy-binding --resource-type=cloud-run \
  --service=sb-control-plane --region=northamerica-northeast1 \
  --member=user:you@example.com --role=roles/iap.httpsResourceAccessor --condition=None
```

Afterwards the `--iap` flag in the workflow keeps it on.

## Local development

```sh
cd app
nub install
nub run dev
```

Authentication falls back to a fake local identity when there is no IAP header, so `gcloud auth application-default login` is all you need. Calls hit the real project, so anything you create is a real VM.

## Using a sandbox

Once the UI shows `ready`:

```sh
ssh sb-myproject
claude login
gh auth login
herdr machine add sb-myproject --label myproject
```

The two logins persist for the life of the VM, so this is once per box rather than once per session. They cannot be automated, which is why there is no per-template secret mechanism.

## What it costs

Nothing runs continuously. Cloud Run scales to zero, IAP is free, there is no static IP and no NAT gateway. What you pay for is compute while a VM is on, and disk whether or not it is.

| | cost |
|---|---|
| `e2-standard-4` running | ~$0.148/hr, so ~$24 for 160 hours a month |
| 50 GB disk, stopped or running | ~$5.50/month |

The trap is not a VM you left running, it is five VMs you stopped and forgot. That's why the list shows age and disk size next to the power state, and why delete removes the disk and the tailnet device rather than leaving either behind.

## Things that will bite you

The serial console is a ~1 MB ring buffer. A very chatty `setup.sh` can push its own early output out of reach.

The exit node is enabled last, after every package is installed. Turning it on earlier routes all of apt through your house for no benefit.

GCE runs the startup script on every boot, not just the first. `bootstrap.sh` uses a marker file so a stop/start does not re-run a five minute setup.

Cloud Run needs `--timeout=3600` for the boot log stream. The default 300 seconds cuts it off mid-provision.
