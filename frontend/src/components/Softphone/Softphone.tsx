import { useEffect, useMemo, useRef, useState } from 'react';
import JsSIP from 'jssip';
import { SearchableSelect, type SearchableSelectOption } from '../common/SearchableSelect';
import { ErrorMessage } from '../common/ErrorMessage';
import { getHostConfig, listOperators } from '../../lib/api';
import { getApiError } from '../../lib/apiError';
import type { HostConfigResponse } from '../../lib/api';
import type { OperatorItem } from '../../types';
import styles from './Softphone.module.css';

type RegistrationState = 'unregistered' | 'connecting' | 'registered';
type CallState = 'idle' | 'incoming' | 'active' | 'ended';

interface SoftphoneOperator extends OperatorItem {
  extension: NonNullable<OperatorItem['extension']>;
}

interface SipIdentity {
  display_name?: string;
  uri?: {
    user?: string;
    toString(): string;
  };
}

interface SipSessionEventMap {
  ended: () => void;
  failed: () => void;
  accepted: () => void;
  confirmed: () => void;
}

interface SipSession {
  direction: 'incoming' | 'outgoing';
  remote_identity?: SipIdentity;
  connection?: RTCPeerConnection;
  answer(options: {
    pcConfig?: RTCConfiguration;
    mediaConstraints: { audio: boolean; video: boolean };
    sessionDescriptionHandlerOptions?: {
      constraints?: { audio: boolean; video: boolean };
      peerConnectionOptions?: {
        rtcConfiguration?: RTCConfiguration;
      };
    };
  }): void;
  terminate(): void;
  mute(options?: { audio?: boolean; video?: boolean }): void;
  unmute(options?: { audio?: boolean; video?: boolean }): void;
  on<T extends keyof SipSessionEventMap>(event: T, handler: SipSessionEventMap[T]): void;
}

interface SipUserAgentEventMap {
  registered: () => void;
  unregistered: () => void;
  registrationFailed: (payload: {
    cause?: string;
    response?: {
      status_code?: number;
    } | null;
  }) => void;
  newRTCSession: (payload: { session: SipSession }) => void;
}

interface SipUserAgent {
  start(): void;
  stop(): void;
  on<T extends keyof SipUserAgentEventMap>(event: T, handler: SipUserAgentEventMap[T]): void;
}

const CALL_ENDED_RESET_MS = 2200;

