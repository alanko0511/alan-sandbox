/** Shared JSON/error helpers so every route reports failures the same way. */
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Turn a thrown value into a response.
 *
 * A thrown `Response` (how auth rejects) passes through untouched; everything
 * else becomes a 500 carrying the real message, because a sandbox control plane
 * with one user benefits far more from a readable error than from opacity.
 */
export function problem(err: unknown) {
  if (err instanceof Response) return err
  const message = err instanceof Error ? err.message : String(err)
  console.error('[api]', err)
  return json({ error: message }, 500)
}
