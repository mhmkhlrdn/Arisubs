package jobs

import (
	"sync"
	"aytce/backend/models"
)

// DownloadQueueItem represents a queued video download
type DownloadQueueItem struct {
	Job     *models.Job
	VideoID string
	URL     string
	Quality string
	Task    func() error
}

// DownloadQueue manages video download queue (only one download at a time)
type DownloadQueue struct {
	mu           sync.Mutex
	queue        []DownloadQueueItem
	currentJobID string
}

func NewDownloadQueue() *DownloadQueue {
	return &DownloadQueue{
		queue: make([]DownloadQueueItem, 0),
	}
}

// Enqueue adds a video download to the queue and starts processing if idle
func (dq *DownloadQueue) Enqueue(item DownloadQueueItem) bool {
	dq.mu.Lock()
	defer dq.mu.Unlock()

	// If queue is empty and nothing is processing, start immediately
	if len(dq.queue) == 0 && dq.currentJobID == "" {
		dq.currentJobID = item.Job.ID
		dq.mu.Unlock()
		dq.processItem(item)
		dq.mu.Lock()
		return false // Not queued, processing immediately
	}

	// Add to queue
	dq.queue = append(dq.queue, item)
	
	// Update job status to queued
	item.Job.Status = models.JobPending
	item.Job.Message = "Waiting in queue..."
	select {
	case item.Job.Updates <- models.JobUpdate{
		Status:  models.JobPending,
		Message: "Waiting in queue...",
		Progress: 0,
	}:
	default:
		// Channel full, skip
	}
	
	return true // Was queued
}

// processItem processes a single download item
func (dq *DownloadQueue) processItem(item DownloadQueueItem) {
	// Execute the download task
	go func() {
		err := item.Task()
		
		// When done, clear current job and process next
		dq.mu.Lock()
		dq.currentJobID = ""
		nextItem := DownloadQueueItem{}
		hasNext := false
		if len(dq.queue) > 0 {
			nextItem = dq.queue[0]
			dq.queue = dq.queue[1:]
			dq.currentJobID = nextItem.Job.ID
			hasNext = true
		}
		dq.mu.Unlock()

		// Process next item if available
		if hasNext {
			dq.processItem(nextItem)
		}
		
		// Error handling is done in the task itself
		_ = err
	}()
}

// IsProcessing returns whether a download is currently in progress
func (dq *DownloadQueue) IsProcessing() bool {
	dq.mu.Lock()
	defer dq.mu.Unlock()
	return dq.currentJobID != ""
}

// GetQueueLength returns the number of items waiting in the queue
func (dq *DownloadQueue) GetQueueLength() int {
	dq.mu.Lock()
	defer dq.mu.Unlock()
	return len(dq.queue)
}

// GetQueuePosition returns the position of a video in the queue (0 = currently processing, 1+ = position in queue, -1 = not found)
func (dq *DownloadQueue) GetQueuePosition(videoID string) int {
	dq.mu.Lock()
	defer dq.mu.Unlock()
	
	// Check queue position
	for i, item := range dq.queue {
		if item.VideoID == videoID {
			return i + 1 // +1 because 0 would be currently processing
		}
	}
	
	return -1
}