function isSoftphoneOperator(operator: OperatorItem): operator is SoftphoneOperator {
  return Boolean(operator.extension);
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getCallerLabel(session: SipSession): string {
  const displayName = session.remote_identity?.display_name?.trim();
  if (displayName) {
    return displayName;
  }
  const user = session.remote_identity?.uri?.user?.trim();
  if (user) {
    return user;
  }
  const uriValue = session.remote_identity?.uri?.toString().trim();
  return uriValue || 'Unknown caller';
}

export function Softphone() {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operators, setOperators] = useState<SoftphoneOperator[]>([]);
  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
  const [hostConfig, setHostConfig] = useState<HostConfigResponse | null>(null);
  const [registrationState, setRegistrationState] = useState<RegistrationState>('unregistered');
  const [callState, setCallState] = useState<CallState>('idle');
  const [callerId, setCallerId] = useState<string | null>(null);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uaRef = useRef<SipUserAgent | null>(null);
  const sessionRef = useRef<SipSession | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringtoneContextRef = useRef<AudioContext | null>(null);
  const ringtoneOscillatorsRef = useRef<OscillatorNode[]>([]);
  const ringtoneGainsRef = useRef<GainNode[]>([]);
  const ringtoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringtoneActiveRef = useRef(false);

  const selectableOperators = useMemo(
    () => operators.filter(isSoftphoneOperator),
    [operators],
  );

  const operatorOptions = useMemo<SearchableSelectOption[]>(
    () =>
      selectableOperators.map((operator) => ({
        value: String(operator.id),
        label: `${operator.name} — ${operator.extension.username}`,
      })),
    [selectableOperators],
  );

  const selectedOperator = useMemo(
    () =>
      selectableOperators.find((operator) => String(operator.id) === selectedOperatorId) ||
      null,
    [selectableOperators, selectedOperatorId],
  );

  useEffect(() => {
    let active = true;

    const loadInitialData = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [operatorsResponse, hostResponse] = await Promise.all([
          listOperators(1, 200),
          getHostConfig(),
        ]);

        if (!active) {
          return;
        }

        const nextOperators = operatorsResponse.data.filter(isSoftphoneOperator);
        setOperators(nextOperators);
        setHostConfig(hostResponse);
        setSelectedOperatorId((current) => {
          if (current && nextOperators.some((item) => String(item.id) === current)) {
            return current;
          }
          return nextOperators[0] ? String(nextOperators[0].id) : null;
        });
      } catch (error) {
        if (active) {
          setLoadError(getApiError(error, 'Failed to load softphone configuration'));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadInitialData();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => () => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
    }
    if (endedTimerRef.current) {
      clearTimeout(endedTimerRef.current);
    }
    if (ringtoneTimerRef.current) {
      clearTimeout(ringtoneTimerRef.current);
    }
    if (sessionRef.current) {
      sessionRef.current.terminate();
      sessionRef.current = null;
    }
    if (uaRef.current) {
      uaRef.current.stop();
      uaRef.current = null;
    }
    stopRingtone();
    const ringtoneContext = ringtoneContextRef.current;
    ringtoneContextRef.current = null;
    if (ringtoneContext) {
      void ringtoneContext.close();
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  }, []);

  const clearEndedTimer = () => {
    if (endedTimerRef.current) {
      clearTimeout(endedTimerRef.current);
      endedTimerRef.current = null;
    }
  };

  const clearDurationTimer = () => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  };

  const clearRingtoneNodes = () => {
    for (const oscillator of ringtoneOscillatorsRef.current) {
      try {
        oscillator.onended = null;
        oscillator.stop();
      } catch {
        // Oscillator may already be stopped.
      }
      oscillator.disconnect();
    }
    for (const gainNode of ringtoneGainsRef.current) {
      gainNode.disconnect();
    }
    ringtoneOscillatorsRef.current = [];
    ringtoneGainsRef.current = [];
  };

  const stopRingtone = () => {
    ringtoneActiveRef.current = false;
    if (ringtoneTimerRef.current) {
      clearTimeout(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    clearRingtoneNodes();
    const ringtoneContext = ringtoneContextRef.current;
    ringtoneContextRef.current = null;
    if (ringtoneContext) {
      void ringtoneContext.close();
    }
  };

  const scheduleRingTone = (context: AudioContext) => {
    const scheduleTone = (offsetSeconds: number, durationSeconds: number) => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      const startTime = context.currentTime + offsetSeconds;
      const stopTime = startTime + durationSeconds;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, startTime);

      gainNode.gain.setValueAtTime(0.0001, startTime);
      gainNode.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
      gainNode.gain.linearRampToValueAtTime(0.18, stopTime - 0.04);
      gainNode.gain.linearRampToValueAtTime(0.0001, stopTime);

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);

      ringtoneOscillatorsRef.current.push(oscillator);
      ringtoneGainsRef.current.push(gainNode);

      oscillator.onended = () => {
        ringtoneOscillatorsRef.current = ringtoneOscillatorsRef.current.filter(
          (item) => item !== oscillator,
        );
        ringtoneGainsRef.current = ringtoneGainsRef.current.filter(
          (item) => item !== gainNode,
        );
        oscillator.disconnect();
        gainNode.disconnect();
      };

      oscillator.start(startTime);
      oscillator.stop(stopTime);
    };

    scheduleTone(0, 0.35);
    scheduleTone(0.55, 0.35);
    ringtoneTimerRef.current = setTimeout(() => {
      if (ringtoneActiveRef.current && ringtoneContextRef.current === context) {
        scheduleRingTone(context);
      }
    }, 3000);
  };

  const startRingtone = async () => {
    stopRingtone();
    const context = new AudioContext();
    ringtoneContextRef.current = context;
    ringtoneActiveRef.current = true;
    await context.resume();
    if (!ringtoneActiveRef.current || ringtoneContextRef.current !== context) {
      await context.close();
      return;
    }
    scheduleRingTone(context);
  };

  const resetCallUi = () => {
    clearDurationTimer();
    stopRingtone();
    setMuted(false);
    setCallDurationSeconds(0);
    setCallerId(null);
    sessionRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  };

  const scheduleEndedReset = () => {
    clearEndedTimer();
    endedTimerRef.current = setTimeout(() => {
      setCallState('idle');
      setCallerId(null);
      setActionError(null);
    }, CALL_ENDED_RESET_MS);
  };

  const handleCallEnded = () => {
    resetCallUi();
    setCallState('ended');
    scheduleEndedReset();
  };

  const startDurationTimer = () => {
    clearDurationTimer();
    const startedAt = Date.now();
    setCallDurationSeconds(0);
    durationTimerRef.current = setInterval(() => {
      setCallDurationSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
  };

  const attachRemoteAudio = (session: SipSession) => {
    const peerConnection = session.connection;
    const audioElement = audioRef.current;
    if (!peerConnection || !audioElement) {
      return;
    }

    peerConnection.addEventListener('track', (event) => {
      const [stream] = event.streams;
      if (!stream) {
        return;
      }
      audioElement.srcObject = stream;
    });
  };

  const bindSession = (session: SipSession) => {
    sessionRef.current = session;
    attachRemoteAudio(session);
    session.on('accepted', () => {
      clearEndedTimer();
      setCallState('active');
      startDurationTimer();
    });
    session.on('confirmed', () => {
      clearEndedTimer();
      setCallState('active');
      if (!durationTimerRef.current) {
        startDurationTimer();
      }
    });
    session.on('ended', handleCallEnded);
    session.on('failed', handleCallEnded);
  };

  const connect = async () => {
    if (uaRef.current || !selectedOperator || !hostConfig) {
      return;
    }

    setActionError(null);
    setRegistrationState('connecting');

    try {
      const jssipModule = JsSIP as unknown as {
        WebSocketInterface: new (url: string) => unknown;
        UA: new (config: Record<string, unknown>) => SipUserAgent;
      };
      const socket = new jssipModule.WebSocketInterface(
        `ws://${hostConfig.hostIp}:8088/ws`,
      );
      const uri = `sip:${selectedOperator.extension.username}@${hostConfig.hostIp}`;
      const userAgent = new jssipModule.UA({
        sockets: [socket],
        uri,
        password: selectedOperator.extension.password,
        authorization_user: selectedOperator.extension.username,
        display_name: selectedOperator.name,
        hackIpInContact: true,
        register: true,
        session_timers: false,
      });

      userAgent.on('registered', () => {
        setRegistrationState('registered');
        setActionError(null);
      });
      userAgent.on('unregistered', () => {
        setRegistrationState('unregistered');
      });
      userAgent.on('registrationFailed', () => {
        setRegistrationState('unregistered');
        setActionError(null);
      });
      userAgent.on('newRTCSession', ({ session }) => {
        if (session.direction !== 'incoming') {
          return;
        }
        clearEndedTimer();
        resetCallUi();
        bindSession(session);
        setCallerId(getCallerLabel(session));
        setCallState('incoming');
        setExpanded(true);
        void startRingtone();
      });

      uaRef.current = userAgent;
      userAgent.start();
    } catch (error) {
      setRegistrationState('unregistered');
      setActionError(getApiError(error, 'Failed to start softphone'));
    }
  };

  const disconnect = async () => {
    setActionError(null);
    try {
      if (sessionRef.current) {
        sessionRef.current.terminate();
      }
      resetCallUi();
      clearEndedTimer();
      setCallState('idle');
      if (uaRef.current) {
        uaRef.current.stop();
        uaRef.current = null;
      }
      setRegistrationState('unregistered');
    } catch (error) {
      setActionError(getApiError(error, 'Failed to stop softphone'));
    }
  };

  const answerCall = async () => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    setActionError(null);
    try {
      stopRingtone();
      session.answer({
        pcConfig: {
          iceServers: [],
          iceTransportPolicy: 'all',
        },
        mediaConstraints: {
          audio: true,
          video: false,
        },
        sessionDescriptionHandlerOptions: {
          constraints: {
            audio: true,
            video: false,
          },
          peerConnectionOptions: {
            rtcConfiguration: {
              iceServers: [],
            },
          },
        },
      });
    } catch (error) {
      setActionError(getApiError(error, 'Failed to answer call'));
    }
  };

  const rejectCall = async () => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    setActionError(null);
    try {
      stopRingtone();
      session.terminate();
    } catch (error) {
      setActionError(getApiError(error, 'Failed to reject call'));
    }
  };

  const hangupCall = async () => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    setActionError(null);
    try {
      session.terminate();
    } catch (error) {
      setActionError(getApiError(error, 'Failed to hang up'));
    }
  };

  const toggleMute = async () => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    setActionError(null);
    try {
      if (muted) {
        session.unmute({ audio: true });
        setMuted(false);
        return;
      }
      session.mute({ audio: true });
      setMuted(true);
    } catch (error) {
      setActionError(getApiError(error, 'Failed to update mute state'));
    }
  };

  const statusLabel =
    registrationState === 'registered'
      ? 'Registered'
      : registrationState === 'connecting'
        ? 'Connecting...'
        : 'Unregistered';
  const statusClass =
    registrationState === 'registered'
      ? styles.statusRegistered
      : registrationState === 'connecting'
        ? styles.statusConnecting
        : styles.statusUnregistered;
  const bubbleStateClass =
    callState === 'incoming'
      ? styles.bubbleIncoming
      : registrationState === 'registered'
        ? styles.bubbleRegistered
        : registrationState === 'connecting'
          ? styles.bubbleConnecting
          : styles.bubbleUnregistered;

  return (
    <div className={styles.root}>
      {expanded ? (
        <section className={styles.panel} aria-label="Softphone panel">
          <div className={styles.statusRow}>
            <span className={styles.sectionLabel}>Softphone</span>
            <span className={`${styles.statusValue} ${statusClass}`}>{statusLabel}</span>
          </div>
          {actionError ? <div className={styles.helperText}>{actionError}</div> : null}

          {loading ? <div className={styles.helperText}>Loading softphone…</div> : null}
          {!loading && !loadError ? (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Operator extension</label>
              <SearchableSelect
                disabled={registrationState === 'connecting' || callState === 'active'}
                onChange={setSelectedOperatorId}
                options={operatorOptions}
                placeholder="Select operator"
                value={selectedOperatorId}
              />
            </div>
          ) : null}

          {callState === 'incoming' ? (
            <div className={styles.callCard}>
              <div className={styles.sectionLabel}>Incoming call</div>
              <div className={styles.callerId}>{callerId || 'Unknown caller'}</div>
              <div className={styles.actions}>
                <button
                  className={`${styles.actionButton} ${styles.answerButton}`}
                  onClick={() => {
                    void answerCall();
                  }}
                  type="button"
                >
                  Answer
                </button>
                <button
                  className={`${styles.actionButton} ${styles.rejectButton}`}
                  onClick={() => {
                    void rejectCall();
                  }}
                  type="button"
                >
                  Reject
                </button>
              </div>
            </div>
          ) : null}

          {callState === 'active' ? (
            <div className={styles.callCard}>
              <div className={styles.sectionLabel}>Live call</div>
              <div className={styles.callerId}>{callerId || 'Active session'}</div>
              <div className={styles.duration}>{formatDuration(callDurationSeconds)}</div>
              <div className={styles.actions}>
                <button
                  className={`${styles.actionButton} ${styles.rejectButton}`}
                  onClick={() => {
                    void hangupCall();
                  }}
                  type="button"
                >
                  Hangup
                </button>
                <button
                  className={`${styles.actionButton} ${muted ? styles.secondaryActiveButton : styles.secondaryButton}`}
                  onClick={() => {
                    void toggleMute();
                  }}
                  type="button"
                >
                  {muted ? 'Unmute' : 'Mute'}
                </button>
              </div>
            </div>
          ) : null}

          {callState === 'ended' ? (
            <div className={styles.helperText}>Call ended</div>
          ) : null}

          <div className={styles.actions}>
            <button
              className={`${styles.actionButton} ${
                registrationState === 'registered' ? styles.secondaryButton : styles.connectButton
              }`}
              disabled={
                loading ||
                Boolean(loadError) ||
                Boolean(callState === 'active') ||
                (!selectedOperator && registrationState !== 'registered')
              }
              onClick={() => {
                if (registrationState === 'registered') {
                  void disconnect();
                  return;
                }
                void connect();
              }}
              type="button"
            >
              {registrationState === 'registered' ? 'Disconnect' : 'Connect'}
            </button>
          </div>

          <ErrorMessage message={loadError} />
          <audio autoPlay className={styles.audio} ref={audioRef} />
        </section>
      ) : null}

      <button
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse softphone' : 'Open softphone'}
        className={`${styles.bubble} ${bubbleStateClass}`}
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className={styles.icon} aria-hidden="true">
          ☎
        </span>
        <span className={styles.indicator} />
      </button>
    </div>
  );
}
