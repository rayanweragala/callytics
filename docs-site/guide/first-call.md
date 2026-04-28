# Your First Call

This walkthrough creates the smallest useful inbound call path: register a SIP extension, point an inbound DID at a flow, publish `Start -> Play Audio -> Hangup`, and dial in.

1. Open the dashboard at `http://localhost:3000`.

   This is the React dashboard served by the frontend container. Keep the backend running on port `3001` in the same stack because the dashboard reads and writes configuration through the NestJS API.

2. Go to Configure -> Extensions. Add a new SIP extension — give it a number, a display name, and a password.

   This is the credential your softphone will register with. Use a real password because the extension becomes a SIP identity inside Asterisk.

3. Go to Configure -> Inbound. Create an inbound route — assign a DID number and select a flow.

   If you have no flows yet, leave it and come back after step 5. The DID is the number Asterisk will match when a call enters the system.

4. Go to Configure -> Flow Builder. Create a new flow.

   Drag a Start node, connect it to a Play Audio node, connect that to a Hangup node. Upload or select an audio file for the Play Audio node so the test call has something audible to play.

5. Click Publish.

   The flow is now live — any call hitting the assigned DID will execute it immediately. Draft edits after this point will not affect live calls until you publish again.

6. Register your softphone using the extension credentials and the server IP on port `5080`.

   Linphone, Zoiper, or any SIP client will work. Dial the DID from the softphone and you should hear your audio file play.
