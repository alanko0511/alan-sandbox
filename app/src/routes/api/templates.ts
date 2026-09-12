import { createFileRoute } from '@tanstack/react-router'
import { requireCaller } from '#/lib/auth'
import { listTemplates } from '#/lib/templates'
import { DEFAULT_MACHINE_TYPE, MACHINE_TYPES, NAME_PREFIX } from '#/lib/config'
import { json, problem } from '#/lib/http'

export const Route = createFileRoute('/api/templates')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireCaller(request)
          // A broken template.yaml throws here rather than silently vanishing
          // from the list, which is the whole point of making disk required.
          return json({
            templates: listTemplates(),
            machineTypes: MACHINE_TYPES,
            defaultMachineType: DEFAULT_MACHINE_TYPE,
            namePrefix: NAME_PREFIX,
          })
        } catch (err) {
          return problem(err)
        }
      },
    },
  },
})
