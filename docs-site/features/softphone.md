# Browser Softphone

The browser softphone is an in-browser SIP softphone built into Callytics. You do not need a separate desktop or mobile app to receive calls from inside the dashboard.

It uses the operator's linked SIP extension and connects over WebSocket to the Asterisk WebRTC transport.

## How to use it

1. Click the phone bubble in the bottom-right corner of the dashboard.
2. Select the operator you want to use.
3. Click `Connect`.
4. Wait until the status changes to `Registered`.

Once the status shows `Registered`, that browser session is available to receive calls for that extension.

## Receiving calls

When an incoming call reaches the selected extension:

- The bubble pulses green.
- The softphone panel opens.
- `Answer` and `Reject` buttons appear.

If you click `Answer`, the browser accepts the call and attaches the remote audio stream to the page audio output.

## During a call

While the call is active:

- The call timer counts up from `00:00`.
- `Hangup` ends the active session.
- `Mute` disables your local microphone until you click `Unmute`.

## Outbound calling

Operators can place outbound calls directly from the softphone bubble.

1. Type an extension number or external number into the dial field.
2. Click `Call`.
3. While the destination is ringing, the softphone shows `Calling...` with a `Cancel` button.
4. Once the other side answers, the live call view appears with the timer plus `Hangup` and `Mute` controls.

## Limitations

- Refreshing the browser disconnects the softphone. After a refresh, click `Connect` again so the browser re-registers.
- Local development currently expects plain `http` and `ws` usage. Production TLS support for secure `https` and `wss` WebRTC deployment is a future phase.

## Using it with Zoiper or Linphone

The browser softphone works alongside Zoiper, Linphone, or another SIP client on the same extension credentials.

Both endpoints can stay registered at the same time, but only one endpoint will ring for a given incoming call. If you need predictable ringing behavior, use separate extensions per device.
