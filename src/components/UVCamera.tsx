import { useRef, useState, useCallback, useEffect } from 'react';
import { Square, RotateCcw, Download, X } from 'lucide-react';
import productImage from '@/assets/product.webp';

type RecordingState = 'idle' | 'recording' | 'preview';

const UVCamera = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const combinedCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number>(0);
  const productImageRef = useRef<HTMLImageElement | null>(null);

  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

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
        
        // Canvas is the full height, we show the same frame twice
        canvas.width = vw;
        canvas.height = vh;

        const halfHeight = Math.floor(vh / 2);

        // Calculate scaled dimensions to fit full video in half height
        const videoAspect = vw / vh;
        const scaledWidth = halfHeight * videoAspect;
        const offsetX = (vw - scaledWidth) / 2; // Center horizontally

        // STEP 1: Draw scaled video in TOP HALF (full video fits in half height)
        ctx.save();
        if (facingMode === 'user') {
          ctx.translate(vw, 0);
          ctx.scale(-1, 1);
        }
        // Draw full video scaled to fit in top half
        ctx.drawImage(video, 0, 0, vw, vh, offsetX, 0, scaledWidth, halfHeight);
        ctx.restore();

        // STEP 2: Get the top half pixels
        const topHalfPixels = ctx.getImageData(0, 0, vw, halfHeight);
        
        // STEP 3: Copy to bottom half (same content in both)
        ctx.putImageData(topHalfPixels, 0, halfHeight);

        // STEP 4: Apply UV invert filter to TOP HALF only
        const topImageData = ctx.getImageData(0, 0, vw, halfHeight);
        const data = topImageData.data;

        for (let i = 0; i < data.length; i += 4) {
          data[i] = 255 - data[i];         // R
          data[i + 1] = 255 - data[i + 1]; // G
          data[i + 2] = 255 - data[i + 2]; // B
        }

        ctx.putImageData(topImageData, 0, 0);

        // Draw the product image in CENTER (always visible on mobile)
        if (productImageRef.current) {
          const img = productImageRef.current;
          const aspectRatio = img.naturalWidth / img.naturalHeight;
          
          const productHeight = vh * 0.20;
          const productWidth = productHeight * aspectRatio;
          
          // Position center-left horizontally, at the split line vertically
          const productX = (vw - productWidth) / 2 - (vw * 0.08);
          const productY = halfHeight - (productHeight / 2);
          
          ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
          ctx.shadowBlur = 25;
          ctx.shadowOffsetX = 5;
          ctx.shadowOffsetY = 5;
          
          ctx.drawImage(img, productX, productY, productWidth, productHeight);
          
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
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

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      setRecordedVideoUrl(url);
      setRecordingState('preview');
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

  // Download video
  const downloadVideo = useCallback(() => {
    if (!recordedVideoUrl) return;
    
    const a = document.createElement('a');
    a.href = recordedVideoUrl;
    a.download = `pixxel-uv-${Date.now()}.webm`;
    a.click();
  }, [recordedVideoUrl]);

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
            <div className="flex items-center justify-center gap-6">
              <button 
                onClick={resetCamera}
                className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center text-foreground transition-transform active:scale-95"
              >
                <X className="w-6 h-6" />
              </button>
              
              <button 
                onClick={downloadVideo}
                className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground transition-transform active:scale-95"
              >
                <Download className="w-7 h-7" />
              </button>
              
              <button 
                onClick={resetCamera}
                className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center text-foreground transition-transform active:scale-95"
              >
                <RotateCcw className="w-6 h-6" />
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
