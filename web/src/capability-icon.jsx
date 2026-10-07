import { LightningIcon, NotebookIcon, PlugsConnectedIcon, PuzzlePieceIcon, RobotIcon } from '@phosphor-icons/react'
import { useState } from 'react'

function PluginIcon({ item, className, size }) {
  const [usable, setUsable] = useState(Boolean(item?.icon))
  if (usable) return <img src={item.icon} alt="" width={size} height={size} className={className} style={{ width: size, height: size, objectFit: 'contain' }} onError={() => setUsable(false)} />
  return <PuzzlePieceIcon className={className} size={size} weight="regular" aria-hidden="true" />
}

export function CapabilityIcon({ route, item, className, size = 24 }) {
  if (route === 'plugins') return <PluginIcon item={item} className={className} size={size} />
  const Icon = { skills: NotebookIcon, mcp: PlugsConnectedIcon, hooks: LightningIcon, migrate: NotebookIcon, agents: RobotIcon }[route] || NotebookIcon
  return <Icon className={className} size={size} weight="regular" aria-hidden="true" />
}

export function AgentIcon({ agent, size = 22 }) {
  return agent?.logo
    ? <img src={agent.logo} alt="" width={size} height={size} className="shrink-0 object-contain" style={{ width: size, height: size }} />
    : <RobotIcon size={size} weight="regular" aria-hidden="true" />
}
