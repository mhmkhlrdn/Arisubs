import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TimelineBlock } from '../types'

interface TimelineClipProps {
  block: TimelineBlock
  pixelsPerSecond: number
  clipLabel: string
}

export function TimelineClip({ block, pixelsPerSecond, clipLabel }: TimelineClipProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const left = block.offsetSeconds * pixelsPerSecond
  const width = block.duration * pixelsPerSecond

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, left: `${left}px`, width: `${width}px` }}
      className="absolute h-full bg-blue-600 border border-blue-400 rounded cursor-move flex items-center justify-center text-white text-xs font-semibold px-2"
      {...attributes}
      {...listeners}
    >
      {clipLabel}
    </div>
  )
}
