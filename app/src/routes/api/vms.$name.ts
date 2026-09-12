import { createFileRoute } from '@tanstack/react-router'
import { requireCaller } from '#/lib/auth'
import { destroy, get, readStage, reboot, start, stop } from '#/lib/gce'
import { deleteDevice } from '#/lib/tailscale'
import { json, problem } from '#/lib/http'
import { NAME_PATTERN } from '#/lib/config'

export const Route = createFileRoute('/api/vms/$name')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          await requireCaller(request)
          const vm = await get(params.name)
          if (!vm) return json({ error: 'not found' }, 404)
          return json({ ...vm, stage: await readStage(params.name) })
        } catch (err) {
          return problem(err)
        }
      },

      POST: async ({ request, params }) => {
        try {
          await requireCaller(request)
          if (!NAME_PATTERN.test(params.name)) {
            return json({ error: 'invalid name' }, 400)
          }

          const { action } = (await request.json()) as { action?: string }
          switch (action) {
            case 'stop':
              return json({ operation: await stop(params.name) }, 202)
            case 'start':
              return json({ operation: await start(params.name) }, 202)
            case 'reboot':
              // Stop-then-start, not reset: see gce.reboot.
              return json({ operation: await reboot(params.name) }, 202)
            default:
              return json({ error: `unknown action: ${action}` }, 400)
          }
        } catch (err) {
          return problem(err)
        }
      },

      DELETE: async ({ request, params }) => {
        try {
          await requireCaller(request)
          if (!NAME_PATTERN.test(params.name)) {
            return json({ error: 'invalid name' }, 400)
          }

          const operation = await destroy(params.name)

          // Remove the tailnet node too, otherwise the next VM with this name
          // comes back as sb-<name>-1 and every SSH alias built on it breaks.
          const device = await deleteDevice(params.name)

          return json({ operation, device }, 202)
        } catch (err) {
          return problem(err)
        }
      },
    },
  },
})
