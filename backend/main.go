package main

import (
	"log"
	"aytce/backend/config"
	"aytce/backend/handlers"
	"aytce/backend/jobs"
	"aytce/backend/services"
	"aytce/backend/storage"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Initialize storage
	store := storage.NewStore(cfg)
	if err := store.Init(); err != nil {
		log.Fatalf("Failed to initialize storage: %v", err)
	}

	// Initialize services
	ytdlp := services.NewYtDlpService()
	ffmpeg := services.NewFFmpegService()
	translationService := services.NewTranslationService(cfg.LibreTranslateURL, cfg.LibreTranslateAPIKey)

	// Initialize job queue
	queue := jobs.NewJobQueue()

	// Initialize handlers
	videoHandler := handlers.NewVideoHandler(queue, store, ytdlp)
	clipHandler := handlers.NewClipHandler(queue, store, ffmpeg)
	exportHandler := handlers.NewExportHandler(queue, store, ffmpeg)
	translationHandler := handlers.NewTranslationHandler(translationService)
	sseHandler := handlers.NewSSEHandler(queue)

	// Setup Gin router
	router := gin.Default()

	// CORS middleware
	corsConfig := cors.DefaultConfig()
	corsConfig.AllowOrigins = cfg.AllowedOrigins
	corsConfig.AllowMethods = []string{"GET", "POST", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Content-Type", "Authorization"}
	corsConfig.AllowCredentials = true
	router.Use(cors.New(corsConfig))

	// API routes
	api := router.Group("/api")
	{
		// Video routes
		api.POST("/video", videoHandler.SubmitVideo)
		api.GET("/video/:id", videoHandler.GetVideo)
		api.GET("/video/:id/file", videoHandler.ServeVideoFile)
		api.HEAD("/video/:id/file", videoHandler.ServeVideoFile)
		api.GET("/video/qualities", videoHandler.GetAvailableQualities)

		// Clip routes
		api.POST("/clip", clipHandler.CreateClip)

		// Export routes
		api.POST("/export", exportHandler.ExportClips)
		api.POST("/export/individual", exportHandler.ExportClipsIndividually)
		api.GET("/export/:jobId/download", exportHandler.DownloadExport)
		api.GET("/clip/:clipId/download", exportHandler.DownloadClip)

		// Translation routes
		api.POST("/translate", translationHandler.Translate)

		// Job routes
		api.GET("/jobs/:jobId/stream", sseHandler.StreamJob)
		api.GET("/jobs/:jobId", sseHandler.GetJob)
		api.DELETE("/jobs/:jobId", sseHandler.DeleteJob)
	}

	// Serve static files (React build) in production
	router.Static("/storage", cfg.StoragePath)
	router.StaticFile("/", "./frontend/dist/index.html")
	router.Static("/assets", "./frontend/dist/assets")

	// Start server
	log.Printf("Server starting on port %s", cfg.Port)
	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
