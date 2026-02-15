import { useState, useEffect } from 'react'
import { Languages, X, Copy, Loader2, Type, Scan } from 'lucide-react'
import { translateText } from '../api/client'

interface TranslateSidebarProps {
  isOpen: boolean
  onClose: () => void
  sourceText?: string
  sourceLanguage?: string
  targetLanguage?: string
  onSourceLanguageChange?: (lang: string) => void
  onTargetLanguageChange?: (lang: string) => void
}

type InputMode = 'ocr' | 'manual'

export function TranslateSidebar({ isOpen, onClose, sourceText, sourceLanguage = 'auto', targetLanguage = 'en', onSourceLanguageChange, onTargetLanguageChange }: TranslateSidebarProps) {
  const [translatedText, setTranslatedText] = useState('')
  const [isTranslating, setIsTranslating] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [inputMode, setInputMode] = useState<InputMode>('ocr')
  const [manualText, setManualText] = useState('')

  // Determine which text to use based on input mode
  const activeText = inputMode === 'ocr' ? sourceText : manualText

  // Auto-translate when active text or languages change
  useEffect(() => {
    if (activeText && activeText.trim() && targetLanguage) {
      setIsTranslating(true)
      setTranslationError(null)
      translateText(activeText, sourceLanguage, targetLanguage)
        .then((translated) => {
          setTranslatedText(translated)
          setIsTranslating(false)
        })
        .catch((err) => {
          console.error('Translation failed:', err)
          setTranslationError(err.message || 'Translation failed')
          setIsTranslating(false)
        })
    } else {
      setTranslatedText('')
      setTranslationError(null)
    }
  }, [activeText, sourceLanguage, targetLanguage])

  const handleCopySourceText = () => {
    if (activeText) {
      navigator.clipboard.writeText(activeText)
    }
  }

  const handleCopyTranslatedText = () => {
    if (translatedText) {
      navigator.clipboard.writeText(translatedText)
    }
  }

  // Switch to manual mode if OCR text is not available
  useEffect(() => {
    if (!sourceText && inputMode === 'ocr') {
      setInputMode('manual')
    }
  }, [sourceText, inputMode])

  if (!isOpen) return null

  return (
    <div className="h-full bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-2">
          <Languages size={16} />
          <h2 className="text-sm font-semibold">Translate</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-700 rounded transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Input Mode Tabs */}
      <div className="flex-shrink-0 p-2 border-b border-gray-700 bg-gray-800">
        <div className="flex gap-2">
          <button
            onClick={() => setInputMode('ocr')}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              inputMode === 'ocr'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            disabled={!sourceText}
          >
            <Scan size={14} />
            <span>OCR Text</span>
          </button>
          <button
            onClick={() => setInputMode('manual')}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              inputMode === 'manual'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <Type size={14} />
            <span>Type Text</span>
          </button>
        </div>
      </div>

      {/* Language Selectors */}
      <div className="flex-shrink-0 p-2 border-b border-gray-700 bg-gray-800 space-y-2">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">From</label>
            <select
              value={sourceLanguage}
              onChange={(e) => {
                if (onSourceLanguageChange) {
                  onSourceLanguageChange(e.target.value)
                }
              }}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg text-sm"
            >
              <option value="auto">Auto-detect</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="ru">Russian</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese</option>
              <option value="ar">Arabic</option>
              <option value="hi">Hindi</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">To</label>
            <select
              value={targetLanguage}
              onChange={(e) => {
                if (onTargetLanguageChange) {
                  onTargetLanguageChange(e.target.value)
                }
              }}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg text-sm"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="ru">Russian</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese</option>
              <option value="ar">Arabic</option>
              <option value="hi">Hindi</option>
            </select>
          </div>
        </div>
      </div>

      {/* Translation Interface */}
      <div className="flex-1 flex flex-col min-h-0 p-3 space-y-3 overflow-y-auto">
        {/* Source Text Input */}
        <div className="flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-400">
              {inputMode === 'ocr' ? 'OCR Text' : 'Type Text'}
            </label>
            {activeText && (
              <button
                onClick={handleCopySourceText}
                className="p-1 text-gray-400 hover:text-white transition-colors"
                title="Copy source text"
              >
                <Copy size={14} />
              </button>
            )}
          </div>
          {inputMode === 'ocr' ? (
            <div className="p-3 bg-gray-800 rounded-lg text-sm text-gray-200 min-h-[80px] max-h-32 overflow-y-auto">
              {sourceText ? (
                sourceText
              ) : (
                <div className="text-gray-500 text-xs">No OCR text available. Use OCR panel to extract text from video.</div>
              )}
            </div>
          ) : (
            <textarea
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="Type or paste text to translate..."
              className="w-full p-3 bg-gray-800 rounded-lg text-sm text-gray-200 min-h-[80px] max-h-32 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>

        {/* Translated Text */}
        <div className="flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-400">Translated Text</label>
            {translatedText && (
              <button
                onClick={handleCopyTranslatedText}
                className="p-1 text-gray-400 hover:text-white transition-colors"
                title="Copy translated text"
              >
                <Copy size={14} />
              </button>
            )}
          </div>
          <div className="p-3 bg-gray-800 rounded-lg text-sm text-gray-200 min-h-[80px] max-h-48 overflow-y-auto">
            {isTranslating ? (
              <div className="flex items-center justify-center gap-2 text-gray-400">
                <Loader2 size={16} className="animate-spin" />
                <span>Translating...</span>
              </div>
            ) : translationError ? (
              <div className="text-red-400 text-xs space-y-2">
                <div>{translationError}</div>
                {translationError.includes('API key') && (
                  <div className="text-gray-400 text-xs mt-2 p-2 bg-gray-800 rounded">
                    <p className="font-semibold mb-1">To use translation:</p>
                    <ol className="list-decimal list-inside space-y-1 text-xs">
                      <li>Get a free API key from <a href="https://portal.libretranslate.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">portal.libretranslate.com</a></li>
                      <li>Set the <code className="bg-gray-700 px-1 rounded">LIBRETRANSLATE_API_KEY</code> environment variable</li>
                      <li>Or use a self-hosted LibreTranslate instance</li>
                    </ol>
                  </div>
                )}
              </div>
            ) : translatedText ? (
              translatedText
            ) : (
              <div className="text-gray-500 text-xs">
                {activeText ? 'Translation will appear here' : 'Enter text above to translate'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
