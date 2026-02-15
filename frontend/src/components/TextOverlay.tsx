import { useState, useEffect, useRef, useMemo } from 'react'
import { X } from 'lucide-react'
import { motion, type Variants } from 'framer-motion'

/* ── Animation types & config ────────────────────────────── */

export type AnimationType =
  | 'none'
  | 'fadeIn'
  | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight'
  | 'zoomIn' | 'zoomOut'
  | 'shake'
  | 'bounce'
  | 'typewriter'
  | 'glitch'
  | 'flipIn'
  | 'rotateIn'
  | 'elastic'
  | 'blurIn'
  | 'neonPulse'

export const ANIMATION_PRESETS: { value: AnimationType; label: string; group: string }[] = [
  { value: 'none', label: 'None', group: 'Basic' },
  { value: 'fadeIn', label: 'Fade In', group: 'Basic' },
  { value: 'slideUp', label: 'Slide Up', group: 'Slide' },
  { value: 'slideDown', label: 'Slide Down', group: 'Slide' },
  { value: 'slideLeft', label: 'Slide Left', group: 'Slide' },
  { value: 'slideRight', label: 'Slide Right', group: 'Slide' },
  { value: 'zoomIn', label: 'Zoom In', group: 'Scale' },
  { value: 'zoomOut', label: 'Zoom Out', group: 'Scale' },
  { value: 'bounce', label: 'Bounce', group: 'Dynamic' },
  { value: 'elastic', label: 'Elastic', group: 'Dynamic' },
  { value: 'shake', label: 'Shake', group: 'Dynamic' },
  { value: 'flipIn', label: 'Flip In', group: 'Transform' },
  { value: 'rotateIn', label: 'Rotate In', group: 'Transform' },
  { value: 'typewriter', label: 'Typewriter', group: 'Text' },
  { value: 'glitch', label: 'Glitch', group: 'Text' },
  { value: 'blurIn', label: 'Blur In', group: 'Effect' },
  { value: 'neonPulse', label: 'Neon Pulse', group: 'Effect' },
]

export interface AnimationConfig {
  intensity: number    // 0-1, multiplier for effect strength
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'spring'
  delay: number        // seconds before animation starts
  loop: boolean        // whether to loop (for shake, neonPulse, etc.)
}

export const DEFAULT_ANIM_CONFIG: AnimationConfig = {
  intensity: 0.5,
  easing: 'easeOut',
  delay: 0,
  loop: false,
}

/* ── Font management ──────────────────────────────────── */

export interface CustomFont {
  name: string
  url: string        // object URL from user upload
  format: string     // woff2, woff, truetype, etc.
}

const BUILTIN_FONTS = [
  'Arial', 'Helvetica', 'Times New Roman', 'Courier New',
  'Verdana', 'Georgia', 'Impact', 'Comic Sans MS',
  'Trebuchet MS', 'Lucida Console', 'Tahoma', 'Segoe UI',
]

/** Loads a custom font from a File object, returns a CustomFont record */
export async function loadFontFromFile(file: File): Promise<CustomFont> {
  const url = URL.createObjectURL(file)
  const name = file.name.replace(/\.(woff2?|ttf|otf|eot)$/i, '')
  const ext = file.name.split('.').pop()?.toLowerCase() || 'truetype'
  const formatMap: Record<string, string> = {
    woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype', eot: 'embedded-opentype',
  }
  const format = formatMap[ext] || 'truetype'

  // Register with browser
  const fontFace = new FontFace(name, `url(${url})`, { style: 'normal', weight: '400' })
  await fontFace.load()
  document.fonts.add(fontFace)

  return { name, url, format }
}

/** Returns combined list of builtin + custom font names */
export function getAllFonts(customFonts: CustomFont[]): string[] {
  return [...BUILTIN_FONTS, ...customFonts.map(f => f.name)]
}

/* ── TextOverlayData ──────────────────────────────────── */

