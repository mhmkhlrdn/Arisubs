package services

import (
	"arisubs/backend/models"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
)

type AnalyzeService struct{}

func NewAnalyzeService() *AnalyzeService {
	return &AnalyzeService{}
}

// chatReplayItem matches the yt-dlp live chat JSON structure
type chatReplayItem struct {
	Header struct {
		VideoID string `json:"video_id"`
	} `json:"header,omitempty"`
	ReplayChatItemAction struct {
		Actions []struct {
			AddChatItemAction struct {
				Item struct {
					LiveChatTextMessageRenderer struct {
						TimestampUsec string `json:"timestampUsec"`
						Message       struct {
							Runs []struct {
								Text string `json:"text"`
							} `json:"runs"`
						} `json:"message"`
						Tooltip string `json:"tooltip"` // e.g., "New member"
					} `json:"liveChatTextMessageRenderer"`
					LiveChatMembershipItemRenderer struct {
						TimestampUsec string `json:"timestampUsec"`
					} `json:"liveChatMembershipItemRenderer"`
					LiveChatPaidMessageRenderer struct {
						TimestampUsec string `json:"timestampUsec"`
					} `json:"liveChatPaidMessageRenderer"`
				} `json:"item"`
			} `json:"addChatItemAction"`
		} `json:"actions"`
	} `json:"replayChatItemAction,omitempty"`
}

type chatMessage struct {
	TimestampSec float64
	HasSuperchat bool
	HasMember    bool
}

// AnalyzeStream extracts live chat and finds the best moments
func (s *AnalyzeService) AnalyzeStream(url string, videoDuration float64) ([]models.Moment, error) {
	log.Printf("[DEBUG] AnalyzeStream: starting analysis for %s", url)

	// 1. Set up temp dir for yt-dlp extraction
	tmpDir, err := os.MkdirTemp("", "arisubs-analyze-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	cookieArgs := getCookieArgs()

	outFileBase := filepath.Join(tmpDir, "chat")

	// 2. Download live chat transcript only
	args := []string{
		"--skip-download",
		"--write-subs",
		"--sub-lang", "live_chat",
		"-o", outFileBase,
	}
	args = append(args, cookieArgs...)
	args = append(args, url)

	log.Printf("[DEBUG] AnalyzeStream: running yt-dlp to extract chat...")
	cmd := exec.Command("py", append([]string{"-m", "yt_dlp"}, args...)...)

	// Better error reporting
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("yt-dlp chat extraction failed: %w\nstderr: %s", err, stderr.String())
	}

	// 3. Find the downloaded file
	chatFiles, err := filepath.Glob(outFileBase + "*.json*")
	if err != nil || len(chatFiles) == 0 {
		return nil, fmt.Errorf("no live chat JSON found (this video might not have live chat replay)")
	}
	chatFile := chatFiles[0]
	log.Printf("[DEBUG] AnalyzeStream: found chat file %s", chatFile)

	// 4. Parse the chat JSON
	data, err := os.ReadFile(chatFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read chat file: %w", err)
	}

	return s.detectMomentsFromChat(data, videoDuration)
}

