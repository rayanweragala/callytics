import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { join } from "path";
import { DataSource, Repository } from "typeorm";
import { InboundRouteEntity } from "../inbound-routes/entities/inbound-route.entity";
import { runSqlMigrations } from "../db/run-sql-migrations";
import { AppLogger } from "../logger/app-logger";
import type { ResolvedExtensionConfig } from "../extensions/extensions.service";
import { SipExtensionEntity } from "../extensions/entities/sip-extension.entity";
import { SipTrunkEntity } from "../trunks/entities/sip-trunk.entity";

const NO_REGISTER_PRESETS = ["twilio", "telnyx", "vonage", "signalwire"];

export interface AmiQualifyResult {
  status: "reachable" | "unreachable" | "not_loaded";
  rtt_ms: number | null;
  message: string;
}

export interface AmiConnectionStatus {
  connected: boolean;
}

export interface AmiPjsipEndpoint {
  endpoint: string;
  aor: string;
  contacts: string[];
}

export interface AmiPjsipAor {
  endpoint: string;
  aor: string;
  contacts: string[];
  contactStatus: string | null;
  roundtripUsec: string | null;
  lastQualifiedAt: string | null;
}

@Injectable()
export class AsteriskConfigService implements OnModuleInit {
  private readonly logger = new AppLogger(AsteriskConfigService.name);
  private readonly configDir =
    process.env.ASTERISK_CONFIG_DIR || "/etc/asterisk";
  private readonly amiHost = process.env.AMI_HOST || "127.0.0.1";
  private readonly amiPort = Number(process.env.AMI_PORT || 5038);
  private readonly amiUser = process.env.AMI_USER || "callytics";
  private readonly amiPassword =
    process.env.AMI_PASSWORD || process.env.AMI_PASS || "callytics";
  private readonly extensionsInclude =
    "#include pjsip_callytics_extensions.conf";
  private readonly trunksInclude = "#include pjsip_callytics_trunks.conf";

  constructor(
    @InjectRepository(SipExtensionEntity)
    private readonly extensionsRepository: Repository<SipExtensionEntity>,
    @InjectRepository(SipTrunkEntity)
    private readonly trunksRepository: Repository<SipTrunkEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
    await this.writeTrunksConfig();
  }

