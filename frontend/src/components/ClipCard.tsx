import { X, Loader2, Play } from 'lucide-react'
import { useState } from 'react'
import type { Clip } from '../types'

interface ClipCardProps {
  clip: Clip
  videoTitle?: string
  isProcessing?: boolean
  onRemove: () => void
  onLabelChange: (label: string) => void
  onView?: (clip: Clip) => void
}

export function ClipCard({ clip, videoTitle, isProcessing, onRemove, onLabelChange, onView }: ClipCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [label, setLabel] = useState(clip.label)

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleSave = () => {
    onLabelChange(label)
    setIsEditing(false)
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-start justify-between mb-2">
        {isEditing ? (
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') {
                setLabel(clip.label)
                setIsEditing(false)
              }
            }}
            className="flex-1 bg-gray-700 text-white px-2 py-1 rounded"
            autoFocus
          />
        ) : (
          <h3
            className="font-semibold text-white cursor-pointer hover:text-blue-400"
            onClick={() => setIsEditing(true)}
          >
            {clip.label || 'Untitled Clip'}
          </h3>
        )}
        <button
          onClick={onRemove}
          className="text-gray-400 hover:text-red-400 transition-colors ml-2"
        >
          <X size={20} />
        </button>
      </div>

      <div className="text-sm text-gray-400 space-y-1">
        <div>{videoTitle || `Video ${clip.videoId}`}</div>
        <div>
          {formatTime(clip.start)} → {formatTime(clip.end)}
        </div>
        {isProcessing && (
          <div className="flex items-center gap-2 text-blue-400">
            <Loader2 size={16} className="animate-spin" />
            <span>Processing...</span>
          </div>
        )}
        {onView && !isProcessing && (
          <button
            onClick={() => onView(clip)}
            className="mt-2 w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs transition-colors flex items-center justify-center gap-1"
          >
            <Play size={12} />
            <span>View Clip</span>
          </button>
        )}
      </div>
    </div>
  )
}
