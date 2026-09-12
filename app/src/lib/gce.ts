import { GoogleAuth } from 'google-auth-library'
import {
  DISK_TYPE,
  IMAGE_FAMILY,
  IMAGE_PROJECT,
  MANAGED_BY,
  NAME_PATTERN,
  PROJECT_ID,
  VM_SERVICE_ACCOUNT,
  ZONE,
} from './config'
import { getTemplate, readBootstrapScript } from './templates'

/**
 * Compute Engine access over plain REST.
 *
 * Deliberately not @google-cloud/compute: that client pulls ~56 MB of protobuf
 * definitions into the server bundle, and this service scales to zero, so every
 * first request after an idle period would pay to parse it. The handful of
 * endpoints used here are simple enough that REST costs nothing in clarity.
 */
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})

const BASE = `https://compute.googleapis.com/compute/v1/projects/${PROJECT_ID}`
const ZONE_BASE = `${BASE}/zones/${ZONE}`

type HttpError = { response?: { status?: number } }

async function call<T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const client = await auth.getClient()
  const res = await client.request<T>({
    url,
    method: (init.method ?? 'GET') as 'GET',
    ...(init.body === undefined ? {} : { data: init.body }),
  })
  return res.data
}

/** 404 is a normal answer for several of these, not a failure. */
async function callOrNull<T>(url: string): Promise<T | null> {
  try {
    return await call<T>(url)
  } catch (err) {
    if ((err as HttpError).response?.status === 404) return null
    throw err
  }
}

export type Vm = {
  name: string
  status: string
  machineType: string
  diskGb: number
  template: string
  createdAt: string
  stage?: string | null
}

type RawInstance = {
  name?: string
  status?: string
  machineType?: string
  creationTimestamp?: string
  labels?: Record<string, string>
  disks?: Array<{ diskSizeGb?: string }>
}

/** Strip the resource-URL prefix GCE returns on machineType, zone, etc. */
const lastSegment = (url?: string) => (url ?? '').split('/').pop() ?? ''

function toVm(i: RawInstance): Vm {
  return {
    name: i.name ?? '',
    status: i.status ?? 'UNKNOWN',
    machineType: lastSegment(i.machineType),
    diskGb: Number(i.disks?.[0]?.diskSizeGb ?? 0),
    template: i.labels?.template ?? 'unknown',
    createdAt: i.creationTimestamp ?? '',
  }
}

export async function list(): Promise<Array<Vm>> {
  const filter = encodeURIComponent(`labels.managed-by=${MANAGED_BY}`)
  const data = await call<{ items?: Array<RawInstance> }>(
    `${ZONE_BASE}/instances?filter=${filter}`,
  )
  return (data.items ?? []).map(toVm)
}

export async function get(name: string): Promise<Vm | null> {
  const data = await callOrNull<RawInstance>(`${ZONE_BASE}/instances/${name}`)
  return data ? toVm(data) : null
}

export async function create(opts: {
  name: string
  template: string
  machineType: string
}) {
  if (!NAME_PATTERN.test(opts.name)) {
    throw new Error(
      `invalid name "${opts.name}" — must match ${NAME_PATTERN} (the sb- prefix is required)`,
    )
  }

  // Disk size comes from the template, never from the caller, so a hand-rolled
  // request cannot provision an arbitrarily large disk.
  const template = getTemplate(opts.template)

  const op = await call<{ name?: string }>(`${ZONE_BASE}/instances`, {
    method: 'POST',
    body: {
      name: opts.name,
      machineType: `zones/${ZONE}/machineTypes/${opts.machineType}`,
      labels: { 'managed-by': MANAGED_BY, template: template.name },
      disks: [
        {
          boot: true,
          autoDelete: true, // delete means delete — no orphaned disks billing
          initializeParams: {
            sourceImage: `projects/${IMAGE_PROJECT}/global/images/family/${IMAGE_FAMILY}`,
            diskSizeGb: String(template.diskSizeGb),
            diskType: `zones/${ZONE}/diskTypes/${DISK_TYPE}`,
          },
        },
      ],
      // An ephemeral external IP: the VM needs internet to reach Tailscale's
      // coordination server before Tailscale exists. It costs nothing while
      // stopped, and nothing can reach in because no ingress rule allows it.
      networkInterfaces: [
        {
          network: 'global/networks/default',
          accessConfigs: [{ name: 'External NAT', type: 'ONE_TO_ONE_NAT' }],
        },
      ],
      serviceAccounts: [
        {
          email: VM_SERVICE_ACCOUNT,
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        },
      ],
      metadata: {
        items: [
          { key: 'startup-script', value: readBootstrapScript() },
          { key: 'sandbox-template', value: template.name },
          // Without this the VM cannot report its provisioning stage at all.
          { key: 'enable-guest-attributes', value: 'TRUE' },
        ],
      },
    },
  })
  return op.name
}

export async function stop(name: string) {
  const op = await call<{ name?: string }>(`${ZONE_BASE}/instances/${name}/stop`, {
    method: 'POST',
  })
  return op.name
}

export async function start(name: string) {
  const op = await call<{ name?: string }>(`${ZONE_BASE}/instances/${name}/start`, {
    method: 'POST',
  })
  return op.name
}

/**
 * Graceful power cycle.
 *
 * Deliberately not `instances/reset`: that is a hard power-cut that risks
 * filesystem corruption and kills whatever an agent was mid-write on.
 */
export async function reboot(name: string) {
  const stopOp = await stop(name)
  if (stopOp) {
    // `wait` returns when the operation finishes or after ~2 minutes, so poll
    // until the instance is actually down before trying to start it again.
    for (let i = 0; i < 10; i++) {
      const op = await call<{ status?: string }>(
        `${ZONE_BASE}/operations/${stopOp}/wait`,
        { method: 'POST' },
      )
      if (op.status === 'DONE') break
    }
  }
  return start(name)
}

export async function destroy(name: string) {
  const op = await call<{ name?: string }>(`${ZONE_BASE}/instances/${name}`, {
    method: 'DELETE',
  })
  return op.name
}

/**
 * Incremental serial console read.
 *
 * This is the only log source that covers the whole boot — kernel, cloud-init,
 * then our scripts — with nothing installed on the VM. The buffer is a ~1 MB
 * ring, so a very chatty setup can lose its earliest bytes.
 */
export async function serialOutput(name: string, start: number) {
  const data = await call<{ contents?: string; next?: string }>(
    `${ZONE_BASE}/instances/${name}/serialPort?port=1&start=${start}`,
  )
  return { contents: data.contents ?? '', next: Number(data.next ?? start) }
}

/**
 * Provisioning stage as reported by the VM via guest attributes.
 *
 * GCE reports RUNNING the moment the VM powers on, minutes before setup
 * finishes, so instance status alone would actively mislead the UI.
 */
export async function readStage(name: string): Promise<string | null> {
  const path = encodeURIComponent('sandbox/status')
  const data = await callOrNull<{
    variableValue?: string
    queryValue?: { items?: Array<{ value?: string }> }
  }>(`${ZONE_BASE}/instances/${name}/getGuestAttributes?queryPath=${path}`)

  // A queryPath query answers with queryValue.items, not variableValue.
  return data?.variableValue ?? data?.queryValue?.items?.[0]?.value ?? null
}
