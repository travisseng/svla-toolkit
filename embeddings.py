import os
import json
import numpy as np
from sentence_transformers import SentenceTransformer
import faiss
from typing import List, Dict, Tuple, Any, Optional, Union
import threading

# Global variables
model = None
model_lock = threading.Lock()

def get_model():
    """Get or initialize the sentence transformer model."""
    global model
    if model is None:
        with model_lock:
            if model is None:
                print("Loading sentence transformer model...")
                # Using a smaller, faster model that's still good for semantic similarity
                model = SentenceTransformer('all-MiniLM-L6-v2')
                print("Sentence transformer model loaded.")
    return model

def compute_embeddings(texts: List[str]) -> np.ndarray:
    """Compute embeddings for a list of texts."""
    if not texts:
        return np.array([])
    
    model = get_model()
    # Generate embeddings
    embeddings = model.encode(texts, convert_to_tensor=False, show_progress_bar=False)
    return embeddings

def extract_sentences_from_transcript(transcript: List[Dict]) -> List[Dict]:
    """Extract sentences from transcript with timing information."""
    sentences = []
    for item in transcript:
        sentences.append({
            "text": item["text"],
            "start": item["start"],
            "duration": item.get("duration", 0),
            "type": "transcript"
        })
    return sentences

def extract_text_from_ocr(scenes: List[Dict]) -> List[Dict]:
    """Extract OCR text from scenes with timing information."""
    ocr_texts = []
    
    for scene_index, scene in enumerate(scenes):
        # Extract timestamp from scene data
        timestamp = scene.get("timestamp", 0)
        time_seconds = scene.get("time_seconds", 0)
        
        # Get OCR text from YOLO detections
        if "yolo_detections" in scene and scene["yolo_detections"].get("success", False):
            detections = scene["yolo_detections"].get("detections", [])
            for detection in detections:
                if "ocr_text" in detection and detection["ocr_text"].strip():
                    ocr_texts.append({
                        "text": detection["ocr_text"],
                        "start": time_seconds,
                        "duration": scene.get("duration", 0),
                        "bbox": detection.get("bbox", []),
                        "scene_index": scene_index,
                        "detection_index": detections.index(detection),
                        "type": "ocr"
                    })
        
        # Also get OCR text from Surya OCR if available
        if "surya_ocr" in scene and scene["surya_ocr"].get("success", False):
            results = scene["surya_ocr"].get("results", [])
            for result_index, result in enumerate(results):
                if "text" in result and result["text"].strip():
                    # Check if this result is already matched with a detection
                    if not result.get("matched", False):
                        ocr_texts.append({
                            "text": result["text"],
                            "start": time_seconds,
                            "duration": scene.get("duration", 0),
                            "bbox": result.get("bbox", []),
                            "scene_index": scene_index,
                            "result_index": result_index,
                            "type": "surya_ocr"
                        })
    
    return ocr_texts

