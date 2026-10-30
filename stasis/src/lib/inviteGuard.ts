/**
 * Guard against retransmitted INVITEs that Asterisk turns into a second call.
 *
 * Some SIP proxies keep retransmitting the initial INVITE (same Call-ID, same
 * Via branch, same CSeq) after the first transaction was already answered and
 * ACKed. Once that transaction has terminated, PJSIP treats the retransmission
 * as a new call: a second channel, a second 200 OK with its own RTP port and a
 * second StasisStart. Both channels then send RTP to the same remote media
 * address and the caller hears choppy audio, while the flow runs twice.
 *
 * The first channel that shows up for a SIP Call-ID owns it. A later channel
 * with the same Call-ID is a duplicate and must be dropped before it answers.
 * The entry is released when the owning channel leaves Stasis, so a genuinely
 * new call is never blocked and the map cannot grow without bound.
 */
import { stasisLogger } from '../logger';

/** channel.getChannelVar as exposed by ari-client; optional so plain channels still work. */
export interface CallIdChannel {
  id: string;
  getChannelVar?: (params: { variable: string }) => Promise<{ value?: string }>;
}

// SIP Call-ID -> id of the channel that owns it.
const ownerByCallId = new Map<string, string>();
// Reverse index so release on channel end does not need the Call-ID.
const callIdByOwner = new Map<string, string>();

/** Reads the SIP Call-ID of an inbound PJSIP channel, or null when unavailable. */
export async function readSipCallId(channel: CallIdChannel): Promise<string | null> {
  if (typeof channel.getChannelVar !== 'function') {
    return null;
  }
  try {
    const { value } = await channel.getChannelVar({ variable: 'CHANNEL(pjsip,call-id)' });
    const callId = String(value ?? '').trim();
    return callId || null;
  } catch {
    // Non-PJSIP channel or variable not readable: behave as without the guard.
    return null;
  }
}

/**
 * Claims the Call-ID for this channel. Returns the owning channel id when the
 * Call-ID is already taken by another channel (this channel is a duplicate),
 * otherwise null. The check and the claim are synchronous, so two StasisStart
 * events cannot both win.
 */
export function claimCallId(callId: string, channelId: string): string | null {
  const owner = ownerByCallId.get(callId);
  if (owner && owner !== channelId) {
    return owner;
  }
  ownerByCallId.set(callId, channelId);
  callIdByOwner.set(channelId, callId);
  return null;
}

/** Releases the Call-ID owned by this channel. Duplicates own nothing, so this is a no-op for them. */
export function releaseCallId(channelId: string): void {
  const callId = callIdByOwner.get(channelId);
  if (!callId) {
    return;
  }
  callIdByOwner.delete(channelId);
  if (ownerByCallId.get(callId) === channelId) {
    ownerByCallId.delete(callId);
  }
}

/**
 * Returns true when the channel is a duplicate of an active call and has been
 * hung up. Must run before channel.answer() so the duplicate never sends a
 * 200 OK or opens an RTP stream. A channel without a readable Call-ID is
 * treated as a normal call.
 */
export async function dropIfDuplicateInvite(channel: CallIdChannel & { hangup: () => Promise<void> }): Promise<boolean> {
  const callId = await readSipCallId(channel);
  if (!callId) {
    return false;
  }
  const originalChannelId = claimCallId(callId, channel.id);
  if (!originalChannelId) {
    return false;
  }
  stasisLogger.warn(
    `Dropping duplicate inbound call (retransmitted INVITE): call-id=${callId} original=${originalChannelId} duplicate=${channel.id}`,
  );
  try {
    // Unanswered channel: Asterisk rejects the INVITE with a final SIP response
    // and no media. The first dialog is unaffected, it already has 200 OK + ACK.
    await channel.hangup();
  } catch (error) {
    stasisLogger.error(`Failed to hang up duplicate channel ${channel.id}:`, error);
  }
  return true;
}

/** Test helper: forget every claimed Call-ID. */
export function resetInviteGuard(): void {
  ownerByCallId.clear();
  callIdByOwner.clear();
}
