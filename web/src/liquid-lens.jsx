'use client'

import { useEffect, useId, useRef, useState } from 'react'

// Reuse the optical map across equal-size controls; calculate only on resize.
const maps = new Map()
function lensMap(width, height, cornerRadius) {
  const key = `${width}:${height}:${cornerRadius}`
  if (maps.has(key)) return maps.get(key)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  const pixels = context.createImageData(width, height)
  const radius = Math.min(cornerRadius ?? Math.min(width, height) / 2, width / 2, height / 2)
  const straightX = Math.max(0, width / 2 - radius)
  const straightY = Math.max(0, height / 2 - radius)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + .5 - width / 2
      const dy = y + .5 - height / 2
      const nx = dx - Math.max(-straightX, Math.min(straightX, dx))
      const ny = dy - Math.max(-straightY, Math.min(straightY, dy))
      const distance = Math.hypot(nx, ny)
      const edge = Math.max(0, Math.min(1, (radius - distance) / Math.min(9, radius * .55)))
      const bend = Math.sin(edge * Math.PI) * .46
      const i = (y * width + x) * 4
      pixels.data[i] = Math.round(128 - (distance ? nx / distance : 0) * bend * 255)
      pixels.data[i + 1] = Math.round(128 - (distance ? ny / distance : 0) * bend * 255)
      pixels.data[i + 2] = 128
      pixels.data[i + 3] = 255
    }
  }
  context.putImageData(pixels, 0, 0)
  const result = canvas.toDataURL()
  if (maps.size > 64) maps.clear()
  maps.set(key, result)
  return result
}

/** A background-only optical layer; labels and icons never pass through the filter. */
export function LiquidLens({ radius, strength = 14, panel = false }) {
  const ref = useRef(null)
  const id = `lens-${useId().replace(/:/g, '')}`
  const [optics, setOptics] = useState(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      if (width < 1 || height < 1) return
      const ratio = Math.min(1, 720 / Math.max(width, height))
      const map = lensMap(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), radius == null ? undefined : radius * ratio)
      if (map) setOptics({ width, height, map })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [radius])
  return <span ref={ref} className="liquid-optics" aria-hidden="true">
    {optics ? <>
      <svg className="liquid-filter-defs" width="0" height="0" focusable="false">
        <defs><filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feImage href={optics.map} x="0" y="0" width={optics.width} height={optics.height} result="lens-map" />
          <feDisplacementMap in="SourceGraphic" in2="lens-map" scale={strength} xChannelSelector="R" yChannelSelector="G" />
        </filter></defs>
      </svg>
      <span className="liquid-refraction" style={{ backdropFilter: `url(#${id}) ${panel ? "blur(3px) saturate(1.08)" : ""}` }} />
    </> : null}
  </span>
}
