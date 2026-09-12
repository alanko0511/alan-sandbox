import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  Container,
  Drawer,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'

export const Route = createFileRoute('/')({ component: Dashboard })

type Vm = {
  name: string
  status: string
  machineType: string
  diskGb: number
  template: string
  createdAt: string
}

type Template = { name: string; description: string; diskSizeGb: number }
type Meta = {
  templates: Array<Template>
  machineTypes: Array<{ value: string; label: string }>
  defaultMachineType: string
  namePrefix: string
}

/** Compact age, because a stopped VM's age is what actually drives the bill. */
function age(iso: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}d`
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return `${hours}h`
  return `${Math.max(1, Math.floor(ms / 60_000))}m`
}

function statusColor(status: string): string {
  if (status === 'RUNNING') return 'green'
  if (status === 'TERMINATED') return 'gray'
  if (status === 'STOPPING' || status === 'SUSPENDING') return 'orange'
  return 'yellow'
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText)
  return body as T
}

function Dashboard() {
  const [vms, setVms] = useState<Array<Vm>>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Vm | null>(null)
  const [logsFor, setLogsFor] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { vms } = await api<{ vms: Array<Vm> }>('/api/vms')
      setVms(vms)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    api<Meta>('/api/templates')
      .then(setMeta)
      // A broken template.yaml surfaces here rather than disappearing silently.
      .catch((err) => setError(String(err.message ?? err)))

    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const act = async (name: string, action: 'stop' | 'start' | 'reboot') => {
    setBusy(name)
    try {
      await api(`/api/vms/${name}`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Container size="lg" py="xl">
      <Group justify="space-between" mb="lg">
        <div>
          <Title order={2}>Sandboxes</Title>
          <Text size="sm" c="dimmed">
            Stopped VMs still bill for their disk, so delete what you are done with.
          </Text>
        </div>
        <Group>
          <Button variant="default" onClick={() => void refresh()}>
            Refresh
          </Button>
          <Button onClick={() => setCreateOpen(true)} disabled={!meta}>
            New sandbox
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" mb="md" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : vms.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No sandboxes yet.
        </Text>
      ) : (
        <Table highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Template</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Machine</Table.Th>
              <Table.Th>Age</Table.Th>
              <Table.Th>Disk</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {vms.map((vm) => (
              <Table.Tr key={vm.name}>
                <Table.Td>
                  <Code>{vm.name}</Code>
                </Table.Td>
                <Table.Td>{vm.template}</Table.Td>
                <Table.Td>
                  <Badge color={statusColor(vm.status)} variant="light">
                    {vm.status}
                  </Badge>
                </Table.Td>
                <Table.Td>{vm.machineType}</Table.Td>
                <Table.Td>{age(vm.createdAt)}</Table.Td>
                <Table.Td>{vm.diskGb} GB</Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button
                      size="compact-sm"
                      variant="subtle"
                      onClick={() => setLogsFor(vm.name)}
                    >
                      Logs
                    </Button>
                    {vm.status === 'RUNNING' ? (
                      <>
                        <Button
                          size="compact-sm"
                          variant="default"
                          loading={busy === vm.name}
                          onClick={() => void act(vm.name, 'stop')}
                        >
                          Stop
                        </Button>
                        <Tooltip label="Graceful stop, then start">
                          <Button
                            size="compact-sm"
                            variant="default"
                            loading={busy === vm.name}
                            onClick={() => void act(vm.name, 'reboot')}
                          >
                            Reboot
                          </Button>
                        </Tooltip>
                      </>
                    ) : (
                      <Button
                        size="compact-sm"
                        variant="default"
                        loading={busy === vm.name}
                        onClick={() => void act(vm.name, 'start')}
                      >
                        Start
                      </Button>
                    )}
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label={`Delete ${vm.name}`}
                      onClick={() => setDeleteTarget(vm)}
                    >
                      ✕
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {meta && (
        <CreateModal
          meta={meta}
          opened={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(name) => {
            setCreateOpen(false)
            setLogsFor(name)
            void refresh()
          }}
          onError={setError}
        />
      )}

      <DeleteModal
        vm={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null)
          void refresh()
        }}
        onError={setError}
      />

      <Drawer
        opened={logsFor !== null}
        onClose={() => setLogsFor(null)}
        position="right"
        size="xl"
        title={logsFor ? `Boot log — ${logsFor}` : ''}
      >
        {logsFor && <LogStream name={logsFor} />}
      </Drawer>
    </Container>
  )
}

function CreateModal(props: {
  meta: Meta
  opened: boolean
  onClose: () => void
  onCreated: (name: string) => void
  onError: (message: string) => void
}) {
  const { meta } = props
  const [suffix, setSuffix] = useState('')
  const [template, setTemplate] = useState<string | null>(null)
  const [machineType, setMachineType] = useState<string>(meta.defaultMachineType)
  const [submitting, setSubmitting] = useState(false)

  const selected = meta.templates.find((t) => t.name === template)
  const name = `${meta.namePrefix}${suffix}`
  const valid = /^[a-z0-9-]{1,40}$/.test(suffix) && template !== null

  const submit = async () => {
    setSubmitting(true)
    try {
      await api('/api/vms', {
        method: 'POST',
        body: JSON.stringify({ name, template, machineType }),
      })
      setSuffix('')
      setTemplate(null)
      props.onCreated(name)
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal opened={props.opened} onClose={props.onClose} title="New sandbox">
      <Stack>
        <TextInput
          label="Name"
          description="Becomes the Tailscale hostname, e.g. sb-api.tail8e363.ts.net"
          leftSection={
            <Text size="sm" c="dimmed" pl={6}>
              {meta.namePrefix}
            </Text>
          }
          leftSectionWidth={34}
          value={suffix}
          onChange={(e) => setSuffix(e.currentTarget.value.toLowerCase())}
          error={
            suffix && !/^[a-z0-9-]{1,40}$/.test(suffix)
              ? 'lowercase letters, digits and dashes only'
              : null
          }
        />

        <Select
          label="Template"
          placeholder="Pick one"
          data={meta.templates.map((t) => ({ value: t.name, label: t.name }))}
          value={template}
          onChange={setTemplate}
        />
        {selected && (
          <Text size="sm" c="dimmed">
            {selected.description}
          </Text>
        )}

        <Select
          label="Machine type"
          data={meta.machineTypes}
          value={machineType}
          onChange={(v) => setMachineType(v ?? meta.defaultMachineType)}
          allowDeselect={false}
        />

        {/* Disk is a property of the template, not a per-creation choice, so it
            is shown rather than asked. */}
        <TextInput
          label="Disk"
          description="Set by the template"
          value={selected ? `${selected.diskSizeGb} GB` : '—'}
          readOnly
        />

        <Button onClick={() => void submit()} disabled={!valid} loading={submitting}>
          Create {valid ? name : ''}
        </Button>
      </Stack>
    </Modal>
  )
}

function DeleteModal(props: {
  vm: Vm | null
  onClose: () => void
  onDeleted: () => void
  onError: (message: string) => void
}) {
  const [typed, setTyped] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const vm = props.vm

  useEffect(() => setTyped(''), [vm?.name])

  const submit = async () => {
    if (!vm) return
    setSubmitting(true)
    try {
      await api(`/api/vms/${vm.name}`, { method: 'DELETE' })
      props.onDeleted()
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal opened={vm !== null} onClose={props.onClose} title="Delete sandbox">
      {vm && (
        <Stack>
          <Alert color="red">
            This destroys the VM, its {vm.diskGb} GB disk, and its Tailscale device.
            There is no undo.
          </Alert>
          <TextInput
            label={`Type ${vm.name} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.currentTarget.value)}
          />
          <Button
            color="red"
            disabled={typed !== vm.name}
            loading={submitting}
            onClick={() => void submit()}
          >
            Delete permanently
          </Button>
        </Stack>
      )}
    </Modal>
  )
}

