# Troubleshooting

## Port already in use

If `docker compose up -d` fails with a bind error, check which process owns the port:

```bash
ss -tulpn | grep <port>
```

Stop the conflicting process or change your host mapping, then rerun:

```bash
docker compose up -d
```

## SIP not registering

Check these first:

- `SIP_PORT` must be `5080`.
- Host firewall must allow SIP traffic on `5080` (UDP/TCP).
- Extension username/password in your softphone must exactly match the credentials provisioned in Callytics.

If registration still fails, inspect Asterisk and backend logs to confirm the auth challenge and endpoint state.

## Audio not playing

Validate in order:

- In the Audio page, confirm the file upload completed.
- Confirm conversion completed successfully.
- Confirm the Asterisk container is healthy.

If the file appears in UI but playback still fails, check container logs and media mount visibility.

## One-way audio

Most one-way audio incidents are NAT/router related:

- Disable SIP ALG on your router.
- Open RTP port range `10000-20000/udp`.
- Check NAT detection result in the preflight wizard and apply the suggested network configuration.

## Docker socket permission denied

If backend operations fail with Docker socket permission errors, add your user to the Docker group:

```bash
sudo usermod -aG docker $USER
```

Then log out and back in (or restart your session) so group membership is applied.
