import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Home } from './pages/Home'
import { Processing } from './pages/Processing'
import { ClipEditor } from './pages/ClipEditor'
import { Decision } from './pages/Decision'
import { TimelineEditor } from './pages/TimelineEditor'
import { TranslationTimelineEditor } from './pages/TranslationTimelineEditor'

function App() {
  return (
    <BrowserRouter>
      <AnimatePresence mode="wait">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/processing/:jobId" element={<Processing />} />
          <Route path="/editor/:videoId" element={<ClipEditor />} />
          <Route path="/editor" element={<ClipEditor />} />
          <Route path="/decision" element={<Decision />} />
          <Route path="/timeline" element={<TimelineEditor />} />
          <Route path="/translate" element={<TranslationTimelineEditor />} />
        </Routes>
      </AnimatePresence>
    </BrowserRouter>
  )
}

export default App
