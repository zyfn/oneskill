import { useEffect, useState } from 'react'

export function useWideLayout() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1280px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1280px)')
    const update = () => setWide(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}
