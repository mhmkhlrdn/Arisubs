import { useState, useEffect } from 'react'
import { Type, Palette, Film, Clock, X, Move, AlignCenter } from 'lucide-react'
import type { TextOverlayData } from './TextOverlay'

interface TextOverlayEditorProps {
  overlay: TextOverlayData | null
  onUpdate: (updates: Partial<TextOverlayData>) => void
  onClose: () => void
  currentTime?: number
  onSeekToTime?: (time: number) => void
}

export function TextOverlayEditor({ overlay, onUpdate, onClose, currentTime, onSeekToTime }: TextOverlayEditorProps) {
  if (!overlay) return null

  const [localOverlay, setLocalOverlay] = useState(overlay)

  // Update local state when overlay prop changes
  useEffect(() => {
    setLocalOverlay(overlay)
  }, [overlay])

  const handleChange = (field: keyof TextOverlayData, value: any) => {
    const updated = { ...localOverlay, [field]: value }
    setLocalOverlay(updated)
    onUpdate({ [field]: value })
  }

  const handleSetToCurrentTime = () => {
    if (currentTime !== undefined) {
      const duration = localOverlay.endTime - localOverlay.startTime
      handleChange('startTime', currentTime)
      handleChange('endTime', currentTime + duration)
      if (onSeekToTime) {
        onSeekToTime(currentTime)
      }
    }
  }

  const handleCenterOverlay = () => {
    // This will be handled by the parent component
    onUpdate({ x: 400, y: 225 }) // Approximate center, will be adjusted by parent
  }

  return (
    <div className="space-y-3 text-sm">
      {/* Quick Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleCenterOverlay}
          className="flex-1 px-2 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs flex items-center justify-center gap-1"
          title="Center overlay on video"
        >
          <AlignCenter size={12} />
          <span>Center</span>
        </button>
      </div>

      {/* Text Content */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Text</label>
        <textarea
          value={localOverlay.text}
          onChange={(e) => handleChange('text', e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          placeholder="Enter text..."
          autoFocus
        />
      </div>

      {/* Font Settings */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Size</label>
          <input
            type="number"
            value={localOverlay.fontSize}
            onChange={(e) => handleChange('fontSize', parseInt(e.target.value) || 24)}
            className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
            min="12"
            max="200"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Font</label>
          <select
            value={localOverlay.fontFamily}
            onChange={(e) => handleChange('fontFamily', e.target.value)}
            className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
          >
            <option value="Arial">Arial</option>
            <option value="Helvetica">Helvetica</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Courier New">Courier New</option>
            <option value="Verdana">Verdana</option>
            <option value="Georgia">Georgia</option>
            <option value="Impact">Impact</option>
            <option value="Comic Sans MS">Comic Sans MS</option>
          </select>
        </div>
      </div>

      {/* Colors */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Text Color</label>
          <div className="flex gap-1.5">
            <input
              type="color"
              value={localOverlay.color}
              onChange={(e) => handleChange('color', e.target.value)}
              className="w-8 h-8 rounded cursor-pointer"
            />
            <input
              type="text"
              value={localOverlay.color}
              onChange={(e) => handleChange('color', e.target.value)}
              className="flex-1 px-2 py-1 bg-gray-700 text-white rounded text-xs"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">BG Color</label>
          <div className="flex gap-1.5">
            <input
              type="color"
              value={localOverlay.backgroundColor || '#000000'}
              onChange={(e) => handleChange('backgroundColor', e.target.value)}
              className="w-8 h-8 rounded cursor-pointer"
            />
            <input
              type="text"
              value={localOverlay.backgroundColor || ''}
              onChange={(e) => handleChange('backgroundColor', e.target.value || undefined)}
              className="flex-1 px-2 py-1 bg-gray-700 text-white rounded text-xs"
              placeholder="None"
            />
          </div>
        </div>
      </div>

      {/* Opacity & Animation */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Opacity: {Math.round(localOverlay.opacity * 100)}%
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={localOverlay.opacity}
            onChange={(e) => handleChange('opacity', parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Animation</label>
          <select
            value={localOverlay.animation}
            onChange={(e) => handleChange('animation', e.target.value as TextOverlayData['animation'])}
            className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
          >
            <option value="none">None</option>
            <option value="fadeIn">Fade In</option>
            <option value="slideUp">Slide Up</option>
            <option value="slideDown">Slide Down</option>
            <option value="slideLeft">Slide Left</option>
            <option value="slideRight">Slide Right</option>
            <option value="zoomIn">Zoom In</option>
          </select>
        </div>
      </div>
      {localOverlay.animation !== 'none' && (
        <div>
          <label className="block text-xs text-gray-400 mb-1">Animation Speed</label>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={localOverlay.animationDuration}
            onChange={(e) => handleChange('animationDuration', parseFloat(e.target.value) || 0.5)}
            className="w-full px-2 py-1 bg-gray-700 text-white rounded text-sm"
          />
          <div className="text-xs text-gray-500 mt-1">Animation effect speed (seconds). Overlay duration is controlled in the timeline below.</div>
        </div>
      )}

      {/* Timing Info (read-only, editing done in timeline) */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Timing</label>
        <div className="p-2 bg-gray-800 rounded text-xs text-gray-300">
          <div className="flex justify-between">
            <span>Start: {localOverlay.startTime.toFixed(2)}s</span>
            <span>End: {localOverlay.endTime.toFixed(2)}s</span>
          </div>
          <div className="mt-1 text-center text-gray-400">
            Duration: {(localOverlay.endTime - localOverlay.startTime).toFixed(2)}s
          </div>
          <div className="mt-2 text-xs text-gray-500 text-center">
            Drag and resize in timeline to adjust timing
          </div>
        </div>
      </div>
    </div>
  )
}
