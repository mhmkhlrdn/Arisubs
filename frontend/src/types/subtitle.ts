export interface SubtitleLine {
    id: string
    lineNumber: number
    layer: number
    start: number      // seconds
    end: number        // seconds
    style: string
    actor: string
    marginL: number
    marginR: number
    marginV: number
    effect: string
    text: string
    isComment: boolean
}

export interface SubtitleStyle {
    name: string
    fontName: string
    fontSize: number
    primaryColor: string
    secondaryColor: string
    outlineColor: string
    shadowColor: string
    bold: boolean
    italic: boolean
    underline: boolean
    strikeout: boolean
    alignment: number  // numpad style 1-9
    marginL: number
    marginR: number
    marginV: number
    outline: number
    shadow: number
}

export interface UndoState {
    lines: SubtitleLine[]
    description: string
}

export function formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    const cs = Math.floor((seconds % 1) * 100)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function parseTime(timeStr: string): number {
    const parts = timeStr.split(/[:.]/)
    if (parts.length < 4) return 0
    const h = parseInt(parts[0]) || 0
    const m = parseInt(parts[1]) || 0
    const s = parseInt(parts[2]) || 0
    const cs = parseInt(parts[3]) || 0
    return h * 3600 + m * 60 + s + cs / 100
}

export function calcCPS(line: SubtitleLine): number {
    const duration = line.end - line.start
    if (duration <= 0) return 0
    const cleanText = line.text.replace(/\{[^}]*\}/g, '').replace(/\\[nN]/g, '')
    return Math.round(cleanText.length / duration)
}

export function createDefaultLine(lineNumber: number, startTime: number = 0): SubtitleLine {
    return {
        id: crypto.randomUUID(),
        lineNumber,
        layer: 0,
        start: startTime,
        end: startTime + 2,
        style: 'Default',
        actor: '',
        marginL: 0,
        marginR: 0,
        marginV: 0,
        effect: '',
        text: '',
        isComment: false,
    }
}

export const DEFAULT_STYLE: SubtitleStyle = {
    name: 'Default',
    fontName: 'Arial',
    fontSize: 48,
    primaryColor: '#FFFFFF',
    secondaryColor: '#FF0000',
    outlineColor: '#000000',
    shadowColor: '#000000',
    bold: false,
    italic: false,
    underline: false,
    strikeout: false,
    alignment: 2,
    marginL: 10,
    marginR: 10,
    marginV: 10,
    outline: 2,
    shadow: 1,
}
