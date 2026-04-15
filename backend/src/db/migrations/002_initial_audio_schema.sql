CREATE TABLE IF NOT EXISTS audio_files (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  original_filename VARCHAR(255),
  mime_type VARCHAR(255),
  duration_ms INTEGER,
  storage_path_original TEXT,
  storage_path_converted TEXT,
  storage_path_preview TEXT,
  conversion_status VARCHAR(50) DEFAULT 'pending',
  tts_text TEXT,
  tts_voice VARCHAR(255),
  speed FLOAT DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
