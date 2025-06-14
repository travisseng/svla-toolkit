from faster_whisper import WhisperModel, BatchedInferencePipeline

def convert_to_srt_time(time_in_seconds):
    hours, remainder = divmod(time_in_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    milliseconds = (seconds - int(seconds)) * 1000
    return f"{int(hours):02}:{int(minutes):02}:{int(seconds):02},{int(milliseconds):03}"


def timestamps_to_srt(word_timestamps):
    sentences = []
    sentence = ""
    start_time = 0
    
    for i, word_info in enumerate(word_timestamps):
        if sentence == "":  # For the start of a new sentence, set start_time
            start_time = word_info["start"]
        word = word_info["word"]
        sentence += "" + word  # Add space before words except after commas
        
        # Check for sentence end or last word in the list
        if "." in word or "?" in word or "!" in word or i == len(word_timestamps) - 1:
            sentences.append({"sentence": sentence.strip(), "start": start_time, "end": word_info["end"]})
            sentence = ""  # Reset sentence for the next loop
    
    # Convert sentences to .srt format
    srt_format_corrected = ""
    for index, sent in enumerate(sentences):
        start_srt = convert_to_srt_time(sent["start"])
        end_srt = convert_to_srt_time(sent["end"])
        srt_format_corrected += f"{index + 1}\n{start_srt} --> {end_srt}\n{sent['sentence']}\n\n"
    
    return srt_format_corrected


def transcribe_audio(file_path, batch_size=16):
    """
    Transcribe audio file and yield sentences as they are processed.
    
    Args:
        file_path: Path to the audio or video file
        batch_size: Batch size for inference
        
    Yields:
        Tuple of (formatted SRT string, progress percentage)
    """
    model = WhisperModel("turbo", device="cuda", compute_type="float16")
    batched_model = BatchedInferencePipeline(model=model)
    segments, info = batched_model.transcribe(file_path, batch_size=batch_size, word_timestamps=True, log_progress=True)
    total_duration = info.duration
    print(total_duration)
    
    processed_duration = 0
    for segment in segments:
        # Extract words from the segment
        words = segment.words
        
        # Create a dictionary for each word with start, end, word, and probability
        word_list = []
        for word in words:
            word_list.append({
                "start": float(word.start),
                "end": float(word.end),
                "word": word.word,
                "probability": float(word.probability)
            })
        
        # Update processed duration based on the last word's end time
        if word_list:
            processed_duration = max(processed_duration, word_list[-1]["end"])
        
        # Calculate progress percentage
        progress = min(100, (processed_duration / total_duration) * 100) if total_duration > 0 else 0
        
        # Use the timestamps_to_srt function to process words into sentences
        sentence_data = timestamps_to_srt(word_list)
        yield sentence_data, progress


# Example usage:
# for sentence, progress in transcribe_audio("static/videos/zjkBMFhNj_g.mp4"):
# for sentence, progress in transcribe_audio("static/videos/6ad049c5_bd75_4e3f_9e88_a740ae5f1981.mp4"):
#     print(f"Progress: {progress:.2f}%")
#     print(sentence)