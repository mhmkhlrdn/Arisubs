import { useRef, useEffect, useState, useCallback } from 'react'
import type { SubtitleLine } from '../../types/subtitle'
import { formatTime } from '../../types/subtitle'

/**
 * COMMENTS & NOTES:
 *
 * [Audio Analysis]
 * - Connect audio analysis
 * - Audio context may already be connected
 *
 * [Visualization]
 * - Draw audio visualization
 * - Calculate visible time range
 * - Auto-scroll to keep current time visible
 * - Background
 * - Draw second markers
 * - Draw other subtitle lines (semi-transparent)
 * - Boundary lines
 * - Draw current line selection
 * - Selection area
 * - Start marker (red, thick)
 * - End marker (orange, thick)
 * - Draw simulated waveform
 * - Mirror waveform
 * - Draw static waveform representation (sine-based for visual)
 * - Draw playhead (white dashed)
 * - Modified indicator
 * - Time display
 *
 * [Interactions]
 * - Handle click to set timing
 */

interface AudioDisplayProps {
    videoElement: HTMLVideoElement | null
    currentLine: SubtitleLine | null
    lines: SubtitleLine[]
    onSetStart: (time: number) => void
    onSetEnd: (time: number) => void
    onSeek: (time: number) => void
    onPlayRange: (start: number, end: number) => void
    isModified: boolean
}

