package services

import (
	"arisubs/backend/models"
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type YtDlpService struct{}

func NewYtDlpService() *YtDlpService {
	return &YtDlpService{}
}

type ytDlpInfo struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Duration  float64 `json:"duration"`
	Thumbnail string  `json:"thumbnail"`
}

type VideoQuality struct {
	FormatID string `json:"formatId"`
	Quality  string `json:"quality"`
	AudioID  string `json:"audioId"`
}

func isNumericFormatID(format string) bool {
	for _, r := range format {
		if r < '0' || r > '9' {
			return false
		}
	}
	return len(format) > 0
}

/*
 * [DownloadVideo]
 * - Update job status
 * - Build yt-dlp command with options to handle YouTube restrictions
 * - Get explicit format IDs from default client (shows all formats)
 * - Determine if we're using explicit format IDs or format strings
 *   - usage of android client depends on this
 * - Only add android client if not using explicit format IDs
 * - Parse progress from stdout (yt-dlp format...)
 *   - Extract total size, speed, ETA
 *   - Calculate downloaded size from percentage and total
 * - Read stderr for errors and progress (yt-dlp outputs progress to stderr as well)
 * - Read info.json to get metadata
 * - Find the downloaded video file
 * - Check file size
 * - Verify file is accessible
 */
