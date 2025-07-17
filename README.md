# Slide Video Lecture Analysis Toolkit 

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.7+-blue.svg)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.68+-green.svg)](https://fastapi.tiangolo.com)

## Overview

**Slide Video Lecture Analysis Toolkit** is a multimedia analysis platform for educational content processing, particularly slide-based lecture videos and presentations. The system combines computer vision, natural language processing, and machine learning techniques to provide automated video analysis, transcript generation, slide text extraction, and content relationships discovery.

![Demo](demo.gif)

### Key Features

- **Scene Detection**: Automated scene segmentation using adaptive and content-based detection algorithms
- **Dual OCR Systems**: Integration of both Tesseract and Surya OCR for text extraction from slides
- **Multi-Source Transcription**: YouTube transcript extraction and Whisper-based speech recognition
- **Semantic Embeddings**: Sentence-BERT based semantic similarity for transcript-OCR alignment
- **YOLO Object Detection**: Custom-trained YOLOv8 model for slide content detection (`slidevqa_best.pt`)
- **AI-Powered Summarization**: Google Gemini integration for chapter generation
- **Web Interface**: FastAPI-based web application with real-time updates

## Interactive User Interface

The Video Lecture Analysis Toolkit features a web interface designed as an interactive dashboard for exploring analyzed lecture content with multiple synchronized views:

### Main Interface Components

**Video Player and Timelines**: The central video player includes an event timeline that marks slide transitions, chapter breaks, and search results. A visual timeline with clickable scene thumbnails provides navigation through the presentation's visual flow.

**Content Navigation Panel**: A vertical tabbed interface provides access to:
- **Transcript Tab**: Timestamped transcript with click-to-seek functionality
- **Chapters Tab**: AI-generated chapter markers for navigation  
- **Scene Changes Tab**: Log of detected scene transitions
- **Slide Content Tab**: OCR-extracted text from slides with temporal alignment

**Integrated Search**: Search functionality that queries both spoken transcript and OCR-extracted visual text

### The Interactive Layer

**Content Customization**: Users can directly manipulate visual components overlaid on the video player:
- **Element Control**: Move, resize, or completely hide detected elements (presenter video, text boxes, images)
- **Accessibility Features**: Reduce visual clutter and cognitive load for neurodivergent users
- **Focus Enhancement**: Hide presenter to focus on slides, or enlarge specific diagrams

**Semantic Link Visualization**: 
- **Bidirectional Highlighting**: When transcript segments play, related slide text is highlighted
- **Interactive Exploration**: Clicking slide text boxes highlights corresponding transcript sentences
- **Cross-Modal Links**: Shows connections between spoken and visual information

### User Experience Features

- **Visual Clutter Reduction**: Customizable interface elements for cognitive load management
- **Multimodal Navigation**: Switch between audio, visual, and textual content modes


## Installation and Setup

### Prerequisites

- **Python>=3.10+** with pip package manager
- **CUDA-capable GPU** (recommended for optimal performance)
- **FFmpeg** for video processing
- **Tesseract OCR** for text extraction
- **Google API Key** for Gemini AI integration

### System Dependencies

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install tesseract-ocr tesseract-ocr-eng ffmpeg
```

**macOS:**
```bash
brew install tesseract ffmpeg
```

**Windows:**
- Install Tesseract from: https://github.com/UB-Mannheim/tesseract/wiki
- Install FFmpeg from: https://ffmpeg.org/download.html

### Python Environment Setup

1. **Clone the repository:**
   ```bash
   git clone <repository_url>
   cd slideDec
   ```

2. **Create virtual environment:**
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

### Configuration

1. **Set up Google Gemini API:**
   ```bash
   # Create .env file
   echo "GOOGLE_API_KEY=your_api_key_here" > .env
   ```
   Get your API key from: https://makersuite.google.com/app/apikey

2. **Configure Tesseract (if not in PATH):**
   ```python
   # In main.py, uncomment and modify:
   # pytesseract.pytesseract.tesseract_cmd = r'/usr/bin/tesseract'
   ```

### Model Files

The system requires pre-trained models (included in repository):
- `slidecraft_best.pt` - Alternative slide detection model

## Usage

### Quick Start

1. **Launch the application:**
   ```bash
   # For modular version (recommended)
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

2. **Access the web interface:**
   Open your browser to: http://localhost:8000

3. **Process content:**
   - **YouTube Videos**: Paste URL and click "Load Video"
   - **Local Files**: Upload video files directly
   - **Real-time Processing**: Monitor progress via live updates

### Advanced Usage Examples

#### 1. YouTube Video Analysis
```bash
# Navigate to http://localhost:8000
# Enter YouTube URL: https://www.youtube.com/watch?v=example_id
# System automatically:
# - Downloads video 
# - Extracts YouTube transcript
# - Detects scenes and extracts keyframes
# - Perform slide visual analysis
# - Performs OCR on slides
# - Generates semantic embeddings
# - Creates chapter summaries
```

#### 2. Local Video Processing
```bash
# Upload local video file via web interface
# System processes identically to YouTube content
# Supports: MP4, AVI, MOV, MKV formats
```

#### 3. API Integration
```python
import requests

# Process YouTube video
response = requests.post("http://localhost:8000/process_youtube", 
                        json={"url": "https://youtube.com/watch?v=example"})

# Get transcript-OCR relationships
relationships = requests.get("http://localhost:8000/get_transcript_ocr_relationships/video_id")

# Find OCR text for specific transcript segment
ocr_text = requests.get("http://localhost:8000/find_ocr_for_transcript/video_id/5")
```

### Core Functionality

#### Scene Detection and Analysis
- **Adaptive Detection**: Automatically identifies scene transitions
- **Content-based Segmentation**: Detects visual changes in presentation slides
- **Keyframe Extraction**: Saves representative frames for each scene
- **Thumbnail Generation**: Creates navigation thumbnails

#### OCR Text Extraction
- **Dual OCR Support**: Tesseract and Surya OCR engines
- **Preference System**: User-configurable OCR method selection
- **Bounding Box Detection**: Precise text location mapping
- **Quality Filtering**: Confidence-based text filtering

#### Transcript Processing
- **Multi-source Support**: YouTube transcripts and Whisper STT
- **Temporal Alignment**: Precise timestamp synchronization

#### Semantic Embeddings
- **Sentence-BERT**: Advanced semantic similarity computation
- **FAISS Indexing**: Efficient similarity search
- **Temporal Mapping**: Scene-transcript synchronization

## Technical Specifications

### Performance Characteristics
- **Processing Speed**: ~1-2x real-time for typical lecture videos
- **Memory Usage**: 2-4GB RAM for standard processing
- **GPU Acceleration**: CUDA support for Whisper and YOLO models
- **Concurrent Processing**: Multi-threaded scene and OCR analysis

## Slide Visual Analysis


### Supported Formats
- **Input Videos**: MP4, AVI, MOV, MKV, WebM

### API Endpoints

#### Core Processing
- `POST /process_youtube` - Process YouTube video
- `POST /upload_video` - Upload and process local video
- `GET /scenes/{video_id}` - Retrieve scene information
- `GET /video/{video_id}` - Stream processed video

#### OCR and Text Analysis
- `GET /ocr_text/{video_id}` - Get extracted OCR text
- `POST /process_surya_ocr/{video_id}` - Run Surya OCR
- `POST /set_ocr_preference` - Configure OCR engine

#### Transcript Processing
- `GET /get_transcript/{video_id}/{source}` - Retrieve transcripts
- `POST /generate_whisper_transcript/{video_id}` - Generate Whisper transcript
- `GET /whisper_transcript_status/{video_id}` - Check processing status

#### Embeddings and Relationships
- `POST /compute_embeddings/{video_id}` - Generate semantic embeddings
- `GET /get_transcript_ocr_relationships/{video_id}` - Get alignment data
- `GET /find_ocr_for_transcript/{video_id}/{index}` - Find related OCR text
- `GET /find_scene_for_transcript/{video_id}/{index}` - Find corresponding scenes


## Dependencies and Licenses

### Core Dependencies
```
fastapi              # Web framework (MIT License)
uvicorn             # ASGI server (BSD License)
yt-dlp              # YouTube downloader (Unlicense)
youtube-transcript-api # Transcript extraction (MIT License)
ultralytics         # YOLOv8 models (AGPL-3.0)
sentence-transformers # Semantic embeddings (Apache 2.0)
faster-whisper      # Speech recognition (MIT License)
google-generativeai # Gemini AI (Apache 2.0)
surya-ocr           # Advanced OCR (GPL-3.0)
opencv-python       # Computer vision (BSD License)
scenedetect         # Scene detection (BSD License)
faiss-cpu           # Similarity search (MIT License)
```

### License Compatibility
- **Academic Use**: All components free for research and educational purposes
- **Commercial Use**: Review individual component licenses (some GPL/AGPL restrictions)
- **Distribution**: Include all license files when redistributing

## Performance Optimization

### Docker Deployment
```dockerfile
FROM python:3.9-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    tesseract-ocr tesseract-ocr-eng ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy and install requirements
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy application
COPY . /app
WORKDIR /app

# Expose port
EXPOSE 8000

# Run application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Production Configuration
```bash
# High-performance deployment
uvicorn main:app --workers 4 --host 0.0.0.0 --port 8000 --access-log

# With SSL (recommended for production)
uvicorn main:app --host 0.0.0.0 --port 443 --ssl-keyfile key.pem --ssl-certfile cert.pem
```

## Troubleshooting

### Common Issues

**CUDA/GPU Issues:**
```bash
# Verify CUDA installation
nvidia-smi
python -c "import torch; print(torch.cuda.is_available())"
```

**Tesseract Not Found:**
```bash
# Ubuntu/Debian
sudo apt-get install tesseract-ocr tesseract-ocr-eng

# Set explicit path in code if needed
pytesseract.pytesseract.tesseract_cmd = '/usr/bin/tesseract'
```

**YouTube Download Errors:**
```bash
# Update yt-dlp
pip install --upgrade yt-dlp

# Check video availability and region restrictions
```

**Memory Issues:**
- Reduce batch sizes in configuration
- Process shorter video segments
- Use CPU-only inference if GPU memory limited


### Acknowledgments
- **YOLOv8**: Ultralytics team for object detection framework
- **Whisper**: OpenAI for speech recognition technology
- **Sentence-BERT**: UKP Lab for semantic embeddings
- **Surya OCR**: VikParuchuri for advanced OCR capabilities
- **FastAPI**: Sebastian Ramirez for the excellent web framework

---

**License**: MIT License - see [LICENSE](LICENSE) file for details.
