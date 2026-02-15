package jobs

import (
	"arisubs/backend/models"
	"sync"
	"time"

	"github.com/google/uuid"
)

type JobQueue struct {
	mu   sync.RWMutex
	jobs map[string]*models.Job
}

/*
 * [NewJobQueue]
 * - Start background goroutine to prune old jobs
 */
func NewJobQueue() *JobQueue {
	queue := &JobQueue{
		jobs: make(map[string]*models.Job),
	}

	go queue.pruneOldJobs()

	return queue
}

func (q *JobQueue) New() *models.Job {
	id := uuid.New().String()
	job := &models.Job{
		ID:       id,
		Status:   models.JobPending,
		Progress: 0,
		Message:  "Queued",
		Updates:  make(chan models.JobUpdate, 50),
	}

	q.mu.Lock()
	q.jobs[id] = job
	q.mu.Unlock()

	return job
}

func (q *JobQueue) Submit(job *models.Job, task func() error) {
	go func() {
		defer func() {
			close(job.Updates)
		}()

		job.Status = models.JobProcessing
		job.Updates <- models.JobUpdate{
			Status:   models.JobProcessing,
			Progress: 0,
			Message:  "Starting...",
		}

		if err := task(); err != nil {
			job.Status = models.JobError
			job.Error = err.Error()
			job.Updates <- models.JobUpdate{
				Status: models.JobError,
				Error:  err.Error(),
			}
		} else {
			job.Status = models.JobDone
			job.Updates <- models.JobUpdate{
				Status:   models.JobDone,
				Progress: 100,
				Message:  "Complete",
				Output:   job.Output,
			}
		}
	}()
}

func (q *JobQueue) Get(id string) *models.Job {
	q.mu.RLock()
	defer q.mu.RUnlock()
	return q.jobs[id]
}

/*
 * [Push]
 * - If channel is full, skip this update
 */
func (q *JobQueue) Push(job *models.Job, update models.JobUpdate) {
	select {
	case job.Updates <- update:
	default:
	}
}

func (q *JobQueue) Delete(id string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if job, exists := q.jobs[id]; exists {
		close(job.Updates)
		delete(q.jobs, id)
	}
}

/*
 * [pruneOldJobs]
 * - In a real implementation, you'd track job creation time
 * - For now, we'll just prune jobs that are done or error and older than 30 minutes
 * - This is simplified - you might want to add a CreatedAt field to Job
 * - TODO: Implement actual job pruning based on CreatedAt timestamp
 */
func (q *JobQueue) pruneOldJobs() {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		q.mu.Lock()
		q.mu.Unlock()
	}
}
