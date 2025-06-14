import os
import json
from fastapi.responses import JSONResponse
from youtube_transcript_api import YouTubeTranscriptApi
from transcribe import transcribe_audio

class TranscriptProcessor:
    def __init__(self):
        self.transcript_preference = "youtube"  # Can be "youtube" or "whisper"

    async def get_transcript(self, video_id: str, source: str):
        """Get a specific transcript by source."""
        if source not in ["youtube", "whisper"]:
            return JSONResponse({
                "success": False,
                "error": "Invalid source. Must be 'youtube' or 'whisper'."
            })
        
        transcript_path = f"static/transcripts/{video_id}_{source}.json"
        if not os.path.exists(transcript_path):
            # If transcript doesn't exist and source is youtube, try to fetch it
            if source == "youtube":
                transcript, error = await self.get_youtube_transcript(video_id)
                if transcript:
                    return JSONResponse({
                        "success": True,
                        "transcript": transcript
                    })
                else:
                    return JSONResponse({
                        "success": False,
                        "error": error or "Failed to fetch YouTube transcript"
                    })
            return JSONResponse({
                "success": False,
                "error": f"No {source} transcript available for this video"
            })
        
        try:
            with open(transcript_path, 'r') as f:
                transcript = json.load(f)
            
            # Ensure consistent format
            if source == "youtube":
                transcript = self.format_youtube_transcript(transcript)
            
            return JSONResponse({
                "success": True,
                "transcript": transcript
            })
        except Exception as e:
            return JSONResponse({
                "success": False,
                "error": str(e)
            })

    def format_youtube_transcript(self, transcript):
        """Ensure YouTube transcript has consistent format."""
        formatted = []
        for item in transcript:
            formatted.append({
                "text": item.get("text", ""),
                "start": item.get("start", 0),
                "duration": item.get("duration", 0)
            })
        return formatted

    async def get_youtube_transcript(self, video_id: str):
        """Get transcript from YouTube."""
        try:
            transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=['en', 'fr'])
            
            # Format transcript
            formatted_transcript = self.format_youtube_transcript(transcript)
            
            # Save transcript for future use
            with open(f"static/transcripts/{video_id}_youtube.json", 'w') as f:
                json.dump(formatted_transcript, f)
            
            return formatted_transcript, None
        except Exception as e:
            return None, str(e)

    async def generate_whisper_transcript(self, video_id: str, background_tasks):
        """Generate a transcript using Whisper."""
        try:
            # Check if video exists
            video_files = os.listdir("static/videos")
            video_path = None
            for file in video_files:
                if file.startswith(video_id):
                    video_path = os.path.join("static/videos", file)
                    break
            
            if not video_path:
                return JSONResponse({
                    "success": False,
                    "error": "Video not found"
                })
            
            output_path = f"static/transcripts/{video_id}_whisper.json"
            
            # Check if transcript already exists
            if os.path.exists(output_path):
                with open(output_path, 'r') as f:
                    transcript = json.load(f)
                return JSONResponse({
                    "success": True,
                    "transcript": transcript,
                    "message": "Using existing Whisper transcript"
                })
            
            # Start background task to generate transcript
            background_tasks.add_task(self.process_whisper_transcript, video_id, video_path, output_path)
            
            return JSONResponse({
                "success": True,
                "message": "Transcript generation started",
                "status_url": f"/whisper_transcript_status/{video_id}"
            })
            
        except Exception as e:
            return JSONResponse({
                "success": False,
                "error": str(e)
            })

    async def start_whisper_generation(self, video_id: str, video_path: str, background_tasks):
        """Start Whisper transcript generation."""
        output_path = f"static/transcripts/{video_id}_whisper.json"
        
        # Create progress file
        with open(f"static/transcripts/{video_id}_whisper_progress.txt", 'w') as f:
            f.write("0")
        
        # Start background task
        background_tasks.add_task(self.process_whisper_transcript, video_id, video_path, output_path)

    async def process_whisper_transcript(self, video_id: str, video_path: str, output_path: str):
        """Process video with Whisper and save transcript."""
        try:
            transcript = []
            
            for sentence_data, progress in transcribe_audio(video_path):
                # Parse SRT format
                lines = sentence_data.strip().split('\n')
                i = 0
                while i < len(lines):
                    if i + 2 < len(lines) and '-->' in lines[i+1]:
                        # Extract timestamp
                        timestamp_line = lines[i+1]
                        start_time = timestamp_line.split(' --> ')[0].strip()
                        end_time = timestamp_line.split(' --> ')[1].strip()
                        
                        # Convert timestamp to seconds
                        h, m, s = start_time.split(':')
                        s, ms = s.split(',')
                        start_seconds = int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000
                        
                        h, m, s = end_time.split(':')
                        s, ms = s.split(',')
                        end_seconds = int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000
                        
                        # Extract text
                        text = lines[i+2].strip()
                        
                        # Add to transcript
                        transcript.append({
                            "text": text,
                            "start": start_seconds,
                            "duration": end_seconds - start_seconds
                        })
                        
                        i += 4
                    else:
                        i += 1
                
                # Update progress
                with open(f"static/transcripts/{video_id}_whisper_progress.txt", 'w') as f:
                    f.write(str(progress))
            
            # Save complete transcript
            with open(output_path, 'w') as f:
                json.dump(transcript, f)
            
            # Remove progress file
            progress_file = f"static/transcripts/{video_id}_whisper_progress.txt"
            if os.path.exists(progress_file):
                os.remove(progress_file)
                
        except Exception as e:
            print(f"Error generating Whisper transcript: {str(e)}")
            # Save error
            with open(f"static/transcripts/{video_id}_whisper_error.txt", 'w') as f:
                f.write(str(e))

    async def get_whisper_status(self, video_id: str):
        """Check the status of Whisper transcript generation."""
        try:
            # Check if transcript exists
            transcript_path = f"static/transcripts/{video_id}_whisper.json"
            if os.path.exists(transcript_path):
                with open(transcript_path, 'r') as f:
                    transcript = json.load(f)
                return JSONResponse({
                    "success": True,
                    "status": "complete",
                    "transcript": transcript
                })
            
            # Check if error occurred
            error_path = f"static/transcripts/{video_id}_whisper_error.txt"
            if os.path.exists(error_path):
                with open(error_path, 'r') as f:
                    error = f.read()
                return JSONResponse({
                    "success": False,
                    "status": "error",
                    "error": error
                })
            
            # Check progress
            progress_path = f"static/transcripts/{video_id}_whisper_progress.txt"
            if os.path.exists(progress_path):
                with open(progress_path, 'r') as f:
                    progress = float(f.read())
                return JSONResponse({
                    "success": True,
                    "status": "in_progress",
                    "progress": progress
                })
            
            # If no files exist, it's probably queued
            return JSONResponse({
                "success": True,
                "status": "queued"
            })
            
        except Exception as e:
            return JSONResponse({
                "success": False,
                "status": "error",
                "error": str(e)
            })

    async def set_preference(self, preference: str):
        """Set the transcript preference."""
        if preference not in ["youtube", "whisper"]:
            return JSONResponse({
                "success": False,
                "error": "Invalid preference"
            })
        
        self.transcript_preference = preference
        return JSONResponse({
            "success": True,
            "message": f"Transcript preference set to {preference}"
        })

    def get_preference(self):
        """Get the current transcript preference."""
        return self.transcript_preference 