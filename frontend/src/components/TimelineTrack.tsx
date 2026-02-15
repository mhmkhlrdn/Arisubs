import type { TimelineBlock } from '../types'
import { useSessionStore } from '../store/sessionStore'
import { TimelineClip } from './TimelineClip'

interface TimelineTrackProps {
  trackIndex: number
  blocks: TimelineBlock[]
  pixelsPerSecond: number
  onBlockClick?: (blockId: string) => void
}

export function TimelineTrack({ trackIndex, blocks, pixelsPerSecond, onBlockClick }: TimelineTrackProps) {
  const { clips } = useSessionStore()
  const trackBlocks = blocks.filter((b) => b.trackIndex === trackIndex)

  return (
    <div className="relative h-20 border-b border-gray-700">
      {trackBlocks.map((block) => {
        const clip = clips.find((c) => c.id === block.clipId)
        if (!clip) return null

        return (
          <TimelineClip
            key={block.id}
            block={block}
            pixelsPerSecond={pixelsPerSecond}
            clipLabel={clip.label}
          />
        )
      })}
    </div>
  )
}
