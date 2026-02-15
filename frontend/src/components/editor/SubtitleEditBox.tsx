import { useState, useRef, useEffect, useCallback } from 'react'
import { Bold, Italic, Underline, Strikethrough, Type } from 'lucide-react'
import type { SubtitleLine, SubtitleStyle } from '../../types/subtitle'
import { formatTime, parseTime } from '../../types/subtitle'

/**
 * COMMENTS & NOTES:
 *
 * [State Sync]
 * - Sync local state when line changes
 *
 * [UI]
 * - Row 1: Line properties
 * - Row 2: Timing & Margins
 * - Row 3: Formatting Toolbar
 * - Row 4: Text Area
 */

interface SubtitleEditBoxProps {
    line: SubtitleLine | null
    styles: SubtitleStyle[]
    onUpdate: (id: string, changes: Partial<SubtitleLine>) => void
    onCommitAndNext: () => void
    onCommitAndStay: () => void
}

export function SubtitleEditBox({
    line,
    styles,
    onUpdate,
    onCommitAndNext,
    onCommitAndStay,
}: SubtitleEditBoxProps) {
    const textRef = useRef<HTMLTextAreaElement>(null)
    const [localText, setLocalText] = useState('')
    const [localStart, setLocalStart] = useState('')
    const [localEnd, setLocalEnd] = useState('')
    const [localDur, setLocalDur] = useState('')

    useEffect(() => {
        if (line) {
            setLocalText(line.text)
            setLocalStart(formatTime(line.start))
            setLocalEnd(formatTime(line.end))
            setLocalDur(formatTime(line.end - line.start))
        }
    }, [line?.id, line?.start, line?.end, line?.text])

    const commitTimes = useCallback(() => {
        if (!line) return
        const s = parseTime(localStart)
        const e = parseTime(localEnd)
        if (s !== line.start || e !== line.end) {
            onUpdate(line.id, { start: s, end: e })
        }
    }, [line, localStart, localEnd, onUpdate])

    const handleDurationChange = (val: string) => {
        setLocalDur(val)
        if (!line) return
        const dur = parseTime(val)
        if (dur > 0) {
            const newEnd = line.start + dur
            setLocalEnd(formatTime(newEnd))
            onUpdate(line.id, { end: newEnd })
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!line) return
            onUpdate(line.id, { text: localText })
            commitTimes()
            if (e.ctrlKey) {
                onCommitAndStay()
            } else {
                onCommitAndNext()
            }
        }
    }

    const insertTag = (tag: string) => {
        if (!textRef.current || !line) return
        const ta = textRef.current
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const before = localText.slice(0, start)
        const selected = localText.slice(start, end)
        const after = localText.slice(end)
        const newText = `${before}{\\${tag}}${selected}${after}`
        setLocalText(newText)
        onUpdate(line.id, { text: newText })
        setTimeout(() => {
            ta.focus()
            ta.selectionStart = ta.selectionEnd = start + tag.length + 3
        }, 0)
    }

    if (!line) {
        return (
            <div className="main-editbox">
                <div className="main-editbox-empty">No subtitle line selected</div>
            </div>
        )
    }

    return (
        <div className="main-editbox" onKeyDown={handleKeyDown}>
            <div className="main-editbox-row">
                <label className="main-editbox-control">
                    <input
                        type="checkbox"
                        checked={line.isComment}
                        onChange={(e) => onUpdate(line.id, { isComment: e.target.checked })}
                        className="main-checkbox"
                    />
                    <span className="main-label">Comment</span>
                </label>

                <label className="main-editbox-control">
                    <span className="main-label">Style:</span>
                    <select
                        value={line.style}
                        onChange={(e) => onUpdate(line.id, { style: e.target.value })}
                        className="main-select"
                    >
                        {styles.map((s) => (
                            <option key={s.name} value={s.name}>{s.name}</option>
                        ))}
                    </select>
                </label>

                <label className="main-editbox-control">
                    <span className="main-label">Actor:</span>
                    <input
                        type="text"
                        value={line.actor}
                        onChange={(e) => onUpdate(line.id, { actor: e.target.value })}
                        className="main-input main-input-sm"
                        placeholder="Actor"
                    />
                </label>

                <label className="main-editbox-control">
                    <span className="main-label">Effect:</span>
                    <input
                        type="text"
                        value={line.effect}
                        onChange={(e) => onUpdate(line.id, { effect: e.target.value })}
                        className="main-input main-input-sm"
                        placeholder="Effect"
                    />
                </label>

                <label className="main-editbox-control">
                    <span className="main-label">Layer:</span>
                    <input
                        type="number"
                        value={line.layer}
                        onChange={(e) => onUpdate(line.id, { layer: parseInt(e.target.value) || 0 })}
                        className="main-input main-input-xs"
                        min={0}
                    />
                </label>
            </div>

            <div className="main-editbox-row">
                <label className="main-editbox-control">
                    <span className="main-label">Start:</span>
                    <input
                        type="text"
                        value={localStart}
                        onChange={(e) => setLocalStart(e.target.value)}
                        onBlur={commitTimes}
                        className="main-input main-input-time"
                    />
                </label>

                <label className="main-editbox-control">
                    <span className="main-label">End:</span>
                    <input
                        type="text"
                        value={localEnd}
                        onChange={(e) => setLocalEnd(e.target.value)}
                        onBlur={commitTimes}
                        className="main-input main-input-time"
                    />
                </label>

                <label className="main-editbox-control">
                    <span className="main-label">Dur:</span>
                    <input
                        type="text"
                        value={localDur}
                        onChange={(e) => handleDurationChange(e.target.value)}
                        className="main-input main-input-time"
                    />
                </label>

                <div className="main-editbox-separator" />

                <label className="main-editbox-control">
                    <span className="main-label">L:</span>
                    <input
                        type="number"
                        value={line.marginL}
                        onChange={(e) => onUpdate(line.id, { marginL: parseInt(e.target.value) || 0 })}
                        className="main-input main-input-xs"
                        min={0}
                    />
                </label>
                <label className="main-editbox-control">
                    <span className="main-label">R:</span>
                    <input
                        type="number"
                        value={line.marginR}
                        onChange={(e) => onUpdate(line.id, { marginR: parseInt(e.target.value) || 0 })}
                        className="main-input main-input-xs"
                        min={0}
                    />
                </label>
                <label className="main-editbox-control">
                    <span className="main-label">V:</span>
                    <input
                        type="number"
                        value={line.marginV}
                        onChange={(e) => onUpdate(line.id, { marginV: parseInt(e.target.value) || 0 })}
                        className="main-input main-input-xs"
                        min={0}
                    />
                </label>
            </div>

            <div className="main-editbox-row main-toolbar-row">
                <button className="main-tbtn" title="Bold (\\b1)" onClick={() => insertTag('b1')}>
                    <Bold size={14} />
                </button>
                <button className="main-tbtn" title="Italic (\\i1)" onClick={() => insertTag('i1')}>
                    <Italic size={14} />
                </button>
                <button className="main-tbtn" title="Underline (\\u1)" onClick={() => insertTag('u1')}>
                    <Underline size={14} />
                </button>
                <button className="main-tbtn" title="Strikeout (\\s1)" onClick={() => insertTag('s1')}>
                    <Strikethrough size={14} />
                </button>
                <button className="main-tbtn" title="Font (\\fn)" onClick={() => insertTag('fnArial')}>
                    <Type size={14} />
                </button>
                <div className="main-editbox-separator" />
                <button className="main-color-btn" style={{ background: '#FFFFFF' }} title="Primary color (\\c)" onClick={() => insertTag('c&HFFFFFF&')} />
                <button className="main-color-btn" style={{ background: '#FF0000' }} title="Secondary color (\\2c)" onClick={() => insertTag('2c&H0000FF&')} />
                <button className="main-color-btn" style={{ background: '#000000', border: '1px solid #555' }} title="Outline color (\\3c)" onClick={() => insertTag('3c&H000000&')} />
                <button className="main-color-btn" style={{ background: '#000000', border: '1px solid #555' }} title="Shadow color (\\4c)" onClick={() => insertTag('4c&H000000&')} />
            </div>

            <textarea
                ref={textRef}
                value={localText}
                onChange={(e) => {
                    setLocalText(e.target.value)
                    onUpdate(line.id, { text: e.target.value })
                }}
                className="main-textarea"
                rows={3}
                placeholder="Enter subtitle text..."
                spellCheck={false}
            />
        </div>
    )
}