func (s *YtDlpService) DownloadVideo(url string, outDir string, job *models.Job, quality string, startTime float64, endTime float64) (*models.Video, error) {
	job.Status = models.JobProcessing
	job.Updates <- models.JobUpdate{
		Status:   models.JobProcessing,
		Progress: 0,
		Message:  "Starting download...",
	}

	outputTemplate := filepath.Join(outDir, "%(id)s.%(ext)s")

	// For partial downloads, append timestamp suffix to filename
	var partialSuffix string
	if endTime > startTime && startTime >= 0 {
		partialSuffix = fmt.Sprintf("_%s%s", formatTimestamp(startTime), formatTimestamp(endTime))
		outputTemplate = filepath.Join(outDir, "%(id)s"+partialSuffix+".%(ext)s")
	}

	log.Printf("[DEBUG] DownloadVideo: Requested quality: '%s'", quality)
	formatString, err := s.GetFormatIDs(url, quality)
	if err != nil {
		log.Printf("[DEBUG] DownloadVideo: GetFormatIDs failed: %v, using fallback", err)
		formatString = s.getFormatString(quality)
	}
	log.Printf("[DEBUG] DownloadVideo: Using format IDs/string: '%s'", formatString)
	log.Printf("[DEBUG] DownloadVideo: Output template: %s", outputTemplate)

	hasExplicitFormatID := strings.Contains(formatString, "+") || isNumericFormatID(formatString)
	useAndroidClient := !hasExplicitFormatID && formatString != "best" && formatString != "worst"

	cmdArgs := []string{
		"-m", "yt_dlp",
		"-f", formatString,
		"--merge-output-format", "mp4",
		"--write-info-json",
		"--newline",
		"--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"--referer", "https://www.youtube.com/",
		"--retries", "3",
		"--fragment-retries", "3",
		"--file-access-retries", "3",
		"--retry-sleep", "1",
		"-o", outputTemplate,
	}

	// Partial download: only fetch the specified time range
	if endTime > startTime && startTime >= 0 {
		section := fmt.Sprintf("*%.2f-%.2f", startTime, endTime)
		cmdArgs = append(cmdArgs, "--download-sections", section)
		cmdArgs = append(cmdArgs, "--force-keyframes-at-cuts")
		log.Printf("[DEBUG] DownloadVideo: Partial download section: %s", section)
	}

	cmdArgs = append(cmdArgs, url)

	if useAndroidClient {
		cmdArgs = append(cmdArgs, "--extractor-args", "youtube:player_client=android")
		log.Printf("[DEBUG] DownloadVideo: Using android client with format string")
	} else {
		log.Printf("[DEBUG] DownloadVideo: Using default client with explicit format IDs")
	}

	cmd := exec.Command("py", cmdArgs...)

	log.Printf("[DEBUG] DownloadVideo: Starting yt-dlp command with format: %s", formatString)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start yt-dlp: %w", err)
	}

	progressRegex := regexp.MustCompile(`\[download\]\s+(\d+\.?\d*)%\s+of\s+~?([\d.]+)([KMGT]?i?B)\s+(?:at\s+([\d.]+)([KMGT]?i?B/s))?\s*(?:ETA\s+([\d:]+))?`)
	ffmpegProgressRegex := regexp.MustCompile(`(?i)size=\s*(\d+(?:\.\d+)?)\s*([kmgt]?i?B)\s+time=\s*(\d{2}:\d{2}:\d{2}\.\d{2})`)

	segmentDuration := endTime - startTime
	if segmentDuration <= 0 {
		segmentDuration = 0
	}

	scanner := bufio.NewScanner(stdout)
	go func() {
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("[DEBUG] DownloadVideo stdout: %s", line)
			if matches := progressRegex.FindStringSubmatch(line); len(matches) > 1 {
				progress, err := strconv.ParseFloat(matches[1], 64)
				if err == nil {
					totalSize := ""
					if len(matches) > 3 && matches[2] != "" && matches[3] != "" {
						totalSize = matches[2] + matches[3]
					}

					speed := ""
					if len(matches) > 5 && matches[4] != "" && matches[5] != "" {
						speed = matches[4] + matches[5]
					}

					eta := ""
					if len(matches) > 6 && matches[6] != "" {
						eta = matches[6]
					}

					downloaded := ""
					if totalSize != "" {
						totalBytes := parseSize(totalSize)
						if totalBytes > 0 {
							downloadedBytes := int64(float64(totalBytes) * progress / 100.0)
							downloaded = formatSize(downloadedBytes)
							totalSize = formatSize(totalBytes)
						}
					}

					log.Printf("[DEBUG] DownloadVideo: Progress update: %.1f%%, Downloaded: %s, Total: %s, Speed: %s, ETA: %s",
						progress, downloaded, totalSize, speed, eta)

					job.Progress = int(progress)
					job.Message = "Downloading..."
					job.Updates <- models.JobUpdate{
						Status:     models.JobProcessing,
						Progress:   int(progress),
						Message:    "Downloading...",
						Downloaded: downloaded,
						Total:      totalSize,
						Speed:      speed,
						ETA:        eta,
					}
				}
			} else if segmentDuration > 0 {
				if matches := ffmpegProgressRegex.FindStringSubmatch(line); len(matches) > 3 {
					downloadedSize := matches[1] + matches[2]
					timeStr := matches[3]

					// Parse time 00:00:10.24 to seconds
					parts := strings.Split(timeStr, ":")
					if len(parts) == 3 {
						h, _ := strconv.ParseFloat(parts[0], 64)
						m, _ := strconv.ParseFloat(parts[1], 64)
						s, _ := strconv.ParseFloat(parts[2], 64)
						currentSeconds := h*3600 + m*60 + s

						progress := (currentSeconds / segmentDuration) * 100
						if progress > 100 {
							progress = 100
						}

						log.Printf("[DEBUG] DownloadVideo: FFmpeg progress: %.1f%%, Time: %s, Size: %s", progress, timeStr, downloadedSize)

						job.Progress = int(progress)
						job.Message = "Clipping section..."
						job.Updates <- models.JobUpdate{
							Status:     models.JobProcessing,
							Progress:   int(progress),
							Message:    "Clipping section...",
							Downloaded: downloadedSize,
						}
					}
				}
			}
		}
		if err := scanner.Err(); err != nil {
			log.Printf("[DEBUG] DownloadVideo: Scanner error: %v", err)
		}
	}()

	stderrData := strings.Builder{}
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("[DEBUG] DownloadVideo stderr: %s", line)
			stderrData.WriteString(line + "\n")

			if matches := progressRegex.FindStringSubmatch(line); len(matches) > 1 {
				progress, err := strconv.ParseFloat(matches[1], 64)
				if err == nil {
					totalSize := ""
					if len(matches) > 3 && matches[2] != "" && matches[3] != "" {
						totalSize = matches[2] + matches[3]
					}

					speed := ""
					if len(matches) > 5 && matches[4] != "" && matches[5] != "" {
						speed = matches[4] + matches[5]
					}

					eta := ""
					if len(matches) > 6 && matches[6] != "" {
						eta = matches[6]
					}

					downloaded := ""
					if totalSize != "" {
						totalBytes := parseSize(totalSize)
						if totalBytes > 0 {
							downloadedBytes := int64(float64(totalBytes) * progress / 100.0)
							downloaded = formatSize(downloadedBytes)
							totalSize = formatSize(totalBytes)
						}
					}

					log.Printf("[DEBUG] DownloadVideo: Progress update: %.1f%%, Downloaded: %s, Total: %s, Speed: %s, ETA: %s",
						progress, downloaded, totalSize, speed, eta)

					job.Progress = int(progress)
					job.Message = "Downloading..."
					job.Updates <- models.JobUpdate{
						Status:     models.JobProcessing,
						Progress:   int(progress),
						Message:    "Downloading...",
						Downloaded: downloaded,
						Total:      totalSize,
						Speed:      speed,
						ETA:        eta,
					}
				}
			} else if segmentDuration > 0 {
				if matches := ffmpegProgressRegex.FindStringSubmatch(line); len(matches) > 3 {
					downloadedSize := matches[1] + matches[2]
					timeStr := matches[3]

					parts := strings.Split(timeStr, ":")
					if len(parts) == 3 {
						h, _ := strconv.ParseFloat(parts[0], 64)
						m, _ := strconv.ParseFloat(parts[1], 64)
						s, _ := strconv.ParseFloat(parts[2], 64)
						currentSeconds := h*3600 + m*60 + s

						progress := (currentSeconds / segmentDuration) * 100
						if progress > 100 {
							progress = 100
						}

						job.Progress = int(progress)
						job.Message = "Clipping section..."
						job.Updates <- models.JobUpdate{
							Status:     models.JobProcessing,
							Progress:   int(progress),
							Message:    "Clipping section...",
							Downloaded: downloadedSize,
						}
					}
				}
			}
		}
		if err := scanner.Err(); err != nil {
			log.Printf("[DEBUG] DownloadVideo: Stderr scanner error: %v", err)
		}
	}()

	log.Printf("[DEBUG] DownloadVideo: Waiting for command to complete...")
	if err := cmd.Wait(); err != nil {
		stderrStr := stderrData.String()
		log.Printf("[DEBUG] DownloadVideo: Command failed with error: %v", err)
		log.Printf("[DEBUG] DownloadVideo: Full stderr output:\n%s", stderrStr)
		if strings.Contains(stderrStr, "HTTP Error 403") || strings.Contains(stderrStr, "Forbidden") {
			return nil, fmt.Errorf("YouTube blocked the request (403 Forbidden). This may be due to rate limiting or regional restrictions. Try updating yt-dlp with: yt-dlp -U\n\nstderr: %s", stderrStr)
		}
		if strings.Contains(stderrStr, "HTTP Error 400") {
			return nil, fmt.Errorf("YouTube rejected the request (400 Bad Request). This may be due to an outdated yt-dlp version. Try updating with: yt-dlp -U\n\nstderr: %s", stderrStr)
		}
		if strings.Contains(stderrStr, "Requested format is not available") {
			return nil, fmt.Errorf("The requested format is not available. This may happen if the format IDs don't match. Try using 'best' quality instead.\n\nstderr: %s", stderrStr)
		}
		return nil, fmt.Errorf("yt-dlp failed: %w\nstderr: %s", err, stderrStr)
	}

	log.Printf("[DEBUG] DownloadVideo: Command completed successfully")

	log.Printf("[DEBUG] DownloadVideo: Looking for info.json files in: %s", outDir)
	infoFiles, err := filepath.Glob(filepath.Join(outDir, "*.info.json"))
	if err != nil {
		log.Printf("[DEBUG] DownloadVideo: Error globbing info.json: %v", err)
		return nil, fmt.Errorf("failed to find info.json file: %w", err)
	}
	if len(infoFiles) == 0 {
		log.Printf("[DEBUG] DownloadVideo: No info.json files found in: %s", outDir)
		allFiles, _ := os.ReadDir(outDir)
		log.Printf("[DEBUG] DownloadVideo: Files in output directory:")
		for _, file := range allFiles {
			log.Printf("[DEBUG] DownloadVideo:   - %s", file.Name())
		}
		return nil, fmt.Errorf("failed to find info.json file in %s", outDir)
	}
	log.Printf("[DEBUG] DownloadVideo: Found info.json: %s", infoFiles[0])

	infoData, err := os.ReadFile(infoFiles[0])
	if err != nil {
		return nil, fmt.Errorf("failed to read info.json: %w", err)
	}

	var info ytDlpInfo
	if err := json.Unmarshal(infoData, &info); err != nil {
		return nil, fmt.Errorf("failed to parse info.json: %w", err)
	}

	log.Printf("[DEBUG] DownloadVideo: Looking for video file: %s%s.mp4", info.ID, partialSuffix)

	var videoFiles []string
	specificPath := filepath.Join(outDir, info.ID+partialSuffix+".mp4")
	if _, err := os.Stat(specificPath); err == nil {
		videoFiles = []string{specificPath}
	} else {
		// Fallback: Search for the video file - with or without partial suffix
		videoGlob := filepath.Join(outDir, info.ID+"*.mp4")
		matches, err := filepath.Glob(videoGlob)
		if err != nil {
			log.Printf("[DEBUG] DownloadVideo: Error globbing video file: %v", err)
			return nil, fmt.Errorf("failed to find downloaded video file: %w", err)
		}

		// Filter out .part files
		var filteredFiles []string
		for _, f := range matches {
			if !strings.HasSuffix(f, ".part") {
				filteredFiles = append(filteredFiles, f)
			}
		}

		if len(filteredFiles) == 0 {
			log.Printf("[DEBUG] DownloadVideo: Video file not found. Looking for any .mp4 files...")
			allMp4, _ := filepath.Glob(filepath.Join(outDir, "*.mp4"))
			log.Printf("[DEBUG] DownloadVideo: Found %d mp4 files:", len(allMp4))
			for _, f := range allMp4 {
				log.Printf("[DEBUG] DownloadVideo:   - %s", f)
			}
			return nil, fmt.Errorf("failed to find downloaded video file %s.mp4 in %s", info.ID, outDir)
		}

		// If multiple, pick the one that matches our partialSuffix if possible, otherwise first
		foundMatch := false
		for _, f := range filteredFiles {
			if strings.Contains(f, partialSuffix) {
				videoFiles = []string{f}
				foundMatch = true
				break
			}
		}
		if !foundMatch {
			videoFiles = []string{filteredFiles[0]}
		}
	}

	fileInfo, err := os.Stat(videoFiles[0])
	if err != nil {
		log.Printf("[DEBUG] DownloadVideo: Error statting video file: %v", err)
	} else {
		log.Printf("[DEBUG] DownloadVideo: Video file size: %d bytes (%.2f MB)", fileInfo.Size(), float64(fileInfo.Size())/1024/1024)
		log.Printf("[DEBUG] DownloadVideo: Video file path: %s", videoFiles[0])
	}

	videoPath := videoFiles[0]

	if _, err := os.Open(videoPath); err != nil {
		log.Printf("[DEBUG] DownloadVideo: WARNING - File exists but cannot be opened: %v", err)
	} else {
		log.Printf("[DEBUG] DownloadVideo: File verified as accessible")
	}

	job.Updates <- models.JobUpdate{
		Status:   models.JobDone,
		Progress: 100,
		Message:  "Download complete",
		Output:   info.ID,
	}

	return &models.Video{
		ID:        info.ID,
		Title:     info.Title,
		Duration:  info.Duration,
		FilePath:  videoPath,
		Thumbnail: info.Thumbnail,
	}, nil
}

