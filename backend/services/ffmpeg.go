package services

import (
	"arisubs/backend/models"
	"bufio"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type FFmpegService struct{}

func NewFFmpegService() *FFmpegService {
	return &FFmpegService{}
}

func (s *FFmpegService) ClipVideo(inputPath string, start float64, end float64, outputPath string) error {
	cmd := exec.Command("ffmpeg",
		"-ss", fmt.Sprintf("%.3f", start),
		"-to", fmt.Sprintf("%.3f", end),
		"-i", inputPath,
		"-c", "copy",
		"-avoid_negative_ts", "make_zero",
		"-y",
		outputPath,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("ffmpeg clip failed: %w\noutput: %s", err, string(output))
	}

	return nil
}

/*
 * [ConcatVideos]
 * - Just copy the single file if only one input
 * - Create concat list file
 * - Run ffmpeg concat
 * - Parse progress from stderr
 */
func (s *FFmpegService) ConcatVideos(inputPaths []string, outputPath string, job *models.Job) error {
	if len(inputPaths) == 0 {
		return fmt.Errorf("no input files provided")
	}

	if len(inputPaths) == 1 {
		cmd := exec.Command("cp", inputPaths[0], outputPath)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("failed to copy single file: %w", err)
		}
		job.Updates <- models.JobUpdate{
			Status:   models.JobDone,
			Progress: 100,
			Message:  "Export complete",
			Output:   outputPath,
		}
		return nil
	}

	listFile := filepath.Join(filepath.Dir(outputPath), "concat_list.txt")
	defer os.Remove(listFile)

	file, err := os.Create(listFile)
	if err != nil {
		return fmt.Errorf("failed to create concat list: %w", err)
	}
	defer file.Close()

	for _, path := range inputPaths {
		absPath, err := filepath.Abs(path)
		if err != nil {
			return fmt.Errorf("failed to get absolute path: %w", err)
		}
		fmt.Fprintf(file, "file '%s'\n", strings.ReplaceAll(absPath, "'", "'\\''"))
	}
	file.Close()

	cmd := exec.Command("ffmpeg",
		"-f", "concat",
		"-safe", "0",
		"-i", listFile,
		"-c", "copy",
		"-y",
		outputPath,
	)

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	timeRegex := regexp.MustCompile(`time=(\d+):(\d+):(\d+\.\d+)`)
	scanner := bufio.NewScanner(stderr)
	go func() {
		for scanner.Scan() {
			line := scanner.Text()
			if matches := timeRegex.FindStringSubmatch(line); len(matches) > 3 {
				hours, _ := strconv.Atoi(matches[1])
				minutes, _ := strconv.Atoi(matches[2])
				seconds, _ := strconv.ParseFloat(matches[3], 64)
				totalSeconds := float64(hours*3600+minutes*60) + seconds
				progress := int((totalSeconds / 100.0) * 100) // rough estimate
				if progress > 100 {
					progress = 100
				}
				job.Updates <- models.JobUpdate{
					Status:   models.JobProcessing,
					Progress: progress,
					Message:  fmt.Sprintf("Merging clips... (%.1fs)", totalSeconds),
				}
			}
		}
	}()

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ffmpeg concat failed: %w", err)
	}

	job.Updates <- models.JobUpdate{
		Status:   models.JobDone,
		Progress: 100,
		Message:  "Export complete",
		Output:   outputPath,
	}

	return nil
}

func (s *FFmpegService) ProbeVideoDuration(filePath string) (float64, error) {
	cmd := exec.Command("ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		filePath,
	)

	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe failed: %w", err)
	}

	duration, err := strconv.ParseFloat(strings.TrimSpace(string(output)), 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse duration: %w", err)
	}

	return duration, nil
}

/*
 * [BurnSubtitles]
 * - Write ASS content to a temp file
 * - Use ffmpeg -vf ass= to hardcode subtitles into the video
 * - If fontsDir is provided, pass it as fontsdir= to the ass filter for custom fonts
 * - Optionally trim the clip if start/end are provided
 * - Track progress via stderr parsing
 * - Clean up temp ASS file on completion
 */
