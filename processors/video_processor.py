import os
import glob
from fastapi.responses import StreamingResponse, JSONResponse
from pathlib import Path
import re
import json
class VideoProcessor:
    def __init__(self):
        self.video_dir = "static/videos"

    def get_video_path(self, video_id: str) -> str:
        """Get the path of a video file by its ID."""
        video_files = glob.glob(f"{self.video_dir}/{video_id}.*")
        return video_files[0] if video_files else None

    async def handle_existing_video(self, video_hash: str, video_path: str, background_tasks):
        """Handle processing for an existing video."""
        from .transcript_processor import TranscriptProcessor
        from .scene_processor import SceneProcessor
        
        transcript_processor = TranscriptProcessor()
        scene_processor = SceneProcessor()
        
        # Check for existing processing results
        whisper_transcript_path = f"static/transcripts/{video_hash}_whisper.json"
        has_whisper_transcript = os.path.exists(whisper_transcript_path)
        
        scenes_path = f"static/scenes/{video_hash}.json"
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
        progress_file = f"static/transcripts/{video_hash}_whisper_progress.txt"
        transcript_in_progress = os.path.exists(progress_file)
        
        # Load existing transcript if available
        transcript_to_use = None
        if has_whisper_transcript:
            print("Loading existing transcript")
            try:
                with open(whisper_transcript_path, 'r') as f:
                    transcript_to_use = json.load(f)
            except Exception as e:
                print(f"Error loading existing transcript: {e}")
        
        # Try to get YouTube transcript if Whisper transcript is not available
        if not transcript_to_use and not transcript_in_progress:
            try:
                youtube_transcript, error = await transcript_processor.get_youtube_transcript(video_hash)
                if youtube_transcript:
                    transcript_to_use = youtube_transcript
                    has_youtube_transcript = True
                else:
                    has_youtube_transcript = False
            except Exception as e:
                print(f"Error getting YouTube transcript: {e}")
                has_youtube_transcript = False
        else:
            has_youtube_transcript = False
        
        # Start missing processing tasks
        if not has_whisper_transcript and not transcript_in_progress:
            await transcript_processor.start_whisper_generation(video_hash, video_path, background_tasks)
            transcript_in_progress = True
        
        if not has_scenes:
            await scene_processor.start_scene_detection(video_hash, video_path, background_tasks)
        print(transcript_to_use)
        return JSONResponse({
            "success": True,
            "video_url": f"/video/{video_hash}",
            "video_id": video_hash,
            "transcript": transcript_to_use,
            "has_youtube_transcript": has_youtube_transcript,
            "has_whisper_transcript": has_whisper_transcript,
            "transcript_in_progress": transcript_in_progress,
            "scenes": existing_scenes,
            "is_duplicate": True
        })

    async def process_new_video(self, video_hash: str, video_path: str, background_tasks):
        """Start processing for a new video."""
        from .transcript_processor import TranscriptProcessor
        from .scene_processor import SceneProcessor
        from .embedding_processor import EmbeddingProcessor
        
        transcript_processor = TranscriptProcessor()
        scene_processor = SceneProcessor()
        embedding_processor = EmbeddingProcessor()
        
        # Start Whisper transcript generation 
        # await transcript_processor.start_whisper_generation(video_hash, video_path, background_tasks)

        await transcript_processor.process_whisper_transcript(video_hash, video_path, f"static/transcripts/{video_hash}_whisper.json")
        
        # Start scene detection
        # await scene_processor.start_scene_detection(video_hash, video_path, background_tasks)
        await scene_processor.run_scene_detection(video_hash, video_path)
        
        # Start embeddings processing
        await embedding_processor.compute_embeddings(video_hash, background_tasks)
        
        return JSONResponse({
            "success": True,
            "video_url": f"/video/{video_hash}",
            "video_id": video_hash,
            "transcript": None,
            "has_youtube_transcript": False,
            "has_whisper_transcript": False,
            "transcript_in_progress": True,
            "scenes": [],
            "is_duplicate": False
        })

    async def stream_video(self, video_path: str, range_header: str = None):
        """Stream a video file with range support."""
        video_path = Path(video_path)
        file_size = video_path.stat().st_size

        # Parse range header
        start = 0
        end = file_size - 1
        if range_header:
            try:
                range_match = re.match(r'bytes=(\d+)-(\d*)', range_header)
                if range_match:
                    start = int(range_match.group(1))
                    end_group = range_match.group(2)
                    if end_group:
                        end = min(int(end_group), file_size - 1)
            except ValueError:
                raise ValueError("Invalid range header")

        chunk_size = end - start + 1

        headers = {
            'Content-Range': f'bytes {start}-{end}/{file_size}',
            'Accept-Ranges': 'bytes',
            'Content-Length': str(chunk_size),
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=3600',
        }

        async def video_stream():
            try:
                with open(video_path, 'rb') as video:
                    video.seek(start)
                    remaining = chunk_size
                    chunk = 32768  # 32KB chunks

                    while remaining > 0:
                        if remaining < chunk:
                            chunk = remaining
                        data = video.read(chunk)
                        if not data:
                            break
                        remaining -= len(data)
                        yield data
            except Exception as e:
                print(f"Error streaming video: {str(e)}")
                raise

        return StreamingResponse(
            video_stream(),
            status_code=206 if range_header else 200,
            headers=headers,
            media_type='video/mp4'
        ) 