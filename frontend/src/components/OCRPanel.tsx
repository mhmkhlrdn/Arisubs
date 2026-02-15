import { useState } from 'react'
import { Scan, Loader2 } from 'lucide-react'

interface OCRPanelProps {
  videoSrc: string
  currentTime: number
  onTextExtracted: (text: string) => void
}

export function OCRPanel({ videoSrc, currentTime, onTextExtracted }: OCRPanelProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [extractedText, setExtractedText] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const captureFrame = async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.src = videoSrc
      video.currentTime = currentTime

      video.onloadeddata = () => {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        
        if (!ctx) {
          reject(new Error('Could not get canvas context'))
          return
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => {
          if (blob) {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          } else {
          reject(new Error('Could not create blob'))
          }
        }, 'image/png')
      }

      video.onerror = () => reject(new Error('Failed to load video'))
    })
  }

  const performOCR = async (imageDataUrl: string): Promise<string> => {
    // For now, we'll use Tesseract.js in the browser
    // In production, you might want to use a backend service
    try {
      // Dynamic import to avoid loading Tesseract unless needed
      const Tesseract = await import('tesseract.js')
      
      const { data: { text } } = await Tesseract.recognize(imageDataUrl, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            // Could show progress here
          }
        },
      })

      return text.trim()
    } catch (err) {
      console.error('OCR error:', err)
      throw new Error('Failed to perform OCR. Make sure tesseract.js is available.')
    }
  }

  const handleExtractText = async () => {
    setIsProcessing(true)
    setError(null)
    setExtractedText('')

    try {
      // Capture current frame
      const imageDataUrl = await captureFrame()
      
      // Perform OCR
      const text = await performOCR(imageDataUrl)
      
      setExtractedText(text)
      onTextExtracted(text)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to extract text'
      setError(errorMessage)
      console.error('OCR error:', err)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="space-y-3">

      <div className="space-y-2">
        <p className="text-xs text-gray-400">
          Frame: {currentTime.toFixed(2)}s
        </p>
        <button
          onClick={handleExtractText}
          disabled={isProcessing}
          className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
        >
          {isProcessing ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Scan size={20} />
              Extract Text from Frame
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {extractedText && (
        <div className="space-y-2">
          <label className="block text-xs text-gray-400">Extracted:</label>
          <textarea
            value={extractedText}
            readOnly
            className="w-full px-2 py-1.5 bg-gray-700 text-white rounded text-xs min-h-[60px] resize-none"
            placeholder="Extracted text..."
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(extractedText)
            }}
            className="w-full px-2 py-1.5 bg-gray-700 hover:bg-gray-600 rounded transition-colors text-xs"
          >
            Copy
          </button>
        </div>
      )}
    </div>
  )
}