def build_transcript_ocr_relationships(video_id: str) -> Dict:
    """
    Build relationships between transcript sentences and OCR text.
    
    Args:
        video_id: The YouTube video ID
    
    Returns:
        Dictionary with relationship data
    """
    # Paths to transcript and scene files
    youtube_transcript_path = f"static/transcripts/{video_id}.json"
    whisper_transcript_path = f"static/transcripts/{video_id}_whisper.json"
    scenes_path = f"static/scenes/{video_id}.json"
    embeddings_path = f"static/transcripts/{video_id}_embeddings.json"
    
    # Check if embeddings file already exists
    # if os.path.exists(embeddings_path):
    #     with open(embeddings_path, 'r') as f:
    #         return json.load(f)
    
    # Load transcript (prefer whisper if available)
    transcript = []
    if os.path.exists(whisper_transcript_path):
        with open(whisper_transcript_path, 'r') as f:
            transcript = json.load(f)
    elif os.path.exists(youtube_transcript_path):
        with open(youtube_transcript_path, 'r') as f:
            transcript = json.load(f)
    else:
        return {"success": False, "error": "No transcript available"}
    
    # Load scenes
    if os.path.exists(scenes_path):
        with open(scenes_path, 'r') as f:
            scenes = json.load(f)
    else:
        return {"success": False, "error": "No scene data available"}
    
    # Extract sentences and OCR text
    transcript_sentences = extract_sentences_from_transcript(transcript)
    ocr_texts = extract_text_from_ocr(scenes)
    
    # If no OCR text found, return early
    if not ocr_texts:
        return {
            "success": True, 
            "message": "No OCR text found",
            "transcript_sentences": transcript_sentences,
            "ocr_texts": [],
            "ocr_to_transcript_relationships": [],
            "transcript_to_ocr_relationships": []
        }
    
    # Create a mapping from scene index to timestamp range
    scene_time_ranges = {}
    for i, scene in enumerate(scenes):
        start_time = scene.get("time_seconds", 0)
        # For the end time, use the next scene's start time or a large value for the last scene
        end_time = scenes[i+1].get("time_seconds", start_time + 120) if i < len(scenes) - 1 else float('inf')
        scene_time_ranges[i] = (start_time, end_time)
    
    # Map each transcript sentence to potential scenes
    transcript_to_scenes = {}
    for i, sentence in enumerate(transcript_sentences):
        sentence_time = sentence["start"]
        potential_scenes = []
        for scene_idx, (start_time, end_time) in scene_time_ranges.items():
            # Consider a sentence part of a scene if:
            # 1. It starts during the scene
            # 2. It starts slightly before the scene but likely continues into it
            # 3. For the first scene, include earlier sentences too
            if (start_time <= sentence_time < end_time) or \
               (scene_idx == 0 and sentence_time < start_time) or \
               (start_time - 5 <= sentence_time < start_time):  # 5-second buffer
                potential_scenes.append(scene_idx)
        transcript_to_scenes[i] = potential_scenes
    
    # Combine all texts for embedding computation
    all_texts = []
    all_texts.extend([item["text"] for item in transcript_sentences])
    all_texts.extend([item["text"] for item in ocr_texts])
    
    # Compute embeddings for all texts
    all_embeddings = compute_embeddings(all_texts)
    
    # Split embeddings back into transcript and OCR
    transcript_count = len(transcript_sentences)
    transcript_embeddings = all_embeddings[:transcript_count]
    ocr_embeddings = all_embeddings[transcript_count:]
    
    # Add embeddings to the data structures
    for i, embedding in enumerate(transcript_embeddings):
        transcript_sentences[i]["embedding"] = embedding.tolist()
    
    for i, embedding in enumerate(ocr_embeddings):
        ocr_texts[i]["embedding"] = embedding.tolist()
    
    # Build FAISS index for transcript sentences - this supports OCR → transcript
    dim = transcript_embeddings.shape[1]  # Embedding dimension
    transcript_index = faiss.IndexFlatIP(dim)  # Inner product (cosine) similarity
    
    # Normalize vectors for cosine similarity
    faiss.normalize_L2(transcript_embeddings)
    faiss.normalize_L2(ocr_embeddings)
    
    # Add transcript embeddings to the index
    transcript_index.add(transcript_embeddings)
    
    # Search for nearest transcript sentences for each OCR text
    k_ocr_to_transcript = min(5, len(transcript_sentences))  # Find top-k matches
    similarities_ocr_to_transcript, indices_ocr_to_transcript = transcript_index.search(ocr_embeddings, k_ocr_to_transcript)
    
    # Build OCR-to-transcript relationships
    ocr_to_transcript_relationships = []
    for i, (sims, idxs) in enumerate(zip(similarities_ocr_to_transcript, indices_ocr_to_transcript)):
        ocr_item = ocr_texts[i]
        
        matches = []
        for j, (sim, idx) in enumerate(zip(sims, idxs)):
            if sim > 0.5:  # Threshold for meaningful similarity
                matches.append({
                    "transcript_index": int(idx),
                    "similarity": float(sim),
                    "text": transcript_sentences[idx]["text"],
                    "start": transcript_sentences[idx]["start"]
                })
        
        if matches:
            ocr_to_transcript_relationships.append({
                "ocr_index": i,
                "ocr_text": ocr_item["text"],
                "scene_index": ocr_item.get("scene_index"),
                "timestamp": ocr_item["start"],
                "matches": matches
            })
    
    # Now build FAISS index for OCR text - this supports transcript → OCR
    ocr_index = faiss.IndexFlatIP(dim)
    ocr_index.add(ocr_embeddings)
    
    # Search for nearest OCR text for each transcript sentence
    k_transcript_to_ocr = min(5, len(ocr_texts))  # Find top-k matches
    similarities_transcript_to_ocr, indices_transcript_to_ocr = ocr_index.search(transcript_embeddings, k_transcript_to_ocr)
    
    # Build transcript-to-OCR relationships
    transcript_to_ocr_relationships = []
    for i, (sims, idxs) in enumerate(zip(similarities_transcript_to_ocr, indices_transcript_to_ocr)):
        transcript_item = transcript_sentences[i]
        
        # Get the potential scenes for this transcript sentence
        potential_scenes = transcript_to_scenes.get(i, [])
        
        matches = []
        for j, (sim, idx) in enumerate(zip(sims, idxs)):
            ocr_item = ocr_texts[idx]
            ocr_scene_index = ocr_item.get("scene_index")
            
            # Only include OCR items from potential scenes with good similarity
            if sim > 0.5 and (not potential_scenes or ocr_scene_index in potential_scenes):
                matches.append({
                    "ocr_index": int(idx),
                    "similarity": float(sim),
                    "text": ocr_item["text"],
                    "scene_index": ocr_scene_index,
                    "timestamp": ocr_item["start"],
                    "bbox": ocr_item.get("bbox", [])
                })
        
        if matches:
            transcript_to_ocr_relationships.append({
                "transcript_index": i,
                "transcript_text": transcript_item["text"],
                "timestamp": transcript_item["start"],
                "matches": matches
            })
    
    # Prepare result without the actual embeddings (to save space)
    transcript_sentences_without_embeddings = []
    for item in transcript_sentences:
        item_copy = item.copy()
        item_copy.pop("embedding", None)
        transcript_sentences_without_embeddings.append(item_copy)
    
    ocr_texts_without_embeddings = []
    for item in ocr_texts:
        item_copy = item.copy()
        item_copy.pop("embedding", None)
        ocr_texts_without_embeddings.append(item_copy)
    
    result = {
        "success": True,
        "video_id": video_id,
        "transcript_sentences": transcript_sentences_without_embeddings,
        "ocr_texts": ocr_texts_without_embeddings,
        "ocr_to_transcript_relationships": ocr_to_transcript_relationships,
        "transcript_to_ocr_relationships": transcript_to_ocr_relationships
    }
    
    # Save results to file
    with open(embeddings_path, 'w') as f:
        json.dump(result, f)
    
    return result

