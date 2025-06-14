from fastapi import FastAPI, Request, Header, HTTPException, BackgroundTasks, UploadFile, File, APIRouter
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import os
import json
import hashlib
from typing import Optional, List, Dict, Any, Union
from pathlib import Path
import asyncio
from concurrent.futures import ThreadPoolExecutor
import glob
import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi
import re

# Import processing modules
from processors.video_processor import VideoProcessor
from processors.scene_processor import SceneProcessor
from processors.ocr_processor import OCRProcessor
from processors.transcript_processor import TranscriptProcessor
from processors.embedding_processor import EmbeddingProcessor
from processors.summary_processor import SummaryProcessor

# Initialize FastAPI app
app = FastAPI()

# Create directories if they don't exist
STATIC_DIRS = [
    "static/videos",
    "static/transcripts",
    "static/scenes",
    "static/thumbnails",
    "static/summaries",
    "static/fullsize_images",
    "static/detections",
    "static/ocr_results"
]

for directory in STATIC_DIRS:
    os.makedirs(directory, exist_ok=True)

# Mount static directory
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Initialize processors
video_processor = VideoProcessor()
scene_processor = SceneProcessor()
transcript_processor = TranscriptProcessor()
embedding_processor = EmbeddingProcessor()
summary_processor = SummaryProcessor()

# Create thread pool for background tasks
executor = ThreadPoolExecutor(max_workers=2)

# Dictionary to store SSE clients by video_id
sse_clients = {}

async def send_sse_update(video_id, event_data):
    """Send an SSE update to all clients for a specific video."""
    if video_id in sse_clients:
        data_str = json.dumps(event_data)
        for queue in sse_clients[video_id]:
            try:
                await queue.put(data_str)
            except Exception as e:
                print(f"Error sending SSE update: {str(e)}")

# Initialize OCR processor with SSE update function
ocr_processor = OCRProcessor(send_sse_update=send_sse_update)

# Routes

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/upload_video")
async def upload_video(background_tasks: BackgroundTasks, video: UploadFile = File(...)):
    try:
        # Calculate video hash
        content = await video.read()
        video_hash = hashlib.sha256(content).hexdigest()
        video_path = f"static/videos/{video_hash}.mp4"

        # Check if video exists
        
        if os.path.exists(video_path):
            print("Video exists: ", os.path.exists(video_path))
            return await video_processor.handle_existing_video(video_hash, video_path, background_tasks)

        # Save new video and start processing
        with open(video_path, "wb") as buffer:
            buffer.write(content)

        return await video_processor.process_new_video(video_hash, video_path, background_tasks)

    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)})

@app.get("/video/{video_id}")
async def stream_video(video_id: str, range: Optional[str] = Header(None)):
    try:
        video_path = video_processor.get_video_path(video_id)
        if not video_path:
            raise HTTPException(status_code=404, detail="Video not found")
        return await video_processor.stream_video(video_path, range)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/scenes/{video_id}")
async def get_scenes(video_id: str):
    return await scene_processor.get_scenes(video_id)

@app.get("/scene_detections/{video_id}/{scene_index}")
async def get_scene_detections(video_id: str, scene_index: int):
    return await scene_processor.get_scene_detections(video_id, scene_index)

@app.get("/thumbnails/{video_id}/{filename}")
async def get_thumbnail(video_id: str, filename: str):
    thumbnail_path = f"static/thumbnails/{video_id}/{filename}"
    if not os.path.exists(thumbnail_path):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(thumbnail_path)

@app.get("/fullsize_images/{video_id}/{filename}")
async def get_fullsize_image(video_id: str, filename: str):
    image_path = f"static/fullsize_images/{video_id}/{filename}"
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(image_path)

@app.get("/ocr_text/{video_id}")
async def get_ocr_text(video_id: str):
    return await ocr_processor.get_ocr_text(video_id)

@app.post("/process_surya_ocr/{video_id}")
async def process_surya_ocr(video_id: str):
    return await ocr_processor.process_surya_ocr(video_id)

@app.post("/set_ocr_preference")
async def set_ocr_preference(request: Request):
    data = await request.json()
    return await ocr_processor.set_preference(data.get("preference", "tesseract"))

@app.get("/get_ocr_preference")
def get_ocr_preference():
    return {"preference": ocr_processor.get_preference()}

@app.get("/get_transcript/{video_id}/{source}")
async def get_transcript(video_id: str, source: str):
    return await transcript_processor.get_transcript(video_id, source)

@app.post("/generate_whisper_transcript/{video_id}")
async def generate_whisper_transcript(video_id: str, background_tasks: BackgroundTasks):
    return await transcript_processor.generate_whisper_transcript(video_id, background_tasks)

@app.get("/whisper_transcript_status/{video_id}")
async def whisper_transcript_status(video_id: str):
    return await transcript_processor.get_whisper_status(video_id)

@app.post("/compute_embeddings/{video_id}")
async def compute_embeddings_endpoint(video_id: str, background_tasks: BackgroundTasks):
    return await embedding_processor.compute_embeddings(video_id, background_tasks)

@app.get("/embeddings_status/{video_id}")
async def embeddings_status(video_id: str):
    return await embedding_processor.get_status(video_id)

@app.get("/get_transcript_ocr_relationships/{video_id}")
async def get_transcript_ocr_relationships(video_id: str):
    return await embedding_processor.get_relationships(video_id)

@app.get("/find_ocr_for_transcript/{video_id}/{transcript_index}")
async def get_ocr_for_transcript(video_id: str, transcript_index: int):
    return await embedding_processor.find_ocr_for_transcript(video_id, transcript_index)