func (s *YtDlpService) GetVideoMetadata(url string) (*models.Video, error) {
	cmd := exec.Command("py", "-m", "yt_dlp",
		"--dump-json",
		"--no-download",
		"--extractor-args", "youtube:player_client=android",
		"--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"--referer", "https://www.youtube.com/",
		url,
	)

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("yt-dlp failed: %s", string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("failed to run yt-dlp: %w", err)
	}

	var info ytDlpInfo
	if err := json.Unmarshal(output, &info); err != nil {
		return nil, fmt.Errorf("failed to parse yt-dlp output: %w", err)
	}

	return &models.Video{
		ID:        info.ID,
		Title:     info.Title,
		Duration:  info.Duration,
		Thumbnail: info.Thumbnail,
	}, nil
}

/*
 * [GetAvailableFormats]
 * - Don't use android client for format listing - it limits available formats
 *   - Use default client to get full format list
 * - Parse the output to extract mp4 formats with quality labels
 * - Scan for quality labels (1080p, 720p, etc) in any mp4 lines
 * - Sort qualities: 1080p, 720p, 480p, 360p, 240p, 144p
 * - Add worst if we have any qualities
 */
func (s *YtDlpService) GetAvailableFormats(url string) ([]models.QualityInfo, error) {
	log.Printf("[DEBUG] GetAvailableFormats: Fetching formats for URL: %s", url)

	cmd := exec.Command("py", "-m", "yt_dlp",
		"-F",
		url,
	)

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			log.Printf("[DEBUG] GetAvailableFormats: yt-dlp error: %s", string(exitErr.Stderr))
			return nil, fmt.Errorf("yt-dlp failed: %s", string(exitErr.Stderr))
		}
		log.Printf("[DEBUG] GetAvailableFormats: Command error: %v", err)
		return nil, fmt.Errorf("failed to run yt-dlp: %w", err)
	}

	outputStr := string(output)
	log.Printf("[DEBUG] GetAvailableFormats: Output length: %d characters", len(outputStr))
	log.Printf("[DEBUG] GetAvailableFormats: Full yt-dlp -F output:\n%s", outputStr)

	lines := strings.Split(outputStr, "\n")
	log.Printf("[DEBUG] GetAvailableFormats: Parsing %d lines", len(lines))

	qualityMap := make(map[string]models.QualityInfo)
	var bestAudioSize int64

	qualityLabels := []string{"1080p60", "1080p", "720p60", "720p", "480p", "360p", "240p", "144p"}
	resolutionMap := map[string]string{
		"1080p": "1920x1080",
		"720p":  "1280x720",
		"480p":  "854x480",
		"360p":  "640x360",
		"240p":  "426x240",
		"144p":  "256x144",
	}

	// First pass: find best audio size
	for _, line := range lines {
		if strings.Contains(line, "audio only") && strings.Contains(line, "m4a") {
			// Support both Unicode box drawing separator and standard pipe
			fmtLine := strings.ReplaceAll(line, "│", "|")
			parts := strings.Split(fmtLine, "|")
			if len(parts) > 1 {
				sizePart := strings.TrimSpace(parts[1])
				sizeParts := strings.Fields(sizePart)
				if len(sizeParts) > 0 {
					size := parseSize(sizeParts[0])
					if size > bestAudioSize {
						bestAudioSize = size
					}
				}
			}
		}
	}

	for i, line := range lines {
		trimmedLine := strings.TrimSpace(line)
		if trimmedLine == "" || strings.Contains(line, "ID  EXT") || strings.Contains(line, "───") {
			continue
		}

		if !strings.Contains(line, "mp4") {
			continue
		}

		formatIDRegex := regexp.MustCompile(`^\s*(\d+)\s+mp4`)
		formatIDMatch := formatIDRegex.FindStringSubmatch(line)
		if len(formatIDMatch) < 2 {
			continue
		}
		formatID := formatIDMatch[1]

		for _, quality := range qualityLabels {
			normalizedQuality := quality
			if strings.HasSuffix(quality, "60") {
				normalizedQuality = strings.TrimSuffix(quality, "60")
			}

			qualityPattern := regexp.MustCompile(`\b` + regexp.QuoteMeta(quality) + `\b`)
			match := qualityPattern.MatchString(line)
			if !match {
				// Try resolution fallback
				if res, ok := resolutionMap[normalizedQuality]; ok {
					if strings.Contains(line, res) {
						match = true
					}
				}
			}

			if match {
				// Extract size - support both separators
				var totalSize int64
				fmtLine := strings.ReplaceAll(line, "│", "|")
				parts := strings.Split(fmtLine, "|")
				if len(parts) > 1 {
					sizePart := strings.TrimSpace(parts[1])
					sizeFields := strings.Fields(sizePart)
					if len(sizeFields) > 0 {
						totalSize = parseSize(sizeFields[0])
						if strings.Contains(line, "video only") {
							totalSize += bestAudioSize
						}
					}
				}

				log.Printf("[DEBUG] GetAvailableFormats: Found format ID %s with quality %s (normalized to %s) (line %d): %s, Size: %d", formatID, quality, normalizedQuality, i, trimmedLine, totalSize)

				if existing, ok := qualityMap[normalizedQuality]; !ok || (totalSize > 0 && existing.SizeInBytes < totalSize) {
					qualityMap[normalizedQuality] = models.QualityInfo{
						Label:       normalizedQuality,
						Size:        formatSize(totalSize),
						SizeInBytes: totalSize,
					}
				}
				break
			}
		}
	}

	log.Printf("[DEBUG] GetAvailableFormats: Found qualities: %v", qualityMap)

	sortedQualities := []models.QualityInfo{{Label: "best", Size: ""}}
	qualityOrder := []string{"1080p", "720p", "480p", "360p", "240p", "144p"}
	for _, q := range qualityOrder {
		if info, ok := qualityMap[q]; ok {
			sortedQualities = append(sortedQualities, info)
		}
	}

	if len(sortedQualities) > 1 {
		sortedQualities = append(sortedQualities, models.QualityInfo{Label: "worst", Size: ""})
	}

	log.Printf("[DEBUG] GetAvailableFormats: Returning sorted qualities: %v", sortedQualities)

	return sortedQualities, nil
}

