package storage

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"aytce/backend/config"
	"aytce/backend/models"
)

type Store struct {
	cfg *config.Config
}

func NewStore(cfg *config.Config) *Store {
	return &Store{cfg: cfg}
}

func (s *Store) Init() error {
	dirs := []string{
		s.cfg.VideosDir(),
		s.cfg.ClipsDir(),
		s.cfg.ExportsDir(),
		s.cfg.MetaDir(),
	}

	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}

	return nil
}

func (s *Store) VideoPath(videoID string) string {
	return filepath.Join(s.cfg.VideosDir(), videoID+".mp4")
}

func (s *Store) ClipPath(clipID string) string {
	return filepath.Join(s.cfg.ClipsDir(), clipID+".mp4")
}

func (s *Store) ExportPath(jobID string) string {
	return filepath.Join(s.cfg.ExportsDir(), jobID+".mp4")
}

func (s *Store) MetaPath(videoID string) string {
	return filepath.Join(s.cfg.MetaDir(), videoID+".json")
}

func (s *Store) VideosDir() string {
	return s.cfg.VideosDir()
}

func (s *Store) VideoExists(videoID string) bool {
	path := s.VideoPath(videoID)
	log.Printf("[DEBUG] VideoExists: Checking for video ID: %s", videoID)
	log.Printf("[DEBUG] VideoExists: Checking path: %s", path)
	
	_, err := os.Stat(path)
	if err != nil {
		log.Printf("[DEBUG] VideoExists: File not found at path: %s (error: %v)", path, err)
		// Try to find the file with different path formats
		videosDir := s.VideosDir()
		log.Printf("[DEBUG] VideoExists: Videos directory: %s", videosDir)
		files, readErr := os.ReadDir(videosDir)
		if readErr != nil {
			log.Printf("[DEBUG] VideoExists: Error reading directory: %v", readErr)
		} else {
			log.Printf("[DEBUG] VideoExists: Looking for %s.mp4 in directory: %s", videoID, videosDir)
			log.Printf("[DEBUG] VideoExists: Files in directory (%d total):", len(files))
			for _, file := range files {
				log.Printf("[DEBUG] VideoExists:   - %s (isDir: %v)", file.Name(), file.IsDir())
			}
		}
		return false
	}
	log.Printf("[DEBUG] VideoExists: File found at path: %s", path)
	return true
}

func (s *Store) ClipExists(clipID string) bool {
	_, err := os.Stat(s.ClipPath(clipID))
	return err == nil
}

func (s *Store) SaveVideoMeta(videoID string, video *models.Video) error {
	metaPath := s.MetaPath(videoID)
	data, err := json.Marshal(video)
	if err != nil {
		return err
	}
	return os.WriteFile(metaPath, data, 0644)
}

func (s *Store) LoadVideoMeta(videoID string) (*models.Video, error) {
	metaPath := s.MetaPath(videoID)
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return nil, err
	}
	var video models.Video
	if err := json.Unmarshal(data, &video); err != nil {
		return nil, err
	}
	return &video, nil
}
