// Directory paths are the category source of truth; no second tagging system.
export function skillCategory(skill) {
  if (typeof skill.category === 'string') return skill.category
  const parts = (skill.relative || '').replaceAll('\\', '/').split('/').filter(Boolean)
  return parts.slice(0, -1).join('/')
}

export function skillCollections(skills) {
  const folders = new Map()
  let rootCount = 0
  for (const skill of skills) {
    const category = skillCategory(skill)
    if (!category) { rootCount += 1; continue }
    const parts = category.split('/').filter(Boolean)
    for (let index = 0; index < parts.length; index += 1) {
      const path = parts.slice(0, index + 1).join('/')
      const entry = folders.get(path) || { path, label: parts[index], depth: index, count: 0 }
      entry.count += 1
      folders.set(path, entry)
    }
  }
  return { rootCount, folders: [...folders.values()].sort((a, b) => a.path.localeCompare(b.path)) }
}

// null selects the whole library; an empty path selects its root only.
export function belongsToCollection(skill, folder) {
  if (folder === null) return true
  const category = skillCategory(skill)
  return folder === '' ? category === '' : category === folder || category.startsWith(`${folder}/`)
}

export function collectionHierarchy(folders) {
  const nodes = new Map(folders.map((entry) => [entry.path, { ...entry, children: [] }]))
  const roots = []
  for (const node of nodes.values()) {
    const parent = nodes.get(node.path.slice(0, node.path.lastIndexOf('/')))
    if (node.path.includes('/') && parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}