def find_ocr_text_for_transcript(video_id: str, transcript_index: int) -> List[Dict]:
    """
    Find OCR text related to a specific transcript sentence.
    
    Args:
        video_id: The YouTube video ID
        transcript_index: Index of the transcript sentence
    
    Returns:
        List of related OCR text items
    """
    embeddings_path = f"static/transcripts/{video_id}_embeddings.json"
    
    if not os.path.exists(embeddings_path):
        # Build relationships if they don't exist
        build_transcript_ocr_relationships(video_id)
    
    if os.path.exists(embeddings_path):
        with open(embeddings_path, 'r') as f:
            data = json.load(f)
        
        # Check if we have the new format with separate relationship types
        if "transcript_to_ocr_relationships" in data:
            for rel in data.get("transcript_to_ocr_relationships", []):
                if rel.get("transcript_index") == transcript_index:
                    return rel.get("matches", [])
        # Backward compatibility with older format
        else:
            related_ocr = []
            for rel in data.get("relationships", []):
                for match in rel.get("matches", []):
                    if match.get("transcript_index") == transcript_index:
                        related_ocr.append({
                            "ocr_index": rel.get("ocr_index"),
                            "ocr_text": rel["ocr_text"],
                            "scene_index": rel["scene_index"],
                            "timestamp": rel["timestamp"],
                            "similarity": match["similarity"]
                        })
            
            return sorted(related_ocr, key=lambda x: x["similarity"], reverse=True)
    
    return []

