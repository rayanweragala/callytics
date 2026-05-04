# Call Recordings

Call Recordings give you a central library for reviewing recorded conversations. When recording is enabled for supported call paths, Callytics records bridged calls such as transfers, queue calls, and hunt group calls.

You can review calls directly in the browser, download them for external handling, or delete them when they are no longer needed.

Each recording includes useful context such as caller details, duration, and timestamp so you can find the right file without guessing from filenames.

## How recordings work

### What gets recorded

Recording only happens on bridged calls. The following call paths support recording:

- **Transfer node** — recording starts when `record_call` is enabled on the node
- **Queue node** — recording starts when `record_call` is enabled on the node
- **Hunt Group node** — recording starts when `record_call` is enabled on the node
- **Direct outbound calls** — recorded when `record_outbound_calls` is enabled in Settings

IVR audio playback from the Play Audio node is never recorded, regardless of any recording settings elsewhere in the flow.

### Bridge recording

For Transfer, Queue, and Hunt Group calls, Stasis starts a bridge recording by calling the ARI endpoint:

```
POST /ari/bridges/{bridgeId}/record
```

This records the mixed audio of both call participants. Recordings are saved as `.wav` files.

### Voicemail recording

For Voicemail nodes, Stasis calls the ARI channel recording endpoint directly on the caller's channel. Voicemail recordings are saved as `.ulaw` files.

### Storage

All recording files are stored in the Docker volume `asterisk_recordings`. This volume is mounted at `/var/lib/asterisk/recording` in both the Asterisk container and the backend container. The backend reads files from this shared path when serving playback and download requests.

| Call type | Format | ARI endpoint used |
|---|---|---|
| Transfer, Queue, Hunt Group | `.wav` | `POST /ari/bridges/{bridgeId}/record` |
| Voicemail | `.ulaw` | ARI channel recording endpoint |

## Capabilities

- Automatic recording on supported bridged calls when enabled
- Recording support for transfer calls
- Recording support for queue calls
- Recording support for hunt group calls
- Paginated recordings library
- Inline browser playback
- Direct file download
- Delete with confirmation
- Recording metadata including caller, duration, and timestamp
