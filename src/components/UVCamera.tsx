import { useRef, useState, useCallback, useEffect } from 'react';
import { Square, RotateCcw, Download, X, Loader2, Share2 } from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import productImage from '@/assets/product.webp';

type RecordingState = 'idle' | 'recording' | 'preview' | 'converting';

const UVCamera = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const combinedCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number>(0);
  const productImageRef = useRef<HTMLImageElement | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const mp4BlobRef = useRef<Blob | null>(null);

  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [convertProgress, setConvertProgress] = useState(0);

  // Load FFmpeg
  useEffect(() => {
    const loadFFmpeg = async () => {
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress }) => {
        setConvertProgress(Math.round(progress * 100));
      });
      
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      
      ffmpegRef.current = ffmpeg;
      setFfmpegLoaded(true);
    };
    
    loadFFmpeg();
  }, []);

  // Convert WebM to MP4
  const convertToMp4 = async (webmBlob: Blob): Promise<Blob> => {
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg) throw new Error('FFmpeg not loaded');
    
    const webmData = await fetchFile(webmBlob);
    await ffmpeg.writeFile('input.webm', webmData);
    
    await ffmpeg.exec([
      '-i', 'input.webm',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '26',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-r', '30',
      'output.mp4'
    ]);
    
    const mp4Data = await ffmpeg.readFile('output.mp4');
    const mp4Blob = new Blob([mp4Data], { type: 'video/mp4' });
    
    // Cleanup
    await ffmpeg.deleteFile('input.webm');
    await ffmpeg.deleteFile('output.mp4');
    
    return mp4Blob;
  };

  // Preload product image
  useEffect(() => {
    const img = new Image();
    img.src = productImage;
    img.onload = () => {
      productImageRef.current = img;
    };
  }, []);

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode,
          width: { ideal: 1080 },
          height: { ideal: 1920 }
        },
        audio: true
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setCameraReady(true);
          renderSplitView();
        };
      }
    } catch (err) {
      console.error('Error accessing camera:', err);
    }
  }, [facingMode]);

  // Render split view - SAME camera frame for both halves
  // TOP = inverted filter, BOTTOM = normal
  const renderSplitView = useCallback(() => {
    const video = videoRef.current;
    const canvas = combinedCanvasRef.current;
    
    if (!video || !canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const processFrame = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        
        // Fixed story size (1080x1920 = 9:16 aspect ratio)
        const STORY_WIDTH = 1080;
        const STORY_HEIGHT = 1920;
        
        canvas.width = STORY_WIDTH;
        canvas.height = STORY_HEIGHT;

        const halfHeight = STORY_HEIGHT / 2;

        // Calculate how to fit the video into half height while maintaining aspect ratio
        const videoAspect = vw / vh;
        const targetAspect = STORY_WIDTH / halfHeight;
        
        let drawWidth, drawHeight, drawX, drawY;
        
        if (videoAspect > targetAspect) {
          // Video is wider - fit by height, crop sides
          drawHeight = halfHeight;
          drawWidth = halfHeight * videoAspect;
          drawX = (STORY_WIDTH - drawWidth) / 2;
          drawY = 0;
        } else {
          // Video is taller - fit by width, crop top/bottom
          drawWidth = STORY_WIDTH;
          drawHeight = STORY_WIDTH / videoAspect;
          drawX = 0;
          drawY = (halfHeight - drawHeight) / 2;
        }

        // Clear canvas with black background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

        // STEP 1: Draw video in TOP HALF (scaled to fit)
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, STORY_WIDTH, halfHeight);
        ctx.clip();
        
        if (facingMode === 'user') {
          ctx.translate(STORY_WIDTH, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
        ctx.restore();

        // STEP 2: Get the top half pixels
        const topHalfPixels = ctx.getImageData(0, 0, STORY_WIDTH, halfHeight);
        
        // STEP 3: Copy to bottom half (same content in both)
        ctx.putImageData(topHalfPixels, 0, halfHeight);

        // STEP 4: Apply UV invert filter to TOP HALF only
        const topImageData = ctx.getImageData(0, 0, STORY_WIDTH, halfHeight);
        const data = topImageData.data;

        for (let i = 0; i < data.length; i += 4) {
          data[i] = 255 - data[i];         // R
          data[i + 1] = 255 - data[i + 1]; // G
          data[i + 2] = 255 - data[i + 2]; // B
        }

        ctx.putImageData(topImageData, 0, 0);

        // Draw the product image (center-left, on the split line)
        if (productImageRef.current) {
          const img = productImageRef.current;
          const aspectRatio = img.naturalWidth / img.naturalHeight;
          
          // Product size: 18% of story height
          const productHeight = STORY_HEIGHT * 0.18;
          const productWidth = productHeight * aspectRatio;
          
          // Position: center-left (18% offset from center), vertically on split line
          const productX = (STORY_WIDTH - productWidth) / 2 - (STORY_WIDTH * 0.18);
          const productY = halfHeight - (productHeight / 2);
          
          // Shadow for depth
          ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
          ctx.shadowBlur = 20;
          ctx.shadowOffsetX = 4;
          ctx.shadowOffsetY = 4;
          
          ctx.drawImage(img, productX, productY, productWidth, productHeight);
          
          // Reset shadow
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
        }
      }
      
      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    processFrame();
  }, [facingMode]);

  // Start recording
  const startRecording = useCallback(() => {
    const canvas = combinedCanvasRef.current;
    if (!canvas || !streamRef.current) return;

    chunksRef.current = [];
    
    // Capture the combined canvas stream with audio
    const canvasStream = canvas.captureStream(30);
    const audioTracks = streamRef.current.getAudioTracks();
    
    audioTracks.forEach(track => {
      canvasStream.addTrack(track);
    });

    const mediaRecorder = new MediaRecorder(canvasStream, {
      mimeType: 'video/webm;codecs=vp9'
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const webmBlob = new Blob(chunksRef.current, { type: 'video/webm' });
      
      // Convert to MP4
      setRecordingState('converting');
      setConvertProgress(0);
      
      try {
        const mp4Blob = await convertToMp4(webmBlob);
        mp4BlobRef.current = mp4Blob;
        const url = URL.createObjectURL(mp4Blob);
        setRecordedVideoUrl(url);
        setRecordingState('preview');
      } catch (error) {
        console.error('Error converting to MP4:', error);
        // Fallback to WebM if conversion fails
        mp4BlobRef.current = webmBlob;
        const url = URL.createObjectURL(webmBlob);
        setRecordedVideoUrl(url);
        setRecordingState('preview');
      }
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(100);
    setRecordingState('recording');

    // Start timer
    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      setRecordingTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    (mediaRecorderRef.current as any).timerInterval = timerInterval;
  }, []);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      clearInterval((mediaRecorderRef.current as any).timerInterval);
      mediaRecorderRef.current.stop();
      setRecordingTime(0);
    }
  }, []);

  // Reset to camera
  const resetCamera = useCallback(() => {
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
    }
    setRecordedVideoUrl(null);
    setRecordingState('idle');
  }, [recordedVideoUrl]);

  // Download video as MP4
  const downloadVideo = useCallback(() => {
    if (!recordedVideoUrl || !mp4BlobRef.current) return;
    
    const a = document.createElement('a');
    a.href = recordedVideoUrl;
    a.download = `pixxel-uv-${Date.now()}.mp4`;
    a.click();
  }, [recordedVideoUrl]);

  // Share video
  const shareVideo = useCallback(async () => {
    if (!mp4BlobRef.current) return;
    
    const file = new File([mp4BlobRef.current], `pixxel-uv-${Date.now()}.mp4`, {
      type: 'video/mp4'
    });
    
    if (navigator.share && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'UV Camera Video',
        });
      } catch (error) {
        console.log('Share cancelled or failed:', error);
      }
    } else {
      // Fallback to download if share not supported
      downloadVideo();
    }
  }, [downloadVideo]);

  // Switch camera
  const switchCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    cancelAnimationFrame(animationFrameRef.current);
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  }, []);

  // Format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Initialize camera on mount or when facing mode changes
  useEffect(() => {
    startCamera();
    
    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  return (
    <div className="relative w-full h-screen bg-background overflow-hidden">
      {/* Hidden video element for camera feed */}
      <video 
        ref={videoRef} 
        className="hidden" 
        playsInline 
        muted
      />
      
      {/* Converting mode */}
      {recordingState === 'converting' && (
        <div className="absolute inset-0 bg-background/90 flex flex-col items-center justify-center z-50">
          <Loader2 className="w-16 h-16 text-primary animate-spin mb-4" />
          <p className="text-lg font-semibold text-foreground mb-2">Converting to MP4...</p>
          <div className="w-48 h-2 bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${convertProgress}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground mt-2">{convertProgress}%</p>
        </div>
      )}
      
      {/* Preview mode */}
      {recordingState === 'preview' && recordedVideoUrl ? (
        <div className="relative w-full h-full flex flex-col">
          <video 
            src={recordedVideoUrl} 
            className="w-full h-full object-cover"
            autoPlay
            loop
            playsInline
          />
          
          {/* Preview controls */}
          <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background/80 to-transparent">
            <div className="flex items-center justify-center gap-4">
              <button 
                onClick={resetCamera}
                className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-foreground transition-transform active:scale-95"
              >
                <X className="w-5 h-5" />
              </button>
              
              <button 
                onClick={downloadVideo}
                className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-primary-foreground transition-transform active:scale-95"
              >
                <Download className="w-6 h-6" />
              </button>
              
              <button 
                onClick={shareVideo}
                className="w-16 h-16 rounded-full bg-accent flex items-center justify-center text-accent-foreground transition-transform active:scale-95"
              >
                <Share2 className="w-7 h-7" />
              </button>
              
              <button 
                onClick={resetCamera}
                className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-foreground transition-transform active:scale-95"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Split-screen Camera View */}
          <canvas 
            ref={combinedCanvasRef} 
            className="w-full h-full object-cover"
          />
          
          {/* Recording indicator */}
          {recordingState === 'recording' && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-destructive px-4 py-2 rounded-full">
              <div className="w-3 h-3 rounded-full bg-foreground animate-pulse-record" />
              <span className="text-sm font-bold text-foreground">{formatTime(recordingTime)}</span>
            </div>
          )}
          
          {/* Switch camera button */}
          <button 
            onClick={switchCamera}
            className="absolute top-4 right-4 w-12 h-12 rounded-full bg-secondary/50 backdrop-blur-sm flex items-center justify-center text-foreground"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
          
          {/* Record button */}
          <div className="absolute bottom-8 left-0 right-0 flex justify-center">
            {recordingState === 'idle' ? (
              <button 
                onClick={startRecording}
                disabled={!cameraReady}
                className="w-20 h-20 rounded-full border-4 border-foreground/80 flex items-center justify-center transition-transform active:scale-95 disabled:opacity-50"
              >
                <div className="w-16 h-16 rounded-full bg-destructive" />
              </button>
            ) : (
              <button 
                onClick={stopRecording}
                className="w-20 h-20 rounded-full border-4 border-destructive flex items-center justify-center transition-transform active:scale-95 animate-pulse-record"
              >
                <Square className="w-8 h-8 text-destructive fill-current" />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default UVCamera;
