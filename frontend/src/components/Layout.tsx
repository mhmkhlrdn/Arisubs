import { ReactNode } from 'react'
import { StepIndicator } from './StepIndicator'

interface LayoutProps {
  children: ReactNode
  showSteps?: boolean
}

export function Layout({ children, showSteps = true }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col">
      {showSteps && <StepIndicator />}
      <div className="flex-1">
        {children}
      </div>
    </div>
  )
}