export interface TextOverlayData {
  id: string
  text: string
  x: number
  y: number
  fontSize: number
  fontFamily: string
  color: string
  backgroundColor?: string
  opacity: number
  animation: AnimationType
  animationDuration: number
  animationConfig: AnimationConfig
  startTime: number
  endTime: number
  // additional styling
  fontWeight?: number
  fontStyle?: 'normal' | 'italic'
  textDecoration?: string
  letterSpacing?: number
  lineHeight?: number
  textStroke?: string
  textShadowCustom?: string
  borderRadius?: number
  padding?: number
}

/* ── default overlay factory ────────────────────────────── */

export function createDefaultOverlay(startTime: number): TextOverlayData {
  return {
    id: crypto.randomUUID(),
    text: '',
    x: 200,
    y: 200,
    fontSize: 32,
    fontFamily: 'Arial',
    color: '#FFFFFF',
    backgroundColor: '#000000',
    opacity: 0.9,
    animation: 'none',
    animationDuration: 0.5,
    animationConfig: { ...DEFAULT_ANIM_CONFIG },
    startTime,
    endTime: startTime + 3,
    fontWeight: 400,
    fontStyle: 'normal',
    letterSpacing: 0,
    lineHeight: 1.2,
    padding: 8,
    borderRadius: 4,
  }
}

/* ── TextOverlay component ────────────────────────────── */

interface TextOverlayProps {
  overlay: TextOverlayData
  currentTime: number
  isSelected: boolean
  onSelect: () => void
  onUpdate: (updates: Partial<TextOverlayData>) => void
  onDelete: () => void
}

