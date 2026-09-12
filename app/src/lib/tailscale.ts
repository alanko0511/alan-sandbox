import { TAILNET } from './config'

/**
 * Tailscale API access.
 *
 * Only used on delete: without removing the tailnet device, deleted VMs pile up
 * as offline `sb-*` nodes forever and a recreated `sb-foo` silently comes back
 * as `sb-foo-1`, breaking the SSH alias the user relies on.
 *
 * Credentials arrive as a Cloud Run secret env var (JSON), so there is no
 * Secret Manager client dependency here.
 */
const API = 'https://api.tailscale.com/api/v2'

type OAuthCreds = { clientId: string; clientSecret: string }

function credentials(): OAuthCreds | null {
  const raw = process.env.TAILSCALE_OAUTH
  if (!raw) return null
  const parsed = JSON.parse(raw) as Partial<OAuthCreds>
  if (!parsed.clientId || !parsed.clientSecret) {
    throw new Error('TAILSCALE_OAUTH must be JSON with clientId and clientSecret')
  }
  return { clientId: parsed.clientId, clientSecret: parsed.clientSecret }
}

/** Short-lived access token from the OAuth client (scope: devices:core). */
async function accessToken(creds: OAuthCreds): Promise<string> {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'client_credentials',
      scope: 'devices:core',
    }),
  })
  if (!res.ok) {
    throw new Error(`tailscale oauth failed: ${res.status} ${await res.text()}`)
  }
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new Error('tailscale oauth returned no access_token')
  return body.access_token
}

/**
 * Remove the tailnet device matching a VM hostname.
 *
 * Returns what happened rather than throwing on "not found": a VM deleted
 * before it ever joined the tailnet is a normal outcome, not an error.
 */
export async function deleteDevice(
  hostname: string,
): Promise<'deleted' | 'not-found' | 'skipped'> {
  const creds = credentials()
  if (!creds) return 'skipped' // no credentials configured (e.g. local dev)

  const token = await accessToken(creds)
  const auth = { Authorization: `Bearer ${token}` }

  const listRes = await fetch(`${API}/tailnet/${TAILNET}/devices`, { headers: auth })
  if (!listRes.ok) {
    throw new Error(`tailscale device list failed: ${listRes.status}`)
  }

  const { devices = [] } = (await listRes.json()) as {
    devices?: Array<{ id: string; name: string; hostname: string }>
  }

  // `name` is the MagicDNS FQDN (sb-foo.tailnet.ts.net); `hostname` is bare.
  const device = devices.find(
    (d) => d.hostname === hostname || d.name.split('.')[0] === hostname,
  )
  if (!device) return 'not-found'

  const delRes = await fetch(`${API}/device/${device.id}`, {
    method: 'DELETE',
    headers: auth,
  })
  if (!delRes.ok && delRes.status !== 404) {
    throw new Error(`tailscale device delete failed: ${delRes.status}`)
  }
  return 'deleted'
}
