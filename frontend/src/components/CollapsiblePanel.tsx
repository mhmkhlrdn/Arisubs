import { useState, ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface CollapsiblePanelProps {
  title: string
  icon?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  className?: string
  onToggle?: (isOpen: boolean) => void
}

export function CollapsiblePanel({ title, icon, defaultOpen = false, children, className = '', onToggle }: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const handleToggle = () => {
    const newState = !isOpen
    setIsOpen(newState)
    onToggle?.(newState)
  }

  return (
    <div className={`bg-gray-800 rounded-lg overflow-hidden flex flex-col ${className}`}>
      <button
        onClick={handleToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700 transition-colors flex-shrink-0"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-semibold text-sm">{title}</span>
        </div>
        {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {isOpen && (
        <div className="px-4 py-3 border-t border-gray-700 flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  )
}
