package jobs

import (
	"arisubs/backend/models"
	"sync"
)

type DownloadQueueItem struct {
	Job     *models.Job
	VideoID string
	URL     string
	Quality string
	Task    func() error
}

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

/*
 * [Enqueue]
 * - If queue is empty and nothing is processing, start immediately
 *   - Not queued, processing immediately
 * - Add to queue
 * - Update job status to queued
 * - If channel full, skip
 * - Return true if was queued, false if processed immediately
 */
func (dq *DownloadQueue) Enqueue(item DownloadQueueItem) bool {
	dq.mu.Lock()
	defer dq.mu.Unlock()

	if len(dq.queue) == 0 && dq.currentJobID == "" {
		dq.currentJobID = item.Job.ID
		dq.mu.Unlock()
		dq.processItem(item)
		dq.mu.Lock()
		return false
	}

	dq.queue = append(dq.queue, item)

	item.Job.Status = models.JobPending
	item.Job.Message = "Waiting in queue..."
	select {
	case item.Job.Updates <- models.JobUpdate{
		Status:   models.JobPending,
		Message:  "Waiting in queue...",
		Progress: 0,
	}:
	default:
	}

	return true
}

/*
 * [processItem]
 * - Execute the download task
 * - When done, clear current job and process next
 * - Process next item if available
 * - Error handling is done in the task itself
 */
func (dq *DownloadQueue) processItem(item DownloadQueueItem) {
	go func() {
		err := item.Task()

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

		if hasNext {
			dq.processItem(nextItem)
		}

		_ = err
	}()
}

func (dq *DownloadQueue) IsProcessing() bool {
	dq.mu.Lock()
	defer dq.mu.Unlock()
	return dq.currentJobID != ""
}

func (dq *DownloadQueue) GetQueueLength() int {
	dq.mu.Lock()
	defer dq.mu.Unlock()
	return len(dq.queue)
}

func (dq *DownloadQueue) GetQueuePosition(videoID string) int {
	dq.mu.Lock()
	defer dq.mu.Unlock()

	for i, item := range dq.queue {
		if item.VideoID == videoID {
			return i + 1
		}
	}

	return -1
}
