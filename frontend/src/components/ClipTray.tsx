import { ClipCard } from './ClipCard'
import type { Clip } from '../types'
import { useSessionStore } from '../store/sessionStore'

interface ClipTrayProps {
  clips: Clip[]
  processingClips: Set<string>
  onViewClip?: (clip: Clip) => void
}

export function ClipTray({ clips, processingClips, onViewClip }: ClipTrayProps) {
  const { updateClip, removeClip, videos } = useSessionStore()

  if (clips.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No clips yet. Add clips using the trim bar above.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {clips.map((clip) => (
        <ClipCard
          key={clip.id}
          clip={clip}
          videoTitle={videos[clip.videoId]?.title}
          isProcessing={processingClips.has(clip.id)}
          onRemove={() => removeClip(clip.id)}
          onLabelChange={(label) => updateClip(clip.id, { label })}
          onView={onViewClip}
        />
      ))}
    </div>
  )
}
