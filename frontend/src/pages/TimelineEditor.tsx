import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download } from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { submitExport, getDownloadUrl, getVideoFileUrl } from '../api/client'
import { useJobProgress } from '../hooks/useJobProgress'
import { ProgressBar } from '../components/ProgressBar'
import { SubtitleEditBox } from '../components/editor/SubtitleEditBox'
import { SubtitleGrid } from '../components/editor/SubtitleGrid'
import { AudioDisplay } from '../components/editor/AudioDisplay'
import type { SubtitleLine, SubtitleStyle, UndoState } from '../types/subtitle'
import { createDefaultLine, DEFAULT_STYLE, formatTime } from '../types/subtitle'
import '../styles/main.css'

/**
 * [State Management]
 * - Core state
 * - Video state
 * - Undo/Redo
 * - Panel sizing
 * - Get the first video ID from clips
 * - Initialize subtitle lines from clips
 * - Selected line
 *
 * [Actions]
 * - Push undo state
 * - Undo
 * - Redo
 * - Update a line
 * - Select a line (Grid click behavior)
 * - Seek video to line start
 * - Go to next line (Enter/G)
 * - Go to previous line (Z in audio mode)
 * - Commit and next (Enter/G)
 * - Commit and stay (Ctrl+Enter)
 * - Move selected lines (Alt+Up/Down)
 * - Delete selected lines (Ctrl+Delete)
 * - Add new line
 * - Duplicate line
 * - Set start time to current video time (Ctrl+3)
 * - Set end time to current video time (Ctrl+4)
 * - Play video range
 * - Toggle play/pause (Ctrl+P)
 *
 * [Global Keybinds]
 * - Ctrl shortcuts (work everywhere)
 * - Non-input shortcuts (Audio mode keys)
 *
 * [Video Handling]
 * - Video time update
 *
 * [UI]
 * - Resize handler for top panel
 * - Export
 * - Export view
 * - No clips view
 * - Menu Bar
 * - Main Toolbar
 * - Top Panel: Video + Audio
 * - Resize Handle
 * - Subtitle Edit Box
 * - Subtitle Grid
 * - Status Bar
 */

