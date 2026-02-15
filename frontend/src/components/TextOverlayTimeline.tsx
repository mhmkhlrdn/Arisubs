import { useState, useRef, useEffect } from 'react'
import { GripVertical, X } from 'lucide-react'
import type { TextOverlayData } from './TextOverlay'

interface TextOverlayTimelineProps {
  overlays: TextOverlayData[]
  selectedOverlayId: string | null
  currentTime: number
  duration: number
  pixelsPerSecond?: number
  onSelect: (overlayId: string) => void
  onUpdate: (overlayId: string, updates: Partial<TextOverlayData>) => void
  onDelete: (overlayId: string) => void
  onSeek: (time: number) => void
}

export function TextOverlayTimeline({
  overlays,
  selectedOverlayId,
  currentTime,
  duration,
  pixelsPerSecond = 50,
  onSelect,
  onUpdate,
  onDelete,
  onSeek,
}: TextOverlayTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null)
  const [draggingOverlayId, setDraggingOverlayId] = useState<string | null>(null)
  const [resizingOverlayId, setResizingOverlayId] = useState<string | null>(null)
  const [resizeEdge, setResizeEdge] = useState<'left' | 'right' | null>(null)
  const [dragStart, setDragStart] = useState({ x: 0, time: 0 })

  // Calculate time from pixel position
  const pixelToTime = (pixel: number): number => {
    return Math.max(0, Math.min(duration, pixel / pixelsPerSecond))
  }

  // Calculate pixel position from time
  const timeToPixel = (time: number): number => {
    return time * pixelsPerSecond
  }

  // Handle mouse down on overlay block
  const handleBlockMouseDown = (e: React.MouseEvent, overlay: TextOverlayData) => {
    e.stopPropagation()
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return

    const clickX = e.clientX - rect.left
    const blockLeft = timeToPixel(overlay.startTime)
    const blockRight = timeToPixel(overlay.endTime)
    const blockWidth = blockRight - blockLeft

    // Check if clicking on resize handles (first/last 8px)
    const relativeX = clickX - blockLeft
    if (relativeX < 8) {
      // Left edge
      setResizingOverlayId(overlay.id)
      setResizeEdge('left')
      setDragStart({ x: e.clientX, time: overlay.startTime })
    } else if (relativeX > blockWidth - 8) {
      // Right edge
      setResizingOverlayId(overlay.id)
      setResizeEdge('right')
      setDragStart({ x: e.clientX, time: overlay.endTime })
    } else {
      // Dragging the block
      setDraggingOverlayId(overlay.id)
      setDragStart({ x: e.clientX, time: overlay.startTime })
    }

    onSelect(overlay.id)
  }

  // Handle mouse move for dragging/resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect) return

      if (draggingOverlayId) {
        const overlay = overlays.find(o => o.id === draggingOverlayId)
        if (!overlay) return

        const deltaX = e.clientX - dragStart.x
        const deltaTime = pixelToTime(deltaX)
        const newStartTime = Math.max(0, Math.min(duration - (overlay.endTime - overlay.startTime), dragStart.time + deltaTime))
        const duration_ = overlay.endTime - overlay.startTime
        const newEndTime = newStartTime + duration_

        onUpdate(overlay.id, {
          startTime: newStartTime,
          endTime: newEndTime,
        })
      } else if (resizingOverlayId && resizeEdge) {
        const overlay = overlays.find(o => o.id === resizingOverlayId)
        if (!overlay) return

        const deltaX = e.clientX - dragStart.x
        const deltaTime = pixelToTime(deltaX)

        if (resizeEdge === 'left') {
          const newStartTime = Math.max(0, Math.min(overlay.endTime - 0.1, dragStart.time + deltaTime))
          onUpdate(overlay.id, { startTime: newStartTime })
        } else {
          const newEndTime = Math.max(overlay.startTime + 0.1, Math.min(duration, dragStart.time + deltaTime))
          onUpdate(overlay.id, { endTime: newEndTime })
        }
      }
    }

    const handleMouseUp = () => {
      setDraggingOverlayId(null)
      setResizingOverlayId(null)
      setResizeEdge(null)
    }

    if (draggingOverlayId || resizingOverlayId) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [draggingOverlayId, resizingOverlayId, resizeEdge, dragStart, overlays, duration, pixelsPerSecond, onUpdate])

  // Handle timeline click to seek
  const handleTimelineClick = (e: React.MouseEvent) => {
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return

    const clickX = e.clientX - rect.left
    const time = pixelToTime(clickX)
    onSeek(time)
  }

  // Generate time markers
  const timeMarkers = []
  const markerInterval = duration > 60 ? 10 : duration > 30 ? 5 : 1
  for (let t = 0; t <= duration; t += markerInterval) {
    timeMarkers.push(t)
  }

  return (
    <div className="bg-gray-800 border-t border-gray-700 flex flex-col h-full">
      {/* Timeline Header */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-gray-700 bg-gray-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Timeline</h3>
          <div className="text-xs text-gray-400">
            {overlays.length} overlay{overlays.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Timeline Ruler */}
      <div className="flex-shrink-0 h-8 bg-gray-900 border-b border-gray-700 relative overflow-x-auto">
        <div className="h-full relative" style={{ minWidth: `${timeToPixel(duration) + 20}px` }}>
          {timeMarkers.map(time => (
            <div
              key={time}
              className="absolute top-0 h-full border-l border-gray-600"
              style={{ left: `${timeToPixel(time)}px` }}
            >
              <div className="absolute top-0 left-0.5 text-xs text-gray-400 whitespace-nowrap">
                {time.toFixed(1)}s
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline Track */}
      <div
        ref={timelineRef}
        className="flex-1 min-h-[120px] bg-gray-800 relative cursor-pointer overflow-x-auto overflow-y-hidden"
        onClick={handleTimelineClick}
        style={{ minWidth: `${timeToPixel(duration) + 20}px` }}
      >
        {/* Current time indicator */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-20 pointer-events-none"
          style={{ left: `${timeToPixel(currentTime)}px` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-blue-500" />
        </div>

        {/* Overlay Blocks */}
        {overlays.map(overlay => {
          const left = timeToPixel(overlay.startTime)
          const width = timeToPixel(overlay.endTime - overlay.startTime)
          const isSelected = overlay.id === selectedOverlayId
          const isDragging = draggingOverlayId === overlay.id
          const isResizing = resizingOverlayId === overlay.id
          const minWidth = 4 // Minimum visible width in pixels

          return (
            <div
              key={overlay.id}
              className={`absolute top-2 bottom-2 rounded border-2 transition-all ${
                isSelected
                  ? 'bg-blue-600 border-blue-400 shadow-lg z-10'
                  : 'bg-blue-700 border-blue-500 hover:bg-blue-600 z-0'
              } ${isDragging || isResizing ? 'opacity-75' : ''}`}
              style={{
                left: `${left}px`,
                width: `${Math.max(minWidth, width)}px`,
                minWidth: `${minWidth}px`,
                cursor: isResizing ? (resizeEdge === 'left' ? 'w-resize' : 'e-resize') : 'move',
              }}
              onMouseDown={(e) => handleBlockMouseDown(e, overlay)}
            >
              {/* Resize handles */}
              {isSelected && (
                <>
                  <div className="absolute left-0 top-0 bottom-0 w-2 bg-blue-400 hover:bg-blue-300 cursor-w-resize" />
                  <div className="absolute right-0 top-0 bottom-0 w-2 bg-blue-400 hover:bg-blue-300 cursor-e-resize" />
                </>
              )}

              {/* Block content */}
              <div className="absolute inset-0 flex items-center justify-center px-2 pointer-events-none">
                <div className="truncate text-xs font-medium text-white">
                  {overlay.text || 'Empty'}
                </div>
              </div>

              {/* Delete button */}
              {isSelected && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(overlay.id)
                  }}
                  className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 z-20 pointer-events-auto"
                  title="Delete overlay"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
