import { OAuth2Client } from 'google-auth-library'

/**
 * Identify the caller from IAP.
 *
 * IAP sets both `x-goog-authenticated-user-email` and a signed JWT assertion.
 * Only the assertion is trustworthy — the plain header is forgeable by anything
 * that can reach the service off-IAP, so it is used for display only after the
 * signature checks out.
 */
const client = new OAuth2Client()
const IAP_ISSUER = 'https://cloud.google.com/iap'

/**
 * Expected `aud` claim. Its exact shape depends on how IAP is attached, so it
 * is configured rather than guessed; when unset the signature and issuer are
 * still verified and the observed value is logged once so it can be pinned.
 */
const AUDIENCE = process.env.IAP_AUDIENCE
let loggedAudience = false

export type Caller = { email: string; verified: boolean }

export async function requireCaller(request: Request): Promise<Caller> {
  const assertion = request.headers.get('x-goog-iap-jwt-assertion')

  if (!assertion) {
    // Local development runs without IAP in front of it.
    if (process.env.NODE_ENV !== 'production') {
      return { email: 'dev@localhost', verified: false }
    }
    throw new Response('Forbidden: missing IAP assertion', { status: 403 })
  }

  const keys = await client.getIapPublicKeys()
  const ticket = await client.verifySignedJwtWithCertsAsync(
    assertion,
    keys.pubkeys,
    AUDIENCE,
    [IAP_ISSUER],
  )

  const payload = ticket.getPayload()
  if (!payload?.email) {
    throw new Response('Forbidden: IAP assertion has no email', { status: 403 })
  }

  if (!AUDIENCE && !loggedAudience) {
    loggedAudience = true
    console.warn(
      `[auth] IAP_AUDIENCE is unset; observed aud="${payload.aud}". Set IAP_AUDIENCE to pin it.`,
    )
  }

  return { email: payload.email, verified: true }
}
