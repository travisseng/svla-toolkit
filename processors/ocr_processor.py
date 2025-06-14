import os
import json
from fastapi.responses import JSONResponse
from PIL import Image
import pytesseract
from queue import Queue
import threading
from ultralytics import YOLO
import asyncio

# Import Surya for OCR
try:
    from surya.recognition import RecognitionPredictor
    from surya.detection import DetectionPredictor
    SURYA_AVAILABLE = True
except ImportError:
    SURYA_AVAILABLE = False
    print("Surya not available. Will use Tesseract for OCR.")

class OCRProcessor:
    # Class-level variables for shared predictors
    surya_recognition_predictor = None
    surya_detection_predictor = None
    yolo_model = None
    
    @classmethod
    def initialize_models(cls):
        global SURYA_AVAILABLE
        """Initialize shared models if not already initialized."""
        if cls.yolo_model is None:
            try:
                cls.yolo_model = YOLO("slide-model.pt")
            except Exception as e:
                print(f"Warning: Failed to load YOLOv8 model: {str(e)}")
        
        if SURYA_AVAILABLE and cls.surya_recognition_predictor is None:
            try:
                cls.surya_recognition_predictor = RecognitionPredictor()
                cls.surya_detection_predictor = DetectionPredictor()
                print("Surya OCR initialized successfully")
            except Exception as e:
                print(f"Failed to initialize Surya OCR: {str(e)}")
                
                SURYA_AVAILABLE = False

    def __init__(self, send_sse_update=None):
        self.ocr_preference = "tesseract"  # Can be "tesseract", "surya", or "both"
        self.surya_confidence_threshold = 0.6
        self.yolo_queue = Queue()
        self.ocr_queue = Queue()
        self.video_ocr_tasks = {}
        self.video_surya_tasks = {}
        self.send_sse_update = send_sse_update
        self.loop = asyncio.get_event_loop()
        
        # Task tracking
        self.yolo_tasks_total = 0
        self.yolo_tasks_completed = 0
        self.ocr_tasks_total = 0
        self.ocr_tasks_completed = 0
        self.task_lock = threading.Lock()
        
        # Initialize shared models
        self.__class__.initialize_models()
        
        # Start worker threads
        self.start_workers()

    def start_workers(self):
        """Start the YOLO and OCR worker threads."""
        self.yolo_thread = threading.Thread(target=self.yolo_worker, daemon=True)
        self.yolo_thread.start()
        
        self.ocr_thread = threading.Thread(target=self.ocr_worker, daemon=True)
        self.ocr_thread.start()

    def run_async(self, coro):
        """Run coroutine in the event loop."""
        if self.loop.is_running():
            # Create a new event loop for this thread if the main loop is running
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(coro)
            finally:
                loop.close()
        else:
            return self.loop.run_until_complete(coro)

    async def queue_yolo_task(self, video_id: str, scene_index: int, image_path: str, scene_path: str):
        """Queue an image for YOLO processing."""
        with self.task_lock:
            self.yolo_tasks_total += 1
        self.yolo_queue.put((video_id, scene_index, image_path, scene_path))

    def yolo_worker(self):
        """Background thread to process images with YOLO."""
        while True:
            try:
                item = self.yolo_queue.get()
                if item is None:
                    break
                
                video_id, scene_index, image_path, scene_path = item
                result = self.process_image_with_yolo(image_path)
                
                if result["success"]:
                    self.update_scene_with_yolo_results(scene_path, scene_index, result)
                
            except Exception as e:
                print(f"Error in YOLO worker thread: {str(e)}")
            finally:
                self.yolo_queue.task_done()
                with self.task_lock:
                    self.yolo_tasks_completed += 1

    def process_image_with_yolo(self, image_path: str):
        """Process an image with YOLOv8 and return the results."""
        if self.__class__.yolo_model is None:
            return {"success": False, "error": "YOLOv8 model not loaded"}
        
        try:
            results = self.__class__.yolo_model(image_path)
            detections = []
            
            for result in results:
                boxes = result.boxes
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    confidence = box.conf[0].item()
                    class_id = int(box.cls[0].item())
                    class_name = result.names[class_id]
                    
                    detection = {
                        "class": class_name,
                        "confidence": round(confidence, 3),
                        "bbox": [round(x, 2) for x in [x1, y1, x2, y2]]
                    }
                    
                    if class_name.lower() in ["title", "page-text", "other-text", "caption"]:
                        detection["needs_ocr"] = True
                        detection["ocr_class"] = class_name.lower()
                    
                    detections.append(detection)
            
            # Merge overlapping text detections
            detections = self.merge_overlapping_detections(detections)
            
            return {
                "success": True,
                "detections": detections
            }
        except Exception as e:
            print(f"Error processing image with YOLO: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }

    def merge_overlapping_detections(self, detections):
        """Merge overlapping text detections."""
        i = 0
        while i < len(detections):
            if not detections[i].get("needs_ocr", False):
                i += 1
                continue
            
            j = i + 1
            merged = False
            while j < len(detections):
                if not detections[j].get("needs_ocr", False):
                    j += 1
                    continue
                
                overlap_score, merged_box = self.calculate_iou_for_merge(
                    detections[i]["bbox"],
                    detections[j]["bbox"]
                )
                
                if merged_box is not None:
                    detections[i]["bbox"] = merged_box
                    if detections[j]["confidence"] > detections[i]["confidence"]:
                        detections[i]["confidence"] = detections[j]["confidence"]
                        detections[i]["class"] = detections[j]["class"]
                        detections[i]["ocr_class"] = detections[j]["ocr_class"]
                    detections.pop(j)
                    merged = True
                else:
                    j += 1
            
            if not merged:
                i += 1
        
        return detections

    def calculate_iou_for_merge(self, box1, box2):
        """Calculate IoU and determine if boxes should be merged."""
        x1_1, y1_1, x2_1, y2_1 = box1
        x1_2, y1_2, x2_2, y2_2 = box2
        
        area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
        area2 = (x2_2 - x1_2) * (y2_2 - y1_2)
        
        x1_i = max(x1_1, x1_2)
        y1_i = max(y1_1, y1_2)
        x2_i = min(x2_1, x2_2)
        y2_i = min(y2_1, y2_2)
        
        if x2_i < x1_i or y2_i < y1_i:
            return 0.0, None
        
        area_i = (x2_i - x1_i) * (y2_i - y1_i)
        iou = area_i / (area1 + area2 - area_i)
        
        containment1 = area_i / area1 if area1 > 0 else 0
        containment2 = area_i / area2 if area2 > 0 else 0
        
        should_merge = iou > 0.7 or containment1 > 0.7 or containment2 > 0.7
        
        if should_merge:
            merged_box = [
                min(x1_1, x1_2),
                min(y1_1, y1_2),
                max(x2_1, x2_2),
                max(y2_1, y2_2)
            ]
            return max(iou, containment1, containment2), merged_box
        
        return iou, None

    def update_scene_with_yolo_results(self, scene_path: str, scene_index: int, result: dict):
        """Update scene data with YOLO detection results."""
        try:
            with open(scene_path, 'r') as f:
                scenes = json.load(f)
            
            if scene_index < len(scenes):
                scenes[scene_index]["yolo_detections"] = result
                
                with open(scene_path, 'w') as f:
                    json.dump(scenes, f)
                
                # Queue OCR tasks if needed
                if result.get('success') and result.get('detections'):
                    self.queue_ocr_tasks(scenes, scene_index, scene_path)
        except Exception as e:
            print(f"Error updating scene with YOLO results: {str(e)}")

    def queue_ocr_tasks(self, scenes, scene_index, scene_path):
        """Queue OCR tasks for text detections."""
        video_id = os.path.splitext(os.path.basename(scene_path))[0]
        scene = scenes[scene_index]
        image_path = f"static/fullsize_images/{video_id}/{scene_index}.jpg"
        
        has_text_detections = False
        for detection_index, detection in enumerate(scene["yolo_detections"]["detections"]):
            if detection.get("needs_ocr"):
                has_text_detections = True
                if self.ocr_preference in ["tesseract", "both"]:
                    if video_id not in self.video_ocr_tasks:
                        self.video_ocr_tasks[video_id] = {}
                    if scene_index not in self.video_ocr_tasks[video_id]:
                        self.video_ocr_tasks[video_id][scene_index] = []
                    
                    self.video_ocr_tasks[video_id][scene_index].append(
                        (detection_index, detection["bbox"], image_path)
                    )
        
        if has_text_detections and self.ocr_preference in ["surya", "both"]:
            if video_id not in self.video_surya_tasks:
                self.video_surya_tasks[video_id] = []
            self.video_surya_tasks[video_id].append((scene_index, image_path))
        
        # Check if this is the last scene and queue all tasks
        if all("yolo_detections" in s for s in scenes):
            if video_id in self.video_ocr_tasks:
                with self.task_lock:
                    # Count all OCR tasks for this video
                    for scene_tasks in self.video_ocr_tasks[video_id].values():
                        self.ocr_tasks_total += len(scene_tasks)
                self.ocr_queue.put((video_id, self.video_ocr_tasks[video_id], scene_path))
                del self.video_ocr_tasks[video_id]
            
            if video_id in self.video_surya_tasks:
                with self.task_lock:
                    self.ocr_tasks_total += len(self.video_surya_tasks[video_id])
                self.ocr_queue.put((video_id, self.video_surya_tasks[video_id], scene_path, "surya_batch"))
                del self.video_surya_tasks[video_id]

    def ocr_worker(self):
        """Background thread to process OCR tasks."""
        while True:
            try:
                item = self.ocr_queue.get()
                if item is None:
                    break
                
                if len(item) == 3:  # Tesseract OCR task
                    video_id, scenes_tasks, scene_path = item
                    task_count = sum(len(tasks) for tasks in scenes_tasks.values())
                    self.process_tesseract_tasks(video_id, scenes_tasks, scene_path)
                    with self.task_lock:
                        self.ocr_tasks_completed += task_count
                elif len(item) == 4 and item[3] == "surya_batch":  # Surya OCR task
                    video_id, surya_tasks, scene_path = item[:3]
                    task_count = len(surya_tasks)
                    self.process_surya_tasks(video_id, surya_tasks, scene_path)
                    with self.task_lock:
                        self.ocr_tasks_completed += task_count
                
            except Exception as e:
                print(f"Error in OCR worker thread: {str(e)}")
            finally:
                self.ocr_queue.task_done()

    async def send_progress_update(self, video_id, data):
        """Send progress update via SSE if the function is available."""
        if self.send_sse_update:
            await self.send_sse_update(video_id, data)

    def process_tesseract_tasks(self, video_id, scenes_tasks, scene_path):
        """Process Tesseract OCR tasks for a video."""
        try:
            with open(scene_path, 'r') as f:
                scenes = json.load(f)
            
            total_tasks = sum(len(tasks) for tasks in scenes_tasks.values())
            completed_tasks = 0
            
            # Send initial progress update
            self.run_async(self.send_progress_update(video_id, {
                "event": "ocr_progress",
                "data": {
                    "type": "tesseract",
                    "total": total_tasks,
                    "completed": completed_tasks,
                    "percent": 0,
                    "message": f"Starting Tesseract OCR processing for {total_tasks} text elements"
                }
            }))
            
            for scene_index, tasks in scenes_tasks.items():
                scene_index = int(scene_index)
                if scene_index >= len(scenes):
                    continue
                
                for detection_index, bbox, image_path in tasks:
                    result = self.perform_tesseract_ocr(image_path, bbox)
                    if result["success"] and "text" in result:
                        if "yolo_detections" in scenes[scene_index]:
                            detections = scenes[scene_index]["yolo_detections"].get("detections", [])
                            if detection_index < len(detections):
                                detections[detection_index]["ocr_text"] = result["text"]
                                detections[detection_index]["ocr_source"] = "tesseract"
                                
                                # Save scenes after each successful OCR to avoid losing progress
                                with open(scene_path, 'w') as f:
                                    json.dump(scenes, f)
                    
                    # Update progress
                    completed_tasks += 1
                    percent_complete = int((completed_tasks / total_tasks) * 100)
                    
                    # Send progress update
                    self.run_async(self.send_progress_update(video_id, {
                        "event": "ocr_progress",
                        "data": {
                            "type": "tesseract",
                            "total": total_tasks,
                            "completed": completed_tasks,
                            "percent": percent_complete,
                            "scene_index": scene_index,
                            "message": f"Processed {completed_tasks} of {total_tasks} text elements ({percent_complete}%)",
                            "partial_results": self.extract_ocr_results_for_scene(scenes, scene_index)
                        }
                    }))
            
            # Send completion update
            self.run_async(self.send_progress_update(video_id, {
                "event": "ocr_complete",
                "data": {
                    "type": "tesseract",
                    "total": total_tasks,
                    "completed": completed_tasks,
                    "message": f"Completed Tesseract OCR processing for {total_tasks} text elements",
                    "final_results": self.extract_ocr_results(scenes)
                }
            }))
            
        except Exception as e:
            print(f"Error processing Tesseract OCR tasks: {str(e)}")
            # Send error update
            self.run_async(self.send_progress_update(video_id, {
                "event": "ocr_error",
                "data": {
                    "type": "tesseract",
                    "error": str(e)
                }
            }))

    def perform_tesseract_ocr(self, image_path, bbox):
        """Perform OCR on a specific region of an image."""
        try:
            image = Image.open(image_path)
            x1, y1, x2, y2 = bbox
            cropped = image.crop((x1, y1, x2, y2))
            text = pytesseract.image_to_string(cropped)
            text = ' '.join(text.split())
            
            return {
                "success": True,
                "text": text
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def process_surya_tasks(self, video_id, surya_tasks, scene_path):
        """Process Surya OCR tasks for a video."""
        if not SURYA_AVAILABLE:
            return
        
        try:
            with open(scene_path, 'r') as f:
                scenes = json.load(f)
            
            total_tasks = len(surya_tasks)
            completed_tasks = 0
            
            # Send initial progress update
            self.run_async(self.send_progress_update(video_id, {
                "event": "ocr_progress",
                "data": {
                    "type": "surya",
                    "total": total_tasks,
                    "completed": completed_tasks,
                    "percent": 0,
                    "message": f"Starting Surya OCR processing for {total_tasks} scenes"
                }
            }))
            
            for scene_index, image_path in surya_tasks:
                result = self.process_image_with_surya(image_path)
                if result["success"] and "results" in result:
                    self.update_scene_with_surya_results(scenes, scene_index, result["results"])
                    
                    # Save scenes after each successful OCR to avoid losing progress
                    with open(scene_path, 'w') as f:
                        json.dump(scenes, f)
                
                # Update progress
                completed_tasks += 1
                percent_complete = int((completed_tasks / total_tasks) * 100)
                
                # Send progress update
                self.run_async(self.send_progress_update(video_id, {
                    "event": "ocr_progress",
                    "data": {
                        "type": "surya",
                        "total": total_tasks,
                        "completed": completed_tasks,
                        "percent": percent_complete,
                        "scene_index": scene_index,
                        "message": f"Processed {completed_tasks} of {total_tasks} scenes ({percent_complete}%)",
                        "partial_results": self.extract_ocr_results_for_scene(scenes, scene_index)
                    }
                }))
            
            # Send completion update
            self.run_async(self.send_progress_update(video_id, {
                "event": "ocr_complete",
                "data": {
                    "type": "surya",
                    "total": total_tasks,
                    "completed": completed_tasks,
                    "message": f"Completed Surya OCR processing for {total_tasks} scenes",
                    "final_results": self.extract_ocr_results(scenes)
                }
            }))
            
        except Exception as e:
            print(f"Error processing Surya OCR tasks: {str(e)}")
            # Send error update
            self.run_async(self.send_progress_update(video_id, {
                "event": "ocr_error",
                "data": {
                    "type": "surya",
                    "error": str(e)
                }
            }))

    def process_image_with_surya(self, image_path):
        """Process an image with Surya OCR."""
        if not SURYA_AVAILABLE:
            return {"success": False, "error": "Surya OCR not available"}
        
        try:
            image = Image.open(image_path)
            predictions = self.__class__.surya_recognition_predictor([image], [None], self.__class__.surya_detection_predictor)
            
            if not predictions:
                return {"success": True, "results": []}
            
            results = []
            ocr_result = predictions[0]
            
            if hasattr(ocr_result, 'text_lines'):
                for text_line in ocr_result.text_lines:
                    if text_line.confidence < self.surya_confidence_threshold:
                        continue
                    
                    if hasattr(text_line, 'polygon'):
                        x_coords = [point[0] for point in text_line.polygon]
                        y_coords = [point[1] for point in text_line.polygon]
                        bbox = [min(x_coords), min(y_coords), max(x_coords), max(y_coords)]
                    elif hasattr(text_line, 'bbox'):
                        bbox = text_line.bbox
                    else:
                        continue
                    
                    results.append({
                        "text": text_line.text,
                        "confidence": text_line.confidence,
                        "bbox": [float(coord) for coord in bbox],
                        "matched": False
                    })
            
            return {"success": True, "results": results}
            
        except Exception as e:
            return {"success": False, "error": str(e)}

    def update_scene_with_surya_results(self, scenes, scene_index, surya_results):
        """Update scene data with Surya OCR results."""
        if scene_index >= len(scenes):
            return
        
        scene = scenes[scene_index]
        if "yolo_detections" in scene and scene["yolo_detections"].get("success", False):
            detections = scene["yolo_detections"].get("detections", [])
            
            for surya_result in surya_results:
                surya_bbox = surya_result["bbox"]
                matches = []
                
                for i, detection in enumerate(detections):
                    if detection.get("needs_ocr", False):
                        yolo_bbox = detection.get("bbox", [0, 0, 0, 0])
                        iou = self.calculate_iou(surya_bbox, yolo_bbox)
                        
                        if iou > 0.3:
                            matches.append({
                                "index": i,
                                "iou": iou,
                                "class": detection.get("class", ""),
                                "ocr_class": detection.get("ocr_class", "text")
                            })
                
                if matches:
                    matches.sort(key=lambda x: x["iou"], reverse=True)
                    surya_result["matched"] = True
                    surya_result["matches"] = matches
                    
                    for match in matches:
                        detection_index = match["index"]
                        detections[detection_index]["ocr_text"] = surya_result["text"]
                        detections[detection_index]["ocr_source"] = "surya"
                        detections[detection_index]["match_iou"] = match["iou"]
        
        scene["surya_ocr"] = {
            "success": True,
            "results": surya_results
        }

    def calculate_iou(self, box1, box2):
        """Calculate Intersection over Union between two boxes."""
        x1_1, y1_1, x2_1, y2_1 = box1
        x1_2, y1_2, x2_2, y2_2 = box2
        
        x1_i = max(x1_1, x1_2)
        y1_i = max(y1_1, y1_2)
        x2_i = min(x2_1, x2_2)
        y2_i = min(y2_1, y2_2)
        
        if x2_i < x1_i or y2_i < y1_i:
            return 0.0
        
        intersection = (x2_i - x1_i) * (y2_i - y1_i)
        box1_area = (x2_1 - x1_1) * (y2_1 - y1_1)
        box2_area = (x2_2 - x1_2) * (y2_2 - y1_2)
        
        return intersection / (box1_area + box2_area - intersection)

    async def get_ocr_text(self, video_id: str):
        """Get all OCR text from a video's scenes."""
        scene_path = f"static/scenes/{video_id}.json"
        if not os.path.exists(scene_path):
            return JSONResponse({
                "success": False,
                "error": "Scene data not found"
            })
        
        try:
            with open(scene_path, 'r') as f:
                scenes = json.load(f)
            
            ocr_results = []
            pending_ocr_count = 0
            
            for scene_index, scene in enumerate(scenes):
                added_from_yolo = set()
                
                if "yolo_detections" in scene and scene["yolo_detections"].get("success", False):
                    detections = scene["yolo_detections"].get("detections", [])
                    
                    for detection_index, detection in enumerate(detections):
                        if detection.get("needs_ocr", False) and "ocr_text" not in detection:
                            pending_ocr_count += 1
                        
                        if "ocr_text" in detection and detection["ocr_text"].strip():
                            if detection.get("ocr_source", "") == "tesseract" or "match_iou" not in detection:
                                ocr_results.append(self.format_ocr_result(scene, scene_index, detection))
                                added_from_yolo.add(detection_index)
                
                if "surya_ocr" in scene and scene["surya_ocr"].get("success", True):
                    surya_results = scene["surya_ocr"].get("results", [])
                    
                    for result in surya_results:
                        if not result.get("matched", False) and result.get("text", "").strip():
                            ocr_results.append(self.format_surya_result(scene, scene_index, result))
            
            return JSONResponse({
                "success": True,
                "ocr_count": len(ocr_results),
                "ocr_results": ocr_results,
                "pending_ocr_count": pending_ocr_count,
                "processing_complete": pending_ocr_count == 0
            })
            
        except Exception as e:
            return JSONResponse({
                "success": False,
                "error": str(e)
            })

    def format_ocr_result(self, scene, scene_index, detection):
        """Format OCR result from YOLO detection."""
        return {
            "scene_index": scene_index,
            "timestamp": scene.get("timestamp", "00:00"),
            "time_seconds": scene.get("time_seconds", 0),
            "text": detection["ocr_text"],
            "confidence": detection.get("confidence", 0),
            "bbox": detection.get("bbox", []),
            "ocr_class": detection.get("ocr_class", "text"),
            "ocr_source": detection.get("ocr_source", "tesseract"),
            "matched": True,
            "match_iou": detection.get("match_iou", 1.0)
        }

    def format_surya_result(self, scene, scene_index, result):
        """Format Surya OCR result."""
        return {
            "scene_index": scene_index,
            "timestamp": scene.get("timestamp", "00:00"),
            "time_seconds": scene.get("time_seconds", 0),
            "text": result["text"],
            "confidence": result.get("confidence", 0),
            "bbox": result.get("bbox", []),
            "ocr_class": "unmatched",
            "ocr_source": "surya",
            "matched": False
        }

    async def process_surya_ocr(self, video_id: str):
        """Trigger Surya OCR processing for a video."""
        if not SURYA_AVAILABLE:
            return JSONResponse({
                "success": False,
                "error": "Surya OCR is not available"
            })
        
        scene_path = f"static/scenes/{video_id}.json"
        if not os.path.exists(scene_path):
            return JSONResponse({
                "success": False,
                "error": "Scene data not found"
            })
        
        try:
            with open(scene_path, 'r') as f:
                scenes = json.load(f)
            
            surya_tasks = []
            for i, scene in enumerate(scenes):
                if "fullsize" in scene:
                    image_path = f"static/fullsize_images/{video_id}/{i}.jpg"
                    if os.path.exists(image_path):
                        surya_tasks.append((i, image_path))
            
            if surya_tasks:
                self.ocr_queue.put((video_id, surya_tasks, scene_path, "surya_batch"))
            
            return JSONResponse({
                "success": True,
                "message": f"Queued {len(surya_tasks)} images for Surya OCR processing"
            })
            
        except Exception as e:
            return JSONResponse({
                "success": False,
                "error": str(e)
            })

    async def set_preference(self, preference: str):
        """Set the OCR preference."""
        if preference not in ["tesseract", "surya", "both"]:
            return JSONResponse({
                "success": False,
                "error": "Invalid preference"
            })
        
        self.ocr_preference = preference
        return JSONResponse({
            "success": True,
            "message": f"OCR preference set to {preference}"
        })

    def get_preference(self):
        """Get the current OCR preference."""
        return self.ocr_preference

    def extract_ocr_results_for_scene(self, scenes, scene_index):
        """Extract OCR results for a specific scene."""
        if scene_index >= len(scenes):
            return []
        
        scene = scenes[scene_index]
        ocr_results = []
        
        # Get OCR results from YOLO detections
        if "yolo_detections" in scene and scene["yolo_detections"].get("success", False):
            detections = scene["yolo_detections"].get("detections", [])
            
            for detection in detections:
                if "ocr_text" in detection and detection["ocr_text"].strip():
                    ocr_results.append(self.format_ocr_result(scene, scene_index, detection))
        
        # Get Surya OCR results
        if "surya_ocr" in scene and scene["surya_ocr"].get("success", True):
            surya_results = scene["surya_ocr"].get("results", [])
            
            for result in surya_results:
                if not result.get("matched", False) and result.get("text", "").strip():
                    ocr_results.append(self.format_surya_result(scene, scene_index, result))
        
        return ocr_results

    def extract_ocr_results(self, scenes):
        """Extract all OCR results from scenes."""
        ocr_results = []
        
        for scene_index, scene in enumerate(scenes):
            scene_results = self.extract_ocr_results_for_scene(scenes, scene_index)
            ocr_results.extend(scene_results)
        
        return ocr_results

    async def wait_for_completion(self):
        """Wait for all queued YOLO and OCR tasks to complete."""
        while True:
            with self.task_lock:
                yolo_done = self.yolo_tasks_completed >= self.yolo_tasks_total
                ocr_done = self.ocr_tasks_completed >= self.ocr_tasks_total
                
                if yolo_done and ocr_done:
                    print(f"All tasks completed: YOLO {self.yolo_tasks_completed}/{self.yolo_tasks_total}, OCR {self.ocr_tasks_completed}/{self.ocr_tasks_total}")
                    return
            
            await asyncio.sleep(1)
            
    async def get_task_status(self):
        """Get the current status of YOLO and OCR tasks."""
        with self.task_lock:
            return {
                "yolo_total": self.yolo_tasks_total,
                "yolo_completed": self.yolo_tasks_completed,
                "ocr_total": self.ocr_tasks_total,
                "ocr_completed": self.ocr_tasks_completed,
                "all_complete": (self.yolo_tasks_completed >= self.yolo_tasks_total and 
                                self.ocr_tasks_completed >= self.ocr_tasks_total)
            } 