/*
 * [GetFormatIDs]
 * - Use default client to get all available format IDs (137, 136, 135, etc.)
 * - Find best audio format ID (prefer 140, fallback to any m4a)
 * - Find video format ID for the requested quality
 * - Look for combined format (video+audio) with quality
 * - If no combined format found, look for video-only format
 * - Logic:
 *   - If combined format found, use it directly
 *   - If not, combine video-only format with best audio ID (videoID+audioID)
 */
func (s *YtDlpService) GetFormatIDs(url string, quality string) (string, error) {
	log.Printf("[DEBUG] GetFormatIDs: Getting format IDs for quality '%s' from URL: %s (using default client)", quality, url)

	if quality == "best" {
		log.Printf("[DEBUG] GetFormatIDs: Using 'best' - will let yt-dlp choose")
		return "best", nil
	}
	if quality == "worst" {
		log.Printf("[DEBUG] GetFormatIDs: Using 'worst' - will let yt-dlp choose")
		return "worst", nil
	}

	cmd := exec.Command("py", "-m", "yt_dlp",
		"-F",
		url,
	)

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			log.Printf("[DEBUG] GetFormatIDs: yt-dlp error: %s", string(exitErr.Stderr))
			return "", fmt.Errorf("yt-dlp failed: %s", string(exitErr.Stderr))
		}
		log.Printf("[DEBUG] GetFormatIDs: Command error: %v", err)
		return "", fmt.Errorf("failed to run yt-dlp: %w", err)
	}

	outputStr := string(output)
	log.Printf("[DEBUG] GetFormatIDs: Full yt-dlp -F output:\n%s", outputStr)
	lines := strings.Split(outputStr, "\n")
	log.Printf("[DEBUG] GetFormatIDs: Parsing %d lines for quality '%s'", len(lines), quality)

	bestAudioID := ""
	audioRegex := regexp.MustCompile(`^\s*(\d+)\s+m4a\s+audio only`)
	for _, line := range lines {
		if matches := audioRegex.FindStringSubmatch(line); len(matches) > 1 {
			audioID := matches[1]
			log.Printf("[DEBUG] GetFormatIDs: Found audio format ID: %s (line: %s)", audioID, strings.TrimSpace(line))
			if audioID == "140" {
				bestAudioID = "140"
				break
			} else if bestAudioID == "" {
				bestAudioID = audioID
			}
		}
	}
	if bestAudioID == "" {
		log.Printf("[DEBUG] GetFormatIDs: No audio format found, falling back to format string")
		return s.getFormatString(quality), nil
	}
	log.Printf("[DEBUG] GetFormatIDs: Selected audio format ID: %s", bestAudioID)

	var formatID string
	var isCombined bool

	log.Printf("[DEBUG] GetFormatIDs: Looking for combined format (video+audio) with quality '%s'", quality)
	qualityPattern := regexp.MustCompile(`\b` + regexp.QuoteMeta(quality) + `(?:60)?\b`)
	for i, line := range lines {
		trimmedLine := strings.TrimSpace(line)
		if strings.Contains(line, "mp4") && !strings.Contains(line, "video only") && qualityPattern.MatchString(line) {
			if matches := regexp.MustCompile(`^\s*(\d+)\s+mp4`).FindStringSubmatch(line); len(matches) > 1 {
				formatID = matches[1]
				isCombined = true
				log.Printf("[DEBUG] GetFormatIDs: Found combined format ID %s (line %d): %s", formatID, i, trimmedLine)
				break
			}
		}
	}

	if !isCombined {
		log.Printf("[DEBUG] GetFormatIDs: No combined format found, looking for video-only format with quality '%s'", quality)
		for i, line := range lines {
			trimmedLine := strings.TrimSpace(line)
			if strings.Contains(line, "mp4") && strings.Contains(line, "video only") && qualityPattern.MatchString(line) {
				if matches := regexp.MustCompile(`^\s*(\d+)\s+mp4`).FindStringSubmatch(line); len(matches) > 1 {
					formatID = matches[1]
					log.Printf("[DEBUG] GetFormatIDs: Found video-only format ID %s (line %d): %s", formatID, i, trimmedLine)
					break
				}
			}
		}
	}

	if formatID == "" {
		log.Printf("[DEBUG] GetFormatIDs: No format ID found for quality '%s', falling back to format string", quality)
		fallback := s.getFormatString(quality)
		log.Printf("[DEBUG] GetFormatIDs: Using fallback format string: %s", fallback)
		return fallback, nil
	}

	if isCombined {
		log.Printf("[DEBUG] GetFormatIDs: Using explicit combined format ID: %s", formatID)
		return formatID, nil
	}

	result := fmt.Sprintf("%s+%s", formatID, bestAudioID)
	log.Printf("[DEBUG] GetFormatIDs: Using explicit format IDs: %s (video: %s, audio: %s)", result, formatID, bestAudioID)
	return result, nil
}

