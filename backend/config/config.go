package config

import (
	"os"
	"path/filepath"
)

type Config struct {
	Port            string
	StoragePath     string
	AllowedOrigins  []string
	LibreTranslateURL string
	LibreTranslateAPIKey string
}

func Load() *Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	storagePath := os.Getenv("STORAGE_PATH")
	if storagePath == "" {
		storagePath = "./storage"
	}

	origins := []string{"http://localhost:5173", "http://localhost:3000"}
	if allowedOrigins := os.Getenv("ALLOWED_ORIGINS"); allowedOrigins != "" {
		origins = []string{allowedOrigins}
	}

	libreTranslateURL := os.Getenv("LIBRETRANSLATE_URL")
	if libreTranslateURL == "" {
		libreTranslateURL = "https://libretranslate.com"
	}

	libreTranslateAPIKey := os.Getenv("LIBRETRANSLATE_API_KEY")

	return &Config{
		Port:              port,
		StoragePath:       storagePath,
		AllowedOrigins:    origins,
		LibreTranslateURL: libreTranslateURL,
		LibreTranslateAPIKey: libreTranslateAPIKey,
	}
}

func (c *Config) VideosDir() string {
	return filepath.Join(c.StoragePath, "videos")
}

func (c *Config) ClipsDir() string {
	return filepath.Join(c.StoragePath, "clips")
}

func (c *Config) ExportsDir() string {
	return filepath.Join(c.StoragePath, "exports")
}

func (c *Config) MetaDir() string {
	return filepath.Join(c.StoragePath, "meta")
}
