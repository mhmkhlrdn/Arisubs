import { useLocation, useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { motion } from 'framer-motion'

interface Step {
  id: string
  label: string
  path: string
  description?: string
}

const steps: Step[] = [
  { id: '1', label: 'Input URL', path: '/', description: 'Paste YouTube link' },
  { id: '2', label: 'Create Clips', path: '/editor', description: 'Trim and select segments' },
  { id: '3', label: 'Export Options', path: '/decision', description: 'Choose export method' },
  { id: '4', label: 'Timeline Editor', path: '/timeline', description: 'Arrange clips (optional)' },
]

export function StepIndicator() {
  const location = useLocation()
  const navigate = useNavigate()

  const getCurrentStepIndex = (): number => {
    const path = location.pathname
    if (path === '/') return 0
    if (path.startsWith('/editor')) return 1
    if (path === '/decision') return 2
    if (path === '/timeline') return 3
    if (path.startsWith('/processing')) return 0 // Processing is part of step 1
    return 0
  }

  const currentStepIndex = getCurrentStepIndex()

  const isStepCompleted = (index: number): boolean => {
    return index < currentStepIndex
  }

  const isStepActive = (index: number): boolean => {
    return index === currentStepIndex
  }

  const handleStepClick = (step: Step) => {
    // Only allow navigation to completed steps or current step
    const stepIndex = steps.findIndex(s => s.id === step.id)
    if (stepIndex <= currentStepIndex) {
      navigate(step.path)
    }
  }

  return (
    <div className="w-full bg-gray-800/50 backdrop-blur-sm border-b border-gray-700">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1">
            {steps.map((step, index) => {
              const completed = isStepCompleted(index)
              const active = isStepActive(index)
              const canNavigate = index <= currentStepIndex

              return (
                <div key={step.id} className="flex items-center flex-1">
                  <div className="flex items-center gap-2 flex-1">
                    {/* Step Circle */}
                    <button
                      onClick={() => handleStepClick(step)}
                      disabled={!canNavigate}
                      className={`
                        relative flex items-center justify-center w-10 h-10 rounded-full font-semibold transition-all
                        ${completed
                          ? 'bg-green-600 text-white cursor-pointer hover:bg-green-700'
                          : active
                          ? 'bg-blue-600 text-white ring-4 ring-blue-600/30'
                          : 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        }
                        ${canNavigate && !active ? 'hover:bg-gray-600' : ''}
                      `}
                    >
                      {completed ? (
                        <Check size={20} />
                      ) : (
                        <span>{step.id}</span>
                      )}
                    </button>

                    {/* Step Label */}
                    <div className="flex-1 min-w-0 ml-2">
                      <div
                        className={`
                          text-sm font-medium
                          ${active ? 'text-white' : completed ? 'text-gray-300' : 'text-gray-500'}
                        `}
                      >
                        {step.label}
                      </div>
                      {step.description && (
                        <div
                          className={`
                            text-xs
                            ${active ? 'text-gray-300' : 'text-gray-500'}
                          `}
                        >
                          {step.description}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Connector Line */}
                  {index < steps.length - 1 && (
                    <div
                      className={`
                        flex-1 h-0.5 mx-2 transition-colors
                        ${completed ? 'bg-green-600' : 'bg-gray-700'}
                      `}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
