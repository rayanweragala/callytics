import type { SipPacket, SipVerdict } from '../types';

const DEFAULT_VERDICT: SipVerdict = {
  message: 'No SIP sequence available',
  cause: 'Select a dialog to inspect packet sequence.',
  colour: 'amber',
};

export function getSipVerdict(packets: SipPacket[]): SipVerdict {
  if (!packets.length) {
    return DEFAULT_VERDICT;
  }

  const methods = packets.map((packet) => packet.method.toUpperCase());
  const has = (value: string) => methods.includes(value);
  const hasAny = (values: string[]) => values.some((value) => has(value));

  if (has('REGISTER')) {
    if (hasAny(['401', '407'])) {
      return {
        message: 'Registration failed — wrong password',
        cause: 'REGISTER challenge response did not authenticate successfully.',
        colour: 'red',
      };
    }

    if (has('403')) {
      return {
        message: 'Registration forbidden — check trunk auth',
        cause: 'Provider rejected REGISTER with forbidden response.',
        colour: 'red',
      };
    }

    if (has('200')) {
      return {
        message: 'Extension registered successfully',
        cause: 'REGISTER transaction completed with 200 OK.',
        colour: 'green',
      };
    }
  }

  if (has('INVITE')) {
    if (has('404')) {
      return {
        message: 'Number not found — check dialplan',
        cause: 'INVITE returned 404 Not Found.',
        colour: 'red',
      };
    }

    if (has('408')) {
      return {
        message: 'Request timeout — trunk may be unreachable',
        cause: 'INVITE timed out without timely endpoint response.',
        colour: 'red',
      };
    }

    if (has('403')) {
      return {
        message: 'Forbidden — check trunk credentials',
        cause: 'INVITE rejected with 403 Forbidden.',
        colour: 'red',
      };
    }

    if (has('503')) {
      return {
        message: 'Service unavailable — trunk down',
        cause: 'INVITE returned 503 Service Unavailable.',
        colour: 'red',
      };
    }

    if (has('486')) {
      return {
        message: 'Called party was busy',
        cause: 'INVITE returned 486 Busy Here.',
        colour: 'amber',
      };
    }

    if (has('200') && has('BYE')) {
      return {
        message: 'Call completed normally',
        cause: 'INVITE reached 200 OK and BYE was exchanged.',
        colour: 'green',
      };
    }

    if (has('200') && !has('BYE')) {
      return {
        message: 'Call may have dropped — no BYE received',
        cause: 'Dialog established but termination signal was not observed.',
        colour: 'amber',
      };
    }

    const hasInviteResponse = methods.some((method) => /^\d{3}$/.test(method));
    if (!hasInviteResponse) {
      return {
        message: 'No response — possible NAT/firewall issue',
        cause: 'INVITE seen with no SIP response packets.',
        colour: 'red',
      };
    }
  }

  return DEFAULT_VERDICT;
}