func (s *AnalyzeService) detectMomentsFromChat(data []byte, videoDuration float64) ([]models.Moment, error) {
	log.Printf("[DEBUG] detectMomentsFromChat: parsing %d bytes", len(data))

	// yt-dlp live chat JSON is typically a stream of JSON objects, one per line
	var entries []chatMessage

	lines := bytes.Split(data, []byte("\n"))

	// Determine video start time (time zero) from the first message
	// The timestampUsec is usually relative to Unix Epoch, but sometimes relative to video start.
	// We map taking the smallest timestamp found.
	var minTimestamp int64 = math.MaxInt64

	for _, line := range lines {
		if len(line) == 0 {
			continue
		}

		var item chatReplayItem
		if err := json.Unmarshal(line, &item); err != nil {
			continue // Skip malformed lines
		}

		for _, action := range item.ReplayChatItemAction.Actions {
			actionItem := action.AddChatItemAction.Item

			// Extract timestamp and type
			var tsec string
			isSuper := false
			isMember := false

			if actionItem.LiveChatTextMessageRenderer.TimestampUsec != "" {
				tsec = actionItem.LiveChatTextMessageRenderer.TimestampUsec
			} else if actionItem.LiveChatPaidMessageRenderer.TimestampUsec != "" {
				tsec = actionItem.LiveChatPaidMessageRenderer.TimestampUsec
				isSuper = true
			} else if actionItem.LiveChatMembershipItemRenderer.TimestampUsec != "" {
				tsec = actionItem.LiveChatMembershipItemRenderer.TimestampUsec
				isMember = true
			}

			if tsec != "" {
				tUsec, err := strconv.ParseInt(tsec, 10, 64)
				if err == nil {
					entries = append(entries, chatMessage{
						TimestampSec: float64(tUsec) / 1000000.0,
						HasSuperchat: isSuper,
						HasMember:    isMember,
					})
					if tUsec < minTimestamp {
						minTimestamp = tUsec
					}
				}
			}
		}
	}

	if len(entries) == 0 {
		return nil, fmt.Errorf("parsed no usable chat messages")
	}

	log.Printf("[DEBUG] detectMomentsFromChat: parsed %d messages", len(entries))

	// Normalize timestamps so minTimestamp = 0
	minSec := float64(minTimestamp) / 1000000.0

	var validEntries []chatMessage
	for _, e := range entries {
		e.TimestampSec -= minSec
		if videoDuration > 0 && e.TimestampSec > videoDuration {
			continue // skip messages beyond video duration
		}
		validEntries = append(validEntries, e)
	}
	entries = validEntries

	if len(entries) == 0 {
		return nil, fmt.Errorf("parsed no usable chat messages within video duration")
	}

	// 5. Bucket messages into windows (e.g., 15 seconds)
	windowSec := 15.0
	maxTime := entries[len(entries)-1].TimestampSec
	if videoDuration > 0 && maxTime > videoDuration {
		maxTime = videoDuration
	}
	numBuckets := int(math.Ceil(maxTime / windowSec))
	if numBuckets == 0 {
		numBuckets = 1
	}

	buckets := make([]float64, numBuckets)

	for _, e := range entries {
		idx := int(e.TimestampSec / windowSec)
		if idx >= 0 && idx < numBuckets {
			// Weight: standard message = 1, superchat/member = 5
			weight := 1.0
			if e.HasSuperchat || e.HasMember {
				weight = 5.0
			}
			buckets[idx] += weight
		}
	}

	// 6. Find baseline/median to detect spikes
	sortedBuckets := make([]float64, numBuckets)
	copy(sortedBuckets, buckets)
	sort.Float64s(sortedBuckets)

	median := 0.0
	if numBuckets > 0 {
		median = sortedBuckets[numBuckets/2]
	}
	if median < 1 {
		median = 1 // avoid div by zero
	}

	// A spike is X times the median
	threshold := math.Max(median*2.5, sortedBuckets[int(float64(numBuckets)*0.9)]) // Top 10% or 2.5x median

	log.Printf("[DEBUG] detectMomentsFromChat: median=%.1f threshold=%.1f", median, threshold)

	// 7. Extract moments
	var moments []models.Moment
	inMoment := false
	var currentStart float64
	var maxScore float64

	for i, val := range buckets {
		timeSec := float64(i) * windowSec

		if val > threshold {
			if !inMoment {
				inMoment = true
				currentStart = math.Max(0, timeSec-windowSec) // buffer before
				maxScore = val
			} else {
				if val > maxScore {
					maxScore = val
				}
			}
		} else {
			if inMoment {
				inMoment = false

				// End moment
				end := timeSec + windowSec // buffer after

				// Determine intensity
				ratio := maxScore / median
				intensity := "low"
				if ratio > 5.0 {
					intensity = "extreme"
				} else if ratio > 3.5 {
					intensity = "high"
				} else if ratio > 2.5 {
					intensity = "medium"
				}

				moments = append(moments, models.Moment{
					ID:        fmt.Sprintf("moment-%d", len(moments)+1),
					Start:     currentStart,
					End:       end,
					Score:     maxScore,
					Intensity: intensity,
					Label:     fmt.Sprintf("Hype %s", formatMomentTimestamp(currentStart)),
				})
			}
		}
	}

	// Close last moment if open
	if inMoment {
		moments = append(moments, models.Moment{
			ID:        fmt.Sprintf("moment-%d", len(moments)+1),
			Start:     currentStart,
			End:       maxTime,
			Score:     maxScore,
			Intensity: "medium",
			Label:     fmt.Sprintf("Hype %s", formatMomentTimestamp(currentStart)),
		})
	}

	// 8. Merge nearby moments (closer than 30s)
	merged := mergeMoments(moments, 30.0)

	// Sort chronologically for output
	sort.Slice(merged, func(i, j int) bool {
		return merged[i].Start < merged[j].Start
	})

	log.Printf("[DEBUG] detectMomentsFromChat: found %d moments", len(merged))
	return merged, nil
}

func mergeMoments(moments []models.Moment, gapSec float64) []models.Moment {
	if len(moments) == 0 {
		return moments
	}

	// Ensure chronological order
	sort.Slice(moments, func(i, j int) bool {
		return moments[i].Start < moments[j].Start
	})

	var merged []models.Moment
	current := moments[0]

	for i := 1; i < len(moments); i++ {
		next := moments[i]

		if next.Start-current.End <= gapSec {
			// Merge!
			current.End = math.Max(current.End, next.End)
			current.Score = math.Max(current.Score, next.Score)
			// keep the higher intensity
			if next.Intensity == "extreme" || (next.Intensity == "high" && current.Intensity != "extreme") {
				current.Intensity = next.Intensity
			}
		} else {
			merged = append(merged, current)
			current = next
		}
	}
	merged = append(merged, current)
	return merged
}

func formatMomentTimestamp(seconds float64) string {
	mins := int(seconds) / 60
	secs := int(seconds) % 60
	return fmt.Sprintf("%02d:%02d", mins, secs)
}
