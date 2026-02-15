import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bold, Italic, Underline, Strikethrough, Type, Scan, Languages,
  Play, Pause, Download, Plus, X, SkipBack, SkipForward,
  ZoomIn, ZoomOut, Upload
} from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { getVideoFileUrl } from '../api/client'
import {
  TextOverlay,
  type TextOverlayData,
  type AnimationType,
  type CustomFont,
  type AnimationConfig,
  ANIMATION_PRESETS,
  createDefaultOverlay,
  loadFontFromFile,
  getAllFonts,
} from '../components/TextOverlay'
import { OCRPanel } from '../components/OCRPanel'
import { TranslateSidebar } from '../components/TranslateSidebar'
import '../styles/main.css'

/**
 * [State]
 * - video
 * - custom fonts
 * - real audio (decoded for static display)
 * - overlays / selection
 * - panels
 * - undo / redo
 * - panel sizing
 * - derived
 * - edit box local state
 *
 * [Actions]
 * - update overlay
 * - select (grid click)
 * - seek video to overlay start
 * - navigation
 * - add / delete / duplicate / move
 * - timing helpers
 * - play range
 * - video events
 * - resize handle
 * - Audio Playhead draw (separate to avoid full redraw)
 * - ideally use a second layer, but for simplicity just use the current canvas and accept the slight flicker or implement a specialized playhead component.
 * - grid helpers
 *
 * [Audio Canvas]
 * - Auto-scroll audio to follow playhead & sync scroll state
 * - Only scroll if playhead is moving out of central 60% of viewport
 * - Markers
 * - Waveform
 * - Overlays
 * - Center line
 * - Playhead
 */

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const cs = Math.floor((sec % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}
function parseTime(t: string): number {
  const p = t.split(/[:.]/); if (p.length < 4) return 0
  return (parseInt(p[0]) || 0) * 3600 + (parseInt(p[1]) || 0) * 60 + (parseInt(p[2]) || 0) + (parseInt(p[3]) || 0) / 100
}
function cps(o: TextOverlayData): number {
  const d = o.endTime - o.startTime; if (d <= 0) return 0
  return Math.round(o.text.length / d)
}

interface UndoSnap { overlays: TextOverlayData[]; desc: string }

export function TranslationTimelineEditor() {
  const navigate = useNavigate()
  const { clips } = useSessionStore()

  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(clips.length > 0 ? clips[0].id : null)
  const selectedClip = selectedClipId ? clips.find(c => c.id === selectedClipId) ?? clips[0] ?? null : clips[0] ?? null
  const videoId = selectedClip?.videoId
  const videoSrc = videoId ? getVideoFileUrl(videoId) : null

  const [customFonts, setCustomFonts] = useState<CustomFont[]>([])
  const fontInputRef = useRef<HTMLInputElement>(null)
  const allFonts = getAllFonts(customFonts)
  const handleFontImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return
    for (const file of Array.from(files)) {
      try { const cf = await loadFontFromFile(file); setCustomFonts(prev => [...prev, cf]) }
      catch (err) { console.error('Failed to load font:', err) }
    }
    e.target.value = ''
  }

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
  const [isLoadingAudio, setIsLoadingAudio] = useState(false)
  const [hZoom, setHZoom] = useState(50)

  useEffect(() => {
    if (!videoSrc) { setAudioBuffer(null); return }
    const abort = new AbortController()
    let cancelled = false
    setIsLoadingAudio(true)

    const load = async () => {
      try {
        const resp = await fetch(videoSrc, { signal: abort.signal })
        const arrayBuf = await resp.arrayBuffer()
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const decoded = await ctx.decodeAudioData(arrayBuf)
        if (!cancelled) {
          setAudioBuffer(decoded)
          setIsLoadingAudio(false)
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return
        console.error('Failed to decode audio:', err)
        if (!cancelled) setIsLoadingAudio(false)
      }
    }
    load()
    return () => { cancelled = true; abort.abort() }
  }, [videoSrc])


  const [overlays, setOverlays] = useState<TextOverlayData[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastSelectIdx, setLastSelectIdx] = useState(-1)
  const [isModified, setIsModified] = useState(false)

  const [showOCR, setShowOCR] = useState(false)
  const [showTranslate, setShowTranslate] = useState(false)
  const [ocrText, setOcrText] = useState('')
  const [srcLang, setSrcLang] = useState('auto')
  const [tgtLang, setTgtLang] = useState('en')

  const [undoStack, setUndoStack] = useState<UndoSnap[]>([])
  const [redoStack, setRedoStack] = useState<UndoSnap[]>([])
  const pushUndo = useCallback((desc: string) => {
    setUndoStack(u => [...u.slice(-50), { overlays: JSON.parse(JSON.stringify(overlays)), desc }])
    setRedoStack([])
  }, [overlays])
  const undo = useCallback(() => {
    if (!undoStack.length) return
    setRedoStack(r => [...r, { overlays: JSON.parse(JSON.stringify(overlays)), desc: 'redo' }])
    setOverlays(undoStack[undoStack.length - 1].overlays)
    setUndoStack(u => u.slice(0, -1))
  }, [undoStack, overlays])
  const redo = useCallback(() => {
    if (!redoStack.length) return
    setUndoStack(u => [...u, { overlays: JSON.parse(JSON.stringify(overlays)), desc: 'undo' }])
    setOverlays(redoStack[redoStack.length - 1].overlays)
    setRedoStack(r => r.slice(0, -1))
  }, [redoStack, overlays])

  const [topH, setTopH] = useState(320)

  const sel = overlays.find(o => o.id === selectedId) ?? null
  const selIdx = sel ? overlays.findIndex(o => o.id === selectedId) : -1

  const updateOverlay = useCallback((id: string, ch: Partial<TextOverlayData>) => {
    setOverlays(prev => prev.map(o => o.id === id ? { ...o, ...ch } : o))
    setIsModified(true)
  }, [])

  const selectOverlay = useCallback((id: string, multi?: boolean, range?: boolean) => {
    const idx = overlays.findIndex(o => o.id === id)
    if (range && lastSelectIdx >= 0) {
      const s = Math.min(lastSelectIdx, idx), e = Math.max(lastSelectIdx, idx)
      setSelectedIds(new Set(overlays.slice(s, e + 1).map(o => o.id)))
    } else if (multi) {
      setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    } else {
      setSelectedIds(new Set([id]))
    }
    setSelectedId(id)
    setLastSelectIdx(idx)
    setIsModified(false)
    const ov = overlays.find(o => o.id === id)
    if (ov && videoRef.current) videoRef.current.currentTime = (selectedClip?.start ?? 0) + ov.startTime
  }, [overlays, lastSelectIdx, selectedClip])

  const goNext = useCallback(() => { if (selIdx < overlays.length - 1) selectOverlay(overlays[selIdx + 1].id) }, [selIdx, overlays, selectOverlay])
  const goPrev = useCallback(() => { if (selIdx > 0) selectOverlay(overlays[selIdx - 1].id) }, [selIdx, overlays, selectOverlay])
  const commitNext = useCallback(() => { pushUndo('edit'); setIsModified(false); goNext() }, [pushUndo, goNext])
  const commitStay = useCallback(() => { pushUndo('edit'); setIsModified(false) }, [pushUndo])

  const addOverlay = useCallback(() => {
    pushUndo('add')
    const rt = selectedClip ? currentTime - selectedClip.start : currentTime
    const nw = createDefaultOverlay(Math.max(0, rt))
    setOverlays(prev => [...prev, nw])
    setSelectedId(nw.id); setSelectedIds(new Set([nw.id]))
  }, [pushUndo, currentTime, selectedClip])

  const deleteSelected = useCallback(() => {
    pushUndo('delete')
    setOverlays(prev => prev.filter(o => !selectedIds.has(o.id)))
    setSelectedIds(new Set()); setSelectedId(null)
  }, [pushUndo, selectedIds])

  const duplicateOverlay = useCallback(() => {
    if (!sel) return; pushUndo('dup')
    const nw = { ...sel, id: crypto.randomUUID() }
    setOverlays(prev => { const n = [...prev]; n.splice(selIdx + 1, 0, nw); return n })
    setSelectedId(nw.id); setSelectedIds(new Set([nw.id]))
  }, [sel, selIdx, pushUndo])

  const moveLines = useCallback((dir: 'up' | 'down') => {
    pushUndo('move')
    setOverlays(prev => {
      const s = [...prev]
      const idxs = s.map((o, i) => selectedIds.has(o.id) ? i : -1).filter(i => i >= 0).sort((a, b) => a - b)
      if (dir === 'up' && idxs[0] > 0)
        for (const i of idxs) [s[i - 1], s[i]] = [s[i], s[i - 1]]
      if (dir === 'down' && idxs[idxs.length - 1] < s.length - 1)
        for (const i of [...idxs].reverse()) [s[i + 1], s[i]] = [s[i], s[i + 1]]
      return s
    })
  }, [selectedIds, pushUndo])

  const relTime = selectedClip ? Math.max(0, currentTime - selectedClip.start) : currentTime
  const clipDuration = selectedClip ? selectedClip.end - selectedClip.start : videoDuration

  const setStartToCurrent = useCallback(() => {
    if (!sel) return; pushUndo('set start'); updateOverlay(sel.id, { startTime: relTime })
  }, [sel, relTime, pushUndo, updateOverlay])
  const setEndToCurrent = useCallback(() => {
    if (!sel) return; pushUndo('set end'); updateOverlay(sel.id, { endTime: relTime })
  }, [sel, relTime, pushUndo, updateOverlay])

  const playRange = useCallback((s: number, e: number) => {
    if (!videoRef.current || !selectedClip) return
    videoRef.current.currentTime = selectedClip.start + s
    videoRef.current.play()
    const chk = () => {
      if (videoRef.current && videoRef.current.currentTime >= selectedClip.start + e) videoRef.current.pause()
      else requestAnimationFrame(chk)
    }
    requestAnimationFrame(chk)
  }, [selectedClip])

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return
    videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause()
  }, [])

  useEffect(() => {
    const v = videoRef.current; if (!v) return
    const onTU = () => { setCurrentTime(v.currentTime); if (selectedClip && v.currentTime > selectedClip.end) { v.pause(); v.currentTime = selectedClip.start } }
    const onDur = () => setVideoDuration(v.duration)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    v.addEventListener('timeupdate', onTU); v.addEventListener('durationchange', onDur)
    v.addEventListener('play', onPlay); v.addEventListener('pause', onPause)
    return () => { v.removeEventListener('timeupdate', onTU); v.removeEventListener('durationchange', onDur); v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause) }
  }, [selectedClip])

  useEffect(() => {
    if (videoRef.current && selectedClip && videoSrc) {
      const v = videoRef.current
      if (v.readyState >= 2) { v.currentTime = selectedClip.start; setIsPlaying(false) }
      else { const h = () => { v.currentTime = selectedClip.start; setIsPlaying(false); v.removeEventListener('canplay', h) }; v.addEventListener('canplay', h); v.load() }
    }
  }, [selectedClip?.id, videoSrc])


  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inp = (e.target as HTMLElement).tagName
      const isInput = inp === 'INPUT' || inp === 'TEXTAREA' || inp === 'SELECT'
      if (e.ctrlKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'z': e.preventDefault(); undo(); return
          case 'y': e.preventDefault(); redo(); return
          case 's': e.preventDefault(); commitStay(); return
          case 'p': e.preventDefault(); togglePlay(); return
          case '3': e.preventDefault(); setStartToCurrent(); return
          case '4': e.preventDefault(); setEndToCurrent(); return
          case '1': e.preventDefault(); if (sel && videoRef.current && selectedClip) videoRef.current.currentTime = selectedClip.start + sel.startTime; return
          case '2': e.preventDefault(); if (sel && videoRef.current && selectedClip) videoRef.current.currentTime = selectedClip.start + sel.endTime; return
          case 'delete': e.preventDefault(); deleteSelected(); return
        }
      }
      if (!isInput) {
        switch (e.key.toLowerCase()) {
          case 'g': e.preventDefault(); commitNext(); return
          case 'enter': e.preventDefault(); commitNext(); return
          case 's': case ' ': e.preventDefault(); if (sel) playRange(sel.startTime, sel.endTime); return
          case 'r': e.preventDefault(); if (sel) playRange(sel.startTime, sel.endTime); return
          case 'q': e.preventDefault(); if (sel) playRange(sel.startTime - 0.5, sel.startTime); return
          case 'w': e.preventDefault(); if (sel) playRange(sel.endTime, sel.endTime + 0.5); return
          case 'e': e.preventDefault(); if (sel) playRange(sel.startTime, sel.startTime + 0.5); return
          case 'd': e.preventDefault(); if (sel) playRange(sel.endTime - 0.5, sel.endTime); return
          case 'x': e.preventDefault(); goNext(); return
          case 'z': if (!e.ctrlKey) { e.preventDefault(); goPrev(); return }; break
          case 'b': e.preventDefault(); togglePlay(); return
          case 'n': e.preventDefault(); addOverlay(); return
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, commitNext, commitStay, togglePlay, setStartToCurrent, setEndToCurrent, deleteSelected, sel, playRange, goNext, goPrev, addOverlay, selectedClip])

  const handleResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); const startY = e.clientY; const startH = topH
    const onM = (ev: MouseEvent) => setTopH(Math.max(200, Math.min(600, startH + ev.clientY - startY)))
    const onU = () => { window.removeEventListener('mousemove', onM); window.removeEventListener('mouseup', onU) }
    window.addEventListener('mousemove', onM); window.addEventListener('mouseup', onU)
  }, [topH])

  const [locText, setLocText] = useState('')
  const [locStart, setLocStart] = useState('')
  const [locEnd, setLocEnd] = useState('')
  const [locDur, setLocDur] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (sel) {
      setLocText(sel.text); setLocStart(fmtTime(sel.startTime)); setLocEnd(fmtTime(sel.endTime))
      setLocDur(fmtTime(sel.endTime - sel.startTime))
    }
  }, [sel?.id, sel?.startTime, sel?.endTime, sel?.text])

  const commitTimes = () => {
    if (!sel) return
    const s = parseTime(locStart), e = parseTime(locEnd)
    if (s !== sel.startTime || e !== sel.endTime) updateOverlay(sel.id, { startTime: s, endTime: e })
  }

  const editBoxKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); if (!sel) return
      updateOverlay(sel.id, { text: locText }); commitTimes()
      e.ctrlKey ? commitStay() : commitNext()
    }
  }

  const insertTag = (tag: string) => {
    if (!textareaRef.current || !sel) return
    const ta = textareaRef.current, st = ta.selectionStart, en = ta.selectionEnd
    const nw = locText.slice(0, st) + `{\\${tag}}` + locText.slice(en)
    setLocText(nw); updateOverlay(sel.id, { text: nw })
  }

  const audioCanvasRef = useRef<HTMLCanvasElement>(null)
  const audioContainerRef = useRef<HTMLDivElement>(null)
  const [audioMode, setAudioMode] = useState<'waveform' | 'spectrum'>('waveform')

  const [scrollX, setScrollX] = useState(0)

  useEffect(() => {
    const container = audioContainerRef.current; if (!container) return
    const handleScroll = () => setScrollX(container.scrollLeft)
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (audioContainerRef.current && isPlaying) {
      const container = audioContainerRef.current
      const playheadX = relTime * hZoom
      const viewportW = container.clientWidth
      if (playheadX < container.scrollLeft + viewportW * 0.2 || playheadX > container.scrollLeft + viewportW * 0.8) {
        container.scrollLeft = playheadX - viewportW / 2
      }
    }
  }, [relTime, hZoom, isPlaying])



  useEffect(() => {
    const canvas = audioCanvasRef.current, cont = audioContainerRef.current
    if (!canvas || !cont || !audioBuffer) return

    const ctx = canvas.getContext('2d'); if (!ctx) return
    const viewportW = cont.clientWidth || 800

    const viewportH = cont.clientHeight || 150

    canvas.width = viewportW; canvas.height = viewportH
    const startT = scrollX / hZoom
    const endT = (scrollX + viewportW) / hZoom

    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, viewportW, viewportH)

    ctx.strokeStyle = '#2a2a4a'; ctx.lineWidth = 1
    for (let s = Math.floor(startT); s <= Math.ceil(endT); s++) {
      const x = s * hZoom - scrollX
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, viewportH); ctx.stroke()
      if (s % 5 === 0) {
        ctx.fillStyle = '#aaa'; ctx.font = '10px monospace'
        ctx.fillText(fmtTime(s), x + 2, 12)
      }
    }

    const data = audioBuffer.getChannelData(0)
    const samplesPerPixel = Math.max(1, Math.floor(audioBuffer.sampleRate / hZoom))
    const amp = viewportH / 2

    if (audioMode === 'waveform') {
      ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1; ctx.beginPath()
      for (let x = 0; x < viewportW; x++) {
        const timeAtX = (scrollX + x) / hZoom
        const sampleIdx = Math.floor(timeAtX * audioBuffer.sampleRate)
        if (sampleIdx >= data.length) break

        let min = 1.0, max = -1.0
        for (let i = 0; i < samplesPerPixel; i++) {
          const datum = data[sampleIdx + i]; if (datum < min) min = datum; if (datum > max) max = datum
        }
        ctx.moveTo(x, (1 + min) * amp); ctx.lineTo(x, (1 + max) * amp)
      }
      ctx.stroke()
    } else {
      for (let x = 0; x < viewportW; x++) {
        const timeAtX = (scrollX + x) / hZoom
        const sampleIdx = Math.floor(timeAtX * audioBuffer.sampleRate)
        if (sampleIdx >= data.length) break
        let sum = 0
        for (let i = 0; i < samplesPerPixel; i++) sum += Math.abs(data[sampleIdx + i] || 0)
        const avg = sum / samplesPerPixel
        const intensity = Math.min(1, avg * 8)
        const hue = 210 + intensity * 50
        ctx.fillStyle = `hsla(${hue}, 80%, ${25 + intensity * 50}%, ${0.4 + intensity * 0.6})`
        ctx.fillRect(x, 0, 1, viewportH)
      }
    }

    overlays.forEach(o => {
      const x1 = o.startTime * hZoom - scrollX, x2 = o.endTime * hZoom - scrollX
      if (x2 < 0 || x1 > viewportW) return

      ctx.fillStyle = (sel && o.id === sel.id)
        ? (isModified ? 'rgba(180,60,60,0.3)' : 'rgba(60,80,180,0.3)')
        : 'rgba(100,100,150,0.15)'
      ctx.fillRect(Math.max(0, x1), 0, Math.min(viewportW, x2) - Math.max(0, x1), viewportH)

      if (sel && o.id === sel.id) {
        ctx.strokeStyle = '#ff3333'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, viewportH); ctx.stroke()
        ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, viewportH); ctx.stroke()
      } else {
        ctx.strokeStyle = 'rgba(100,100,150,0.4)'; ctx.lineWidth = 1
        if (x1 >= 0) { ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, viewportH); ctx.stroke() }
        if (x2 <= viewportW) { ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, viewportH); ctx.stroke() }
      }
    })

    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, viewportH / 2); ctx.lineTo(viewportW, viewportH / 2); ctx.stroke()

    const px = relTime * hZoom - scrollX
    if (px >= 0 && px <= viewportW) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, viewportH); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.moveTo(px - 4, 0); ctx.lineTo(px + 4, 0); ctx.lineTo(px, 6); ctx.closePath(); ctx.fill()
    }
  }, [audioBuffer, hZoom, overlays, sel, isModified, relTime, scrollX, audioMode])


  useEffect(() => {
    const canvas = audioCanvasRef.current; if (!canvas || !audioBuffer) return
  }, [relTime])


  const handleAudioClick = (e: React.MouseEvent, btn: number) => {
    if (!audioContainerRef.current || !sel) return
    const r = audioCanvasRef.current!.getBoundingClientRect()
    const time = (e.clientX - r.left) / hZoom
    pushUndo('set time')
    if (btn === 0) updateOverlay(sel.id, { startTime: Math.max(0, time) })
    else if (btn === 2) updateOverlay(sel.id, { endTime: Math.max(0, time) })
  }

  const getRowClass = (o: TextOverlayData) => {
    const c = ['main-grid-row']
    if (o.id === selectedId) c.push('main-grid-row-active')
    else if (selectedIds.has(o.id)) c.push('main-grid-row-selected')
    if (relTime >= o.startTime && relTime <= o.endTime) c.push('main-grid-row-visible')
    return c.join(' ')
  }
  const cpsClass = (v: number) => v > 25 ? 'main-cps-critical' : v > 20 ? 'main-cps-high' : v > 15 ? 'main-cps-warn' : 'main-cps-ok'

  if (clips.length === 0) {
    return (
      <div className="main-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: '#cdd6f4' }}>No Clips Available</h2>
          <p style={{ color: '#6c7086', marginBottom: 16 }}>Please add clips in the Clip Editor first.</p>
          <button onClick={() => navigate('/')} className="main-tbtn main-tbtn-primary" style={{ padding: '8px 20px' }}>Go to Home</button>
        </div>
      </div>
    )
  }

  return (
    <div className="main-container"
      onContextMenu={e => e.preventDefault()}
    >


      <input
        type="file"
        ref={fontInputRef}
        onChange={handleFontImport}
        accept=".ttf,.otf,.woff,.woff2"
        multiple
        style={{ display: 'none' }}
      />

      <div className="main-menubar">
        <span className="main-menu-item" onClick={() => navigate('/')}>File</span>
        <span className="main-menu-item" onClick={undo}>Edit</span>
        <span className="main-menu-item">Subtitle</span>
        <span className="main-menu-item">Timing</span>
        <span className="main-menu-item">Video</span>
        <span className="main-menu-item">Audio</span>
        <span className="main-menu-item" onClick={() => setShowOCR(!showOCR)}>OCR</span>
        <span className="main-menu-item" onClick={() => setShowTranslate(!showTranslate)}>Translate</span>
        <span className="main-menu-item">Help</span>
      </div>

      <div className="main-main-toolbar">
        <button className="main-tbtn" title="New overlay (N)" onClick={addOverlay}><Plus size={12} /> Line</button>
        <button className="main-tbtn" title="Duplicate" onClick={duplicateOverlay}>Dup</button>
        <button className="main-tbtn main-tbtn-danger" title="Delete (Ctrl+Del)" onClick={deleteSelected}>Del</button>
        <div className="main-editbox-separator" />
        <button className="main-tbtn" title="Undo (Ctrl+Z)" onClick={undo}>↩</button>
        <button className="main-tbtn" title="Redo (Ctrl+Y)" onClick={redo}>↪</button>
        <div className="main-editbox-separator" />
        <button className="main-tbtn" title="Set start to video (Ctrl+3)" onClick={setStartToCurrent}>Start→</button>
        <button className="main-tbtn" title="Set end to video (Ctrl+4)" onClick={setEndToCurrent}>←End</button>
        <div className="main-editbox-separator" />
        <button className={`main-tbtn ${isPlaying ? 'main-tbtn-active' : ''}`} title="Play/Pause (Ctrl+P)" onClick={togglePlay}>
          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button className="main-tbtn" title="Prev frame" onClick={() => { if (videoRef.current) videoRef.current.currentTime -= 1 / 30 }}><SkipBack size={12} /></button>
        <button className="main-tbtn" title="Next frame" onClick={() => { if (videoRef.current) videoRef.current.currentTime += 1 / 30 }}><SkipForward size={12} /></button>
        <div className="main-editbox-separator" />
        <button className={`main-tbtn ${showOCR ? 'main-tbtn-active' : ''}`} title="OCR Panel" onClick={() => setShowOCR(!showOCR)}><Scan size={12} /></button>
        <button className={`main-tbtn ${showTranslate ? 'main-tbtn-active' : ''}`} title="Translate" onClick={() => setShowTranslate(!showTranslate)}><Languages size={12} /></button>
        <div style={{ flex: 1 }} />
        <button className="main-tbtn main-tbtn-primary" title="Export" onClick={() => navigate('/decision')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Download size={12} /> Export
        </button>
      </div>

      <div className="main-top-panel" style={{ height: topH }}>
        <div className="main-video-panel">
          <div className="main-video-container">
            {videoSrc ? (
              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <video ref={videoRef} src={videoSrc} crossOrigin="anonymous" preload="auto"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onLoadedMetadata={() => { if (videoRef.current && selectedClip) videoRef.current.currentTime = selectedClip.start }}
                />
                {overlays.filter(o => relTime >= o.startTime && relTime <= o.endTime).map(o => (
                  <TextOverlay key={o.id} overlay={o} currentTime={relTime}
                    isSelected={o.id === selectedId}
                    onSelect={() => selectOverlay(o.id)}
                    onUpdate={(u) => updateOverlay(o.id, u)}
                    onDelete={() => { pushUndo('del'); setOverlays(prev => prev.filter(p => p.id !== o.id)); if (selectedId === o.id) setSelectedId(null) }}
                  />
                ))}
              </div>
            ) : (
              <div style={{ color: '#585b70', fontSize: 13 }}>No video loaded</div>
            )}
          </div>
          <div className="main-video-controls">
            <button className="main-tbtn" onClick={() => { if (videoRef.current) videoRef.current.currentTime += 1 / 30 }}>⏩</button>
            <select
              value={selectedClipId || ''}
              onChange={(e) => setSelectedClipId(e.target.value)}
              className="main-select"
              style={{ maxWidth: 120 }}
            >
              {clips.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <span className="main-video-time">{fmtTime(relTime)}</span>
            <span style={{ color: '#45475a' }}>/</span>
            <span className="main-video-time">{fmtTime(clipDuration)}</span>
          </div>
        </div>

        <div className="main-audio-panel">
          <div className="main-audio-toolbar">
            <button className={`main-tbtn ${audioMode === 'waveform' ? 'main-tbtn-active' : ''}`} onClick={() => setAudioMode('waveform')}>Wave</button>
            <button className={`main-tbtn ${audioMode === 'spectrum' ? 'main-tbtn-active' : ''}`} onClick={() => setAudioMode('spectrum')}>Spec</button>
            <div className="main-editbox-separator" />
            <span className="main-label" style={{ fontSize: 10 }}>Zoom</span>
            <button className="main-tbtn" onClick={() => setHZoom(z => Math.max(10, z - 10))}><ZoomOut size={11} /></button>
            <button className="main-tbtn" onClick={() => setHZoom(z => Math.min(500, z + 10))}><ZoomIn size={11} /></button>
          </div>
          <div ref={audioContainerRef} className="main-audio-canvas-container"
            style={{ overflow: 'auto', position: 'relative' }}
          >
            {isLoadingAudio && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', zIndex: 10 }}>
                <span style={{ fontSize: 11, color: '#f9e2af' }}>Decoding Audio...</span>
              </div>
            )}
            <canvas ref={audioCanvasRef} className="main-audio-canvas"
              onClick={(e) => handleAudioClick(e, 0)}
              onContextMenu={(e) => { e.preventDefault(); handleAudioClick(e, 2) }}
              style={{ position: 'sticky', left: 0, top: 0, pointerEvents: 'auto', display: 'block' }}
            />
            {audioBuffer && (
              <div style={{ width: audioBuffer.duration * hZoom, height: 1, pointerEvents: 'none' }} />
            )}
            {audioBuffer && (
              <div
                style={{
                  position: 'absolute', top: 20, bottom: 0,
                  left: relTime * hZoom, width: 2,
                  background: '#ffffff', pointerEvents: 'none',
                  zIndex: 15, boxShadow: '0 0 5px rgba(0,0,0,0.5)'
                }}
              />
            )}

          </div>
          <div className="main-audio-controls">
            <button className="main-tbtn" title="Play selection (S)" onClick={() => { if (sel) playRange(sel.startTime, sel.endTime) }}>▶ Sel</button>
            <button className="main-tbtn" title="Play 500ms before (Q)" onClick={() => { if (sel) playRange(sel.startTime - 0.5, sel.startTime) }}>◀500</button>
            <button className="main-tbtn" title="Play 500ms after (W)" onClick={() => { if (sel) playRange(sel.endTime, sel.endTime + 0.5) }}>500▶</button>
            <button className="main-tbtn" title="Play first 500ms (E)" onClick={() => { if (sel) playRange(sel.startTime, sel.startTime + 0.5) }}>▶|500</button>
            <button className="main-tbtn" title="Play last 500ms (D)" onClick={() => { if (sel) playRange(sel.endTime - 0.5, sel.endTime) }}>500|◀</button>
          </div>
        </div>
      </div>

      <div className="main-resize-handle" onMouseDown={handleResize} />

      <div className="main-editbox" onKeyDown={editBoxKeyDown}>
        {sel ? (<>
          <div className="main-editbox-row">
            <label className="main-editbox-control">
              <span className="main-label">Font:</span>
              <select value={sel.fontFamily} onChange={e => updateOverlay(sel.id, { fontFamily: e.target.value })} className="main-select">
                {allFonts.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <button className="main-tbtn" onClick={() => fontInputRef.current?.click()} title="Import Font"><Upload size={11} /></button>
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Size:</span>
              <input type="number" value={sel.fontSize} onChange={e => updateOverlay(sel.id, { fontSize: parseInt(e.target.value) || 24 })} className="main-input main-input-xs" min={8} max={200} />
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Opacity:</span>
              <input type="range" min="0" max="1" step="0.05" value={sel.opacity} onChange={e => updateOverlay(sel.id, { opacity: parseFloat(e.target.value) })} className="main-slider" />
              <span className="main-label">{Math.round(sel.opacity * 100)}%</span>
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Anim:</span>
              <select value={sel.animation} onChange={e => updateOverlay(sel.id, { animation: e.target.value as AnimationType })} className="main-select">
                {ANIMATION_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Dur:</span>
              <input type="number" step="0.1" value={sel.animationDuration} onChange={e => updateOverlay(sel.id, { animationDuration: parseFloat(e.target.value) || 0.5 })} className="main-input main-input-xs" style={{ width: 40 }} />
            </label>
          </div>
          <div className="main-editbox-row">
            <label className="main-editbox-control">
              <span className="main-label">Intensity:</span>
              <input type="range" min="0" max="1" step="0.1" value={sel.animationConfig?.intensity ?? 0.5} onChange={e => updateOverlay(sel.id, { animationConfig: { ...sel.animationConfig, intensity: parseFloat(e.target.value) } })} className="main-slider" />
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Ease:</span>
              <select value={sel.animationConfig?.easing ?? 'easeOut'} onChange={e => updateOverlay(sel.id, { animationConfig: { ...sel.animationConfig, easing: e.target.value as AnimationConfig['easing'] } })} className="main-select">
                <option value="linear">Linear</option>
                <option value="easeIn">Ease In</option>
                <option value="easeOut">Ease Out</option>
                <option value="easeInOut">Ease In Out</option>
                <option value="spring">Spring</option>
              </select>
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Delay:</span>
              <input type="number" step="0.1" value={sel.animationConfig?.delay ?? 0} onChange={e => updateOverlay(sel.id, { animationConfig: { ...sel.animationConfig, delay: parseFloat(e.target.value) || 0 } })} className="main-input main-input-xs" />
            </label>
            <label className="main-editbox-control">
              <input type="checkbox" checked={sel.animationConfig?.loop ?? false} onChange={e => updateOverlay(sel.id, { animationConfig: { ...sel.animationConfig, loop: e.target.checked } })} className="main-checkbox" />
              <span className="main-label">Loop</span>
            </label>
          </div>
          <div className="main-editbox-row">
            <label className="main-editbox-control">
              <span className="main-label">Start:</span>
              <input type="text" value={locStart} onChange={e => setLocStart(e.target.value)} onBlur={commitTimes} className="main-input main-input-time" />
            </label>
            <label className="main-editbox-control">
              <span className="main-label">End:</span>
              <input type="text" value={locEnd} onChange={e => setLocEnd(e.target.value)} onBlur={commitTimes} className="main-input main-input-time" />
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Dur:</span>
              <input type="text" value={locDur} onChange={e => { setLocDur(e.target.value); if (sel) { const d = parseTime(e.target.value); if (d > 0) { setLocEnd(fmtTime(sel.startTime + d)); updateOverlay(sel.id, { endTime: sel.startTime + d }) } } }} className="main-input main-input-time" />
            </label>
            <div className="main-editbox-separator" />
            <label className="main-editbox-control">
              <span className="main-label">X:</span>
              <input type="number" value={Math.round(sel.x)} onChange={e => updateOverlay(sel.id, { x: parseInt(e.target.value) || 0 })} className="main-input main-input-xs" />
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Y:</span>
              <input type="number" value={Math.round(sel.y)} onChange={e => updateOverlay(sel.id, { y: parseInt(e.target.value) || 0 })} className="main-input main-input-xs" />
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Color:</span>
              <input type="color" value={sel.color} onChange={e => updateOverlay(sel.id, { color: e.target.value })} style={{ width: 22, height: 22, border: '1px solid #45475a', borderRadius: 2, cursor: 'pointer', padding: 0 }} />
            </label>
            <label className="main-editbox-control">
              <span className="main-label">BG:</span>
              <input type="color" value={sel.backgroundColor || '#000000'} onChange={e => updateOverlay(sel.id, { backgroundColor: e.target.value })} style={{ width: 22, height: 22, border: '1px solid #45475a', borderRadius: 2, cursor: 'pointer', padding: 0 }} />
            </label>
          </div>
          <div className="main-editbox-row">
            <label className="main-editbox-control">
              <span className="main-label">Spacing:</span>
              <input type="number" step="0.5" value={sel.letterSpacing ?? 0} onChange={e => updateOverlay(sel.id, { letterSpacing: parseFloat(e.target.value) || 0 })} className="main-input main-input-xs" />
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Weight:</span>
              <select value={sel.fontWeight ?? 400} onChange={e => updateOverlay(sel.id, { fontWeight: parseInt(e.target.value) })} className="main-select">
                {[100, 200, 300, 400, 500, 600, 700, 800, 900].map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Padding:</span>
              <input type="number" value={sel.padding ?? 8} onChange={e => updateOverlay(sel.id, { padding: parseInt(e.target.value) || 0 })} className="main-input main-input-xs" />
            </label>
            <label className="main-editbox-control">
              <span className="main-label">Radius:</span>
              <input type="number" value={sel.borderRadius ?? 4} onChange={e => updateOverlay(sel.id, { borderRadius: parseInt(e.target.value) || 0 })} className="main-input main-input-xs" />
            </label>
            <label className="main-editbox-control" title="Example: 2px 2px 4px rgba(0,0,0,0.8)">
              <span className="main-label">Shadow:</span>
              <input type="text" value={sel.textShadowCustom ?? ''} onChange={e => updateOverlay(sel.id, { textShadowCustom: e.target.value })} className="main-input" style={{ width: 100 }} placeholder="2px 2px 4px..." />
            </label>
          </div>
          <div className="main-editbox-row main-toolbar-row">
            <button className="main-tbtn" title="Bold" onClick={() => insertTag('b1')}><Bold size={13} /></button>
            <button className="main-tbtn" title="Italic" onClick={() => insertTag('i1')}><Italic size={13} /></button>
            <button className="main-tbtn" title="Underline" onClick={() => insertTag('u1')}><Underline size={13} /></button>
            <button className="main-tbtn" title="Strikeout" onClick={() => insertTag('s1')}><Strikethrough size={13} /></button>
            <button className="main-tbtn" title="Font" onClick={() => insertTag('fnArial')}><Type size={13} /></button>
          </div>
          <textarea ref={textareaRef} value={locText}
            onChange={e => { setLocText(e.target.value); updateOverlay(sel.id, { text: e.target.value }) }}
            className="main-textarea" rows={2} placeholder="Enter subtitle text..." spellCheck={false}
          />
        </>) : (
          <div className="main-editbox-empty">Select a subtitle line to edit</div>
        )}
      </div>

      <div className="main-grid" tabIndex={0} onKeyDown={e => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveLines(e.key === 'ArrowUp' ? 'up' : 'down') }
      }}>
        <table className="main-grid-table">
          <thead>
            <tr className="main-grid-header">
              <th className="main-grid-col-num">#</th>
              <th className="main-grid-col-time">Start</th>
              <th className="main-grid-col-time">End</th>
              <th className="main-grid-col-style">Font</th>
              <th className="main-grid-col-margin">Size</th>
              <th className="main-grid-col-style">Anim</th>
              <th className="main-grid-col-margin">X</th>
              <th className="main-grid-col-margin">Y</th>
              <th className="main-grid-col-text">Text</th>
              <th className="main-grid-col-cps">CPS</th>
            </tr>
          </thead>
          <tbody>
            {overlays.map((o, i) => {
              const c = cps(o)
              return (
                <tr key={o.id} className={getRowClass(o)}
                  onClick={e => selectOverlay(o.id, e.ctrlKey, e.shiftKey)}
                >
                  <td className="main-grid-col-num">{i + 1}</td>
                  <td className="main-grid-col-time">{fmtTime(o.startTime)}</td>
                  <td className="main-grid-col-time">{fmtTime(o.endTime)}</td>
                  <td className="main-grid-col-style">{o.fontFamily}</td>
                  <td className="main-grid-col-margin">{o.fontSize}</td>
                  <td className="main-grid-col-style">{o.animation}</td>
                  <td className="main-grid-col-margin">{Math.round(o.x)}</td>
                  <td className="main-grid-col-margin">{Math.round(o.y)}</td>
                  <td className="main-grid-col-text">{o.text || '(empty)'}</td>
                  <td className={`main-grid-col-cps ${cpsClass(c)}`}>{c}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="main-statusbar">
        <div className="main-statusbar-section">
          <span>Lines: {overlays.length}</span>
          <span>Selected: {selectedIds.size}</span>
          {sel && <span>Line {selIdx + 1}</span>}
        </div>
        <div className="main-statusbar-section">
          {isModified && <span style={{ color: '#f38ba8' }}>● Modified</span>}
          <span>Time: {fmtTime(relTime)}</span>
          <span>
            <span className="main-kbd">G</span> Commit
            <span className="main-kbd">S</span> Play
            <span className="main-kbd">Z/X</span> Nav
          </span>
        </div>
      </div>

      {showOCR && selectedClip && videoSrc && (
        <div style={{ position: 'fixed', right: showTranslate ? 384 : 0, top: 0, bottom: 0, width: 320, background: '#1e1e2e', borderLeft: '1px solid #313244', zIndex: 40, overflowY: 'auto', padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: '#cdd6f4' }}>OCR Text Extraction</span>
            <button className="main-tbtn" onClick={() => setShowOCR(false)}><X size={12} /></button>
          </div>
          <OCRPanel videoSrc={videoSrc} currentTime={selectedClip.start + relTime} onTextExtracted={(t) => { setOcrText(t); setShowTranslate(true) }} />
        </div>
      )}

      {showTranslate && (
        <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 384, borderLeft: '1px solid #313244', background: '#1e1e2e', zIndex: 40 }}>
          <TranslateSidebar isOpen={showTranslate} onClose={() => setShowTranslate(false)}
            sourceText={ocrText} sourceLanguage={srcLang} targetLanguage={tgtLang}
            onSourceLanguageChange={setSrcLang} onTargetLanguageChange={setTgtLang}
          />
        </div>
      )}
    </div>
  )
}
