/**
 * Deployment constants.
 *
 * Zone and region are hardcoded on purpose: the user does not care which zone,
 * and exposing it would add a form field that never gets a considered answer.
 */
export const PROJECT_ID = process.env.GCP_PROJECT_ID ?? 'alan-ko-playground'
export const ZONE = process.env.GCP_ZONE ?? 'northamerica-northeast1-b'

/** Every sandbox VM carries this prefix so it is distinguishable from the
 * user's other Tailscale devices at a glance. Enforced server-side. */
export const NAME_PREFIX = 'sb-'
export const NAME_PATTERN = /^sb-[a-z0-9-]{1,40}$/

/** Identifies instances this control plane owns, so the list never shows
 * unrelated VMs in the project. */
export const MANAGED_BY = 'sb'

export const IMAGE_FAMILY = 'ubuntu-2604-lts-amd64'
export const IMAGE_PROJECT = 'ubuntu-os-cloud'
export const DISK_TYPE = 'pd-balanced'

export const MACHINE_TYPES = [
  { value: 'e2-standard-2', label: 'e2-standard-2 (2 vCPU / 8 GiB)' },
  { value: 'e2-standard-4', label: 'e2-standard-4 (4 vCPU / 16 GiB)' },
  { value: 'e2-standard-8', label: 'e2-standard-8 (8 vCPU / 32 GiB)' },
] as const

export const DEFAULT_MACHINE_TYPE = 'e2-standard-4'

/** VM service account. Deliberately minimal: it can read the Tailscale auth key
 * and nothing else, because agents on these boxes run with broad permissions. */
export const VM_SERVICE_ACCOUNT =
  process.env.SB_VM_SERVICE_ACCOUNT ?? `sb-sandbox-vm@${PROJECT_ID}.iam.gserviceaccount.com`

export const TAILNET = process.env.TAILNET ?? 'tail8e363.ts.net'