def find_transcript_for_ocr(video_id: str, scene_index: int, ocr_text: str) -> List[Dict]:
    """
    Find transcript sentences related to specific OCR text.
    
    Args:
        video_id: The YouTube video ID
        scene_index: Index of the scene
        ocr_text: The OCR text to search for
    
    Returns:
        List of related transcript sentences
    """
    embeddings_path = f"static/transcripts/{video_id}_embeddings.json"
    
    if not os.path.exists(embeddings_path):
        # Build relationships if they don't exist
        build_transcript_ocr_relationships(video_id)
    
    if os.path.exists(embeddings_path):
        with open(embeddings_path, 'r') as f:
            data = json.load(f)
        
        # Check if we have the new format with separate relationship types
        if "ocr_to_transcript_relationships" in data:
            for rel in data.get("ocr_to_transcript_relationships", []):
                if rel.get("scene_index") == scene_index and rel.get("ocr_text") == ocr_text:
                    return rel.get("matches", [])
        # Backward compatibility with older format
        else:
            related_transcript = []
            for rel in data.get("relationships", []):
                if rel.get("scene_index") == scene_index and rel.get("ocr_text") == ocr_text:
                    for match in rel.get("matches", []):
                        related_transcript.append({
                            "text": match["text"],
                            "start": match["start"],
                            "transcript_index": match["transcript_index"],
                            "similarity": match["similarity"]
                        })
            
            return sorted(related_transcript, key=lambda x: x["similarity"], reverse=True)
    
    return []

def find_scene_for_transcript(video_id: str, transcript_index: int) -> List[int]:
    """
    Find scenes that likely contain a specific transcript sentence.
    
    Args:
        video_id: The YouTube video ID
        transcript_index: Index of the transcript sentence
    
    Returns:
        List of scene indices
    """
    # Get transcript time
    embeddings_path = f"static/transcripts/{video_id}_embeddings.json"
    scenes_path = f"static/scenes/{video_id}.json"
    
    if not os.path.exists(embeddings_path) or not os.path.exists(scenes_path):
        return []
    
    try:
        # Load transcript data
        with open(embeddings_path, 'r') as f:
            data = json.load(f)
        
        if transcript_index >= len(data.get("transcript_sentences", [])):
            return []
        
        transcript_time = data["transcript_sentences"][transcript_index]["start"]
        
        # Load scenes
        with open(scenes_path, 'r') as f:
            scenes = json.load(f)
        
        # Find scenes that contain this timestamp
        result_scenes = []
        for i, scene in enumerate(scenes):
            start_time = scene.get("time_seconds", 0)
            # For the end time, use the next scene's start time or a large value for the last scene
            end_time = scenes[i+1].get("time_seconds", start_time + 120) if i < len(scenes) - 1 else float('inf')
            
            # Consider a sentence part of a scene if:
            # 1. It starts during the scene
            # 2. It starts slightly before the scene but likely continues into it
            # 3. For the first scene, include earlier sentences too
            if (start_time <= transcript_time < end_time) or \
               (i == 0 and transcript_time < start_time) or \
               (start_time - 5 <= transcript_time < start_time):  # 5-second buffer
                result_scenes.append(i)
        
        return result_scenes
    
    except Exception as e:
        print(f"Error finding scene for transcript: {str(e)}")
        return [] 