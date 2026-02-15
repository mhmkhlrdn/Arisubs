import { useRef, useEffect, useCallback } from 'react'
import type { SubtitleLine } from '../../types/subtitle'
import { formatTime, calcCPS } from '../../types/subtitle'

/**
 * COMMENTS & NOTES:
 *
 * [UX/UI Behavior]
 * - Auto-scroll to selected line
 * - Line is visible on current video frame
 *
 * [Helpers]
 * - Strip override tags for display
 */

interface SubtitleGridProps {
    lines: SubtitleLine[]
    selectedLineId: string | null
    selectedLineIds: Set<string>
    currentVideoTime: number
    onSelect: (lineId: string, multi?: boolean, range?: boolean) => void
    onMoveLines: (direction: 'up' | 'down') => void
}

export function SubtitleGrid({
    lines,
    selectedLineId,
    selectedLineIds,
    currentVideoTime,
    onSelect,
    onMoveLines,
}: SubtitleGridProps) {
    const gridRef = useRef<HTMLDivElement>(null)
    const selectedRowRef = useRef<HTMLTableRowElement>(null)

    useEffect(() => {
        if (selectedRowRef.current) {
            selectedRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
    }, [selectedLineId])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault()
            onMoveLines(e.key === 'ArrowUp' ? 'up' : 'down')
        }
    }, [onMoveLines])

    const getRowClass = (line: SubtitleLine): string => {
        const classes: string[] = ['main-grid-row']

        if (line.id === selectedLineId) {
            classes.push('main-grid-row-active')
        } else if (selectedLineIds.has(line.id)) {
            classes.push('main-grid-row-selected')
        }

        if (line.isComment) {
            classes.push('main-grid-row-comment')
        }

        if (currentVideoTime >= line.start && currentVideoTime <= line.end) {
            classes.push('main-grid-row-visible')
        }

        return classes.join(' ')
    }

    const getCPSClass = (cps: number): string => {
        if (cps > 25) return 'main-cps-critical'
        if (cps > 20) return 'main-cps-high'
        if (cps > 15) return 'main-cps-warn'
        return 'main-cps-ok'
    }

    const displayText = (text: string): string => {
        return text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' ↵ ').replace(/\\n/g, ' ↵ ')
    }

    return (
        <div
            ref={gridRef}
            className="main-grid"
            tabIndex={0}
            onKeyDown={handleKeyDown}
        >
            <table className="main-grid-table">
                <thead>
                    <tr className="main-grid-header">
                        <th className="main-grid-col-num">#</th>
                        <th className="main-grid-col-layer">L</th>
                        <th className="main-grid-col-time">Start</th>
                        <th className="main-grid-col-time">End</th>
                        <th className="main-grid-col-style">Style</th>
                        <th className="main-grid-col-actor">Actor</th>
                        <th className="main-grid-col-effect">Effect</th>
                        <th className="main-grid-col-margin">ML</th>
                        <th className="main-grid-col-margin">MR</th>
                        <th className="main-grid-col-margin">MV</th>
                        <th className="main-grid-col-text">Text</th>
                        <th className="main-grid-col-cps">CPS</th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map((line) => {
                        const cps = calcCPS(line)
                        return (
                            <tr
                                key={line.id}
                                ref={line.id === selectedLineId ? selectedRowRef : undefined}
                                className={getRowClass(line)}
                                onClick={(e) => onSelect(line.id, e.ctrlKey, e.shiftKey)}
                                onDoubleClick={() => onSelect(line.id)}
                            >
                                <td className="main-grid-col-num">{line.lineNumber}</td>
                                <td className="main-grid-col-layer">{line.layer}</td>
                                <td className="main-grid-col-time">{formatTime(line.start)}</td>
                                <td className="main-grid-col-time">{formatTime(line.end)}</td>
                                <td className="main-grid-col-style">{line.style}</td>
                                <td className="main-grid-col-actor">{line.actor}</td>
                                <td className="main-grid-col-effect">{line.effect}</td>
                                <td className="main-grid-col-margin">{line.marginL || ''}</td>
                                <td className="main-grid-col-margin">{line.marginR || ''}</td>
                                <td className="main-grid-col-margin">{line.marginV || ''}</td>
                                <td className="main-grid-col-text">{displayText(line.text)}</td>
                                <td className={`main-grid-col-cps ${getCPSClass(cps)}`}>{cps}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