export function TimelineEditor() {
  const navigate = useNavigate()
  const { clips, setExportJobId, exportJobId } = useSessionStore()
  const { progress, status, message, error } = useJobProgress(exportJobId)

  const [lines, setLines] = useState<SubtitleLine[]>([])
  const [styles] = useState<SubtitleStyle[]>([DEFAULT_STYLE])
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set())
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1)
  const [isModified, setIsModified] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const [undoStack, setUndoStack] = useState<UndoState[]>([])
  const [redoStack, setRedoStack] = useState<UndoState[]>([])

  const [topPanelHeight, setTopPanelHeight] = useState(320)
  const [isResizing, setIsResizing] = useState(false)

  const videoId = clips.length > 0 ? clips[0].videoId : null

  useEffect(() => {
    if (lines.length === 0 && clips.length > 0) {
      const newLines = clips.map((clip, i) => ({
        id: crypto.randomUUID(),
        lineNumber: i + 1,
        layer: 0,
        start: clip.start,
        end: clip.end,
        style: 'Default',
        actor: '',
        marginL: 0,
        marginR: 0,
        marginV: 0,
        effect: '',
        text: clip.label || '',
        isComment: false,
      }))
      setLines(newLines)
      if (newLines.length > 0) {
        setSelectedLineId(newLines[0].id)
        setSelectedLineIds(new Set([newLines[0].id]))
      }
    }
  }, [clips, lines.length])

  const selectedLine = lines.find((l) => l.id === selectedLineId) || null
  const selectedIndex = selectedLine ? lines.findIndex((l) => l.id === selectedLineId) : -1

  const pushUndo = useCallback((desc: string) => {
    setUndoStack((prev) => [...prev.slice(-50), { lines: JSON.parse(JSON.stringify(lines)), description: desc }])
    setRedoStack([])
  }, [lines])

  const undo = useCallback(() => {
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    setRedoStack((r) => [...r, { lines: JSON.parse(JSON.stringify(lines)), description: 'redo' }])
    setUndoStack((u) => u.slice(0, -1))
    setLines(prev.lines)
  }, [undoStack, lines])

  const redo = useCallback(() => {
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    setUndoStack((u) => [...u, { lines: JSON.parse(JSON.stringify(lines)), description: 'undo' }])
    setRedoStack((r) => r.slice(0, -1))
    setLines(next.lines)
  }, [redoStack, lines])

  const updateLine = useCallback((id: string, changes: Partial<SubtitleLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...changes } : l)))
    setIsModified(true)
  }, [])

  const selectLine = useCallback((lineId: string, multi?: boolean, range?: boolean) => {
    const idx = lines.findIndex((l) => l.id === lineId)
    if (range && lastSelectedIndex >= 0) {
      const start = Math.min(lastSelectedIndex, idx)
      const end = Math.max(lastSelectedIndex, idx)
      const rangeIds = new Set(lines.slice(start, end + 1).map((l) => l.id))
      setSelectedLineIds(rangeIds)
    } else if (multi) {
      setSelectedLineIds((prev) => {
        const next = new Set(prev)
        if (next.has(lineId)) next.delete(lineId)
        else next.add(lineId)
        return next
      })
    } else {
      setSelectedLineIds(new Set([lineId]))
    }
    setSelectedLineId(lineId)
    setLastSelectedIndex(idx)
    setIsModified(false)

    const line = lines.find((l) => l.id === lineId)
    if (line && videoRef.current) {
      videoRef.current.currentTime = line.start
    }
  }, [lines, lastSelectedIndex])

  const goToNextLine = useCallback(() => {
    if (selectedIndex < lines.length - 1) {
      selectLine(lines[selectedIndex + 1].id)
    }
  }, [selectedIndex, lines, selectLine])

  const goToPrevLine = useCallback(() => {
    if (selectedIndex > 0) {
      selectLine(lines[selectedIndex - 1].id)
    }
  }, [selectedIndex, lines, selectLine])

  const commitAndNext = useCallback(() => {
    pushUndo('edit line')
    setIsModified(false)
    goToNextLine()
  }, [pushUndo, goToNextLine])

  const commitAndStay = useCallback(() => {
    pushUndo('edit line')
    setIsModified(false)
  }, [pushUndo])

  const moveLines = useCallback((direction: 'up' | 'down') => {
    pushUndo('move lines')
    setLines((prev) => {
      const sorted = [...prev]
      const selectedIndices = sorted
        .map((l, i) => (selectedLineIds.has(l.id) ? i : -1))
        .filter((i) => i !== -1)
        .sort((a, b) => a - b)

      if (direction === 'up' && selectedIndices[0] > 0) {
        for (const idx of selectedIndices) {
          ;[sorted[idx - 1], sorted[idx]] = [sorted[idx], sorted[idx - 1]]
        }
      } else if (direction === 'down' && selectedIndices[selectedIndices.length - 1] < sorted.length - 1) {
        for (const idx of [...selectedIndices].reverse()) {
          ;[sorted[idx + 1], sorted[idx]] = [sorted[idx], sorted[idx + 1]]
        }
      }

      return sorted.map((l, i) => ({ ...l, lineNumber: i + 1 }))
    })
  }, [selectedLineIds, pushUndo])

  const deleteSelectedLines = useCallback(() => {
    pushUndo('delete lines')
    setLines((prev) => {
      const remaining = prev.filter((l) => !selectedLineIds.has(l.id))
      return remaining.map((l, i) => ({ ...l, lineNumber: i + 1 }))
    })
    setSelectedLineIds(new Set())
    setSelectedLineId(null)
  }, [selectedLineIds, pushUndo])

  const addNewLine = useCallback(() => {
    pushUndo('add line')
    const lastLine = lines[lines.length - 1]
    const newStart = lastLine ? lastLine.end : 0
    const newLine = createDefaultLine(lines.length + 1, newStart)
    setLines((prev) => [...prev, newLine])
    setSelectedLineId(newLine.id)
    setSelectedLineIds(new Set([newLine.id]))
  }, [lines, pushUndo])

  const duplicateLine = useCallback(() => {
    if (!selectedLine) return
    pushUndo('duplicate line')
    const newLine: SubtitleLine = {
      ...selectedLine,
      id: crypto.randomUUID(),
      lineNumber: selectedIndex + 2,
    }
    setLines((prev) => {
      const next = [...prev]
      next.splice(selectedIndex + 1, 0, newLine)
      return next.map((l, i) => ({ ...l, lineNumber: i + 1 }))
    })
    setSelectedLineId(newLine.id)
    setSelectedLineIds(new Set([newLine.id]))
  }, [selectedLine, selectedIndex, pushUndo])

  const setStartToCurrent = useCallback(() => {
    if (!selectedLine) return
    pushUndo('set start time')
    updateLine(selectedLine.id, { start: currentTime })
  }, [selectedLine, currentTime, pushUndo, updateLine])

  const setEndToCurrent = useCallback(() => {
    if (!selectedLine) return
    pushUndo('set end time')
    updateLine(selectedLine.id, { end: currentTime })
  }, [selectedLine, currentTime, pushUndo, updateLine])

  const playRange = useCallback((start: number, end: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = start
    videoRef.current.play()
    const checkEnd = () => {
      if (videoRef.current && videoRef.current.currentTime >= end) {
        videoRef.current.pause()
      } else {
        requestAnimationFrame(checkEnd)
      }
    }
    requestAnimationFrame(checkEnd)
  }, [])

  const togglePlayPause = useCallback(() => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.play()
      setIsPlaying(true)
    } else {
      videoRef.current.pause()
      setIsPlaying(false)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'

      if (e.ctrlKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'z': e.preventDefault(); undo(); return
          case 'y': e.preventDefault(); redo(); return
          case 's': e.preventDefault(); commitAndStay(); return
          case 'p': e.preventDefault(); togglePlayPause(); return
          case '3': e.preventDefault(); setStartToCurrent(); return
          case '4': e.preventDefault(); setEndToCurrent(); return
          case '1':
            e.preventDefault()
            if (selectedLine && videoRef.current) videoRef.current.currentTime = selectedLine.start
            return
          case '2':
            e.preventDefault()
            if (selectedLine && videoRef.current) videoRef.current.currentTime = selectedLine.end
            return
          case 'delete':
            e.preventDefault(); deleteSelectedLines(); return
        }
      }

      if (!isInput) {
        switch (e.key.toLowerCase()) {
          case 'g':
            e.preventDefault(); commitAndNext(); return
          case 's':
            e.preventDefault()
            if (selectedLine) playRange(selectedLine.start, selectedLine.end)
            return
          case ' ':
            e.preventDefault()
            if (selectedLine) playRange(selectedLine.start, selectedLine.end)
            return
          case 'r':
            e.preventDefault()
            if (selectedLine) playRange(selectedLine.start, selectedLine.end)
            return
          case 'q':
            e.preventDefault()
            if (selectedLine) playRange(selectedLine.start - 0.5, selectedLine.start)
            return
          case 'w':
            e.preventDefault()
            if (selectedLine) playRange(selectedLine.end, selectedLine.end + 0.5)
            return
          case 'e':
            e.preventDefault()
            if (selectedLine) playRange(selectedLine.start, selectedLine.start + 0.5)
            return
          case 'd':
            e.preventDefault()
            if (selectedLine) playRange(selectedLine.end - 0.5, selectedLine.end)
            return
          case 'x':
            e.preventDefault(); goToNextLine(); return
          case 'z':
            if (!e.ctrlKey) { e.preventDefault(); goToPrevLine(); return }
            break
          case 'b':
            e.preventDefault(); togglePlayPause(); return
          case 'n':
            e.preventDefault(); addNewLine(); return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, commitAndNext, commitAndStay, togglePlayPause, setStartToCurrent,
    setEndToCurrent, deleteSelectedLines, selectedLine, playRange, goToNextLine,
    goToPrevLine, addNewLine])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onDurationChange = () => setVideoDuration(video.duration)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [videoId])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    const startY = e.clientY
    const startH = topPanelHeight
    const onMove = (ev: MouseEvent) => {
      setTopPanelHeight(Math.max(200, Math.min(600, startH + ev.clientY - startY)))
    }
    const onUp = () => {
      setIsResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [topPanelHeight])

  const handleExport = async () => {
    const exportClips = lines
      .filter((l) => !l.isComment)
      .map((l) => {
        const clip = clips.find((c) => c.label === l.text || c.start === l.start)
        return clip!
      })
      .filter(Boolean)

    setIsExporting(true)
    try {
      const { jobId } = await submitExport(exportClips)
      setExportJobId(jobId)
    } catch (err) {
      console.error('Failed to export:', err)
      setIsExporting(false)
    }
  }

  if (isExporting && exportJobId) {
    return (
      <div className="main-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: '420px', padding: '32px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', color: '#cdd6f4' }}>
            Exporting Timeline
          </h2>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6c7086', marginBottom: '8px' }}>
              <span>{message || 'Processing...'}</span>
              <span>{progress}%</span>
            </div>
            <ProgressBar progress={progress} />
          </div>
          {error && (
            <div style={{ background: 'rgba(243,139,168,0.15)', border: '1px solid #f38ba8', color: '#f38ba8', padding: '8px 12px', borderRadius: '4px', fontSize: '12px', marginBottom: '12px' }}>
              {error}
            </div>
          )}
          {status === 'done' && (
            <button
              onClick={() => { window.location.href = getDownloadUrl(exportJobId!) }}
              className="main-tbtn-primary"
              style={{ width: '100%', height: '36px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
            >
              <Download size={16} /> Download Export
            </button>
          )}
        </div>
      </div>
    )
  }

  if (clips.length === 0) {
    return (
      <div className="main-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '12px', color: '#cdd6f4' }}>No Clips Available</h2>
          <p style={{ color: '#6c7086', marginBottom: '16px' }}>Please add clips in the Clip Editor first.</p>
          <button onClick={() => navigate('/')} className="main-tbtn-primary" style={{ padding: '8px 20px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '13px' }}>
            Go to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="main-container">
      <div className="main-menubar">
        <span className="main-menu-item" onClick={() => navigate('/')}>File</span>
        <span className="main-menu-item" onClick={undo}>Edit</span>
        <span className="main-menu-item">Subtitle</span>
        <span className="main-menu-item">Timing</span>
        <span className="main-menu-item">Video</span>
        <span className="main-menu-item">Audio</span>
        <span className="main-menu-item">View</span>
        <span className="main-menu-item">Help</span>
      </div>

      <div className="main-main-toolbar">
        <button className="main-tbtn" title="New line (N)" onClick={addNewLine}>+ Line</button>
        <button className="main-tbtn" title="Duplicate line" onClick={duplicateLine}>Dup</button>
        <button className="main-tbtn main-tbtn-danger" title="Delete (Ctrl+Del)" onClick={deleteSelectedLines}>Del</button>
        <div className="main-editbox-separator" />
        <button className="main-tbtn" title="Undo (Ctrl+Z)" onClick={undo}>↩</button>
        <button className="main-tbtn" title="Redo (Ctrl+Y)" onClick={redo}>↪</button>
        <div className="main-editbox-separator" />
        <button className="main-tbtn" title="Set start to video (Ctrl+3)" onClick={setStartToCurrent}>Start→</button>
        <button className="main-tbtn" title="Set end to video (Ctrl+4)" onClick={setEndToCurrent}>←End</button>
        <div className="main-editbox-separator" />
        <button className={`main-tbtn ${isPlaying ? 'main-tbtn-active' : ''}`} title="Play/Pause (Ctrl+P)" onClick={togglePlayPause}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <div style={{ flex: 1 }} />
        <button className="main-tbtn main-tbtn-primary" title="Export timeline" onClick={handleExport} style={{ gap: '4px', display: 'flex', alignItems: 'center' }}>
          <Download size={12} /> Export
        </button>
      </div>

      <div className="main-top-panel" style={{ height: `${topPanelHeight}px` }}>
        <div className="main-video-panel">
          <div className="main-video-container">
            {videoId ? (
              <video
                ref={videoRef}
                src={getVideoFileUrl(videoId)}
                crossOrigin="anonymous"
                preload="auto"
              />
            ) : (
              <div style={{ color: '#585b70', fontSize: '13px' }}>No video loaded</div>
            )}
          </div>
          <div className="main-video-controls">
            <button className="main-tbtn" onClick={togglePlayPause}>{isPlaying ? '⏸' : '▶'}</button>
            <button className="main-tbtn" onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, currentTime - 1 / 30) }}>⏪</button>
            <button className="main-tbtn" onClick={() => { if (videoRef.current) videoRef.current.currentTime += 1 / 30 }}>⏩</button>
            <span className="main-video-time">{formatTime(currentTime)}</span>
            <span style={{ color: '#45475a' }}>/</span>
            <span className="main-video-time">{formatTime(videoDuration)}</span>
          </div>
        </div>

        <div className="main-audio-panel">
          <AudioDisplay
            videoElement={videoRef.current}
            currentLine={selectedLine}
            lines={lines}
            onSetStart={(t) => {
              if (selectedLine) {
                pushUndo('set start')
                updateLine(selectedLine.id, { start: t })
              }
            }}
            onSetEnd={(t) => {
              if (selectedLine) {
                pushUndo('set end')
                updateLine(selectedLine.id, { end: t })
              }
            }}
            onSeek={(t) => { if (videoRef.current) videoRef.current.currentTime = t }}
            onPlayRange={playRange}
            isModified={isModified}
          />
        </div>
      </div>

      <div className="main-resize-handle" onMouseDown={handleResizeStart} />

      <SubtitleEditBox
        line={selectedLine}
        styles={styles}
        onUpdate={updateLine}
        onCommitAndNext={commitAndNext}
        onCommitAndStay={commitAndStay}
      />

      <SubtitleGrid
        lines={lines}
        selectedLineId={selectedLineId}
        selectedLineIds={selectedLineIds}
        currentVideoTime={currentTime}
        onSelect={selectLine}
        onMoveLines={moveLines}
      />

      <div className="main-statusbar">
        <div className="main-statusbar-section">
          <span>Lines: {lines.length}</span>
          <span>Selected: {selectedLineIds.size}</span>
          {selectedLine && <span>Line {selectedLine.lineNumber}</span>}
        </div>
        <div className="main-statusbar-section">
          {isModified && <span style={{ color: '#f38ba8' }}>● Modified</span>}
          <span>Video: {formatTime(currentTime)}</span>
          <span>
            <span className="main-kbd">G</span> Commit
            <span className="main-kbd">S</span> Play
            <span className="main-kbd">Z/X</span> Prev/Next
          </span>
        </div>
      </div>
    </div>
  )
}
