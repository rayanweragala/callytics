# IVR Flow Builder

IVR Flow Builder is the visual editor for designing how calls move through Callytics. Teams can build call routing with a drag-and-drop canvas instead of editing dialplan text, making it easier to design menus, queues, transfers, voicemail paths, and after-hours behavior.

Flows use a draft and publish model so changes can be prepared safely before they affect live calls. Published versions are tracked, and older versions can be restored with one click when a previous routing setup needs to be recovered.

Before a flow is published, Callytics validates the nodes and connections to catch missing configuration or invalid routing. The canvas also includes a minimap and auto-layout tools for keeping large call flows understandable.

## Capabilities

- Drag-and-drop call flow canvas
- Draft editing before publishing to live calls
- Flow version history
- One-click restore of previous versions
- Validation before publish
- Canvas minimap for navigating large flows
- Auto-layout for organizing complex diagrams

## Node Types

- Start — marks the entry point for the call
- Play Audio — plays an uploaded or TTS-generated audio file
- Get Digits — waits for a keypress from the caller
- Menu — routes the call based on which key the caller pressed
- Business Hours — routes the call based on the current time and day
- Transfer — sends the call to an extension, external number, or SIP URI
- Hunt Group — dials multiple destinations in sequence, randomly, or simultaneously
- Queue — places the caller in a wait queue until an operator is available
- Queue Login — lets an operator log in or out of a queue using a PIN
- Conference — joins the caller into a named multi-party conference room
- Callback — records the caller's number and schedules an outbound callback
- Voicemail — records a message from the caller and stores it
- Webhook — fires an async HTTP request without blocking the call
- Hangup — ends the call