func (s *YtDlpService) getFormatString(quality string) string {
	switch quality {
	case "1080p":
		return "bestvideo[height>=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best"
	case "720p":
		return "bestvideo[height>=720][height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best"
	case "480p":
		return "bestvideo[height>=480][height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best"
	case "360p":
		return "bestvideo[height>=360][height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best"
	case "worst":
		return "worst[ext=mp4]/worst"
	default:
		return "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
	}
}

func parseSize(sizeStr string) int64 {
	sizeStr = strings.TrimSpace(strings.ToLower(sizeStr))

	var numStr string
	var unit string
	foundNum := false
	for i, r := range sizeStr {
		if (r >= '0' && r <= '9') || r == '.' {
			numStr += string(r)
			foundNum = true
		} else if !foundNum {
			// Skip leading characters like ~
			continue
		} else {
			unit = sizeStr[i:]
			break
		}
	}

	if numStr == "" {
		return 0
	}

	num, err := strconv.ParseFloat(numStr, 64)
	if err != nil {
		return 0
	}

	unit = strings.TrimSpace(unit)
	var multiplier float64 = 1

	if strings.HasPrefix(unit, "k") {
		multiplier = 1024
	} else if strings.HasPrefix(unit, "m") {
		multiplier = 1024 * 1024
	} else if strings.HasPrefix(unit, "g") {
		multiplier = 1024 * 1024 * 1024
	} else if strings.HasPrefix(unit, "t") {
		multiplier = 1024 * 1024 * 1024 * 1024
	}

	return int64(num * multiplier)
}

func formatSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}

	units := []string{"KB", "MB", "GB", "TB"}
	if exp < len(units) {
		return fmt.Sprintf("%.1f %s", float64(bytes)/float64(div), units[exp])
	}
	return fmt.Sprintf("%.1f PB", float64(bytes)/float64(div))
}

// formatTimestamp converts seconds to HHMMSS format (e.g., 41411 seconds -> "113011")
func formatTimestamp(seconds float64) string {
	totalSecs := int(seconds)
	h := totalSecs / 3600
	m := (totalSecs % 3600) / 60
	s := totalSecs % 60
	return fmt.Sprintf("%02d%02d%02d", h, m, s)
}
