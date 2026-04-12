# Audio handling

Audio has to feel simple in the UI, even though Asterisk is picky about file formats.

## What users can upload

The UI should accept common formats:

- `mp3`
- `wav`
- `m4a`
- `ogg`
- `flac`

Users should not need to know what Asterisk wants internally.

## What Asterisk needs

For predictable playback, the system should normalize uploaded audio into Asterisk-safe output such as:

- `wav` for source-quality archival when useful
- `ulaw` or `gsm` versions for telephony playback depending on configured codec support

Exact output formats may vary by deployment, but the product should choose a standard internal set and generate those automatically.

## Conversion flow

1. User uploads a file through the UI
2. Backend stores the original file in `storage/audio/originals`
3. A background job sends the file through `ffmpeg`
4. The job creates normalized output files in `storage/audio/converted`
5. Metadata is written to the database: original name, MIME type, duration, converted paths, sample rate, and status
6. The UI shows the file as ready when conversion succeeds

If conversion fails:

- Keep the original file for inspection
- Mark the asset as failed
- Show the user a clear error message

## File storage

Suggested storage layout:

- `storage/audio/originals`
  Raw user uploads
- `storage/audio/converted`
  Generated playback files used by Asterisk
- `storage/audio/tts`
  Generated speech files from text input

The database should store logical asset references, not hard-coded UI paths. Asterisk should mount the converted output path into its sounds directory.

## TTS flow

The default offline TTS engine should be `Piper`.

Flow:

1. User opens `Create from text`
2. User enters text and picks a voice
3. Backend runs a TTS job with Piper
4. The generated file is saved into `storage/audio/tts`
5. The file is then normalized through the same audio pipeline as uploaded files
6. The finished asset appears in the audio library like any other audio file

This matters because uploaded files and TTS files should behave the same once they are ready. The flow builder should not care where a prompt came from.

## Preview in the UI

The UI should let users preview audio before using it in a flow.

Preview behavior:

- Play from the browser using the converted preview-safe file
- Show duration and source type: uploaded or TTS
- Show conversion status if still processing
- Let the user test the exact file attached to a node from the node settings panel

## Deletion and replacement

Deleting an audio file should be blocked if it is used in a published flow, unless the user replaces it first.

Replacing an audio file should:

- Keep the same logical asset ID if the user chooses replace
- Re-run conversion
- Update future playbacks without forcing the user to rewire every node

That replacement path is important for agencies and businesses that update greetings often.