  async syncExtensions(extensions: ResolvedExtensionConfig[]): Promise<void> {
    await this.writeExtensionsConfig(extensions);
    try {
      await this.reloadResPjsip();
    } catch (error) {
      this.logger.error(
        "failed to reload pjsip",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async syncInboundRoutes(routes: InboundRouteEntity[]): Promise<void> {
    await this.writeInboundRoutesConfig(routes);
    try {
      await this.reloadDialplan();
    } catch (error) {
      this.logger.error(
        "failed to reload dialplan",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async writeInboundRoutesConfig(routes: InboundRouteEntity[]): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    await this.ensureIncludeAtFileEnd(
      join(this.configDir, "extensions.conf"),
      "#include extensions_callytics_inbound.conf",
    );
    await fs.writeFile(
      join(this.configDir, "extensions_callytics_inbound.conf"),
      this.buildInboundRoutesConfig(routes),
      "utf8",
    );
  }

  async writeExtensionsConfig(
    extensions: ResolvedExtensionConfig[],
  ): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    await this.ensurePjsipTemplate();
    await fs.writeFile(
      join(this.configDir, "pjsip_callytics_extensions.conf"),
      this.buildExtensionsConfig(extensions),
      "utf8",
    );
    await fs.writeFile(
      join(this.configDir, "pjsip_extensions_relay.conf"),
      this.buildExtensionsRelayConfig(extensions, this.getExternalMediaAddress()),
      "utf8",
    );
    await this.ensureManagedPjsipIncludes();
  }

  async writeTrunksConfig(trunks?: SipTrunkEntity[]): Promise<void> {
    const items =
      trunks ??
      (await this.trunksRepository.find({
        where: { enabled: true },
        order: { createdAt: "ASC", id: "ASC" },
      }));
    await fs.mkdir(this.configDir, { recursive: true });
    await this.ensurePjsipTemplate();
    await fs.writeFile(
      join(this.configDir, "pjsip_callytics_trunks.conf"),
      this.buildTrunksConfig(items),
      "utf8",
    );
    await this.ensureManagedPjsipIncludes();
  }

  async reloadResPjsip(): Promise<void> {
    await this.sendAmiCommand("module reload res_pjsip.so");
  }

  async syncUdpTransport(externalAddress: string | null): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    await this.writeUdpTransportConfig(externalAddress);
    await this.reloadPjsip();
  }

  async syncExtensionsRelayConfig(
    externalAddress: string | null,
  ): Promise<void> {
    const extensions = await this.extensionsRepository.find({
      order: { username: "ASC" },
    });
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.writeFile(
      join(this.configDir, "pjsip_extensions_relay.conf"),
      this.buildExtensionsRelayConfig(extensions, externalAddress),
      "utf8",
    );
  }

  async reloadPjsip(): Promise<void> {
    try {
      await this.sendAmiCommand("pjsip reload");
    } catch (error) {
      this.logger.warn(
        `pjsip reload unavailable, falling back to module reload: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.sendAmiCommand("module reload res_pjsip.so");
    }
  }

  async reloadDialplan(): Promise<void> {
    await this.sendAmiCommand("dialplan reload");
  }

  async qualifyEndpoint(endpoint: string): Promise<AmiQualifyResult> {
    const script = [
      "import json, socket, sys, time",
      "host, port, user, password, endpoint = sys.argv[1:6]",
      "port = int(port)",
      "sock = socket.create_connection((host, port), timeout=5)",
      "sock.settimeout(0.5)",
      "sock.recv(4096)",
      "sock.sendall(f'Action: Login\\r\\nUsername: {user}\\r\\nSecret: {password}\\r\\n\\r\\n'.encode())",
      'login = sock.recv(4096).decode(errors="replace")',
      "if 'Authentication accepted' not in login:",
      "    raise SystemExit(login)",
      'buffer = ""',
      "def parse_message(raw):",
      "    fields = {}",
      '    for line in raw.split("\\r\\n"):',
      '        if not line or ":" not in line:',
      "            continue",
      '        key, value = line.split(":", 1)',
      "        fields[key.strip()] = value.strip()",
      "    return fields",
      "def collect(deadline):",
      "    global buffer",
      "    messages = []",
      "    while time.time() < deadline:",
      "        try:",
      '            chunk = sock.recv(8192).decode(errors="replace")',
      "            if not chunk:",
      "                break",
      "            buffer += chunk",
      '            while "\\r\\n\\r\\n" in buffer:',
      '                raw, buffer = buffer.split("\\r\\n\\r\\n", 1)',
      "                if raw.strip():",
      "                    messages.append(parse_message(raw))",
      "        except TimeoutError:",
      "            continue",
      "    return messages",
      "sock.sendall(f'Action: PJSIPQualify\\r\\nActionID: qualify-1\\r\\nEndpoint: {endpoint}\\r\\n\\r\\n'.encode())",
      "qualify_messages = collect(time.time() + 1.5)",
      'qualify_ok = any(msg.get("Response") == "Success" and "Endpoint found" in msg.get("Message", "") for msg in qualify_messages)',
      "if not qualify_ok:",
      '    result = {"status": "not_loaded", "rtt_ms": None, "message": "Not loaded — try saving again"}',
      "else:",
      "    time.sleep(0.5)",
      "    sock.sendall(f'Action: PJSIPShowEndpoint\\r\\nActionID: show-1\\r\\nEndpoint: {endpoint}\\r\\n\\r\\n'.encode())",
      "    detail_messages = collect(time.time() + 3.5)",
      '    detail_messages = [msg for msg in detail_messages if msg.get("ActionID") == "show-1"]',
      '    matched = any(msg.get("ObjectName") == endpoint or msg.get("EndpointName") == endpoint for msg in detail_messages)',
      "    rtt_ms = None",
      "    unreachable = False",
      "    for fields in detail_messages:",
      '        status_text = " ".join([fields.get("Status", ""), fields.get("ContactStatus", ""), fields.get("Message", "")]).lower()',
      '        if fields.get("EndpointName") == endpoint or fields.get("ObjectName") == endpoint or fields.get("AOR", "").startswith(f"{endpoint}-"):',
      '            if "nonqual" in status_text or "unreach" in status_text or "unknown" in status_text:',
      "                unreachable = True",
      '            usec = fields.get("RoundtripUsec") or fields.get("RTT") or fields.get("Roundtrip")',
      '            if usec and usec != "N/A":',
      "                try:",
      "                    rtt_ms = round(float(usec) / 1000.0, 1)",
      "                except ValueError:",
      "                    try:",
      "                        rtt_ms = round(float(usec), 1)",
      "                    except ValueError:",
      "                        rtt_ms = None",
      "    if rtt_ms is not None:",
      '        result = {"status": "reachable", "rtt_ms": rtt_ms, "message": f"Reachable — {int(rtt_ms) if float(rtt_ms).is_integer() else rtt_ms}ms"}',
      "    elif matched or unreachable:",
      '        result = {"status": "unreachable", "rtt_ms": None, "message": "Unreachable"}',
      "    else:",
      '        result = {"status": "not_loaded", "rtt_ms": None, "message": "Not loaded — try saving again"}',
      "sock.sendall(b'Action: Logoff\\r\\n\\r\\n')",
      "try:",
      "    sock.recv(4096)",
      "except TimeoutError:",
      "    pass",
      "sock.close()",
      "print(json.dumps(result))",
    ].join("\n");

    const output = await this.runPythonScript(script, [
      this.amiHost,
      String(this.amiPort),
      this.amiUser,
      this.amiPassword,
      endpoint,
    ]);
    return JSON.parse(output) as AmiQualifyResult;
  }

  async checkAmiConnection(): Promise<AmiConnectionStatus> {
    const script = [
      "import json, socket, sys",
      "host, port, user, password = sys.argv[1:5]",
      "port = int(port)",
      "sock = socket.create_connection((host, port), timeout=5)",
      "sock.settimeout(2)",
      "sock.recv(4096)",
      "sock.sendall(f'Action: Login\\r\\nUsername: {user}\\r\\nSecret: {password}\\r\\n\\r\\n'.encode())",
      'response = sock.recv(4096).decode(errors="replace")',
      'connected = "Authentication accepted" in response',
      "sock.sendall(b'Action: Logoff\\r\\n\\r\\n')",
      "sock.close()",
      'print(json.dumps({"connected": connected}))',
    ].join("\n");

    try {
      const output = await this.runPythonScript(script, [
        this.amiHost,
        String(this.amiPort),
        this.amiUser,
        this.amiPassword,
      ]);
      return JSON.parse(output) as AmiConnectionStatus;
    } catch {
      return { connected: false };
    }
  }

  async getPjsipEndpoints(): Promise<AmiPjsipEndpoint[]> {
    const script = [
      "import json, socket, sys, time",
      "host, port, user, password = sys.argv[1:5]",
      "port = int(port)",
      "sock = socket.create_connection((host, port), timeout=5)",
      "sock.settimeout(0.5)",
      "sock.recv(4096)",
      "sock.sendall(f'Action: Login\\r\\nUsername: {user}\\r\\nSecret: {password}\\r\\n\\r\\n'.encode())",
      'login = sock.recv(4096).decode(errors="replace")',
      "if 'Authentication accepted' not in login:",
      "    raise SystemExit(login)",
      'buffer = ""',
      'action_id = "endpoints-1"',
      "def parse_message(raw):",
      "    fields = {}",
      '    for line in raw.split("\\r\\n"):',
      '        if not line or ":" not in line:',
      "            continue",
      '        key, value = line.split(":", 1)',
      "        fields[key.strip()] = value.strip()",
      "    return fields",
      "def collect(deadline):",
      "    global buffer",
      "    messages = []",
      "    while time.time() < deadline:",
      "        try:",
      '            chunk = sock.recv(8192).decode(errors="replace")',
      "            if not chunk:",
      "                break",
      "            buffer += chunk",
      '            while "\\r\\n\\r\\n" in buffer:',
      '                raw, buffer = buffer.split("\\r\\n\\r\\n", 1)',
      "                raw = raw.strip()",
      "                if raw:",
      "                    messages.append(parse_message(raw))",
      "        except TimeoutError:",
      "            continue",
      "    return messages",
      "sock.sendall(f'Action: PJSIPShowEndpoints\\r\\nActionID: {action_id}\\r\\n\\r\\n'.encode())",
      "messages = collect(time.time() + 3)",
      "rows = []",
      "for message in messages:",
      '    if message.get("ActionID") != action_id:',
      "        continue",
      '    if message.get("Event") != "EndpointList":',
      "        continue",
      '    contacts = [value.strip() for value in message.get("Contacts", "").split(",") if value.strip()]',
      "    rows.append({",
      '        "endpoint": message.get("ObjectName", "unknown"),',
      '        "aor": message.get("Aor", "unknown"),',
      '        "contacts": contacts,',
      "    })",
      "sock.sendall(b'Action: Logoff\\r\\n\\r\\n')",
      "sock.close()",
      "print(json.dumps(rows))",
    ].join("\n");

    const output = await this.runPythonScript(script, [
      this.amiHost,
      String(this.amiPort),
      this.amiUser,
      this.amiPassword,
    ]);
    return JSON.parse(output) as AmiPjsipEndpoint[];
  }

  async getPjsipAors(): Promise<AmiPjsipAor[]> {
    const script = [
      "import json, socket, sys, time",
      "host, port, user, password = sys.argv[1:5]",
      "port = int(port)",
      "sock = socket.create_connection((host, port), timeout=5)",
      "sock.settimeout(0.5)",
      "sock.recv(4096)",
      "sock.sendall(f'Action: Login\\r\\nUsername: {user}\\r\\nSecret: {password}\\r\\n\\r\\n'.encode())",
      'login = sock.recv(4096).decode(errors="replace")',
      "if 'Authentication accepted' not in login:",
      "    raise SystemExit(login)",
      'buffer = ""',
      'action_id = "aors-1"',
      "def parse_message(raw):",
      "    fields = {}",
      '    for line in raw.split("\\r\\n"):',
      '        if not line or ":" not in line:',
      "            continue",
      '        key, value = line.split(":", 1)',
      "        fields[key.strip()] = value.strip()",
      "    return fields",
      "def collect(deadline):",
      "    global buffer",
      "    messages = []",
      "    while time.time() < deadline:",
      "        try:",
      '            chunk = sock.recv(8192).decode(errors="replace")',
      "            if not chunk:",
      "                break",
      "            buffer += chunk",
      '            while "\\r\\n\\r\\n" in buffer:',
      '                raw, buffer = buffer.split("\\r\\n\\r\\n", 1)',
      "                raw = raw.strip()",
      "                if raw:",
      "                    messages.append(parse_message(raw))",
      "        except TimeoutError:",
      "            continue",
      "    return messages",
      "sock.sendall(f'Action: PJSIPShowAors\\r\\nActionID: {action_id}\\r\\n\\r\\n'.encode())",
      "messages = collect(time.time() + 3)",
      "rows = []",
      "for message in messages:",
      '    if message.get("ActionID") != action_id:',
      "        continue",
      '    if message.get("Event") != "AorList":',
      "        continue",
      '    contacts = [value.strip() for value in message.get("Contacts", "").split(",") if value.strip()]',
      '    aor = message.get("ObjectName", "unknown")',
      '    endpoint = aor[:-4] if aor.endswith("-aor") else aor',
      "    rows.append({",
      '        "endpoint": endpoint,',
      '        "aor": aor,',
      '        "contacts": contacts,',
      '        "contactStatus": message.get("ContactStatus"),',
      '        "roundtripUsec": message.get("RoundtripUsec"),',
      '        "lastQualifiedAt": message.get("LastQualifiedAt"),',
      "    })",
      "sock.sendall(b'Action: Logoff\\r\\n\\r\\n')",
      "sock.close()",
      "print(json.dumps(rows))",
    ].join("\n");

    const output = await this.runPythonScript(script, [
      this.amiHost,
      String(this.amiPort),
      this.amiUser,
      this.amiPassword,
    ]);
    return JSON.parse(output) as AmiPjsipAor[];
  }

  private buildExtensionsConfig(extensions: ResolvedExtensionConfig[]): string {
    const blocks = extensions.map((extension) => {
      const endpointLines = [
        `[${extension.username}]`,
        "type = endpoint",
        `transport = ${extension.transport}`,
        "context = callytics-inbound",
        "disallow = all",
        "allow = ulaw",
        "allow = alaw",
        "direct_media = no",
        "force_rport = yes",
        "rewrite_contact = yes",
        `auth = ${extension.username}-auth`,
        `aors = ${extension.username}`,
      ];

      endpointLines.push(...extension.endpointFlags);

      return [
        `[${extension.username}]`,
        "type = aor",
        "max_contacts = 5",
        "remove_unavailable = yes",
        "",
        `[${extension.username}-auth]`,
        "type = auth",
        "auth_type = userpass",
        `username = ${extension.username}`,
        `password = ${extension.password}`,
        "",
        ...endpointLines,
      ].join("\n");
    });

    return (
      ["; auto-generated by callytics — do not edit manually", "", ...blocks]
        .join("\n\n")
        .trimEnd() + "\n"
    );
  }

  private getExternalMediaAddress(): string | null {
    return (
      process.env.ASTERISK_EXTERNAL_IP?.trim() ||
      process.env.VPN_PUBLIC_IP?.trim() ||
      null
    );
  }

  private buildTrunksConfig(trunks: SipTrunkEntity[]): string {
    const blocks = trunks
      .filter((trunk) => trunk.enabled)
      .map((trunk) => {
        const transport =
          String((trunk as { protocol?: string }).protocol || "udp")
            .trim()
            .toLowerCase() === "tcp"
            ? "transport-tcp"
            : "transport-udp";
        const providerPreset = String(trunk.providerPreset || "generic")
          .trim()
          .toLowerCase();
        const hasUsername = Boolean(trunk.username?.trim());
        const hasPassword = Boolean(trunk.password?.trim());
        const hasAuth = hasUsername && hasPassword;
        const shouldRegister =
          hasAuth && !NO_REGISTER_PRESETS.includes(providerPreset);

        const endpointLines = [
          `; trunk: ${trunk.name}`,
          `[trunk-${trunk.id}]`,
          "type = endpoint",
          `transport = ${transport}`,
          "context = callytics-inbound",
          "disallow = all",
          "allow = ulaw",
          "allow = alaw",
        ];

        if (hasAuth) {
          endpointLines.push(`outbound_auth = trunk-${trunk.id}-auth`);
        }

        endpointLines.push(`aors = trunk-${trunk.id}-aor`);

        if (trunk.fromDomain) {
          endpointLines.push(`from_domain = ${trunk.fromDomain}`);
        }

        if (trunk.fromUser) {
          endpointLines.push(
            `from_user = ${trunk.fromUser.replace(/\s+/g, "")}`,
          );
        }

        const lines: string[] = [];
        if (shouldRegister) {
          lines.push(
            `; trunk: ${trunk.name}`,
            `[trunk-${trunk.id}-reg]`,
            "type = registration",
            "transport = transport-udp",
            `outbound_auth = trunk-${trunk.id}-auth`,
            `server_uri = sip:${trunk.host}`,
            `client_uri = sip:${trunk.username}@${trunk.host}`,
            "retry_interval = 60",
            "",
          );
        }

        if (hasAuth) {
          lines.push(
            `[trunk-${trunk.id}-auth]`,
            "type = auth",
            "auth_type = userpass",
            `username = ${trunk.username}`,
            `password = ${trunk.password}`,
            "",
          );
        }

        lines.push(
          ...endpointLines,
          "",
          `[trunk-${trunk.id}-aor]`,
          "type = aor",
          `contact = sip:${trunk.host}:${trunk.port}`,
        );

        return lines.join("\n");
      });

    return (
      ["; auto-generated by callytics — do not edit manually", "", ...blocks]
        .join("\n\n")
        .trimEnd() + "\n"
    );
  }

  private buildInboundRoutesConfig(routes: InboundRouteEntity[]): string {
    const lines: string[] = [
      "; auto-generated by callytics — do not edit manually",
      "",
      "[callytics-inbound]",
    ];
    for (const route of routes) {
      lines.push(`exten => ${route.did},1,Stasis(callytics)`);
      lines.push(`exten => ${route.did},n,Hangup()`);
      lines.push("");
    }
    return lines.join("\n").trimEnd() + "\n";
  }

  private async ensureManagedPjsipIncludes(): Promise<void> {
    await this.ensureIncludesAtFileEnd(join(this.configDir, "pjsip.conf"), [
      this.extensionsInclude,
      this.trunksInclude,
    ]);
  }

  private async ensureIncludesAtFileEnd(
    filePath: string,
    includeLines: string[],
  ): Promise<void> {
    let content = "";
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      content = "";
    }

    const includeSet = new Set(includeLines.map((line) => line.trim()));
    const lines = content
      .split(/\r?\n/)
      .filter((line) => !includeSet.has(line.trim()));

    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }

    const body = lines.join("\n");
    const includeBlock = includeLines.join("\n");
    const next = body ? `${body}\n\n${includeBlock}\n` : `${includeBlock}\n`;

    await fs.writeFile(filePath, next, "utf8");
  }

  private async ensureIncludeAtFileEnd(
    filePath: string,
    includeLine: string,
  ): Promise<void> {
    await this.ensureIncludesAtFileEnd(filePath, [includeLine]);
  }

  private async ensurePjsipTemplate(): Promise<void> {
    const filePath = join(this.configDir, "pjsip.conf");
    let content = "";
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      content = "";
    }

    if (content.includes("[callytics-endpoint-template]")) {
      return;
    }

    const templateBlock = [
      "",
      "[callytics-endpoint-template](!)",
      "type = endpoint",
      "transport = transport-udp",
      "context = callytics-inbound",
      "disallow = all",
      "allow = ulaw",
      "allow = alaw",
      "direct_media = no",
      "force_rport = yes",
      "rewrite_contact = yes",
      "",
    ].join("\n");

    await fs.writeFile(
      filePath,
      `${content.trimEnd()}${templateBlock}`,
      "utf8",
    );
  }

  private async writeUdpTransportConfig(
    externalAddress: string | null,
  ): Promise<void> {
    const filePath = join(this.configDir, "pjsip_relay.conf");
    const lines = [
      "; auto-generated relay settings — do not commit",
      "; external_* values come from the active relay/VPS public IP at runtime.",
      "; endpoint NAT overrides are loaded from pjsip_extensions_relay.conf and use ASTERISK_EXTERNAL_IP.",
      "",
    ];
    if (externalAddress) {
      lines.push(
        `external_signaling_address = ${externalAddress}`,
        `external_media_address = ${externalAddress}`,
        "",
      );
    }
    lines.push("#include pjsip_extensions_relay.conf", "");
    const content = lines.join("\n");
    await fs.writeFile(filePath, content, "utf8");
  }

  private buildExtensionsRelayConfig(
    extensions: Array<Pick<ResolvedExtensionConfig, "username">>,
    externalAddress: string | null,
  ): string {
    const header = [
      "; auto-generated NAT overrides — do not commit",
      "; Set ASTERISK_EXTERNAL_IP in the runtime environment before regenerating this file.",
    ];
    if (!externalAddress) {
      return `${header.join("\n")}\n`;
    }

    const blocks = extensions.map((extension) =>
      [
        `[${extension.username}](+)`,
        `media_address = ${externalAddress}`,
        "rtp_symmetric = yes",
      ].join("\n"),
    );

    return [...header, "", ...blocks].join("\n\n").trimEnd() + "\n";
  }

  private async sendAmiCommand(command: string): Promise<void> {
    const script = [
      "import socket, sys, time",
      "host, port, user, password, command = sys.argv[1:6]",
      "port = int(port)",
      "sock = socket.create_connection((host, port), timeout=5)",
      "sock.settimeout(2)",
      "sock.recv(4096)",
      "sock.sendall(f'Action: Login\\r\\nUsername: {user}\\r\\nSecret: {password}\\r\\n\\r\\n'.encode())",
      'login = sock.recv(4096).decode(errors="replace")',
      "if 'Authentication accepted' not in login:",
      "    raise SystemExit(login)",
      "sock.sendall(f'Action: Command\\r\\nActionID: cmd-1\\r\\nCommand: {command}\\r\\n\\r\\n'.encode())",
      "deadline = time.time() + 2",
      'response = ""',
      "while time.time() < deadline:",
      "    try:",
      '        chunk = sock.recv(4096).decode(errors="replace")',
      "        if not chunk:",
      "            break",
      "        response += chunk",
      "        if 'Response: Error' in response:",
      "            raise SystemExit(response)",
      "        if 'Message: Command output follows' in response or '--END COMMAND--' in response or 'Response: Success' in response:",
      "            break",
      "    except TimeoutError:",
      "        break",
      "sock.sendall(b'Action: Logoff\\r\\n\\r\\n')",
      "try:",
      "    sock.recv(4096)",
      "except TimeoutError:",
      "    pass",
      "sock.close()",
    ].join("\n");

    await this.runPythonScript(script, [
      this.amiHost,
      String(this.amiPort),
      this.amiUser,
      this.amiPassword,
      command,
    ]);
    this.logger.log(`AMI command executed: ${command}`);
  }

  private async runPythonScript(
    script: string,
    args: string[],
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn("python3", ["-c", script, ...args]);
      let stderr = "";
      let stdout = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }
        reject(
          new Error(`AMI script failed stdout=${stdout} stderr=${stderr}`),
        );
      });
    });
  }
}
