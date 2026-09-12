import { createFileRoute } from '@tanstack/react-router'
import { requireCaller } from '#/lib/auth'
import { create, list } from '#/lib/gce'
import { json, problem } from '#/lib/http'
import { DEFAULT_MACHINE_TYPE, MACHINE_TYPES } from '#/lib/config'

export const Route = createFileRoute('/api/vms')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireCaller(request)
          return json({ vms: await list() })
        } catch (err) {
          return problem(err)
        }
      },

      POST: async ({ request }) => {
        try {
          await requireCaller(request)
          const body = (await request.json()) as {
            name?: string
            template?: string
            machineType?: string
          }

          if (!body.name || !body.template) {
            return json({ error: 'name and template are required' }, 400)
          }

          const machineType = body.machineType ?? DEFAULT_MACHINE_TYPE
          if (!MACHINE_TYPES.some((m) => m.value === machineType)) {
            return json({ error: `unsupported machine type: ${machineType}` }, 400)
          }

          // Note: no disk size is accepted here — it comes from the template.
          const operation = await create({
            name: body.name,
            template: body.template,
            machineType,
          })
          return json({ name: body.name, operation }, 202)
        } catch (err) {
          return problem(err)
        }
      },
    },
  },
})