export function TextOverlay({ overlay, currentTime, isSelected, onSelect, onUpdate, onDelete }: TextOverlayProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const textRef = useRef<HTMLDivElement>(null)

  const isVisible = currentTime >= overlay.startTime && currentTime <= overlay.endTime
  if (!isVisible) return null

  const cfg = overlay.animationConfig || DEFAULT_ANIM_CONFIG
  const elapsed = currentTime - overlay.startTime - cfg.delay
  const dur = overlay.animationDuration || 0.5
  const p = cfg.delay > 0 && elapsed < 0 ? 0 : Math.min(1, Math.max(0, elapsed / dur))
  const intensity = cfg.intensity ?? 0.5

  /* ── compute animation style ────────────────────────── */
  const getAnimStyle = (): Record<string, any> => {
    const dist = 60 * intensity
    switch (overlay.animation) {
      case 'fadeIn':
        return { opacity: p }
      case 'slideUp':
        return { y: (1 - p) * dist, opacity: p }
      case 'slideDown':
        return { y: (1 - p) * -dist, opacity: p }
      case 'slideLeft':
        return { x: (1 - p) * dist, opacity: p }
      case 'slideRight':
        return { x: (1 - p) * -dist, opacity: p }
      case 'zoomIn':
        return { scale: (1 - intensity) + p * intensity, opacity: p }
      case 'zoomOut': {
        const s = 1 + intensity * 0.5
        return { scale: p < 1 ? s - (s - 1) * p : 1, opacity: p }
      }
      case 'bounce': {
        const bounceP = p < 1 ? 1 - Math.abs(Math.cos(p * Math.PI * (2 + intensity * 3)) * (1 - p)) : 1
        return { y: (1 - bounceP) * -dist, opacity: Math.min(1, p * 2) }
      }
      case 'elastic': {
        const elasticP = p < 1
          ? 1 - Math.cos(p * Math.PI * (3 + intensity * 4)) * Math.exp(-p * 5 * intensity)
          : 1
        return { scale: elasticP, opacity: Math.min(1, p * 2) }
      }
      case 'shake': {
        if (p >= 1 && !cfg.loop) return {}
        const t = currentTime * (10 + intensity * 30)
        const shakeX = Math.sin(t) * dist * 0.3
        const shakeY = Math.cos(t * 1.3) * dist * 0.2
        return { x: shakeX, y: shakeY }
      }
      case 'flipIn':
        return { rotateX: (1 - p) * 90 * intensity * 2, opacity: p }
      case 'rotateIn':
        return { rotate: (1 - p) * 360 * intensity, opacity: p, scale: 0.5 + p * 0.5 }
      case 'blurIn': {
        const blur = (1 - p) * 20 * intensity
        return { filter: `blur(${blur}px)`, opacity: p }
      }
      case 'neonPulse': {
        const pulse = cfg.loop || p < 1
          ? 0.5 + 0.5 * Math.sin(currentTime * (5 + intensity * 10))
          : 1
        return {
          opacity: 0.7 + pulse * 0.3,
          textShadow: `0 0 ${10 * pulse * intensity}px ${overlay.color}, 0 0 ${20 * pulse * intensity}px ${overlay.color}, 0 0 ${40 * pulse * intensity}px ${overlay.color}`,
        }
      }
      case 'typewriter': {
        const charCount = Math.floor(p * overlay.text.length)
        return { __typewriterChars: charCount, opacity: 1 }
      }
      case 'glitch': {
        if (p >= 1 && !cfg.loop) return {}
        const t2 = currentTime * (8 + intensity * 20)
        const glitchOn = Math.sin(t2) > 0.3
        if (!glitchOn) return {}
        return {
          x: (Math.random() - 0.5) * 10 * intensity,
          y: (Math.random() - 0.5) * 6 * intensity,
          filter: `hue-rotate(${Math.random() * 360}deg)`,
          opacity: 0.8 + Math.random() * 0.2,
        }
      }
      default:
        return {}
    }
  }

  const animStyle = getAnimStyle()
  const typewriterChars = animStyle.__typewriterChars as number | undefined
  delete animStyle.__typewriterChars
  const displayText = typewriterChars !== undefined
    ? overlay.text.slice(0, typewriterChars) + (typewriterChars < overlay.text.length ? '▌' : '')
    : overlay.text

  /* ── drag handlers ─────────────────────────────────── */
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.text-content')) {
      setIsDragging(true)
      setDragStart({ x: e.clientX - overlay.x, y: e.clientY - overlay.y })
      onSelect()
    }
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) onUpdate({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }
  const handleMouseUp = () => setIsDragging(false)

  /* ── transition config ─────────────────────────────── */
  const getTransition = () => {
    const ease = cfg.easing
    if (ease === 'spring') return { type: 'spring', stiffness: 200, damping: 15 }
    return { duration: 0, ease: ease === 'easeIn' ? 'easeIn' : ease === 'easeOut' ? 'easeOut' : ease === 'easeInOut' ? 'easeInOut' : 'linear' }
  }

  return (
    <motion.div
      className={`absolute cursor-move ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
      style={{
        left: `${overlay.x}px`,
        top: `${overlay.y}px`,
        zIndex: isSelected ? 1000 : 100,
        perspective: '800px',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      animate={animStyle}
      transition={getTransition()}
    >
      <div
        ref={textRef}
        className="text-content relative whitespace-pre-wrap"
        style={{
          fontFamily: overlay.fontFamily,
          fontSize: `${overlay.fontSize}px`,
          fontWeight: overlay.fontWeight || 400,
          fontStyle: overlay.fontStyle || 'normal',
          letterSpacing: overlay.letterSpacing ? `${overlay.letterSpacing}px` : undefined,
          lineHeight: overlay.lineHeight || 1.2,
          color: overlay.color,
          backgroundColor: overlay.backgroundColor || 'transparent',
          padding: overlay.backgroundColor ? `${overlay.padding ?? 8}px` : '0',
          borderRadius: `${overlay.borderRadius ?? 4}px`,
          opacity: overlay.opacity,
          textShadow: overlay.textShadowCustom || (overlay.backgroundColor ? 'none' : '2px 2px 4px rgba(0,0,0,0.8)'),
          textDecoration: overlay.textDecoration || 'none',
          WebkitTextStroke: overlay.textStroke || 'none',
        }}
      >
        {displayText}
        {isSelected && (
          <button onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 z-10">
            <X size={14} />
          </button>
        )}
      </div>
    </motion.div>
  )
}