export function AudioDisplay({
    videoElement,
    currentLine,
    lines,
    onSetStart,
    onSetEnd,
    onSeek,
    onPlayRange,
    isModified,
}: AudioDisplayProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const animFrameRef = useRef<number>(0)
    const [displayMode, setDisplayMode] = useState<'waveform' | 'spectrum'>('waveform')
    const [horizontalZoom, setHorizontalZoom] = useState(1)
    const [verticalZoom, setVerticalZoom] = useState(1)
    const [scrollOffset, setScrollOffset] = useState(0)
    const [autoScroll, setAutoScroll] = useState(true)

    const audioContextRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)

    useEffect(() => {
        if (!videoElement) return

        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new AudioContext()
            }
            const ctx = audioContextRef.current
            if (!sourceRef.current) {
                sourceRef.current = ctx.createMediaElementSource(videoElement)
            }
            if (!analyserRef.current) {
                analyserRef.current = ctx.createAnalyser()
                analyserRef.current.fftSize = 2048
                sourceRef.current.connect(analyserRef.current)
                analyserRef.current.connect(ctx.destination)
            }
        } catch {
        }

        return () => {
            cancelAnimationFrame(animFrameRef.current)
        }
    }, [videoElement])

    const draw = useCallback(() => {
        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container || !videoElement) return

        const rect = container.getBoundingClientRect()
        canvas.width = rect.width
        canvas.height = rect.height

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const w = canvas.width
        const h = canvas.height
        const duration = videoElement.duration || 1
        const currentTime = videoElement.currentTime

        const pixelsPerSecond = (w * horizontalZoom) / Math.max(duration, 1)
        const visibleDuration = w / pixelsPerSecond

        let offset = scrollOffset
        if (autoScroll && currentLine) {
            const lineCenter = (currentLine.start + currentLine.end) / 2
            offset = lineCenter - visibleDuration / 2
            offset = Math.max(0, Math.min(duration - visibleDuration, offset))
        }

        const timeToX = (t: number) => (t - offset) * pixelsPerSecond

        ctx.fillStyle = '#1a1a2e'
        ctx.fillRect(0, 0, w, h)

        ctx.strokeStyle = '#2a2a4a'
        ctx.lineWidth = 1
        const startSec = Math.floor(offset)
        const endSec = Math.ceil(offset + visibleDuration)
        for (let s = startSec; s <= endSec; s++) {
            const x = timeToX(s)
            if (x >= 0 && x <= w) {
                ctx.beginPath()
                ctx.moveTo(x, 0)
                ctx.lineTo(x, h)
                ctx.stroke()
            }
        }

        lines.forEach((line) => {
            if (currentLine && line.id === currentLine.id) return
            const x1 = timeToX(line.start)
            const x2 = timeToX(line.end)
            if (x2 < 0 || x1 > w) return
            ctx.fillStyle = 'rgba(100, 100, 150, 0.15)'
            ctx.fillRect(Math.max(0, x1), 0, Math.min(w, x2) - Math.max(0, x1), h)
            ctx.strokeStyle = 'rgba(100, 100, 150, 0.3)'
            ctx.lineWidth = 1
            if (x1 >= 0 && x1 <= w) {
                ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, h); ctx.stroke()
            }
            if (x2 >= 0 && x2 <= w) {
                ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, h); ctx.stroke()
            }
        })

        if (currentLine) {
            const x1 = timeToX(currentLine.start)
            const x2 = timeToX(currentLine.end)

            const bgColor = isModified ? 'rgba(180, 60, 60, 0.25)' : 'rgba(60, 80, 180, 0.2)'
            ctx.fillStyle = bgColor
            ctx.fillRect(Math.max(0, x1), 0, Math.min(w, x2) - Math.max(0, x1), h)

            ctx.strokeStyle = '#ff3333'
            ctx.lineWidth = 3
            if (x1 >= 0 && x1 <= w) {
                ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, h); ctx.stroke()
            }

            ctx.strokeStyle = '#ff8800'
            ctx.lineWidth = 3
            if (x2 >= 0 && x2 <= w) {
                ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, h); ctx.stroke()
            }
        }

        if (analyserRef.current && displayMode === 'waveform') {
            const bufLen = analyserRef.current.frequencyBinCount
            const data = new Uint8Array(bufLen)
            analyserRef.current.getByteTimeDomainData(data)

            ctx.strokeStyle = '#4fc3f7'
            ctx.lineWidth = 1
            ctx.beginPath()
            const sliceWidth = w / bufLen
            let x = 0
            for (let i = 0; i < bufLen; i++) {
                const v = data[i] / 128.0
                const y = (v * h * verticalZoom) / 2
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
                x += sliceWidth
            }
            ctx.stroke()

            ctx.strokeStyle = 'rgba(79, 195, 247, 0.4)'
            ctx.beginPath()
            x = 0
            for (let i = 0; i < bufLen; i++) {
                const v = data[i] / 128.0
                const y = h - (v * h * verticalZoom) / 2
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
                x += sliceWidth
            }
            ctx.stroke()
        } else if (analyserRef.current && displayMode === 'spectrum') {
            const bufLen = analyserRef.current.frequencyBinCount
            const data = new Uint8Array(bufLen)
            analyserRef.current.getByteFrequencyData(data)

            const barWidth = w / bufLen * 2
            let x = 0
            for (let i = 0; i < bufLen; i++) {
                const barHeight = (data[i] / 255) * h * verticalZoom
                const hue = (i / bufLen) * 240
                ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.8)`
                ctx.fillRect(x, h - barHeight, barWidth - 1, barHeight)
                x += barWidth
                if (x > w) break
            }
        }

        if (!analyserRef.current) {
            ctx.strokeStyle = '#4fc3f7'
            ctx.lineWidth = 1
            ctx.beginPath()
            for (let x = 0; x < w; x++) {
                const t = offset + x / pixelsPerSecond
                const y = h / 2 + Math.sin(t * 50) * (h * 0.3 * verticalZoom) *
                    Math.sin(t * 3) * Math.cos(t * 7)
                if (x === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
            }
            ctx.stroke()
        }

        const playX = timeToX(currentTime)
        if (playX >= 0 && playX <= w) {
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 1
            ctx.setLineDash([4, 4])
            ctx.beginPath()
            ctx.moveTo(playX, 0)
            ctx.lineTo(playX, h)
            ctx.stroke()
            ctx.setLineDash([])
        }

        if (isModified) {
            ctx.fillStyle = '#ff4444'
            ctx.font = '11px monospace'
            ctx.fillText('Modified', w - 60, 14)
        }

        ctx.fillStyle = '#aaa'
        ctx.font = '10px monospace'
        for (let s = startSec; s <= endSec; s++) {
            const x = timeToX(s)
            if (x >= 0 && x <= w) {
                ctx.fillText(formatTime(s), x + 2, 12)
            }
        }

        animFrameRef.current = requestAnimationFrame(draw)
    }, [videoElement, currentLine, lines, displayMode, horizontalZoom, verticalZoom, scrollOffset, autoScroll, isModified])

    useEffect(() => {
        animFrameRef.current = requestAnimationFrame(draw)
        return () => cancelAnimationFrame(animFrameRef.current)
    }, [draw])

    const handleMouseEvent = (e: React.MouseEvent, button: number) => {
        if (!containerRef.current || !videoElement) return
        const rect = containerRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left
        const duration = videoElement.duration || 1
        const pixelsPerSecond = (rect.width * horizontalZoom) / duration
        const visibleDuration = rect.width / pixelsPerSecond

        let offset = scrollOffset
        if (autoScroll && currentLine) {
            const lineCenter = (currentLine.start + currentLine.end) / 2
            offset = lineCenter - visibleDuration / 2
            offset = Math.max(0, Math.min(duration - visibleDuration, offset))
        }

        const time = offset + x / pixelsPerSecond

        if (button === 0) {
            onSetStart(Math.max(0, time))
        } else if (button === 2) {
            onSetEnd(Math.max(0, time))
        }
    }

    return (
        <div className="main-audio">
            <div className="main-audio-toolbar">
                <button
                    className={`main-tbtn ${displayMode === 'waveform' ? 'main-tbtn-active' : ''}`}
                    onClick={() => setDisplayMode('waveform')}
                    title="Waveform"
                >
                    Wave
                </button>
                <button
                    className={`main-tbtn ${displayMode === 'spectrum' ? 'main-tbtn-active' : ''}`}
                    onClick={() => setDisplayMode('spectrum')}
                    title="Spectrum"
                >
                    Spec
                </button>
                <div className="main-editbox-separator" />
                <button
                    className={`main-tbtn ${autoScroll ? 'main-tbtn-active' : ''}`}
                    onClick={() => setAutoScroll(!autoScroll)}
                    title="Auto-scroll to selected line"
                >
                    Auto
                </button>
                <div className="main-editbox-separator" />
                <span className="main-label" style={{ fontSize: '10px' }}>HZoom</span>
                <input
                    type="range"
                    min="0.5"
                    max="10"
                    step="0.1"
                    value={horizontalZoom}
                    onChange={(e) => setHorizontalZoom(parseFloat(e.target.value))}
                    className="main-slider"
                />
                <span className="main-label" style={{ fontSize: '10px' }}>VZoom</span>
                <input
                    type="range"
                    min="0.2"
                    max="3"
                    step="0.1"
                    value={verticalZoom}
                    onChange={(e) => setVerticalZoom(parseFloat(e.target.value))}
                    className="main-slider"
                />
            </div>

            <div
                ref={containerRef}
                className="main-audio-canvas-container"
                onClick={(e) => handleMouseEvent(e, 0)}
                onContextMenu={(e) => {
                    e.preventDefault()
                    handleMouseEvent(e, 2)
                }}
            >
                <canvas ref={canvasRef} className="main-audio-canvas" />
            </div>

            <div className="main-audio-controls">
                <button className="main-tbtn" title="Play selection (S)" onClick={() => {
                    if (currentLine) onPlayRange(currentLine.start, currentLine.end)
                }}>▶ Sel</button>
                <button className="main-tbtn" title="Play 500ms before (Q)" onClick={() => {
                    if (currentLine) onPlayRange(currentLine.start - 0.5, currentLine.start)
                }}>◀ 500ms</button>
                <button className="main-tbtn" title="Play 500ms after (W)" onClick={() => {
                    if (currentLine) onPlayRange(currentLine.end, currentLine.end + 0.5)
                }}>500ms ▶</button>
                <button className="main-tbtn" title="Play first 500ms (E)" onClick={() => {
                    if (currentLine) onPlayRange(currentLine.start, currentLine.start + 0.5)
                }}>▶| 500ms</button>
                <button className="main-tbtn" title="Play last 500ms (D)" onClick={() => {
                    if (currentLine) onPlayRange(currentLine.end - 0.5, currentLine.end)
                }}>500ms |◀</button>
            </div>
        </div>
    )
}
