import { createFileRoute } from '@tanstack/react-router'
import { requireCaller } from '#/lib/auth'
import { readStage, serialOutput } from '#/lib/gce'
import { problem } from '#/lib/http'
import { NAME_PATTERN } from '#/lib/config'

const POLL_MS = 1500

/**
 * Stream the VM's serial console as SSE.
 *
 * GCE reports RUNNING the instant the VM powers on — minutes before setup
 * finishes — so the serial console is the only honest progress signal, and the
 * only one available before the box is on the tailnet.
 *
 * Requires Cloud Run `--timeout=3600`; the 300s default would cut the stream.
 */
export const Route = createFileRoute('/api/vms/$name/logs')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          await requireCaller(request)
          if (!NAME_PATTERN.test(params.name)) {
            return new Response('invalid name', { status: 400 })
          }
          const name = params.name

          const encoder = new TextEncoder()
          let cursor = 0
          let lastStage: string | null = null
          let closed = false

          const stream = new ReadableStream({
            async start(controller) {
              const send = (event: string, data: unknown) => {
                if (closed) return
                controller.enqueue(
                  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
                )
              }

              // Client navigating away must stop the polling loop, or the
              // Cloud Run instance stays pinned for the full hour timeout.
              request.signal.addEventListener('abort', () => {
                closed = true
              })

              while (!closed) {
                try {
                  const { contents, next } = await serialOutput(name, cursor)
                  if (contents) {
                    cursor = next
                    send('log', { contents })
                  }

                  const stage = await readStage(name)
                  if (stage !== lastStage) {
                    lastStage = stage
                    send('stage', { stage })
                  }

                  if (stage === 'ready' || stage?.startsWith('failed')) {
                    send('done', { stage })
                    break
                  }
                } catch (err) {
                  send('error', {
                    message: err instanceof Error ? err.message : String(err),
                  })
                  break
                }

                await new Promise((r) => setTimeout(r, POLL_MS))
              }

              closed = true
              try {
                controller.close()
              } catch {
                // already closed by the client disconnecting
              }
            },
          })

          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
            },
          })
        } catch (err) {
          return problem(err)
        }
      },
    },
  },
})
