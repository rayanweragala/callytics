# Audio handling

Audio is now an implemented part of the product, not just a future design note. The current system supports upload, offline TTS generation, conversion, browser preview, and telephony playback.

## What users can do now

- Upload audio from the `/audio` page
- Generate new prompts from text with offline Piper TTS
- Browse the paginated audio library
- Preview ready assets in the browser
- Delete assets through the UI when they are not used by a published flow
- Select audio assets from the flow builder node config panel

## Current backend endpoints

- `GET /audio?page=X&limit=Y`
- `GET /audio/:id`
- `POST /audio/upload`
- `POST /audio/tts`
- `GET /audio/voices`
- `DELETE /audio/:id`

`GET /audio` currently returns the paginated envelope:

- `data`
- `total`
- `page`
- `limit`
- `totalPages`

## Actual storage layout

Current storage paths under the backend-mounted `./storage` directory:

- `storage/audio/originals`
  Source uploads and raw generated TTS WAV files
- `storage/audio/converted`
  Telephony WAV files used by Asterisk playback
- `storage/audio/previews`
  Browser-preview WAV files served by NestJS
- `storage/audio/tts`
  Intermediate/generated TTS working files
- `storage/audio/voices`
  Voice model files available inside the backend runtime

The backend container mounts `./storage` at `/app/storage`.

## Current conversion pipeline

When audio is uploaded or generated with TTS:

1. NestJS creates an `audio_files` record
2. The original or generated source file is written into `storage/audio/...`
3. `ffmpeg` creates:
   - a telephony WAV in `storage/audio/converted`
   - a preview WAV in `storage/audio/previews`
4. The database record is updated with duration, converted path, preview path, and status
5. The browser uses the preview WAV, while Asterisk uses the telephony WAV

The current telephony output is generated with:

- `8000 Hz`
- mono
- `pcm_mulaw`

The current preview output is generated with:

- `22050 Hz`
- mono
- `pcm_s16le`

## Static media serving

NestJS serves stored media through `/media/audio/...`.

Current path patterns include:

- `/media/audio/originals/...`
- `/media/audio/previews/...`
- `/media/audio/converted/...`
- `/media/audio/tts/...`

These URLs are returned by the backend for the browser preview player.

## Piper TTS runtime

Offline TTS now runs inside the backend container.

Current backend image/runtime facts:

- base image: `node:20-bookworm-slim`
- installed tools: `python3`, `python3-pip`, `ffmpeg`, `piper-tts`
- bundled voice model files live in `backend/voices/`
- backend image copies bundled voice files into the runtime audio voices path

The current bundled voice model is:

- `en_US-lessac-medium`

`GET /audio/voices` currently serves the local voice catalog used by the frontend voice picker.

## Asterisk playback path

Asterisk does not read browser preview files directly. It reads the converted telephony assets through the mounted sounds directory:

- host path: `./storage/audio/converted`
- container path: `/var/lib/asterisk/sounds/callytics`

This is why telephony playback can use `sound:callytics/<id>` while the browser preview uses `/media/audio/...`.

## Runtime resolution in Stasis

The Stasis runtime now resolves audio assets from the database through `audioResolver.ts`.

Current behavior:

- `play_audio` first tries `audio_file_id`
- `get_digits` first tries `prompt_audio_file_id`
- If a ready `audio_files.storage_path_converted` row exists, the runtime maps it to `sound:callytics/<basename>`
- If no database-backed asset is available, the runtime falls back to the static path fields:
  - `audio_file_path`
  - `prompt_path`

That keeps existing built-in prompt paths working while allowing real audio asset management through the database-backed flow builder.
