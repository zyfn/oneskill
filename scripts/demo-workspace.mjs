import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createWorkspace } from '../src/core.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Real files and symlinks, isolated from the user's Agent folders.
export async function createDemoWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-demo-'))
  try {
    const catalog = JSON.parse(await fs.readFile(path.join(repo, 'agents.catalog.json'), 'utf8'))
    const detected = ['codex', 'claude', 'cursor', 'gemini']
    const bin = path.join(root, 'bin')
    await fs.mkdir(bin)
    const versionScript = path.join(bin, 'version.cjs')
    await fs.writeFile(versionScript, "if(process.argv[2]!=='--version')process.exit(2);console.log('oneskill-demo 1.0.0')\n")
    for (const name of detected) {
      const launcher = process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${versionScript}" %*\r\n`
        : `#!${process.execPath}\nif(process.argv[2]!=='--version')process.exit(2);console.log('oneskill-demo 1.0.0')\n`
      await fs.writeFile(path.join(bin, name + (process.platform === 'win32' ? '.cmd' : '')), launcher, { mode: 0o755 })
    }
    const agents = catalog.map((agent) => {
      return {
        ...agent,
        probeInstallation: false,
        configDir: { macos: path.join(root, 'agents', agent.name), windows: path.join(root, 'agents', agent.name), linux: path.join(root, 'agents', agent.name) },
        configDirEnv: undefined,
        configDirEnvSuffix: undefined,
        extraSkillDirs: [],
        pluginDirs: ['plugins/cache'],
        mcp: [{ file: 'mcp.json', key: 'mcpServers' }],
        executable: detected.includes(agent.name) ? path.join(bin, agent.name + (process.platform === 'win32' ? '.cmd' : '')) : undefined,
        skillDir: 'skills',
      }
    })
    await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify(agents))
    for (const name of detected) await fs.mkdir(path.join(root, 'agents', name, 'skills'), { recursive: true })
    const packages = [
      ['design/accessibility-audit', 'Check keyboard navigation, contrast, and screen-reader labels.'],
      ['design/interface-review', 'Review hierarchy, spacing, and interaction details before shipping.'],
      ['engineering/api-contracts', 'Keep request shapes, response examples, and errors consistent.'],
      ['engineering/backend/query-plan', 'Read query plans and find expensive database operations.'],
      ['engineering/code-review', 'Find actionable defects and explain their impact on the change.'],
      ['writing/release-notes', 'Turn completed changes into clear, useful release notes.'],
      ['writing/technical-docs', 'Write concise setup guides, examples, and troubleshooting steps.'],
      ['workspace-notes', 'Keep project conventions and everyday commands close at hand.'],
    ]
    async function writeSkill(directory, name, description) {
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${description}\n\nThis is a sample skill for the oneskill demo workspace.\n`)
    }
    for (const [relative, description] of packages) await writeSkill(path.join(root, 'skills', relative), path.basename(relative), description)
    await writeSkill(path.join(root, 'agents/codex/skills/.system/agent-guide'), 'agent-guide', 'Local guidance kept in the Agent folder.')
    await writeSkill(path.join(root, 'agents/claude/skills/writing/draft-notes'), 'draft-notes', 'A writing skill ready to add to the shared library.')
    await writeSkill(path.join(root, 'agents/cursor/skills/project-tools'), 'project-tools', 'Project-specific tools intentionally kept outside the library.')
    await fs.writeFile(path.join(root, 'migrate.ignore'), '# Demo preferences\n{"agent":"cursor","relative":"project-tools","ignored":true}\n')

    const core = createWorkspace({ root })
    const links = {
      codex: ['engineering/api-contracts', 'engineering/backend/query-plan', 'engineering/code-review', 'writing/technical-docs', 'workspace-notes'],
      claude: ['design/accessibility-audit', 'design/interface-review', 'writing/release-notes', 'writing/technical-docs'],
      cursor: ['design/accessibility-audit', 'engineering/api-contracts', 'engineering/code-review'],
      gemini: ['writing/release-notes', 'workspace-notes'],
    }
    for (const [agent, relatives] of Object.entries(links)) {
      for (const relative of relatives) await core.setSkillLink(agent, relative, true)
    }
    for (const [agent, plugins] of [['codex', ['repository-tools']], ['claude', ['browser-checks', 'documentation']]]) {
      for (const name of plugins) {
        const directory = path.join(root, 'agents', agent, 'plugins/cache', name, `.${agent}-plugin`)
        await fs.mkdir(directory, { recursive: true })
        await fs.writeFile(path.join(directory, 'plugin.json'), JSON.stringify({ name, description: `Sample ${name} plugin.`, version: '1.0.0' }))
      }
    }
    for (const [agent, names] of [['codex', ['filesystem', 'documentation']], ['claude', ['browser', 'filesystem']], ['cursor', ['filesystem']], ['gemini', ['documentation']]]) {
      await fs.writeFile(path.join(root, 'agents', agent, 'mcp.json'), JSON.stringify({ mcpServers: Object.fromEntries(names.map((name) => [name, { command: 'sample-server' }])) }))
    }
    return { root, workspace: core, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true })
    throw error
  }
}