@app.get("/find_transcript_for_ocr/{video_id}/{scene_index}")
async def get_transcript_for_ocr(video_id: str, scene_index: int, ocr_text: str):
    return await embedding_processor.find_transcript_for_ocr(video_id, scene_index, ocr_text)

@app.get("/find_scene_for_transcript/{video_id}/{transcript_index}")
async def get_scene_for_transcript(video_id: str, transcript_index: int):
    return await embedding_processor.find_scene_for_transcript(video_id, transcript_index)

# SSE routes and handlers
@app.get("/ocr_progress/{video_id}")
async def ocr_progress(video_id: str):
    async def event_generator():
        if video_id not in sse_clients:
            sse_clients[video_id] = []
        
        queue = asyncio.Queue()
        sse_clients[video_id].append(queue)
        
        try:
            await queue.put(json.dumps({
                "event": "connected",
                "data": {"message": "SSE connection established"}
            }))
            
            while True:
                data = await queue.get()
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if video_id in sse_clients and queue in sse_clients[video_id]:
                sse_clients[video_id].remove(queue)
                if not sse_clients[video_id]:
                    del sse_clients[video_id]
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

def extract_video_id(url):
    """Extract video ID from YouTube URL."""
    pattern = r'(?:v=|\/)([0-9A-Za-z_-]{11}).*'
    match = re.search(pattern, url)
    return match.group(1) if match else None

@app.get("/download/{video_id}")
@app.post("/download/{video_id}")
async def download_video(video_id: str, background_tasks: BackgroundTasks):
    try:
        video_path = f"static/videos/{video_id}.mp4"
        if not glob.glob(f"static/videos/{video_id}.*"):
            ydl_opts = {
                'format': 'bestvideo[height<=720][vcodec=vp9]+bestaudio/best[vcodec=vp9]',  # 720p, no AV1
                'outtmpl': f'static/videos/{video_id}.%(ext)s',
                'merge_output_format': 'mp4',  # Ensure the final output is MP4
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([f'https://www.youtube.com/watch?v={video_id}'])

        # Get the actual video path (in case the extension is different)
        downloaded_files = os.listdir("static/videos")
        for file in downloaded_files:
            if file.startswith(video_id):
                video_path = os.path.join("static/videos", file)
                break

        # Check for existing processing results
        whisper_transcript_path = f"static/transcripts/{video_id}_whisper.json"
        has_whisper_transcript = os.path.exists(whisper_transcript_path)
        
        scenes_path = f"static/scenes/{video_id}.json"
        has_scenes = os.path.exists(scenes_path)
        
        # Load existing scenes if available
        existing_scenes = []
        if has_scenes:
            try:
                with open(scenes_path, 'r') as f:
                    existing_scenes = json.load(f)
            except Exception as e:
                print(f"Error loading existing scenes: {e}")
        
        # Check if transcript is being generated
        progress_file = f"static/transcripts/{video_id}_whisper_progress.txt"
        transcript_in_progress = os.path.exists(progress_file)
        
        # Load existing transcript if available
        transcript_to_use = None
        if has_whisper_transcript:
            try:
                with open(whisper_transcript_path, 'r') as f:
                    transcript_to_use = json.load(f)
            except Exception as e:
                print(f"Error loading existing transcript: {e}")
        
        # Try to get YouTube transcript if Whisper transcript is not available
        has_youtube_transcript = False
        if not transcript_to_use and not transcript_in_progress:
            try:
                youtube_transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=['en'])
                if youtube_transcript:
                    transcript_to_use = youtube_transcript
                    has_youtube_transcript = True
                    # Save YouTube transcript
                    with open(f"static/transcripts/{video_id}_youtube.json", 'w') as f:
                        json.dump(youtube_transcript, f)
            except Exception as e:
                print(f"Error getting YouTube transcript: {e}")
        
        # Start missing processing tasks
        if not has_whisper_transcript and not transcript_in_progress:
            await transcript_processor.start_whisper_generation(video_id, video_path, background_tasks)
            transcript_in_progress = True
        
        if not has_scenes:
            await scene_processor.start_scene_detection(video_id, video_path, background_tasks)
        
        return JSONResponse({
            "success": True,
            "video_url": f"/video/{video_id}",
            "video_id": video_id,
            "transcript": transcript_to_use,
            "has_youtube_transcript": has_youtube_transcript,
            "has_whisper_transcript": has_whisper_transcript,
            "transcript_in_progress": transcript_in_progress,
            "scenes": existing_scenes,
            "is_duplicate": os.path.exists(video_path)
        })
            
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        })

@app.post("/process_youtube")
async def process_youtube(request: Request, background_tasks: BackgroundTasks):
    try:
        data = await request.json()
        url = data.get("url")
        if not url:
            return JSONResponse({
                "success": False,
                "error": "No URL provided"
            })
        
        video_id = extract_video_id(url)
        if not video_id:
            return JSONResponse({
                "success": False,
                "error": "Invalid YouTube URL"
            })
        
        return await download_video(video_id, background_tasks)
        
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        })

@app.post("/generate_summary")
async def generate_summary(request: Request):
    try:
        data = await request.json()
        transcript = data.get("transcript", [])
        video_id = data.get("video_id")
        return await summary_processor.generate_summary(transcript, video_id)
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e)
        })

@app.get("/summary/{video_id}")
async def get_summary(video_id: str):
    return await summary_processor.get_summary(video_id)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)