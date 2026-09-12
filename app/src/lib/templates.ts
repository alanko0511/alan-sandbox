import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

/**
 * Templates are read from the repo tree, which is copied into the container
 * image at build time. In dev they sit one level up from `app/`.
 */
const TEMPLATES_DIR =
  process.env.SANDBOX_TEMPLATES_DIR ?? resolve(process.cwd(), '..', 'templates')

const SCRIPTS_DIR =
  process.env.SANDBOX_SCRIPTS_DIR ?? resolve(process.cwd(), '..', 'scripts')

export type Template = {
  name: string
  description: string
  diskSizeGb: number
}

/**
 * Parse one template's config.
 *
 * Throws rather than defaulting. A template that silently inherits a disk size
 * is the exact failure this config file exists to prevent — the author must
 * state what the workload needs.
 */
function parseTemplate(name: string): Template {
  const path = join(TEMPLATES_DIR, name, 'template.yaml')
  if (!existsSync(path)) {
    throw new Error(`template "${name}" is missing template.yaml`)
  }

  const raw = parse(readFileSync(path, 'utf8')) as unknown
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`template "${name}": template.yaml is not a mapping`)
  }

  const cfg = raw as { description?: unknown; disk?: { sizeGb?: unknown } }

  const description = cfg.description
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`template "${name}": "description" is required`)
  }

  const sizeGb = cfg.disk?.sizeGb
  if (typeof sizeGb !== 'number' || !Number.isInteger(sizeGb) || sizeGb < 10) {
    throw new Error(
      `template "${name}": "disk.sizeGb" is required and must be an integer >= 10`,
    )
  }

  return { name, description, diskSizeGb: sizeGb }
}

/** Selectable templates. `_base` is infrastructure, not a choice. */
export function listTemplates(): Array<Template> {
  return readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => parseTemplate(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function getTemplate(name: string): Template {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`invalid template name: ${name}`)
  return parseTemplate(name)
}

/** The startup-script handed to every instance. */
export function readBootstrapScript(): string {
  return readFileSync(join(SCRIPTS_DIR, 'bootstrap.sh'), 'utf8')
}
