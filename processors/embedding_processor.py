import os
import json
from fastapi.responses import JSONResponse
from embeddings import (
    build_transcript_ocr_relationships,
    find_ocr_text_for_transcript,
    find_transcript_for_ocr,
    find_scene_for_transcript
)

class EmbeddingProcessor:
    def __init__(self):
        pass

    async def compute_embeddings(self, video_id: str, background_tasks):
        """Compute transcript-OCR embeddings and relationships for a video."""
        try:
            # Check if video exists
            video_files = os.listdir("static/videos")
            if not any(f.startswith(video_id) for f in video_files):
                return JSONResponse({
                    "success": False,
                    "error": "Video not found"
                })
            
            # Check if transcript exists
            transcript_files = os.listdir("static/transcripts")
            if not any(f.startswith(video_id) for f in transcript_files):
                return JSONResponse({
                    "success": False,
                    "error": "No transcript found"
                })
            
            # Check if scenes exist
            scenes_path = f"static/scenes/{video_id}.json"
            if not os.path.exists(scenes_path):
                return JSONResponse({
                    "success": False,
                    "error": "No scene data found"
                })
            
            # Start background task
            background_tasks.add_task(self.process_embeddings, video_id)
            
            return JSONResponse({
                "success": True,
                "message": "Embedding computation started",
                "status_url": f"/embeddings_status/{video_id}"
            })
            
        except Exception as e:
            return JSONResponse({
                "success": False,
                "error": str(e)
            })

    async def process_embeddings(self, video_id: str):
        """Process embeddings in the background."""
        try:
            # Save initial progress
            with open(f"static/transcripts/{video_id}_embeddings_progress.txt", 'w') as f:
                f.write("0")
            
            # Update progress to 10%
            with open(f"static/transcripts/{video_id}_embeddings_progress.txt", 'w') as f:
                f.write("10")
            
            # Compute embeddings and relationships
            result = build_transcript_ocr_relationships(video_id)
            
            # Update progress to 100%
            with open(f"static/transcripts/{video_id}_embeddings_progress.txt", 'w') as f:
                f.write("100")
            
            print(f"Completed embedding computation for video {video_id}")
            
        except Exception as e:
            print(f"Error computing embeddings: {str(e)}")
            # Save error
            with open(f"static/transcripts/{video_id}_embeddings_error.txt", 'w') as f:
                f.write(str(e))

    async def get_status(self, video_id: str):
        """Get the status of embeddings computation."""
        error_file = f"static/transcripts/{video_id}_embeddings_error.txt"
        progress_file = f"static/transcripts/{video_id}_embeddings_progress.txt"
        completed_file = f"static/transcripts/{video_id}_embeddings.json"
        
        if os.path.exists(error_file):
            with open(error_file, 'r') as f:
                error_message = f.read()
            return JSONResponse({
                "success": False,
                "status": "error",
                "error": error_message
            })
        
        if os.path.exists(completed_file):
            return JSONResponse({
                "success": True,
                "status": "completed"
            })
        
        if os.path.exists(progress_file):
            with open(progress_file, 'r') as f:
                progress = f.read().strip()
            return JSONResponse({
                "success": True,
                "status": "processing",
                "progress": float(progress) if progress.replace('.', '', 1).isdigit() else 0
            })
        
        return JSONResponse({
            "success": False,
            "status": "not_started"
        })

    async def get_relationships(self, video_id: str):
        """Get the computed relationships between transcript and OCR."""
        embeddings_path = f"static/transcripts/{video_id}_embeddings.json"
        
        if os.path.exists(embeddings_path):
            with open(embeddings_path, 'r') as f:
                data = json.load(f)
            return JSONResponse(data)
        else:
            return JSONResponse({
                "success": False,
                "error": "Embeddings not computed yet"
            })

    async def find_ocr_for_transcript(self, video_id: str, transcript_index: int):
        """Find OCR text related to a specific transcript sentence."""
        try:
            related_ocr = find_ocr_text_for_transcript(video_id, transcript_index)
            
            # If we got results, also get the scenes for this transcript
            scenes = []
            if related_ocr:
                scenes = find_scene_for_transcript(video_id, transcript_index)
            
            return JSONResponse({
                "success": True,
                "transcript_index": transcript_index,
                "related_ocr": related_ocr,
                "related_scenes": scenes
            })
        except Exception as e:
            return JSONResponse({
                "success": False,
                "error": str(e)
            })

    async def find_transcript_for_ocr(self, video_id: str, scene_index: int, ocr_text: str):
        """Find transcript sentences related to specific OCR text."""
        try:
            related_transcript = find_transcript_for_ocr(video_id, scene_index, ocr_text)
            return JSONResponse({
                "success": True,
                "scene_index": scene_index,
                "ocr_text": ocr_text,
                "related_transcript": related_transcript
            })
        except Exception as e:
            return JSONResponse({
                "success": False,
                "error": str(e)
            })

    async def find_scene_for_transcript(self, video_id: str, transcript_index: int):
        """Find scenes related to a specific transcript sentence."""
        try:
            related_scenes = find_scene_for_transcript(video_id, transcript_index)
            return JSONResponse({
                "success": True,
                "transcript_index": transcript_index,
                "related_scenes": related_scenes
            })
        except Exception as e:
            return JSONResponse({
                "success": False,
                "error": str(e)
            }) 