func (s *FFmpegService) BurnSubtitles(videoPath string, assContent string, start float64, end float64, outputPath string, job *models.Job, fontsDir string) error {
	// Ensure absolute paths
	absVideo, _ := filepath.Abs(videoPath)
	absOutput, _ := filepath.Abs(outputPath)

	assFile := filepath.Join(filepath.Dir(absOutput), "temp_subs_"+filepath.Base(absOutput)+".ass")
	if err := os.WriteFile(assFile, []byte(assContent), 0644); err != nil {
		return fmt.Errorf("failed to write ASS file: %w", err)
	}
	defer os.Remove(assFile)

	// Escape the ASS path for FFmpeg filter
	// On Windows, the path in 'ass' filter must have colons escaped and backslashes converted to forward slashes.
	// Filter path: ass='C\:/path/to/sub.ass'
	escapedAss := filepath.ToSlash(assFile)
	escapedAss = strings.ReplaceAll(escapedAss, ":", "\\:")

	// Build the ass filter string, with optional fontsdir for custom fonts
	var vf string
	if fontsDir != "" {
		escapedFonts := filepath.ToSlash(fontsDir)
		escapedFonts = strings.ReplaceAll(escapedFonts, ":", "\\:")
		vf = fmt.Sprintf("ass='%s':fontsdir='%s'", escapedAss, escapedFonts)
	} else {
		vf = fmt.Sprintf("ass='%s'", escapedAss)
	}

	duration := end - start

	args := []string{
		"-ss", fmt.Sprintf("%.3f", start),
		"-to", fmt.Sprintf("%.3f", end),
		"-i", absVideo,
		"-vf", vf,
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-c:a", "aac",
		"-b:a", "128k",
		"-y",
		absOutput,
	}

	log.Printf("[FFmpeg] Running burn: ffmpeg %s", strings.Join(args, " "))
	cmd := exec.Command("ffmpeg", args...)

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start ffmpeg: %w", err)
	}

	var stderrLog strings.Builder
	timeRegex := regexp.MustCompile(`time=(\d+):(\d+):(\d+\.\d+)`)

	// Custom scanner to handle both \n and \r
	scanner := bufio.NewScanner(stderr)
	scanner.Split(func(data []byte, atEOF bool) (advance int, token []byte, err error) {
		if atEOF && len(data) == 0 {
			return 0, nil, nil
		}
		for i := 0; i < len(data); i++ {
			if data[i] == '\r' || data[i] == '\n' {
				return i + 1, data[:i], nil
			}
		}
		if atEOF {
			return len(data), data, nil
		}
		return 0, nil, nil
	})

	go func() {
		for scanner.Scan() {
			line := scanner.Text()
			stderrLog.WriteString(line + "\n")
			if matches := timeRegex.FindStringSubmatch(line); len(matches) > 3 {
				hours, _ := strconv.Atoi(matches[1])
				minutes, _ := strconv.Atoi(matches[2])
				seconds, _ := strconv.ParseFloat(matches[3], 64)
				totalSeconds := float64(hours*3600+minutes*60) + seconds
				progress := int((totalSeconds / duration) * 100)
				if progress > 99 {
					progress = 99
				}
				job.Updates <- models.JobUpdate{
					Status:   models.JobProcessing,
					Progress: progress,
					Message:  fmt.Sprintf("Burning subtitles... %.0f%%", float64(progress)),
				}
			}
		}
	}()

	if err := cmd.Wait(); err != nil {
		log.Printf("[FFmpeg] Burn failed. Stderr:\n%s", stderrLog.String())
		return fmt.Errorf("ffmpeg burn subtitles failed: %w (see log for details)", err)
	}

	job.Updates <- models.JobUpdate{
		Status:   models.JobDone,
		Progress: 100,
		Message:  "Export complete",
		Output:   absOutput,
	}

	return nil
}
