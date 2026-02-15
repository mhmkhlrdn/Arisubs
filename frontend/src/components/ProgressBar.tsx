import { motion } from 'framer-motion'

interface ProgressBarProps {
  progress: number  // 0-100
  className?: string
}

export function ProgressBar({ progress, className = '' }: ProgressBarProps) {
  return (
    <div className={`w-full h-2 bg-gray-700 rounded-full overflow-hidden ${className}`}>
      <motion.div
        className="h-full bg-blue-500"
        initial={{ width: 0 }}
        animate={{ width: `${progress}%` }}
        transition={{ duration: 0.3 }}
      />
    </div>
  )
}
