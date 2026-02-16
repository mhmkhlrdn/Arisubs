package main

import (
	"arisubs/backend/config"
	"arisubs/backend/handlers"
	"arisubs/backend/jobs"
	"arisubs/backend/services"
	"arisubs/backend/storage"
	"log"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

/*
 * [Initialization]
 * - Load configuration
 * - Initialize storage
 * - Initialize services (YtDlp, FFmpeg, Translation)
 * - Initialize job queue
 * - Initialize handlers
 *
 * [Server Setup]
 * - Setup Gin router
 * - Configure CORS middleware
 * - Define API routes
 * - Serve static files (React build) in production
 * - Start server
 */
func main() {
	cfg := config.Load()

	store := storage.NewStore(cfg)
	if err := store.Init(); err != nil {
		log.Fatalf("Failed to initialize storage: %v", err)
	}

	ytdlp := services.NewYtDlpService()
	ffmpeg := services.NewFFmpegService()
	translationService := services.NewTranslationService(cfg.LibreTranslateURL, cfg.LibreTranslateAPIKey)

	queue := jobs.NewJobQueue()

	videoHandler := handlers.NewVideoHandler(queue, store, ytdlp, ffmpeg)
	clipHandler := handlers.NewClipHandler(queue, store, ffmpeg)
	exportHandler := handlers.NewExportHandler(queue, store, ffmpeg)
	translationHandler := handlers.NewTranslationHandler(translationService)
	sseHandler := handlers.NewSSEHandler(queue)

	router := gin.Default()

	corsConfig := cors.DefaultConfig()
	corsConfig.AllowOrigins = cfg.AllowedOrigins
	corsConfig.AllowMethods = []string{"GET", "POST", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Content-Type", "Authorization"}
	corsConfig.AllowCredentials = true
	router.Use(cors.New(corsConfig))

	api := router.Group("/api")
	{
		api.POST("/video", videoHandler.SubmitVideo)
		api.POST("/video/upload", videoHandler.UploadVideo)
		api.GET("/videos", videoHandler.ListVideos)
		api.GET("/video/:id", videoHandler.GetVideo)
		api.GET("/video/:id/file", videoHandler.ServeVideoFile)
		api.HEAD("/video/:id/file", videoHandler.ServeVideoFile)
		api.GET("/video/qualities", videoHandler.GetAvailableQualities)
		api.POST("/video/:id/open-folder", videoHandler.OpenVideoFolder)

		api.POST("/clip", clipHandler.CreateClip)

		api.POST("/export", exportHandler.ExportClips)
		api.POST("/export/individual", exportHandler.ExportClipsIndividually)
		api.POST("/export/subtitles", exportHandler.ExportWithSubtitles)
		api.GET("/export/:jobId/download", exportHandler.DownloadExport)
		api.GET("/clip/:clipId/download", exportHandler.DownloadClip)

		api.POST("/translate", translationHandler.Translate)

		api.GET("/jobs/:jobId/stream", sseHandler.StreamJob)
		api.GET("/jobs/:jobId", sseHandler.GetJob)
		api.DELETE("/jobs/:jobId", sseHandler.DeleteJob)
	}

	router.Static("/storage", cfg.StoragePath)
	router.StaticFile("/", "./frontend/dist/index.html")
	router.Static("/assets", "./frontend/dist/assets")

	log.Printf("Server starting on port %s", cfg.Port)
	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