/**
 * Live serial console.
 *
 * Streams from kernel boot onward, which is the only way to see anything during
 * the window where the VM is powered on but not yet on the tailnet.
 */
function LogStream({ name }: { name: string }) {
  const [lines, setLines] = useState('')
  const [stage, setStage] = useState<string | null>(null)
  const boxRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    setLines('')
    setStage(null)

    const source = new EventSource(`/api/vms/${name}/logs`)
    source.addEventListener('log', (e) => {
      const { contents } = JSON.parse((e as MessageEvent).data) as { contents: string }
      setLines((prev) => prev + contents)
    })
    source.addEventListener('stage', (e) => {
      setStage(JSON.parse((e as MessageEvent).data).stage)
    })
    source.addEventListener('done', () => source.close())
    source.addEventListener('error', () => source.close())

    return () => source.close()
  }, [name])

  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [lines])

  return (
    <Stack gap="xs">
      <Group>
        <Text size="sm">Stage:</Text>
        <Badge
          color={
            stage === 'ready' ? 'green' : stage?.startsWith('failed') ? 'red' : 'yellow'
          }
        >
          {stage ?? 'waiting…'}
        </Badge>
      </Group>
      <pre
        ref={boxRef}
        style={{
          height: '70vh',
          overflow: 'auto',
          fontSize: 12,
          lineHeight: 1.45,
          background: 'var(--mantine-color-dark-8)',
          color: 'var(--mantine-color-gray-3)',
          padding: 12,
          borderRadius: 6,
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {lines || 'Waiting for serial output…'}
      </pre>
    </Stack>
  )
}
