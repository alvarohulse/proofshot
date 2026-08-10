// src/cli.ts
import { Command } from "commander";

// src/commands/install.ts
import * as fs2 from "fs";
import * as path2 from "path";
import * as os from "os";
import { execSync } from "child_process";
import chalk from "chalk";

// src/utils/skills.ts
import * as fs from "fs";
import * as path from "path";
function getSkillsDir() {
  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "skills"
  );
}
function readBundledSkill(relativePath) {
  try {
    return fs.readFileSync(path.join(getSkillsDir(), relativePath), "utf-8");
  } catch {
    return null;
  }
}
function getInlineSkillContent(agent) {
  if (agent === "claude" || agent === "codex") {
    return `---
name: proofshot
description: Visual verification of UI features. Use after building or modifying any
  UI component, page, or visual feature. Starts a verification session with video
  recording and error capture, then you drive the browser to test, then stop to
  bundle proof artifacts for the human.
allowed-tools: Bash(proofshot:*), Bash(agent-browser:*)
---

# ProofShot \u2014 Visual Verification Workflow

## When to use

Use ProofShot after:
- Building a new UI feature or page
- Modifying existing UI components
- Fixing a visual bug
- Any change that affects what the user sees

## The workflow (always follow these 3 steps)

### Step 1: Start the session

\`\`\`bash
proofshot start --run "your-dev-command" --port PORT --description "what you are about to verify"
\`\`\`

This opens a browser and begins recording. If --run is provided, it also starts and captures your dev server output.
If the server is already running, omit --run (no server logs captured).
The description appears in the proof report for the human.

### Step 2: Drive the browser and test

Use proofshot exec to navigate, interact, and verify:

\`\`\`bash
proofshot exec snapshot -i                                    # See interactive elements
proofshot exec open http://localhost:PORT/page                # Navigate to a page
proofshot exec click @e3                                      # Click a button
proofshot exec fill @e2 "test@example.com"                    # Fill a form field
proofshot exec assert-visible "#expected-result"              # Record an expected selector
proofshot exec screenshot step-NAME.png                       # Capture key moments
\`\`\`

Take screenshots at important moments \u2014 these become the visual proof.
Verify what you expect to see by reading the snapshot output.

### Step 3: Stop and bundle the proof

\`\`\`bash
proofshot stop
\`\`\`

This stops recording, collects canonical browser + environment evidence, and generates
a SUMMARY.md, viewer, structured verdict, and provenance manifest.

### Step 4 (optional): Post proof to the PR

\`\`\`bash
proofshot pr              # Auto-detect PR from current branch
proofshot pr 42           # Target a specific PR number
proofshot pr 42 --session SESSION_ID --screenshot step-NAME.png
\`\`\`

This selects one finalized session compatible with the PR head, validates artifact hashes, uploads the selected screenshots/video, and posts only after every upload succeeds. Requires \`gh\` CLI to be authenticated.
Default upload mode uses the official GitHub contents API on a \`proofshot-artifacts\` branch. For GitHub-hosted attachment URLs, use \`proofshot pr --upload-provider github-web-attachments\`.

## Tips

- Always include a meaningful --description so the human knows what was tested
- Take screenshots before AND after key actions (e.g., before form submit, after redirect)
- If you find errors during verification, fix them and re-run the workflow
- Use \`proofshot pr\` after stopping to attach proof directly to the pull request
`;
  }
  if (agent === "cursor") {
    return `---
description: Visual verification of UI changes using ProofShot
globs: ["**/*.tsx", "**/*.jsx", "**/*.vue", "**/*.svelte", "**/*.html"]
---

After modifying UI files, visually verify changes with this workflow:

1. Start session: \`proofshot start --run "your-dev-command" --port PORT --description "what you are verifying"\`
   If the server is already running, omit --run.
2. Drive browser: Use \`proofshot exec\` commands to navigate, click, fill forms, and take screenshots
3. Stop session: \`proofshot stop\` to bundle video + screenshots + error report
4. (Optional) Post to PR: \`proofshot pr\` to upload proof to the GitHub PR
   Default provider uses the official contents API. Use \`--upload-provider github-web-attachments\` only if you specifically want GitHub attachment URLs.

Key proofshot exec commands:
- \`proofshot exec snapshot -i\` \u2014 see interactive elements
- \`proofshot exec click @e3\` \u2014 click an element
- \`proofshot exec fill @e2 "text"\` \u2014 fill a form field
- \`proofshot exec assert-visible "#selector"\` \u2014 record an expected selector
- \`proofshot exec screenshot step.png\` \u2014 capture a moment
`;
  }
  return `# ProofShot Visual Verification

After building or modifying UI features, verify with this workflow:

1. Start: \`proofshot start --run "your-dev-command" --port PORT --description "what you are verifying"\`
   If the server is already running, omit --run.
2. Test: Use \`proofshot exec\` to navigate, click, fill forms, take screenshots
3. Stop: \`proofshot stop\` \u2014 bundles video, screenshots, and error report
4. (Optional) Post to PR: \`proofshot pr\` \u2014 uploads proof to the GitHub PR
   Default provider uses the official contents API. Use \`--upload-provider github-web-attachments\` only if you specifically want GitHub attachment URLs.

Key proofshot exec commands:
- \`proofshot exec snapshot -i\` \u2014 see interactive elements
- \`proofshot exec click @e3\` \u2014 click an element
- \`proofshot exec fill @e2 "text"\` \u2014 fill a form field
- \`proofshot exec assert-visible "#selector"\` \u2014 record an expected selector
- \`proofshot exec screenshot step.png\` \u2014 capture a moment

Artifacts saved to ./proofshot-artifacts/ including video, screenshots, errors, and summary.
`;
}

// src/commands/install.ts
var MARKER_START = "<!-- proofshot:start -->";
var MARKER_END = "<!-- proofshot:end -->";
function getToolDefinitions() {
  const home = os.homedir();
  return [
    {
      name: "claude",
      displayName: "Claude Code",
      binaryName: "claude",
      configDir: path2.join(home, ".claude"),
      skillTarget: { strategy: "file", relativePath: "skills/proofshot/SKILL.md" },
      bundledSkill: "claude/SKILL.md",
      inlineAgent: "claude"
    },
    {
      name: "cursor",
      displayName: "Cursor",
      binaryName: "cursor",
      configDir: path2.join(home, ".cursor"),
      skillTarget: { strategy: "file", relativePath: "rules/proofshot.mdc" },
      bundledSkill: "cursor/proofshot.mdc",
      inlineAgent: "cursor"
    },
    {
      name: "codex",
      displayName: "Codex (OpenAI)",
      binaryName: "codex",
      configDir: path2.join(home, ".codex"),
      skillTarget: { strategy: "file", relativePath: "skills/proofshot/SKILL.md" },
      bundledSkill: "codex/SKILL.md",
      inlineAgent: "codex"
    },
    {
      name: "gemini",
      displayName: "Gemini CLI",
      binaryName: "gemini",
      configDir: path2.join(home, ".gemini"),
      skillTarget: { strategy: "append", relativePath: "GEMINI.md" },
      bundledSkill: "generic/PROOFSHOT.md",
      inlineAgent: "generic"
    },
    {
      name: "windsurf",
      displayName: "Windsurf",
      binaryName: "windsurf",
      configDir: path2.join(home, ".codeium", "windsurf"),
      skillTarget: { strategy: "append", relativePath: "memories/global_rules.md" },
      bundledSkill: "generic/PROOFSHOT.md",
      inlineAgent: "generic"
    },
    {
      name: "opencode",
      displayName: "OpenCode",
      binaryName: "opencode",
      configDir: path2.join(home, ".config", "opencode"),
      skillTarget: { strategy: "file", relativePath: "skills/proofshot/SKILL.md" },
      bundledSkill: "opencode/SKILL.md",
      inlineAgent: "codex"
    }
  ];
}
function isBinaryAvailable(binaryName) {
  const cmd = process.platform === "win32" ? `where ${binaryName}` : `which ${binaryName}`;
  try {
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function detectInstalledTools() {
  return getToolDefinitions().filter(
    (tool) => isBinaryAvailable(tool.binaryName) || fs2.existsSync(tool.configDir)
  );
}
function filterTools(detected, only, skip) {
  let tools = detected;
  if (only) {
    const onlySet = new Set(only.split(",").map((s) => s.trim().toLowerCase()));
    tools = tools.filter((t) => onlySet.has(t.name));
  }
  if (skip) {
    const skipSet = new Set(skip.split(",").map((s) => s.trim().toLowerCase()));
    tools = tools.filter((t) => !skipSet.has(t.name));
  }
  return tools;
}
function getSkillContent(tool) {
  return readBundledSkill(tool.bundledSkill) ?? getInlineSkillContent(tool.inlineAgent);
}
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function installFile(tool, targetPath, content, force) {
  const exists = fs2.existsSync(targetPath);
  if (exists && !force) {
    const existing = fs2.readFileSync(targetPath, "utf-8");
    if (existing === content) {
      return {
        tool: tool.name,
        displayName: tool.displayName,
        status: "skipped",
        path: targetPath,
        message: "Already up to date"
      };
    }
  }
  fs2.writeFileSync(targetPath, content);
  return {
    tool: tool.name,
    displayName: tool.displayName,
    status: exists ? "updated" : "installed",
    path: targetPath
  };
}
function installAppend(tool, targetPath, content, force) {
  const markedContent = `${MARKER_START}
${content}
${MARKER_END}`;
  const exists = fs2.existsSync(targetPath);
  if (exists) {
    const existing = fs2.readFileSync(targetPath, "utf-8");
    if (existing.includes(MARKER_START)) {
      const regex = new RegExp(
        `${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}`
      );
      const updated = existing.replace(regex, markedContent);
      if (updated === existing && !force) {
        return {
          tool: tool.name,
          displayName: tool.displayName,
          status: "skipped",
          path: targetPath,
          message: "Already up to date"
        };
      }
      fs2.writeFileSync(targetPath, updated);
      return {
        tool: tool.name,
        displayName: tool.displayName,
        status: "updated",
        path: targetPath
      };
    }
    fs2.appendFileSync(targetPath, "\n\n" + markedContent + "\n");
    return {
      tool: tool.name,
      displayName: tool.displayName,
      status: "installed",
      path: targetPath
    };
  }
  fs2.writeFileSync(targetPath, markedContent + "\n");
  return {
    tool: tool.name,
    displayName: tool.displayName,
    status: "installed",
    path: targetPath
  };
}
function installForTool(tool, force) {
  const content = getSkillContent(tool);
  const targetPath = path2.join(tool.configDir, tool.skillTarget.relativePath);
  const targetDir = path2.dirname(targetPath);
  try {
    fs2.mkdirSync(targetDir, { recursive: true });
    if (tool.skillTarget.strategy === "file") {
      return installFile(tool, targetPath, content, force);
    } else {
      return installAppend(tool, targetPath, content, force);
    }
  } catch (error) {
    return {
      tool: tool.name,
      displayName: tool.displayName,
      status: "failed",
      path: targetPath,
      message: error.message
    };
  }
}
function checkboxSelect(tools) {
  return new Promise((resolve12) => {
    const selected = new Array(tools.length).fill(true);
    let cursor = 0;
    function render() {
      if (renderCount > 0) {
        process.stdout.write(`\x1B[${tools.length + 2}A`);
      }
      renderCount++;
      console.log(chalk.bold("Select tools to install:"));
      console.log("");
      for (let i = 0; i < tools.length; i++) {
        const check = selected[i] ? chalk.green("[x]") : chalk.dim("[ ]");
        const label = tools[i].displayName;
        const pointer = i === cursor ? chalk.green("> ") : "  ";
        console.log(`${pointer}${check} ${label}`);
      }
    }
    let renderCount = 0;
    render();
    console.log("");
    process.stdout.write(chalk.dim("  \u2191/\u2193 navigate \xB7 space toggle \xB7 enter confirm"));
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");
    function onData(key) {
      if (key === "") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        stdin.pause();
        process.stdout.write("\r\x1B[K\n");
        resolve12([]);
        return;
      }
      if (key === "\r" || key === "\n") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        stdin.pause();
        process.stdout.write("\r\x1B[K\n");
        resolve12(tools.filter((_, i) => selected[i]));
        return;
      }
      if (key === " ") {
        selected[cursor] = !selected[cursor];
        process.stdout.write("\r\x1B[K");
        process.stdout.write(`\x1B[1A`);
        render();
        console.log("");
        process.stdout.write(chalk.dim("  \u2191/\u2193 navigate \xB7 space toggle \xB7 enter confirm"));
        return;
      }
      if (key === "\x1B[A") {
        cursor = (cursor - 1 + tools.length) % tools.length;
        process.stdout.write("\r\x1B[K");
        process.stdout.write(`\x1B[1A`);
        render();
        console.log("");
        process.stdout.write(chalk.dim("  \u2191/\u2193 navigate \xB7 space toggle \xB7 enter confirm"));
        return;
      }
      if (key === "\x1B[B") {
        cursor = (cursor + 1) % tools.length;
        process.stdout.write("\r\x1B[K");
        process.stdout.write(`\x1B[1A`);
        render();
        console.log("");
        process.stdout.write(chalk.dim("  \u2191/\u2193 navigate \xB7 space toggle \xB7 enter confirm"));
        return;
      }
    }
    stdin.on("data", onData);
  });
}
async function installCommand(options) {
  const allDetected = detectInstalledTools();
  const tools = filterTools(allDetected, options.only, options.skip);
  if (tools.length === 0) {
    if (options.only || options.skip) {
      console.log(chalk.yellow("No matching AI tools found after applying filters."));
      console.log(
        chalk.dim(
          "Detected tools: " + (allDetected.map((t) => t.name).join(", ") || "none")
        )
      );
    } else {
      console.log(chalk.yellow("No AI coding tools detected on this machine."));
      console.log(chalk.dim("Looked for: claude, cursor, codex, gemini, windsurf, opencode"));
    }
    return;
  }
  let selectedTools = tools;
  if (process.stdin.isTTY) {
    console.log("");
    const picked = await checkboxSelect(tools);
    if (picked.length === 0) {
      console.log(chalk.dim("Aborted."));
      return;
    }
    selectedTools = picked;
  } else {
    console.log("");
    console.log(chalk.bold("Detected AI coding tools:"));
    console.log("");
    for (const tool of tools) {
      console.log(`  ${chalk.green("\u25CF")} ${tool.displayName}`);
    }
    console.log("");
  }
  const results = [];
  for (const tool of selectedTools) {
    const result = installForTool(tool, !!options.force);
    results.push(result);
    const icon = result.status === "failed" ? chalk.red("\u2717") : result.status === "skipped" ? chalk.dim("\u2013") : chalk.green("\u2713");
    const statusText = result.status === "installed" ? "Installed" : result.status === "updated" ? "Updated" : result.status === "skipped" ? "Skipped" : "Failed";
    const suffix = result.message ? chalk.dim(` (${result.message})`) : "";
    console.log(`${icon} ${tool.displayName}: ${statusText}${suffix}`);
    if (result.status !== "failed") {
      console.log(chalk.dim(`  \u2192 ${result.path}`));
    } else if (result.message) {
      console.log(chalk.red(`  ${result.message}`));
    }
  }
  const installed = results.filter(
    (r) => r.status === "installed" || r.status === "updated"
  ).length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log("");
  if (failed > 0) {
    console.log(chalk.yellow(`Done. ${installed} installed, ${failed} failed.`));
  } else if (installed > 0) {
    console.log(chalk.green(`Done! ProofShot skills installed for ${installed} tool(s).`));
    console.log("");
    console.log(`You're all set! In any project, tell your AI agent:`);
    console.log("");
    console.log(chalk.white(`  "Verify the changes visually with proofshot"`));
    console.log("");
  } else {
    console.log(chalk.dim("All tools already up to date."));
  }
}

// src/commands/start.ts
import * as path13 from "path";
import chalk2 from "chalk";

// src/utils/config.ts
import * as fs3 from "fs";
import * as path3 from "path";
var CONFIG_FILENAME = "proofshot.config.json";
var DEFAULT_CONFIG = {
  devServer: {
    port: 3e3,
    startupTimeout: 3e4
  },
  output: "./proofshot-artifacts",
  defaultPages: ["/"],
  viewport: { width: 1280, height: 720 },
  headless: true,
  browser: {
    ignoreHttpsErrors: false
  },
  logs: {
    stripAnsi: true,
    maxBytesPerSource: 5 * 1024 * 1024,
    sources: []
  }
};
function findConfigPath(startDir) {
  let dir = startDir || process.cwd();
  while (true) {
    const configPath = path3.join(dir, CONFIG_FILENAME);
    if (fs3.existsSync(configPath)) return configPath;
    const parent = path3.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function loadConfig(startDir) {
  const configPath = findConfigPath(startDir);
  if (!configPath) return { ...DEFAULT_CONFIG };
  try {
    const raw = fs3.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const configDir = path3.dirname(configPath);
    const resolvedBrowser = {
      ...DEFAULT_CONFIG.browser,
      ...parsed.browser
    };
    if (resolvedBrowser.configPath) {
      resolvedBrowser.configPath = path3.resolve(configDir, resolvedBrowser.configPath);
    }
    const environment = resolveEnvironmentConfig(parsed.environment, configDir);
    const logs = resolveLogsConfig(parsed.logs, configDir);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      output: path3.resolve(
        configDir,
        typeof parsed.output === "string" ? parsed.output : DEFAULT_CONFIG.output
      ),
      devServer: { ...DEFAULT_CONFIG.devServer, ...parsed.devServer },
      viewport: { ...DEFAULT_CONFIG.viewport, ...parsed.viewport },
      browser: resolvedBrowser,
      environment,
      logs
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function resolveEnvironmentConfig(value, configDir) {
  if (typeof value !== "object" || value === null) {
    return void 0;
  }
  const environment = value;
  if (environment.kind === "tmux") {
    const launch = environment.launch.kind === "panes" ? {
      ...environment.launch,
      panes: environment.launch.panes.map((pane) => ({
        ...pane,
        cwd: path3.resolve(configDir, pane.cwd || environment.cwd || ".")
      }))
    } : environment.launch;
    return {
      ...environment,
      cwd: path3.resolve(configDir, environment.cwd || "."),
      connection: environment.connection?.socket ? {
        ...environment.connection,
        socket: path3.resolve(configDir, environment.connection.socket)
      } : environment.connection,
      launch
    };
  }
  if (environment.kind === "processes") {
    return {
      ...environment,
      commands: environment.commands.map((command) => ({
        ...command,
        cwd: path3.resolve(configDir, command.cwd || ".")
      }))
    };
  }
  return void 0;
}
function resolveLogsConfig(value, configDir) {
  const logs = typeof value === "object" && value !== null ? value : DEFAULT_CONFIG.logs;
  const sources = (logs.sources || []).map(
    (source) => source.kind === "file" ? { ...source, path: path3.resolve(configDir, source.path) } : source
  );
  return {
    ...DEFAULT_CONFIG.logs,
    ...logs,
    sources
  };
}
function writeConfig(config, dir) {
  const configPath = path3.join(dir || process.cwd(), CONFIG_FILENAME);
  fs3.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return configPath;
}

// src/utils/exec.ts
import { execSync as execSync3 } from "child_process";

// src/utils/process.ts
import * as fs4 from "fs";
import {
  execFileSync,
  execSync as execSync2,
  spawn
} from "child_process";
function getShellExecutable(platform = process.platform, env = process.env) {
  if (platform === "win32") {
    return env.ComSpec || "cmd.exe";
  }
  return env.SHELL || "/bin/sh";
}
function spawnShellCommand(command, options = {}) {
  return spawn(command, {
    ...options,
    shell: getShellExecutable()
  });
}
function parseLinuxProcStat(stat) {
  const closeParen = stat.lastIndexOf(")");
  if (closeParen < 0) return null;
  const pid = Number(stat.slice(0, stat.indexOf(" ")));
  const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
  const processGroupId = Number(fields[2]);
  const sessionId = Number(fields[3]);
  const startTime = fields[19];
  if (!Number.isInteger(pid) || !Number.isInteger(processGroupId) || !Number.isInteger(sessionId) || !startTime) {
    return null;
  }
  return { pid, processGroupId, sessionId, startTime };
}
function parseUnixProcessIdentity(pid, output) {
  const match = output.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) return null;
  const processGroupId = Number(match[1]);
  const sessionId = Number(match[2]);
  const startTime = match[3];
  if (!Number.isInteger(processGroupId) || processGroupId <= 0 || !Number.isInteger(sessionId) || sessionId < 0 || !startTime) {
    return null;
  }
  return { pid, processGroupId, sessionId, startTime };
}
function isDetachedProcessIdentity(identity, platform = process.platform) {
  if (platform === "darwin") {
    return identity.processGroupId === identity.pid;
  }
  return identity.sessionId === identity.pid;
}
function captureProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") {
    try {
      const identity = parseLinuxProcStat(fs4.readFileSync(`/proc/${pid}/stat`, "utf-8"));
      const bootId = fs4.readFileSync("/proc/sys/kernel/random/boot_id", "utf-8").trim();
      if (!identity || !bootId) return null;
      return { ...identity, bootId };
    } catch {
      return null;
    }
  }
  if (process.platform !== "win32") {
    try {
      const sessionField = process.platform === "darwin" ? "sess=" : "sid=";
      const output = execFileSync(
        "ps",
        ["-o", "pgid=", "-o", sessionField, "-o", "lstart=", "-p", String(pid)],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
      );
      const identity = parseUnixProcessIdentity(pid, output);
      if (!identity) return null;
      if (process.platform !== "darwin") return identity;
      const bootId = execFileSync("sysctl", ["-n", "kern.boottime"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim();
      return bootId ? { ...identity, bootId } : null;
    } catch {
      return null;
    }
  }
  try {
    const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
    const startTime = execFileSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    if (!/^\d+$/.test(startTime)) return null;
    return { pid, processGroupId: pid, sessionId: pid, startTime };
  } catch {
    return null;
  }
}
function processIdentityMatches(identity) {
  const current = captureProcessIdentity(identity.pid);
  return Boolean(current && processIdentitiesMatch(current, identity));
}
function processIdentitiesMatch(left, right) {
  return left.pid === right.pid && left.processGroupId === right.processGroupId && left.sessionId === right.sessionId && left.startTime === right.startTime && left.bootId === right.bootId;
}
function listProcessGroupsInSession(sessionId) {
  const groups = /* @__PURE__ */ new Set();
  if (process.platform === "linux") {
    let entries = [];
    try {
      entries = fs4.readdirSync("/proc");
    } catch {
      return [];
    }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const identity = parseLinuxProcStat(
          fs4.readFileSync(`/proc/${entry}/stat`, "utf-8")
        );
        if (identity?.sessionId === sessionId) {
          groups.add(identity.processGroupId);
        }
      } catch {
      }
    }
    return [...groups];
  }
  if (process.platform !== "win32") {
    try {
      const sessionField = process.platform === "darwin" ? "sess=" : "sid=";
      const output = execFileSync("ps", ["-axo", `pgid=,${sessionField}`], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      for (const line of output.split(/\r?\n/)) {
        const match = line.trim().match(/^(\d+)\s+(\d+)$/);
        if (match && Number(match[2]) === sessionId) {
          groups.add(Number(match[1]));
        }
      }
    } catch {
      return [];
    }
  }
  return [...groups];
}
function processGroupIsAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function ownedProcessTreeIsAlive(identity) {
  if (process.platform === "win32") return processIdentityMatches(identity);
  const current = captureProcessIdentity(identity.pid);
  if (current && !processIdentitiesMatch(current, identity)) return false;
  if (process.platform === "darwin") {
    return processGroupIsAlive(identity.processGroupId);
  }
  return listProcessGroupsInSession(identity.sessionId).length > 0;
}
function signalOwnedTree(identity, signal) {
  if (process.platform === "win32") return false;
  const current = captureProcessIdentity(identity.pid);
  if (current && !processIdentitiesMatch(current, identity)) return false;
  if (!isDetachedProcessIdentity(identity)) return false;
  if (process.platform === "darwin") {
    if (!processGroupIsAlive(identity.processGroupId)) return false;
    try {
      process.kill(-identity.processGroupId, signal);
      return true;
    } catch {
      return false;
    }
  }
  const groups = listProcessGroupsInSession(identity.sessionId);
  if (groups.length === 0) return false;
  let signalled = false;
  for (const groupId of groups) {
    if (!Number.isInteger(groupId) || groupId <= 0) continue;
    try {
      process.kill(-groupId, signal);
      signalled = true;
    } catch {
    }
  }
  return signalled;
}
async function terminateOwnedProcessTree(identity, options = {}) {
  if (!identity) return false;
  if (process.platform === "win32") {
    if (!processIdentityMatches(identity)) return false;
    try {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(identity.pid)], {
        stdio: "pipe"
      });
      return true;
    } catch {
      return false;
    }
  }
  if (!ownedProcessTreeIsAlive(identity)) return false;
  const signalled = signalOwnedTree(identity, "SIGTERM");
  if (!signalled) return false;
  const graceMs = options.graceMs ?? 1500;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && ownedProcessTreeIsAlive(identity)) {
    await new Promise((resolve12) => setTimeout(resolve12, pollIntervalMs));
  }
  if (ownedProcessTreeIsAlive(identity)) {
    signalOwnedTree(identity, "SIGKILL");
    const killDeadline = Date.now() + 500;
    while (Date.now() < killDeadline && ownedProcessTreeIsAlive(identity)) {
      await new Promise((resolve12) => setTimeout(resolve12, pollIntervalMs));
    }
  }
  return true;
}
async function terminateOwnedProcess(identity, options = {}) {
  if (!identity || !processIdentityMatches(identity)) {
    return false;
  }
  const graceMs = options.graceMs ?? 1500;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  try {
    process.kill(identity.pid, "SIGTERM");
  } catch {
    return false;
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && processIdentityMatches(identity)) {
    await new Promise((resolve12) => setTimeout(resolve12, pollIntervalMs));
  }
  if (processIdentityMatches(identity)) {
    try {
      process.kill(identity.pid, "SIGKILL");
    } catch {
      return false;
    }
  }
  return true;
}
function terminateProcessTree(pid) {
  if (process.platform === "win32") {
    execSync2(`taskkill /F /T /PID ${pid}`, { stdio: "pipe" });
    return;
  }
  process.kill(-pid, "SIGKILL");
}
function findExecutablePath(command, platform = process.platform, execFn = execSync2) {
  try {
    const lookupCommand = platform === "win32" ? `where ${command}` : `command -v ${command}`;
    const output = execFn(lookupCommand, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return output.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}
function readCommandVersion(command, args = ["--version"], execFn = execSync2) {
  try {
    const output = execFn([command, ...args].join(" "), {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return output.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

// src/utils/exec.ts
var ProofShotError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "ProofShotError";
  }
};
var defaultAgentBrowserOptions = {};
function setAgentBrowserDefaults(options) {
  defaultAgentBrowserOptions = { ...options };
}
function getAgentBrowserEnvironment(options = {}) {
  const socketDir = options.socketDir ?? defaultAgentBrowserOptions.socketDir;
  return socketDir ? { ...process.env, AGENT_BROWSER_SOCKET_DIR: socketDir } : { ...process.env };
}
function quoteShellArgument(value) {
  const escaped = value.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}
function buildAgentBrowserCommand(command, options = {}) {
  const mergedOptions = {
    ...defaultAgentBrowserOptions,
    ...options
  };
  const configFlag = mergedOptions.configPath ? ` --config ${quoteShellArgument(mergedOptions.configPath)}` : "";
  const sessionFlag = mergedOptions.session ? ` --session ${quoteShellArgument(mergedOptions.session)}` : "";
  return `agent-browser${configFlag}${sessionFlag} ${command}`;
}
function ab(command, timeoutOrOptions = 3e4) {
  const options = typeof timeoutOrOptions === "number" ? { timeoutMs: timeoutOrOptions } : timeoutOrOptions;
  const fullCommand = buildAgentBrowserCommand(command, options);
  try {
    return execSync3(fullCommand, {
      encoding: "utf-8",
      timeout: options.timeoutMs ?? 3e4,
      stdio: ["pipe", "pipe", "pipe"],
      env: getAgentBrowserEnvironment(options)
    }).trim();
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || "";
    const message = stderr || error?.message || "Unknown error";
    throw new ProofShotError(
      `Browser command failed: ${fullCommand}
${message}`,
      error
    );
  }
}

// src/server/start.ts
import * as fs5 from "fs";
import { spawn as spawn2 } from "child_process";

// src/utils/port.ts
import * as net from "net";
async function isPortOpen(port, host = "localhost") {
  if (await tryConnect(port, host)) return true;
  if (host === "localhost") {
    const results = await Promise.all([
      tryConnect(port, "127.0.0.1"),
      tryConnect(port, "::1")
    ]);
    return results.some(Boolean);
  }
  return false;
}
function tryConnect(port, host) {
  return new Promise((resolve12) => {
    const socket = new net.Socket();
    socket.setTimeout(1e3);
    socket.on("connect", () => {
      socket.destroy();
      resolve12(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve12(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve12(false);
    });
    socket.connect(port, host);
  });
}
async function waitForPort(port, timeoutMs = 3e4, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(port)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for port ${port} after ${timeoutMs}ms`);
}

// src/server/start.ts
var SERVER_RUNNER_SOURCE = String.raw`
const fs = require('fs');
const { spawn } = require('child_process');
const [command, cwd, logPath, shell] = process.argv.slice(1);
const fd = fs.openSync(logPath, 'a');
let closed = false;
const write = (text) => {
  if (!closed) fs.writeSync(fd, Date.now() + '\t' + text + '\n');
};
const child = spawn(command, {
  cwd,
  shell,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const attach = (stream) => {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) write(line);
  });
  stream.on('end', () => {
    if (buffer) write(buffer);
    buffer = '';
  });
};
attach(child.stdout);
attach(child.stderr);
child.on('error', (error) => write(error.stack || error.message || String(error)));
child.on('close', (code) => {
  closed = true;
  fs.closeSync(fd);
  process.exit(code == null ? 1 : code);
});
`;
async function ensureDevServer(command, port, startupTimeout, logPath, onStarted) {
  if (await isPortOpen(port)) {
    throw new Error(
      `Port ${port} is already in use by a process ProofShot did not start.
Choose another port or stop that process explicitly, then retry.`
    );
  }
  const logFd = fs5.openSync(logPath, "a");
  fs5.closeSync(logFd);
  const proc = spawn2(process.execPath, [
    "-e",
    SERVER_RUNNER_SOURCE,
    command,
    process.cwd(),
    logPath,
    getShellExecutable()
  ], {
    stdio: "ignore",
    detached: true
  });
  proc.unref();
  let processIdentity = proc.pid ? captureProcessIdentity(proc.pid) : null;
  for (let attempt = 0; !processIdentity && attempt < 5; attempt++) {
    await new Promise((resolve12) => setTimeout(resolve12, 10));
    processIdentity = proc.pid ? captureProcessIdentity(proc.pid) : null;
  }
  if (!processIdentity || !isDetachedProcessIdentity(processIdentity)) {
    try {
      if (proc.pid) terminateProcessTree(proc.pid);
    } catch {
    }
    throw new Error("ProofShot could not record an exact identity for the dev server process.");
  }
  const result = { alreadyRunning: false, port, process: processIdentity };
  try {
    onStarted?.(result);
  } catch (error) {
    await terminateOwnedProcessTree(processIdentity);
    throw error;
  }
  try {
    await waitForPort(port, startupTimeout);
  } catch (error) {
    await terminateOwnedProcessTree(processIdentity);
    throw new Error(
      `Failed to start dev server with "${command}" on port ${port}.
Make sure the command is correct and the port is available.
Original error: ${error instanceof Error ? error.message : error}`
    );
  }
  await new Promise((resolve12) => setTimeout(resolve12, 1e3));
  return result;
}

// src/browser/session.ts
function buildOpenBrowserCommand(url, headless = true, browserConfig) {
  const flags = [];
  if (!headless) flags.push("--headed");
  if (browserConfig?.ignoreHttpsErrors) flags.push("--ignore-https-errors");
  if (browserConfig?.executablePath) flags.push(`--executable-path "${browserConfig.executablePath.replace(/"/g, '\\"')}"`);
  const suffix = flags.length > 0 ? ` ${flags.join(" ")}` : "";
  return `open ${quoteShellArgument(url)}${suffix}`;
}
function openBrowser(url, viewport, headless = true, sessionName, browserConfig) {
  try {
    ab(buildOpenBrowserCommand(url, headless, browserConfig), {
      timeoutMs: 6e4,
      session: sessionName
    });
  } catch (error) {
    const currentUrl = getPageUrl(sessionName);
    if (!isNavigationTimeout(error) || !urlsMatch(currentUrl, url)) {
      throw error;
    }
    console.warn(
      "Browser reached the target URL before its load event timed out; continuing with the active page."
    );
  }
  ab(`set viewport ${viewport.width} ${viewport.height}`, { session: sessionName });
}
function isNavigationTimeout(error) {
  return error instanceof ProofShotError && error.message.toLowerCase().includes("operation timed out");
}
function urlsMatch(actual, expected) {
  try {
    return new URL(actual).href === new URL(expected).href;
  } catch {
    return actual === expected;
  }
}
function closeBrowser(sessionName) {
  try {
    ab("close", { session: sessionName });
  } catch {
  }
}
function getConsoleErrors(sessionName) {
  try {
    return ab("errors", { session: sessionName });
  } catch {
    return "";
  }
}
function getConsoleOutput(sessionName) {
  try {
    return ab("console", { session: sessionName });
  } catch {
    return "";
  }
}
function getConsoleOutputJson(sessionName) {
  try {
    const raw = ab("console --json", { session: sessionName });
    const parsed = JSON.parse(raw);
    const messages = parsed?.data?.messages ?? parsed;
    return Array.isArray(messages) ? messages : [];
  } catch {
    return [];
  }
}
function getPageUrl(sessionName) {
  try {
    return ab("get url", { session: sessionName });
  } catch {
    return "";
  }
}

// src/browser/capture.ts
function startRecording(outputPath, sessionName) {
  ab(`record start ${outputPath}`, { timeoutMs: 1e4, session: sessionName });
}
function stopRecording(sessionName) {
  try {
    ab("record stop", { timeoutMs: 15e3, session: sessionName });
  } catch {
  }
}
function diffScreenshots(baseline, current, outputPath, sessionName) {
  try {
    const result = ab(`diff screenshot ${baseline} ${current} ${outputPath}`, {
      timeoutMs: 15e3,
      session: sessionName
    });
    const match = result.match(/([\d.]+)%/);
    return match ? parseFloat(match[1]) : null;
  } catch {
    return null;
  }
}

// src/browser/discovery.ts
import * as fs6 from "fs";
import * as os2 from "os";
import * as path4 from "path";
function isExecutable(filePath) {
  try {
    const stat = fs6.statSync(filePath);
    if (!stat.isFile()) return false;
    fs6.accessSync(filePath, fs6.constants.R_OK | fs6.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function sortedDirectories(root) {
  try {
    return fs6.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => b.localeCompare(a, void 0, { numeric: true }));
  } catch {
    return [];
  }
}
function cachedBrowserCandidates(home) {
  const candidates = [];
  const agentBrowserRoot = path4.join(home, ".agent-browser", "browsers");
  for (const directory of sortedDirectories(agentBrowserRoot)) {
    candidates.push(
      path4.join(agentBrowserRoot, directory, "chrome"),
      path4.join(agentBrowserRoot, directory, "chrome-linux64", "chrome"),
      path4.join(agentBrowserRoot, directory, "chrome-linux", "chrome")
    );
  }
  const playwrightRoot = path4.join(home, ".cache", "ms-playwright");
  for (const directory of sortedDirectories(playwrightRoot)) {
    if (!directory.startsWith("chromium")) continue;
    candidates.push(
      path4.join(playwrightRoot, directory, "chrome-linux64", "chrome"),
      path4.join(playwrightRoot, directory, "chrome-linux", "chrome"),
      path4.join(playwrightRoot, directory, "chrome-headless-shell-linux64", "chrome-headless-shell")
    );
  }
  const puppeteerRoot = path4.join(home, ".cache", "puppeteer", "chrome");
  for (const directory of sortedDirectories(puppeteerRoot)) {
    candidates.push(
      path4.join(puppeteerRoot, directory, "chrome-linux64", "chrome"),
      path4.join(puppeteerRoot, directory, "chrome-linux", "chrome")
    );
  }
  return candidates;
}
function accountHomeDirectory() {
  try {
    return os2.userInfo().homedir;
  } catch {
    return void 0;
  }
}
function discoverBrowserExecutable(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const executableLookup = options.findExecutable ?? findExecutablePath;
  const explicit = options.configuredPath || env.AGENT_BROWSER_EXECUTABLE_PATH;
  if (explicit) {
    const resolved = path4.resolve(explicit);
    if (!isExecutable(resolved)) {
      throw new Error(
        `Browser executable is not runnable: ${resolved}
Retry with: proofshot start --browser-executable ${JSON.stringify(resolved)}`
      );
    }
    return resolved;
  }
  const homes = /* @__PURE__ */ new Set();
  if (env.HOME) homes.add(path4.resolve(env.HOME));
  const accountHome = options.accountHome ?? accountHomeDirectory();
  if (accountHome) homes.add(path4.resolve(accountHome));
  if (platform === "linux") {
    const cached = [...homes].flatMap(cachedBrowserCandidates).find(isExecutable);
    if (cached) return cached;
  }
  const commandNames = platform === "darwin" ? ["google-chrome", "chromium"] : platform === "win32" ? ["chrome", "msedge"] : ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"];
  for (const command of commandNames) {
    const executable = executableLookup(command, platform);
    if (executable && isExecutable(executable)) return executable;
  }
  const candidates = [];
  if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  } else if (platform === "win32") {
    for (const root of [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]) {
      if (!root) continue;
      candidates.push(
        path4.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        path4.join(root, "Microsoft", "Edge", "Application", "msedge.exe")
      );
    }
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  }
  return candidates.find(isExecutable) ?? null;
}
function browserSetupError() {
  return new Error(
    "No runnable Chrome/Chromium executable was found for this environment.\nRun `agent-browser install` in this environment, then retry `proofshot start`."
  );
}

// src/browser/runtime.ts
import * as fs7 from "fs";
import * as os3 from "os";
import * as path5 from "path";
var UNIX_SOCKET_PATH_MAX_BYTES = 103;
function assertOwnedDirectory(directory) {
  const stat = fs7.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Agent-browser socket path is not a real directory: ${directory}`);
  }
  const uid = process.getuid?.();
  if (uid !== void 0 && stat.uid !== uid) {
    throw new Error(
      `Agent-browser socket directory is owned by uid ${stat.uid}, expected ${uid}: ${directory}`
    );
  }
  fs7.accessSync(directory, fs7.constants.R_OK | fs7.constants.W_OK | fs7.constants.X_OK);
  if (uid !== void 0) fs7.chmodSync(directory, 448);
}
function prepareAgentBrowserSocketDir(sessionName, env = process.env, accountHome = os3.userInfo().homedir) {
  const uid = process.getuid?.() ?? process.pid;
  const explicit = env.AGENT_BROWSER_SOCKET_DIR;
  const systemRuntime = `/run/user/${uid}`;
  let runtimeRoot = accountHome;
  if (!explicit && env.XDG_RUNTIME_DIR && path5.isAbsolute(env.XDG_RUNTIME_DIR)) {
    runtimeRoot = env.XDG_RUNTIME_DIR;
  } else if (!explicit && fs7.existsSync(systemRuntime)) {
    try {
      assertOwnedDirectory(systemRuntime);
      runtimeRoot = systemRuntime;
    } catch {
    }
  }
  const directory = explicit ? path5.resolve(explicit) : runtimeRoot === systemRuntime || runtimeRoot === env.XDG_RUNTIME_DIR ? path5.join(runtimeRoot, "proofshot", "agent-browser") : path5.join("/tmp", `proofshot-${uid}`, "agent-browser");
  fs7.mkdirSync(directory, { recursive: true, mode: 448 });
  assertOwnedDirectory(directory);
  const socketPath = path5.join(directory, `${sessionName}.sock`);
  const byteLength = Buffer.byteLength(socketPath);
  if (byteLength > UNIX_SOCKET_PATH_MAX_BYTES) {
    throw new Error(
      `Agent-browser socket path is ${byteLength} bytes (max ${UNIX_SOCKET_PATH_MAX_BYTES}): ${socketPath}
Set AGENT_BROWSER_SOCKET_DIR to a shorter user-owned directory and retry.`
    );
  }
  return directory;
}
function captureAgentBrowserProcessIdentity(socketDir, sessionName) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) return null;
  try {
    assertOwnedDirectory(socketDir);
    const pidPath = path5.join(socketDir, `${sessionName}.pid`);
    const pid = Number(fs7.readFileSync(pidPath, "utf-8").trim());
    const identity = captureProcessIdentity(pid);
    if (!identity || !isDetachedProcessIdentity(identity)) return null;
    return identity;
  } catch {
    return null;
  }
}
async function waitForAgentBrowserProcessIdentity(socketDir, sessionName, timeoutMs = 2e3, pollIntervalMs = 25) {
  const deadline = Date.now() + timeoutMs;
  do {
    const identity = captureAgentBrowserProcessIdentity(socketDir, sessionName);
    if (identity) {
      return identity;
    }
    await new Promise((resolve12) => setTimeout(resolve12, pollIntervalMs));
  } while (Date.now() < deadline);
  return captureAgentBrowserProcessIdentity(socketDir, sessionName);
}
function clearAgentBrowserSessionFiles(socketDir, sessionName) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) {
    throw new Error(`Unsafe agent-browser session name: ${sessionName}`);
  }
  assertOwnedDirectory(socketDir);
  const uid = process.getuid?.();
  for (const suffix of [".pid", ".sock"]) {
    const filePath = path5.join(socketDir, `${sessionName}${suffix}`);
    try {
      const stat = fs7.lstatSync(filePath);
      if (uid !== void 0 && stat.uid !== uid) {
        throw new Error(`Agent-browser sidecar is owned by uid ${stat.uid}: ${filePath}`);
      }
      fs7.unlinkSync(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

// src/artifacts/bundle.ts
import * as fs8 from "fs";
function ensureOutputDir(outputDir) {
  fs8.mkdirSync(outputDir, { recursive: true });
}
function generateTimestamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}
function generateSessionDirName(timestamp, description) {
  if (!description) return timestamp;
  const slug = description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");
  return slug ? `${timestamp}_${slug}` : timestamp;
}

// src/session/state.ts
import * as fs9 from "fs";
import * as path6 from "path";
import { createHash, randomUUID } from "crypto";
var SESSION_FILENAME = ".session.json";
function resolveSessionControlDir(configuredOutput, cwd = process.cwd()) {
  return path6.resolve(cwd, configuredOutput);
}
function saveSession(state, controlDir = state.outputDir) {
  fs9.mkdirSync(controlDir, { recursive: true });
  const sessionPath = path6.join(controlDir, SESSION_FILENAME);
  const temporaryPath = `${sessionPath}.${process.pid}.${randomUUID()}.tmp`;
  fs9.writeFileSync(temporaryPath, JSON.stringify(state, null, 2) + "\n", {
    mode: 384
  });
  fs9.renameSync(temporaryPath, sessionPath);
}
function loadSession(controlDir) {
  const sessionPath = path6.join(controlDir, SESSION_FILENAME);
  if (!fs9.existsSync(sessionPath)) return null;
  try {
    return JSON.parse(fs9.readFileSync(sessionPath, "utf-8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `ProofShot session state is corrupt: ${sessionPath}
${message}
Use "proofshot session list" to inspect durable recovery records.`
    );
  }
}
function hasActiveSession(controlDir) {
  return fs9.existsSync(path6.join(controlDir, SESSION_FILENAME));
}
function clearSession(controlDir) {
  const sessionPath = path6.join(controlDir, SESSION_FILENAME);
  if (fs9.existsSync(sessionPath)) {
    fs9.unlinkSync(sessionPath);
  }
}
function generateAgentBrowserSessionName(seed, nonce = randomUUID()) {
  const normalized = seed.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 8).replace(/-+$/g, "");
  const digest = createHash("sha256").update(`${seed}\0${nonce}`).digest("hex").slice(0, 12);
  return normalized ? `ps-${normalized}-${digest}` : `ps-${digest}`;
}

// src/environment/runtime.ts
import * as fs13 from "fs";
import * as net2 from "net";
import * as path9 from "path";

// src/environment/workers.ts
import * as fs11 from "fs";
import * as path7 from "path";
import { spawn as spawn3 } from "child_process";

// src/environment/evidence.ts
import * as fs10 from "fs";
var ANSI_PATTERN = (
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g
);
var CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g;
function normalizeLogText(text, stripAnsi = true) {
  const normalized = text.replace(/\r\n?/g, "\n").replace(CONTROL_PATTERN, "");
  return stripAnsi ? normalized.replace(ANSI_PATTERN, "") : normalized;
}
function appendEvidenceEvent(filePath, event) {
  fs10.appendFileSync(filePath, JSON.stringify(event) + "\n");
}
function loadEvidenceEvents(filePath) {
  if (!fs10.existsSync(filePath)) {
    return [];
  }
  return fs10.readFileSync(filePath, "utf-8").split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter((event) => event !== null);
}

// src/environment/workers.ts
var COMMON_WORKER_SOURCE = String.raw`
const fs = require('fs');
const config = JSON.parse(Buffer.from(process.argv[1], 'base64').toString('utf8'));
const ansiPattern = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const controlPattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g;
let bytesWritten = 0;
let truncated = false;
function normalize(text) {
  const normalized = text.replace(/\r\n?/g, '\n').replace(controlPattern, '');
  return config.stripAnsi ? normalized.replace(ansiPattern, '') : normalized;
}
function writeEvent(text, stream, segment = 'live', extra = {}) {
  const normalized = normalize(text);
  if (normalized.length === 0) return;
  const bytes = Buffer.byteLength(normalized);
  if (bytesWritten + bytes > config.maxBytes) {
    if (!truncated) {
      truncated = true;
      const now = Date.now();
      const event = {
        version: 1,
        origin: 'environment',
        group: config.source.group,
        sourceId: config.source.id,
        sourceTitle: config.source.title,
        stream,
        segment,
        timestamp: new Date(now).toISOString(),
        relativeTimeSec: Math.max(0, (now - config.startTimeMs) / 1000),
        text: '[ProofShot capture truncated at configured byte limit]',
        truncated: true,
      };
      fs.appendFileSync(config.evidencePath, JSON.stringify(event) + '\n');
      fs.appendFileSync(config.logPath, event.text + '\n');
    }
    return;
  }
  bytesWritten += bytes;
  const now = Date.now();
  const event = {
    version: 1,
    origin: 'environment',
    group: config.source.group,
    sourceId: config.source.id,
    sourceTitle: config.source.title,
    stream,
    segment,
    timestamp: new Date(now).toISOString(),
    relativeTimeSec: Math.max(0, (now - config.startTimeMs) / 1000),
    text: normalized,
    ...extra,
  };
  fs.appendFileSync(config.evidencePath, JSON.stringify(event) + '\n');
  fs.appendFileSync(config.logPath, normalized + '\n');
}
function attachLines(stream, streamName) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString().replace(/\r\n?/g, '\n');
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) writeEvent(line, streamName);
  });
  stream.on('end', () => {
    if (buffer.length > 0) writeEvent(buffer, streamName);
    buffer = '';
  });
}
if (config.pidFile) {
  fs.writeFileSync(config.pidFile, String(process.pid), { mode: 0o600 });
}
function removePidFile() {
  if (config.pidFile) {
    try { fs.unlinkSync(config.pidFile); } catch {}
  }
}
`;
var TMUX_PIPE_RUNNER_SOURCE = `${COMMON_WORKER_SOURCE}
attachLines(process.stdin, 'pty');
process.stdin.on('end', () => {
  removePidFile();
  process.exit(0);
});
process.on('SIGTERM', () => {
  removePidFile();
  process.exit(0);
});
`;
var PROCESS_RUNNER_SOURCE = `${COMMON_WORKER_SOURCE}
const { spawn } = require('child_process');
const child = spawn(config.command, {
  cwd: config.cwd,
  env: { ...process.env, ...config.env },
  shell: process.env.SHELL || '/bin/sh',
  stdio: ['ignore', 'pipe', 'pipe'],
});
attachLines(child.stdout, 'stdout');
attachLines(child.stderr, 'stderr');
child.on('error', (error) => writeEvent(error.stack || error.message || String(error), 'stderr'));
child.on('close', (code) => {
  writeEvent('[process exited with code ' + (code == null ? 'unknown' : code) + ']', 'stderr');
  removePidFile();
  process.exit(code == null ? 1 : code);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try { child.kill(signal); } catch {}
  });
}
`;
var FILE_RUNNER_SOURCE = `${COMMON_WORKER_SOURCE}
let offset = config.offset || 0;
let buffered = '';
function readAvailable() {
  let stat;
  try {
    stat = fs.statSync(config.filePath);
  } catch {
    return;
  }
  if (stat.size < offset) {
    offset = 0;
    writeEvent('[file rotated or truncated]', 'file', 'live', { captureGap: true });
  }
  if (stat.size === offset) return;
  const length = stat.size - offset;
  const fd = fs.openSync(config.filePath, 'r');
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, offset);
  fs.closeSync(fd);
  offset = stat.size;
  buffered += buffer.toString();
  const lines = buffered.split('\\n');
  buffered = lines.pop() || '';
  for (const line of lines) writeEvent(line, 'file');
}
const timer = setInterval(readAvailable, 100);
function stop() {
  clearInterval(timer);
  if (buffered.length > 0) writeEvent(buffered, 'file');
  removePidFile();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
`;
function buildTmuxPipeCommand(config) {
  const encodedConfig = encodeConfig(config);
  return [
    shellQuote(process.execPath),
    "-e",
    shellQuote(TMUX_PIPE_RUNNER_SOURCE),
    shellQuote(encodedConfig)
  ].join(" ");
}
async function waitForCaptureProcess(sourceId, pidFile, timeoutMs = 2e3) {
  const deadline = Date.now() + timeoutMs;
  do {
    const identity = readPidIdentity(pidFile);
    if (identity) {
      return { sourceId, process: identity, pidFile };
    }
    await new Promise((resolve12) => setTimeout(resolve12, 25));
  } while (Date.now() < deadline);
  throw new Error(`ProofShot could not capture the log helper identity for ${sourceId}.`);
}
async function startProcessCapture(definition, source, evidencePath, startTimeMs, maxBytes, stripAnsi) {
  const pidFile = `${source.logPath}.pid`;
  const config = {
    evidencePath,
    logPath: source.logPath,
    pidFile,
    startTimeMs,
    maxBytes,
    stripAnsi,
    source,
    command: definition.command,
    cwd: definition.cwd,
    env: definition.env
  };
  return startDetachedWorker(source.id, pidFile, PROCESS_RUNNER_SOURCE, config);
}
async function startFileCapture(filePath, source, evidencePath, startTimeMs, maxBytes, stripAnsi) {
  const pidFile = `${source.logPath}.pid`;
  let offset = 0;
  if (fs11.existsSync(filePath)) {
    const raw = fs11.readFileSync(filePath, "utf-8");
    appendHistory(
      raw,
      source,
      evidencePath,
      maxBytes,
      stripAnsi,
      "file"
    );
    offset = fs11.statSync(filePath).size;
  }
  const config = {
    evidencePath,
    logPath: source.logPath,
    pidFile,
    startTimeMs,
    maxBytes,
    stripAnsi,
    source,
    offset,
    filePath
  };
  return startDetachedWorker(source.id, pidFile, FILE_RUNNER_SOURCE, config);
}
function appendHistory(raw, source, evidencePath, maxBytes, stripAnsi, stream) {
  const normalized = normalizeLogText(raw, stripAnsi);
  const buffer = Buffer.from(normalized);
  const truncated = buffer.byteLength > maxBytes;
  const retained = truncated ? buffer.subarray(Math.max(0, buffer.byteLength - maxBytes)).toString("utf-8") : normalized;
  const lines = retained.split("\n").filter((line) => line.length > 0);
  fs11.appendFileSync(source.logPath, retained + (retained.endsWith("\n") ? "" : "\n"));
  for (const line of lines) {
    appendEvidenceEvent(evidencePath, {
      version: 1,
      origin: "environment",
      group: source.group,
      sourceId: source.id,
      sourceTitle: source.title,
      stream,
      segment: "history",
      timestamp: null,
      relativeTimeSec: null,
      text: line,
      truncated: truncated || void 0
    });
  }
}
function createWorkerConfig(params) {
  return params;
}
async function startDetachedWorker(sourceId, pidFile, workerSource, config) {
  fs11.mkdirSync(path7.dirname(pidFile), { recursive: true });
  const errorFd = fs11.openSync(`${pidFile}.stderr`, "a", 384);
  const worker = spawn3(process.execPath, ["-e", workerSource, encodeConfig(config)], {
    detached: true,
    stdio: ["ignore", "ignore", errorFd]
  });
  fs11.closeSync(errorFd);
  worker.unref();
  let identity = worker.pid ? captureProcessIdentity(worker.pid) : null;
  for (let attempt = 0; !identity && attempt < 20; attempt += 1) {
    await new Promise((resolve12) => setTimeout(resolve12, 10));
    identity = worker.pid ? captureProcessIdentity(worker.pid) : null;
  }
  if (!identity) {
    try {
      if (worker.pid) {
        process.kill(-worker.pid, "SIGKILL");
      }
    } catch {
    }
    throw new Error(`ProofShot could not capture the runner identity for ${sourceId}.`);
  }
  return { sourceId, process: identity, pidFile };
}
function readPidIdentity(pidFile) {
  try {
    const pid = Number(fs11.readFileSync(pidFile, "utf-8").trim());
    return captureProcessIdentity(pid);
  } catch {
    return null;
  }
}
function encodeConfig(config) {
  return Buffer.from(JSON.stringify(config)).toString("base64");
}
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// src/environment/tmux.ts
import * as fs12 from "fs";
import * as path8 from "path";
import { execFileSync as execFileSync2 } from "child_process";
async function startTmuxEnvironment(config, logs, sessionDir, proofShotSessionName, startTimeMs, onState) {
  assertTmuxAvailable();
  const evidencePath = path8.join(sessionDir, "environment.ndjson");
  const logsDir = path8.join(sessionDir, "logs");
  const captureDir = path8.join(sessionDir, ".capture");
  fs12.mkdirSync(logsDir, { recursive: true });
  fs12.mkdirSync(captureDir, { recursive: true, mode: 448 });
  fs12.writeFileSync(evidencePath, "", { flag: "a", mode: 384 });
  let state = null;
  let connection;
  try {
    connection = config.launch.kind === "panes" ? startOwnedTmux(config, proofShotSessionName, (startedConnection) => {
      const startedState = createTmuxState(
        config,
        startedConnection,
        evidencePath
      );
      state = startedState;
      onState(startedState);
    }) : await startExternalTmux(config);
    if (!state) {
      const connectedState = createTmuxState(
        config,
        connection,
        evidencePath
      );
      state = connectedState;
      onState(connectedState);
    }
  } catch (error) {
    if (state) {
      await stopTmuxEnvironment(state).catch(() => {
      });
    }
    throw error;
  }
  try {
    if (!state) {
      throw new Error("tmux environment ownership state was not initialized.");
    }
    let activeState = state;
    const tmuxSources = resolveTmuxSources(config, logs, connection);
    const panes = tmuxSources.map(
      ({ config: sourceConfig, mapping }) => resolvePane(
        connection.socketPath,
        sourceConfig,
        mapping,
        logsDir
      )
    );
    disambiguateTitles(panes);
    activeState = {
      ...activeState,
      panes: panes.map(({ pane }) => pane),
      sources: panes.map(({ source }) => source)
    };
    state = activeState;
    onState(activeState);
    for (const pane of panes) {
      const pipeStatus = tmuxExec(connection.socketPath, [
        "display-message",
        "-p",
        "-t",
        pane.pane.paneId,
        "#{pane_pipe}"
      ]);
      if (pipeStatus === "1") {
        throw new Error(
          `tmux pane ${pane.pane.paneId} already has a pipe-pane consumer.`
        );
      }
      const pidFile = path8.join(captureDir, `${pane.source.id}.pid`);
      const workerConfig = createWorkerConfig({
        evidencePath,
        logPath: pane.source.logPath,
        pidFile,
        startTimeMs,
        maxBytes: logs.maxBytesPerSource || 5 * 1024 * 1024,
        stripAnsi: logs.stripAnsi !== false,
        source: pane.source
      });
      tmuxExec(connection.socketPath, [
        "pipe-pane",
        "-t",
        pane.pane.paneId,
        buildTmuxPipeCommand(workerConfig)
      ]);
      pane.pane.captureAttached = true;
      activeState = {
        ...activeState,
        panes: activeState.panes.map(
          (ownedPane) => ownedPane.paneId === pane.pane.paneId ? { ...ownedPane, captureAttached: true } : ownedPane
        )
      };
      state = activeState;
      onState(activeState);
      const history = tmuxExec(connection.socketPath, [
        "capture-pane",
        "-p",
        "-S",
        "-",
        "-t",
        pane.pane.paneId
      ]);
      appendHistory(
        history,
        pane.source,
        evidencePath,
        logs.maxBytesPerSource || 5 * 1024 * 1024,
        logs.stripAnsi !== false,
        "pty"
      );
      appendEvidenceEvent(evidencePath, {
        version: 1,
        origin: "environment",
        group: pane.source.group,
        sourceId: pane.source.id,
        sourceTitle: pane.source.title,
        stream: "pty",
        segment: "history",
        timestamp: null,
        relativeTimeSec: null,
        text: "[tmux history/live capture boundary]",
        captureGap: true
      });
      const capture = await waitForCaptureProcess(pane.source.id, pidFile);
      activeState = {
        ...activeState,
        captures: [...activeState.captures, capture]
      };
      state = activeState;
      onState(activeState);
    }
    return activeState;
  } catch (error) {
    if (state) {
      await stopTmuxEnvironment(state).catch(() => {
      });
    }
    throw error;
  }
}
async function stopTmuxEnvironment(state) {
  if (!processIdentityMatches(state.serverProcess) && !fs12.existsSync(state.socket.path) && state.captures.every((capture) => !processIdentityMatches(capture.process))) {
    return;
  }
  assertSocketIdentity(state);
  if (!processIdentityMatches(state.serverProcess)) {
    throw new Error("tmux server identity changed; refusing widened cleanup.");
  }
  if (state.stopCommand) {
    await runCommand(state.stopCommand, state.stopCwd || process.cwd());
  } else if (state.ownsSession && tmuxHasSession(state)) {
    tmuxExec(state.socket.path, ["kill-session", "-t", state.sessionName]);
  } else {
    for (const pane of state.panes.filter(
      (candidate) => candidate.captureAttached
    )) {
      try {
        tmuxExec(state.socket.path, ["pipe-pane", "-t", pane.paneId]);
      } catch {
      }
    }
  }
  for (const capture of state.captures) {
    await terminateOwnedProcess(capture.process, { graceMs: 500 });
    if (processIdentityMatches(capture.process)) {
      throw new Error(`Log helper for ${capture.sourceId} did not stop.`);
    }
  }
  if (state.ownsServer && processIdentityMatches(state.serverProcess)) {
    try {
      tmuxExec(state.socket.path, ["kill-server"]);
    } catch {
      await terminateOwnedProcessTree(state.serverProcess, { graceMs: 500 });
    }
  }
  if (state.ownsServer && processIdentityMatches(state.serverProcess)) {
    throw new Error("Owned tmux server did not stop.");
  }
  if (state.ownsServer && fs12.existsSync(state.socket.path)) {
    const currentSocket = captureSocketIdentity(state.socket.path);
    if (currentSocket.inode !== state.socket.inode || currentSocket.uid !== state.socket.uid) {
      throw new Error("tmux socket changed before final cleanup.");
    }
    fs12.unlinkSync(state.socket.path);
  }
  if (state.ownsSession && tmuxHasSession(state)) {
    throw new Error(`Owned tmux session ${state.sessionName} did not stop.`);
  }
}
function startOwnedTmux(config, proofShotSessionName, onStarted) {
  if (config.launch.kind !== "panes" || config.launch.panes.length === 0) {
    throw new Error("tmux pane launch requires at least one pane.");
  }
  const uid = process.getuid?.() ?? process.pid;
  const socketDir = path8.join("/tmp", `proofshot-${uid}`, "tmux");
  fs12.mkdirSync(socketDir, { recursive: true, mode: 448 });
  const socketPath = path8.join(socketDir, `${proofShotSessionName}.sock`);
  if (fs12.existsSync(socketPath)) {
    throw new Error(`Refusing to reuse an existing tmux socket: ${socketPath}`);
  }
  const sessionName = config.launch.sessionName || proofShotSessionName;
  const [firstPane, ...remainingPanes] = config.launch.panes;
  const first = parsePaneOutput(
    tmuxExec(socketPath, [
      "new-session",
      "-d",
      "-P",
      "-F",
      "#{pane_id}	#{pane_index}	#{pane_pid}",
      "-s",
      sessionName,
      "-n",
      "environment",
      "-c",
      firstPane.cwd || config.cwd || process.cwd(),
      buildPaneCommand(firstPane)
    ])
  );
  const mappings = [
    {
      key: firstPane.id,
      paneId: first.paneId,
      title: firstPane.title,
      group: firstPane.group
    }
  ];
  configurePane(socketPath, first.paneId, firstPane.id, firstPane.title);
  onStarted({
    socketPath,
    sessionName,
    paneMappings: [...mappings],
    ownsServer: true,
    ownsSession: true
  });
  for (const pane of remainingPanes) {
    const created = parsePaneOutput(
      tmuxExec(socketPath, [
        "split-window",
        "-d",
        "-P",
        "-F",
        "#{pane_id}	#{pane_index}	#{pane_pid}",
        "-t",
        `${sessionName}:environment`,
        "-c",
        pane.cwd || config.cwd || process.cwd(),
        buildPaneCommand(pane)
      ])
    );
    configurePane(socketPath, created.paneId, pane.id, pane.title);
    mappings.push({
      key: pane.id,
      paneId: created.paneId,
      title: pane.title,
      group: pane.group
    });
  }
  tmuxExec(socketPath, ["select-layout", "-t", `${sessionName}:environment`, "tiled"]);
  return {
    socketPath,
    sessionName,
    paneMappings: mappings,
    ownsServer: true,
    ownsSession: true
  };
}
function createTmuxState(config, connection, evidencePath) {
  const serverPid = Number(
    tmuxExec(connection.socketPath, ["display-message", "-p", "#{pid}"])
  );
  const serverProcess = captureProcessIdentity(serverPid);
  if (!serverProcess) {
    throw new Error("ProofShot could not capture the exact tmux server identity.");
  }
  return {
    kind: "tmux",
    evidencePath,
    sources: [],
    socket: captureSocketIdentity(connection.socketPath),
    serverProcess,
    sessionName: connection.sessionName,
    ownsServer: connection.ownsServer,
    ownsSession: connection.ownsSession,
    panes: [],
    captures: [],
    stopCommand: config.launch.kind === "external-command" ? config.launch.stopCommand : void 0,
    stopCwd: config.cwd
  };
}
async function startExternalTmux(config) {
  if (config.launch.kind !== "external-command" || !config.connection) {
    throw new Error("External tmux launch requires a connection contract.");
  }
  const hintedSocket = config.connection.socket;
  const socketExistedBefore = hintedSocket ? fs12.existsSync(hintedSocket) : true;
  const output = await runCommand(
    config.launch.command,
    config.cwd || process.cwd()
  );
  const parsed = config.connection.format === "json" ? parseJsonConnection(output) : parseAttachCommand(output);
  const ownsCreatedSocket = hintedSocket !== void 0 && path8.resolve(hintedSocket) === path8.resolve(parsed.socketPath) && !socketExistedBefore;
  return {
    ...parsed,
    ownsServer: ownsCreatedSocket,
    ownsSession: ownsCreatedSocket
  };
}
function resolveTmuxSources(config, logs, connection) {
  const configured = (logs.sources || []).filter(
    (source) => source.kind === "tmux-pane"
  );
  if (configured.length > 0) {
    return configured.map((source) => {
      const connectionKey = "connectionKey" in source.match ? source.match.connectionKey : void 0;
      return {
        config: source,
        mapping: connectionKey ? connection.paneMappings.find(
          (mapping) => mapping.key === connectionKey
        ) : void 0
      };
    });
  }
  if (config.launch.kind !== "panes") {
    return [];
  }
  return connection.paneMappings.map((mapping) => ({
    config: {
      id: mapping.key,
      title: mapping.title,
      group: mapping.group,
      kind: "tmux-pane",
      match: { connectionKey: mapping.key }
    },
    mapping
  }));
}
function resolvePane(socketPath, sourceConfig, mapping, logsDir) {
  let target;
  if ("connectionKey" in sourceConfig.match) {
    if (!mapping) {
      throw new Error(
        `No tmux pane mapping matched connection key "${sourceConfig.match.connectionKey}".`
      );
    }
    target = mapping.paneId;
  } else if ("tag" in sourceConfig.match) {
    const tag = sourceConfig.match.tag;
    const matches = tmuxExec(socketPath, [
      "list-panes",
      "-a",
      "-F",
      "#{pane_id}	#{@proofshot-source}"
    ]).split("\n").filter((line) => line.split("	")[1] === tag);
    if (matches.length !== 1) {
      throw new Error(
        `Expected one tmux pane tagged "${tag}", found ${matches.length}.`
      );
    }
    target = matches[0].split("	")[0];
  } else {
    target = sourceConfig.match.target;
  }
  const fields = tmuxExec(socketPath, [
    "display-message",
    "-p",
    "-t",
    target,
    "#{pane_id}	#{pane_index}	#{pane_pid}	#{pane_title}	#{session_name}:#{window_name}.#{pane_index}"
  ]).split("	");
  if (fields.length !== 5) {
    throw new Error(`Could not resolve tmux pane metadata for ${target}.`);
  }
  const paneIndex = Number(fields[1]);
  const tmuxTitle = fields[3].trim();
  const title = mapping?.title || (tmuxTitle.length > 0 ? tmuxTitle : `Pane ${paneIndex}`);
  const group = sourceConfig.group || mapping?.group || "environment";
  const source = {
    id: sourceConfig.id,
    title,
    group,
    kind: "tmux-pane",
    stream: "pty",
    logPath: path8.join(logsDir, `${sourceConfig.id}.log`),
    include: sourceConfig.include,
    exclude: sourceConfig.exclude
  };
  return {
    source,
    pane: {
      paneId: fields[0],
      paneIndex,
      panePid: Number(fields[2]),
      sourceId: source.id,
      title,
      group,
      target: fields[4],
      captureAttached: false
    }
  };
}
function disambiguateTitles(panes) {
  const counts = /* @__PURE__ */ new Map();
  for (const pane of panes) {
    counts.set(pane.source.title, (counts.get(pane.source.title) || 0) + 1);
  }
  for (const pane of panes) {
    if ((counts.get(pane.source.title) || 0) > 1) {
      const title = `${pane.source.title} (Pane ${pane.pane.paneIndex})`;
      pane.source.title = title;
      pane.pane.title = title;
    }
  }
}
function configurePane(socketPath, paneId, sourceId, title) {
  validateId(sourceId);
  tmuxExec(socketPath, [
    "set-option",
    "-p",
    "-t",
    paneId,
    "@proofshot-source",
    sourceId
  ]);
  if (title) {
    tmuxExec(socketPath, ["select-pane", "-t", paneId, "-T", title]);
  }
}
function buildPaneCommand(pane) {
  const assignments = Object.entries(pane.env || {}).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
    return `${key}=${shellQuote2(value)}`;
  });
  return assignments.length > 0 ? `env ${assignments.join(" ")} ${pane.command}` : pane.command;
}
function parsePaneOutput(output) {
  const [paneId, paneIndex, panePid] = output.split("	");
  if (!paneId || !Number.isInteger(Number(paneIndex)) || !Number.isInteger(Number(panePid))) {
    throw new Error(`Unexpected tmux pane output: ${output}`);
  }
  return { paneId, paneIndex: Number(paneIndex), panePid: Number(panePid) };
}
function parseJsonConnection(output) {
  const parsed = JSON.parse(output);
  if (!parsed.tmux || !path8.isAbsolute(parsed.tmux.socket) || typeof parsed.tmux.session !== "string") {
    throw new Error("External launcher returned invalid tmux JSON.");
  }
  return {
    socketPath: parsed.tmux.socket,
    sessionName: parsed.tmux.session,
    paneMappings: parsed.tmux.panes || [],
    ownsServer: false,
    ownsSession: false
  };
}
function parseAttachCommand(output) {
  const match = output.match(
    /tmux\s+(?:(-S)\s+(\S+)|(-L)\s+(\S+)).*?attach(?:-session)?\s+-t\s+(\S+)/
  );
  if (!match) {
    throw new Error("External launcher did not emit a supported tmux attach command.");
  }
  const flag = match[1] || match[3];
  const value = stripShellQuotes(match[2] || match[4]);
  const sessionName = stripShellQuotes(match[5]);
  const socketPath = flag === "-S" ? path8.resolve(value) : execFileSync2(
    "tmux",
    ["-L", value, "display-message", "-p", "#{socket_path}"],
    { encoding: "utf-8" }
  ).trim();
  return {
    socketPath,
    sessionName,
    paneMappings: [],
    ownsServer: false,
    ownsSession: false
  };
}
function tmuxExec(socketPath, args) {
  return execFileSync2("tmux", ["-S", socketPath, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trimEnd();
}
function tmuxHasSession(state) {
  if (!processIdentityMatches(state.serverProcess)) {
    return false;
  }
  try {
    tmuxExec(state.socket.path, ["has-session", "-t", state.sessionName]);
    return true;
  } catch {
    return false;
  }
}
async function runCommand(command, cwd) {
  const child = spawnShellCommand(command, {
    cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const identity = child.pid ? captureProcessIdentity(child.pid) : null;
  if (!identity) {
    throw new Error("ProofShot could not capture the external launcher identity.");
  }
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise((resolve12, reject) => {
    child.once("error", reject);
    child.once("close", resolve12);
  });
  if (exitCode !== 0) {
    await terminateOwnedProcessTree(identity);
    throw new Error(
      `External environment command failed with code ${String(exitCode)}: ${stderr.trim()}`
    );
  }
  return stdout.trim();
}
function captureSocketIdentity(socketPath) {
  const stat = fs12.lstatSync(socketPath);
  if (!stat.isSocket() || stat.isSymbolicLink()) {
    throw new Error(`tmux socket is not an owned Unix socket: ${socketPath}`);
  }
  const uid = process.getuid?.();
  if (uid !== void 0 && stat.uid !== uid) {
    throw new Error(`tmux socket is owned by uid ${stat.uid}, expected ${uid}.`);
  }
  return { path: socketPath, inode: stat.ino, uid: stat.uid };
}
function assertSocketIdentity(state) {
  if (!fs12.existsSync(state.socket.path)) {
    if (!processIdentityMatches(state.serverProcess)) {
      return;
    }
    throw new Error("Owned tmux socket disappeared while its server is still alive.");
  }
  const current = captureSocketIdentity(state.socket.path);
  if (current.inode !== state.socket.inode || current.uid !== state.socket.uid) {
    throw new Error("tmux socket identity changed; refusing widened cleanup.");
  }
}
function assertTmuxAvailable() {
  try {
    execFileSync2("tmux", ["-V"], { stdio: "pipe" });
  } catch {
    throw new Error('tmux is required for environment.kind "tmux".');
  }
}
function validateId(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid log source id: ${id}`);
  }
}
function shellQuote2(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
function stripShellQuotes(value) {
  return value.replace(/^(['"])(.*)\1$/, "$2");
}

// src/environment/runtime.ts
async function startOwnedEnvironment(environment, logs, sessionDir, sessionName, startTimeMs, onState) {
  const fileSources = (logs.sources || []).filter(
    (source) => source.kind === "file"
  );
  if (!environment && fileSources.length === 0) {
    return null;
  }
  let state;
  if (environment?.kind === "tmux") {
    state = await startTmuxEnvironment(
      environment,
      logs,
      sessionDir,
      sessionName,
      startTimeMs,
      onState
    );
  } else {
    state = await startProcessEnvironment(
      environment?.kind === "processes" ? environment.commands : [],
      logs,
      sessionDir,
      startTimeMs,
      onState
    );
  }
  try {
    state = await attachFileSources(
      state,
      fileSources,
      logs,
      sessionDir,
      startTimeMs,
      onState
    );
    if (environment) {
      await waitForReadiness(environment.readiness || []);
    }
    return state;
  } catch (error) {
    await stopOwnedEnvironment(state).catch(() => {
    });
    throw error;
  }
}
async function stopOwnedEnvironment(state) {
  if (!state) {
    return;
  }
  switch (state.kind) {
    case "tmux":
      await stopTmuxEnvironment(state);
      return;
    case "processes":
      for (const capture of state.processes) {
        await terminateOwnedProcessTree(capture.process, { graceMs: 1e3 });
        if (ownedProcessTreeIsAlive(capture.process)) {
          throw new Error(`Environment process ${capture.sourceId} did not stop.`);
        }
      }
      return;
    default: {
      const exhaustiveState = state;
      return exhaustiveState;
    }
  }
}
async function startProcessEnvironment(definitions, logs, sessionDir, startTimeMs, onState) {
  const evidencePath = path9.join(sessionDir, "environment.ndjson");
  const logsDir = path9.join(sessionDir, "logs");
  fs13.mkdirSync(logsDir, { recursive: true });
  fs13.writeFileSync(evidencePath, "", { flag: "a", mode: 384 });
  const configuredSources = (logs.sources || []).filter(
    (source) => source.kind === "process"
  );
  const sources = configuredSources.length > 0 ? configuredSources : definitions.map((definition) => ({
    id: definition.id,
    title: definition.title,
    group: definition.group,
    kind: "process",
    processId: definition.id,
    include: void 0,
    exclude: void 0
  }));
  validateUniqueIds(sources.map((source) => source.id));
  let state = {
    kind: "processes",
    evidencePath,
    sources: [],
    processes: []
  };
  onState(state);
  try {
    for (const sourceConfig of sources) {
      const definition = definitions.find(
        (candidate) => candidate.id === sourceConfig.processId
      );
      if (!definition) {
        throw new Error(
          `Log source ${sourceConfig.id} references unknown process ${sourceConfig.processId}.`
        );
      }
      const source = {
        id: sourceConfig.id,
        title: sourceConfig.title || definition.title || definition.id,
        group: sourceConfig.group || definition.group || "environment",
        kind: "process",
        stream: "stdout",
        logPath: path9.join(logsDir, `${sourceConfig.id}.log`),
        include: sourceConfig.include,
        exclude: sourceConfig.exclude
      };
      const process2 = await startProcessCapture(
        definition,
        source,
        evidencePath,
        startTimeMs,
        logs.maxBytesPerSource || 5 * 1024 * 1024,
        logs.stripAnsi !== false
      );
      state = {
        ...state,
        sources: [...state.sources, source],
        processes: [...state.processes, process2]
      };
      onState(state);
    }
    return state;
  } catch (error) {
    await stopOwnedEnvironment(state).catch(() => {
    });
    throw error;
  }
}
async function attachFileSources(state, fileSources, logs, sessionDir, startTimeMs, onState) {
  if (fileSources.length === 0) {
    return state;
  }
  const knownIds = new Set(state.sources.map((source) => source.id));
  const logsDir = path9.join(sessionDir, "logs");
  for (const fileSource of fileSources) {
    if (knownIds.has(fileSource.id)) {
      throw new Error(`Duplicate log source id: ${fileSource.id}`);
    }
    knownIds.add(fileSource.id);
    const source = {
      id: fileSource.id,
      title: fileSource.title || path9.basename(fileSource.path),
      group: fileSource.group || "environment",
      kind: "file",
      stream: "file",
      logPath: path9.join(logsDir, `${fileSource.id}.log`),
      include: fileSource.include,
      exclude: fileSource.exclude
    };
    const capture = await startFileCapture(
      fileSource.path,
      source,
      state.evidencePath,
      startTimeMs,
      logs.maxBytesPerSource || 5 * 1024 * 1024,
      logs.stripAnsi !== false
    );
    state = state.kind === "tmux" ? {
      ...state,
      sources: [...state.sources, source],
      captures: [...state.captures, capture]
    } : {
      ...state,
      sources: [...state.sources, source],
      processes: [...state.processes, capture]
    };
    onState(state);
  }
  return state;
}
async function waitForReadiness(checks) {
  for (const check of checks) {
    const timeoutMs = check.timeoutMs || 30 * 1e3;
    const deadline = Date.now() + timeoutMs;
    let lastError = "not ready";
    while (Date.now() < deadline) {
      try {
        if (check.kind === "http") {
          const response = await fetch(check.url, {
            signal: AbortSignal.timeout(Math.min(2e3, timeoutMs))
          });
          if (response.ok) {
            lastError = "";
            break;
          }
          lastError = `HTTP ${response.status}`;
        } else {
          await connectTcp(check.host || "127.0.0.1", check.port);
          lastError = "";
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve12) => setTimeout(resolve12, 100));
    }
    if (lastError) {
      const target = check.kind === "http" ? check.url : `${check.host || "127.0.0.1"}:${check.port}`;
      throw new Error(`Environment readiness failed for ${target}: ${lastError}`);
    }
  }
}
function connectTcp(host, port) {
  return new Promise((resolve12, reject) => {
    const socket = net2.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("TCP readiness timed out"));
    }, 2e3);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve12();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
function validateUniqueIds(ids) {
  const seen = /* @__PURE__ */ new Set();
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid log source id: ${id}`);
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate log source id: ${id}`);
    }
    seen.add(id);
  }
}

// src/session/lifecycle.ts
function resolveOwnedBrowserIdentity(session) {
  return session.browserProcess || (session.agentBrowserSocketDir ? captureAgentBrowserProcessIdentity(
    session.agentBrowserSocketDir,
    session.sessionName
  ) : null);
}
function canAddressOwnedBrowserSession(session) {
  const identity = resolveOwnedBrowserIdentity(session);
  return Boolean(identity && processIdentityMatches(identity));
}
async function stopOwnedBrowser(session) {
  const identity = resolveOwnedBrowserIdentity(session);
  if (!identity && session.browserLaunchAttempted) {
    throw new Error(
      `Could not recover exact browser ownership for ${session.sessionName}; cleanup state was retained.`
    );
  }
  assertIdentityNotReused(identity, "browser");
  if (identity && processIdentityMatches(identity)) {
    closeBrowser(session.sessionName);
  }
  await terminateOwnedProcessTree(identity);
  if (identity && ownedProcessTreeIsAlive(identity)) {
    throw new Error(`Owned browser process session ${identity.sessionId} did not stop.`);
  }
  if (session.agentBrowserSocketDir) {
    clearAgentBrowserSessionFiles(session.agentBrowserSocketDir, session.sessionName);
  }
}
async function stopOwnedServer(session) {
  assertIdentityNotReused(session.serverProcess, "server");
  await terminateOwnedProcessTree(session.serverProcess);
  if (session.serverProcess && ownedProcessTreeIsAlive(session.serverProcess)) {
    throw new Error(`Owned server process session ${session.serverProcess.sessionId} did not stop.`);
  }
}
function assertIdentityNotReused(identity, label) {
  if (!identity) return;
  const current = captureProcessIdentity(identity.pid);
  if (current && !processIdentitiesMatch(current, identity)) {
    throw new Error(
      `Owned ${label} process identity no longer matches PID ${identity.pid}; cleanup state was retained.`
    );
  }
}
async function cleanupFailedStart(session) {
  let cleanupError;
  if (!session.browserProcess && session.browserLaunchAttempted && session.agentBrowserSocketDir) {
    session.browserProcess = await waitForAgentBrowserProcessIdentity(
      session.agentBrowserSocketDir,
      session.sessionName
    );
  }
  if (session.browserLaunchAttempted && !session.browserProcess) {
    cleanupError = new Error(
      `Could not recover exact browser ownership for ${session.sessionName}; cleanup state was retained.`
    );
  }
  if (canAddressOwnedBrowserSession(session)) {
    stopRecording(session.sessionName);
  }
  if (session.browserProcess || !session.browserLaunchAttempted) {
    try {
      await stopOwnedBrowser(session);
    } catch (error) {
      cleanupError ||= error;
    }
  }
  try {
    await stopOwnedEnvironment(session.environment);
  } catch (error) {
    cleanupError ||= error;
  }
  try {
    await stopOwnedServer(session);
  } catch (error) {
    cleanupError ||= error;
  }
  if (cleanupError) throw cleanupError;
}

// src/session/registry.ts
import * as fs14 from "fs";
import * as os4 from "os";
import * as path10 from "path";
import { randomUUID as randomUUID2 } from "crypto";
var SESSION_REGISTRY_DIRECTORY = "sessions";
function getSessionRegistryDir(env = process.env, homeDir = os4.homedir()) {
  const stateHome = env.XDG_STATE_HOME || path10.join(homeDir, ".local", "state");
  return path10.join(stateHome, "proofshot", SESSION_REGISTRY_DIRECTORY);
}
function registerSession(session, registryDir = getSessionRegistryDir()) {
  validateSessionName(session.sessionName);
  prepareRegistryDirectory(registryDir);
  const registryPath = getRegistryPath(session.sessionName, registryDir);
  const temporaryPath = `${registryPath}.${process.pid}.${randomUUID2()}.tmp`;
  try {
    fs14.writeFileSync(temporaryPath, JSON.stringify(session, null, 2) + "\n", {
      mode: 384
    });
    fs14.renameSync(temporaryPath, registryPath);
  } finally {
    if (fs14.existsSync(temporaryPath)) {
      fs14.unlinkSync(temporaryPath);
    }
  }
}
function unregisterSession(sessionName, registryDir = getSessionRegistryDir()) {
  validateSessionName(sessionName);
  const registryPath = getRegistryPath(sessionName, registryDir);
  if (fs14.existsSync(registryPath)) {
    fs14.unlinkSync(registryPath);
  }
}
function listRegisteredSessions(registryDir = getSessionRegistryDir()) {
  if (!fs14.existsSync(registryDir)) {
    return [];
  }
  assertOwnedDirectory2(registryDir);
  return fs14.readdirSync(registryDir).filter((fileName) => fileName.endsWith(".json")).map((fileName) => readRegisteredSession(path10.join(registryDir, fileName))).filter((session) => session !== null).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}
function getRegisteredSession(sessionName, registryDir = getSessionRegistryDir()) {
  validateSessionName(sessionName);
  return readRegisteredSession(getRegistryPath(sessionName, registryDir));
}
function prepareRegistryDirectory(registryDir) {
  fs14.mkdirSync(registryDir, { recursive: true, mode: 448 });
  assertOwnedDirectory2(registryDir);
}
function assertOwnedDirectory2(directory) {
  const stat = fs14.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`ProofShot session registry is not a real directory: ${directory}`);
  }
  const uid = process.getuid?.();
  if (uid !== void 0 && stat.uid !== uid) {
    throw new Error(
      `ProofShot session registry is owned by uid ${stat.uid}, expected ${uid}: ${directory}`
    );
  }
  fs14.accessSync(directory, fs14.constants.R_OK | fs14.constants.W_OK | fs14.constants.X_OK);
  if (uid !== void 0) {
    fs14.chmodSync(directory, 448);
  }
}
function getRegistryPath(sessionName, registryDir) {
  return path10.join(registryDir, `${sessionName}.json`);
}
function validateSessionName(sessionName) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) {
    throw new Error(`Invalid ProofShot session name: ${sessionName}`);
  }
}
function readRegisteredSession(registryPath) {
  try {
    const stat = fs14.lstatSync(registryPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return null;
    }
    const parsed = JSON.parse(fs14.readFileSync(registryPath, "utf-8"));
    return isSessionState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function isSessionState(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const session = value;
  return typeof session.startedAt === "string" && (typeof session.description === "string" || session.description === null) && typeof session.outputDir === "string" && typeof session.sessionDir === "string" && typeof session.sessionName === "string" && typeof session.videoPath === "string" && typeof session.serverErrorLog === "string" && typeof session.port === "number" && (typeof session.serverCommand === "string" || session.serverCommand === null) && typeof session.serverAlreadyRunning === "boolean" && typeof session.recordingActive === "boolean" && isOptionalProcessIdentity(session.serverProcess) && isOptionalProcessIdentity(session.browserProcess);
}
function isOptionalProcessIdentity(value) {
  if (value === void 0 || value === null) {
    return true;
  }
  if (typeof value !== "object") {
    return false;
  }
  const identity = value;
  return Number.isInteger(identity.pid) && Number.isInteger(identity.processGroupId) && Number.isInteger(identity.sessionId) && typeof identity.startTime === "string";
}

// src/session/metadata.ts
import * as fs15 from "fs";
import * as path11 from "path";
var METADATA_FILENAME = "metadata.json";
function writeMetadata(sessionDir, metadata) {
  const metadataPath = path11.join(sessionDir, METADATA_FILENAME);
  fs15.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
}
function loadMetadata(sessionDir) {
  const metadataPath = path11.join(sessionDir, METADATA_FILENAME);
  if (!fs15.existsSync(metadataPath)) return null;
  try {
    return JSON.parse(fs15.readFileSync(metadataPath, "utf-8"));
  } catch {
    return null;
  }
}
function findSessionsForBranch(outputDir, branch) {
  if (!fs15.existsSync(outputDir)) return [];
  const entries = fs15.readdirSync(outputDir, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionDir = path11.join(outputDir, entry.name);
    const metadata = loadMetadata(sessionDir);
    if (metadata && metadata.branch === branch) {
      matches.push({ dir: sessionDir, startedAt: metadata.startedAt });
    }
  }
  matches.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return matches.map((m) => m.dir);
}

// src/session/manifest.ts
import * as fs16 from "fs";
import * as path12 from "path";
import { createHash as createHash2 } from "crypto";
import { execFileSync as execFileSync3 } from "child_process";
var MANIFEST_FILENAME = "artifact-manifest.json";
function captureGitProvenance(cwd = process.cwd()) {
  const git = (args) => execFileSync3("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  try {
    const repository = normalizeRepository(git(["remote", "get-url", "origin"]));
    const branch = git(["branch", "--show-current"]);
    const commitSha = git(["rev-parse", "HEAD"]);
    const treeHash = git(["rev-parse", "HEAD^{tree}"]);
    const sourceDirty = git(["status", "--porcelain", "--untracked-files=all"]) !== "";
    return { repository, branch, commitSha, treeHash, sourceDirty };
  } catch {
    return {
      repository: "",
      branch: "",
      commitSha: "",
      treeHash: "",
      sourceDirty: true
    };
  }
}
function normalizeRepository(remote) {
  return remote.trim().replace(/^git@([^:]+):/, "$1/").replace(/^ssh:\/\/git@/, "").replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/\/$/, "");
}
function writeArtifactManifest(options) {
  const finalized = options.finalizedProvenance || captureGitProvenance(options.metadata.repositoryRoot);
  const sourceDrift = (options.metadata.repository || "") !== finalized.repository || options.metadata.branch !== finalized.branch || options.metadata.commitSha !== finalized.commitSha || (options.metadata.treeHash || "") !== finalized.treeHash || options.metadata.sourceDirty !== false || finalized.sourceDirty;
  const artifacts = collectManifestArtifacts(
    options.sessionDir,
    options.evidence
  );
  const manifest = {
    version: 1,
    sessionId: options.sessionId,
    repository: options.metadata.repository || "",
    branch: options.metadata.branch,
    commitSha: options.metadata.commitSha,
    treeHash: options.metadata.treeHash || "",
    sourceDirty: options.metadata.sourceDirty !== false,
    sourceDrift,
    startedAt: options.metadata.startedAt,
    finalizedAt: (/* @__PURE__ */ new Date()).toISOString(),
    completion: "complete",
    verdict: options.verdict.status,
    artifacts
  };
  writeJsonAtomically(
    path12.join(options.sessionDir, MANIFEST_FILENAME),
    manifest
  );
  return manifest;
}
function loadArtifactManifest(sessionDir) {
  const manifestPath = path12.join(sessionDir, MANIFEST_FILENAME);
  try {
    if (fs16.lstatSync(sessionDir).isSymbolicLink() || fs16.lstatSync(manifestPath).isSymbolicLink()) {
      return null;
    }
    const parsed = JSON.parse(
      fs16.readFileSync(manifestPath, "utf-8")
    );
    if (parsed.version !== 1 || parsed.completion !== "complete" || !Array.isArray(parsed.artifacts)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function validateManifestArtifacts(sessionDir, manifest) {
  const root = fs16.realpathSync(sessionDir);
  const ids = /* @__PURE__ */ new Set();
  for (const artifact of manifest.artifacts) {
    if (ids.has(artifact.id)) {
      throw new Error(`Duplicate artifact ID: ${artifact.id}`);
    }
    ids.add(artifact.id);
    if (!artifact.path || path12.isAbsolute(artifact.path) || artifact.path.split(/[\\/]/).includes("..")) {
      throw new Error(`Unsafe artifact path: ${artifact.path}`);
    }
    const artifactPath = path12.resolve(sessionDir, artifact.path);
    const stat = fs16.lstatSync(artifactPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Artifact is not a regular file: ${artifact.path}`);
    }
    const realPath = fs16.realpathSync(artifactPath);
    if (!realPath.startsWith(`${root}${path12.sep}`)) {
      throw new Error(`Artifact escapes its session directory: ${artifact.path}`);
    }
    const contents = fs16.readFileSync(realPath);
    const hash = createHash2("sha256").update(contents).digest("hex");
    if (hash !== artifact.sha256 || contents.length !== artifact.size) {
      throw new Error(`Artifact hash mismatch: ${artifact.path}`);
    }
  }
}
function collectManifestArtifacts(sessionDir, evidence) {
  const screenshotOrder = new Map(
    evidence.actions.map((action) => action.action.match(/^screenshot\s+(.+)$/)?.[1]).filter((value) => Boolean(value)).map((value, index) => [path12.basename(value), index])
  );
  const candidates = listArtifactFiles(sessionDir).filter((file) => classifyArtifact(file) !== null).sort((left, right) => {
    const leftOrder = screenshotOrder.get(path12.basename(left));
    const rightOrder = screenshotOrder.get(path12.basename(right));
    if (leftOrder !== void 0 || rightOrder !== void 0) {
      return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return left.localeCompare(right);
  });
  return candidates.map((file, order) => {
    const contents = fs16.readFileSync(path12.join(sessionDir, file));
    const kind = classifyArtifact(file);
    return {
      id: `${kind}:${file}`,
      kind,
      path: file,
      sha256: createHash2("sha256").update(contents).digest("hex"),
      size: contents.length,
      order
    };
  });
}
function listArtifactFiles(root, current = root) {
  const files = [];
  for (const entry of fs16.readdirSync(current, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const absolutePath = path12.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...listArtifactFiles(root, absolutePath));
    } else if (entry.isFile()) {
      files.push(path12.relative(root, absolutePath));
    }
  }
  return files;
}
function classifyArtifact(file) {
  const basename8 = path12.basename(file);
  if (file.endsWith(".png")) return "screenshot";
  if (basename8 === "session.webm" || basename8 === "session.mp4") return "video";
  if (basename8 === "viewer.html") return "viewer";
  if (basename8 === "SUMMARY.md") return "summary";
  if (basename8 === "evidence.json") return "evidence";
  if (basename8 === "verdict.json") return "verdict";
  if (file.endsWith(".log") || file.endsWith(".ndjson")) return "log";
  return null;
}
function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs16.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + "\n", {
    mode: 384
  });
  fs16.renameSync(temporaryPath, filePath);
}

// src/commands/start.ts
async function startCommand(options) {
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);
  if (hasActiveSession(controlDir)) {
    if (options.force) {
      const existingSession = loadSession(controlDir);
      if (existingSession) {
        setAgentBrowserDefaults({
          configPath: existingSession.agentBrowserConfigPath || config.browser.configPath,
          socketDir: existingSession.agentBrowserSocketDir
        });
        await cleanupFailedStart(existingSession);
        unregisterSession(existingSession.sessionName);
      }
      clearSession(controlDir);
      console.log(chalk2.yellow("\u26A0") + chalk2.dim(" Cleaned up the previous session"));
    } else {
      console.log(
        chalk2.yellow("\u26A0 A session is already active.") + chalk2.dim(' Run "proofshot stop" first, or use --force to override.')
      );
      return;
    }
  }
  if (options.port) config.devServer.port = options.port;
  if (options.output) config.output = options.output;
  if (options.headed !== void 0) config.headless = !options.headed;
  const outputDir = path13.resolve(config.output);
  const timestamp = generateTimestamp();
  const sessionDirName = generateSessionDirName(timestamp, options.description || null);
  const sessionDir = path13.join(outputDir, sessionDirName);
  const sessionName = generateAgentBrowserSessionName(timestamp);
  let socketDir;
  let browserExecutable;
  try {
    socketDir = prepareAgentBrowserSocketDir(sessionName);
    browserExecutable = discoverBrowserExecutable({
      configuredPath: options.browserExecutable || config.browser.executablePath
    });
    if (!browserExecutable && !process.env.AGENT_BROWSER_PROVIDER && !process.env.AGENT_BROWSER_CDP) {
      throw browserSetupError();
    }
  } catch (error) {
    console.error(chalk2.red("\u2717") + ` Browser preflight failed: ${error.message}`);
    process.exit(1);
    return;
  }
  if (browserExecutable) config.browser.executablePath = browserExecutable;
  setAgentBrowserDefaults({ configPath: config.browser.configPath, socketDir });
  ensureOutputDir(outputDir);
  ensureOutputDir(sessionDir);
  const videoPath = path13.join(sessionDir, "session.webm");
  const serverErrorLog = path13.join(sessionDir, "server.log");
  const provenance = captureGitProvenance();
  writeMetadata(sessionDir, {
    ...provenance,
    repositoryRoot: process.cwd(),
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    description: options.description || null
  });
  const baseUrl = `http://localhost:${config.devServer.port}`;
  const openUrl = options.url || baseUrl;
  const session = {
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    startDirectory: process.cwd(),
    controlDir,
    lifecycleStatus: "starting",
    cleanupError: null,
    description: options.description || null,
    outputDir,
    sessionDir,
    sessionName,
    videoPath,
    serverErrorLog,
    port: config.devServer.port,
    serverCommand: options.run || null,
    serverAlreadyRunning: !options.run,
    recordingActive: false,
    browserLaunchAttempted: false,
    bundleComplete: false,
    browserRetained: false,
    videoTrimComplete: false,
    trimOffsetSec: 0,
    sessionLogAdjusted: false,
    consoleEvidenceAvailable: false,
    consoleErrorCount: 0,
    targetUrl: openUrl,
    headless: config.headless,
    agentBrowserSocketDir: socketDir,
    agentBrowserConfigPath: config.browser.configPath,
    serverProcess: null,
    browserProcess: null,
    environment: null,
    viewport: { width: config.viewport.width, height: config.viewport.height }
  };
  persistOwnedSession(session, controlDir);
  const signalHandlers = installStartSignalHandlers(session, controlDir);
  let failureContext = "start the session";
  try {
    if (options.run && config.environment) {
      throw new Error("Use either --run or config.environment, not both.");
    }
    if (config.environment || (config.logs?.sources || []).some((source) => source.kind === "file")) {
      failureContext = "start environment";
      session.environment = await startOwnedEnvironment(
        config.environment,
        config.logs || {},
        sessionDir,
        sessionName,
        new Date(session.startedAt).getTime(),
        (environmentState) => {
          session.environment = environmentState;
          persistOwnedSession(session, controlDir);
        }
      );
      console.log(chalk2.green("\u2713") + " Environment and log capture started");
    }
    if (options.run) {
      failureContext = "start dev server";
      console.log(chalk2.dim(`Starting: ${options.run}`));
      const server = await ensureDevServer(
        options.run,
        config.devServer.port,
        config.devServer.startupTimeout,
        serverErrorLog,
        (startedServer) => {
          session.serverAlreadyRunning = false;
          session.serverProcess = startedServer.process;
          persistOwnedSession(session, controlDir);
        }
      );
      session.serverAlreadyRunning = false;
      session.serverProcess = server.process;
      persistOwnedSession(session, controlDir);
      console.log(chalk2.green("\u2713") + ` Dev server started on :${config.devServer.port}`);
      console.log(chalk2.dim(`  Server logs \u2192 ${serverErrorLog}`));
    } else if (!config.environment) {
      console.log(chalk2.dim("No --run provided, assuming server is already running"));
    }
    failureContext = "open browser";
    console.log(chalk2.dim("Opening browser..."));
    session.browserLaunchAttempted = true;
    persistOwnedSession(session, controlDir);
    openBrowser(openUrl, config.viewport, config.headless, sessionName, config.browser);
    session.browserProcess = captureAgentBrowserProcessIdentity(socketDir, sessionName);
    if (!session.browserProcess) {
      throw new Error(
        `Could not record the exact agent-browser daemon identity for session ${sessionName}.`
      );
    }
    persistOwnedSession(session, controlDir);
    console.log(chalk2.green("\u2713") + " Browser ready");
    failureContext = "initialize recording";
    const RECORDING_RETRIES = 3;
    const RETRY_DELAY_MS = 2e3;
    let recordingStarted = false;
    let lastError;
    for (let attempt = 1; attempt <= RECORDING_RETRIES; attempt++) {
      try {
        startRecording(videoPath, sessionName);
        session.recordingStartedAt = (/* @__PURE__ */ new Date()).toISOString();
        recordingStarted = true;
        console.log(chalk2.green("\u2713") + " Recording started");
        break;
      } catch (error) {
        lastError = error;
        if (attempt < RECORDING_RETRIES) {
          console.log(
            chalk2.yellow("\u26A0") + ` Recording failed (attempt ${attempt}/${RECORDING_RETRIES}), retrying in ${RETRY_DELAY_MS / 1e3}s...`
          );
          await new Promise((resolve12) => setTimeout(resolve12, RETRY_DELAY_MS));
        }
      }
    }
    if (!recordingStarted) {
      throw new Error(
        `Recording did not start after ${RECORDING_RETRIES} attempts: ${lastError?.message}`
      );
    }
  } catch (error) {
    if (signalHandlers.isHandling()) {
      return;
    }
    signalHandlers.remove();
    const interruptionSignal = getTerminationSignal(error);
    try {
      await cleanupFailedStart(session);
      clearOwnedSession(session, controlDir);
      console.error(
        chalk2.red("\u2717") + ` Failed to ${failureContext}: ${error.message}
` + chalk2.dim("All processes started by this ProofShot attempt were cleaned up.")
      );
    } catch (cleanupError) {
      session.lifecycleStatus = "recovery";
      session.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      persistOwnedSession(session, controlDir);
      console.error(
        chalk2.red("\u2717") + ` Failed to ${failureContext}: ${error.message}
` + chalk2.yellow(`Cleanup is incomplete: ${session.cleanupError}
`) + chalk2.dim(`Run "proofshot session clean --session ${session.sessionName}" to retry.`)
      );
    }
    process.exit(
      interruptionSignal === "SIGINT" ? 130 : interruptionSignal === "SIGTERM" ? 143 : 1
    );
    return;
  }
  session.recordingActive = true;
  session.lifecycleStatus = "active";
  persistOwnedSession(session, controlDir);
  signalHandlers.remove();
  console.log("");
  console.log(chalk2.green.bold("\u2705 ProofShot session started"));
  console.log("");
  console.log(`Server:     ${options.run ? chalk2.cyan(options.run) : chalk2.dim("external")} on :${config.devServer.port}`);
  console.log(`Browser:    Chromium (${config.headless ? "headless" : "headed"})`);
  console.log(`Session:    ${chalk2.dim(sessionName)}`);
  console.log(`Target:     ${chalk2.dim(openUrl)}`);
  console.log(`Recording:  ${chalk2.dim(videoPath)}`);
  console.log(`Errors log: ${chalk2.dim(serverErrorLog)}`);
  if (options.description) {
    console.log(`Verifying:  ${chalk2.white(options.description)}`);
  }
  console.log("");
  console.log(chalk2.dim("Use proofshot exec to navigate and test:"));
  console.log(chalk2.dim("  proofshot exec snapshot -i            # See interactive elements"));
  console.log(chalk2.dim("  proofshot exec click @e3              # Click an element"));
  console.log(chalk2.dim('  proofshot exec fill @e2 "text"        # Fill a form field'));
  console.log(chalk2.dim("  proofshot exec screenshot step.png    # Capture a moment"));
  console.log("");
  console.log(`When done, run: ${chalk2.white("proofshot stop")}`);
}
function persistOwnedSession(session, controlDir) {
  saveSession(session, controlDir);
  registerSession(session);
}
function clearOwnedSession(session, controlDir) {
  clearSession(controlDir);
  unregisterSession(session.sessionName);
}
function installStartSignalHandlers(session, controlDir) {
  let handlingSignal = false;
  const handlers = /* @__PURE__ */ new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (handlingSignal) {
        return;
      }
      handlingSignal = true;
      void cleanupFailedStart(session).then(() => {
        clearOwnedSession(session, controlDir);
        process.exit(signal === "SIGINT" ? 130 : 143);
      }).catch((error) => {
        session.lifecycleStatus = "recovery";
        session.cleanupError = error instanceof Error ? error.message : String(error);
        persistOwnedSession(session, controlDir);
        process.exit(1);
      });
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return {
    isHandling: () => handlingSignal,
    remove: () => {
      for (const [signal, handler] of handlers) {
        process.removeListener(signal, handler);
      }
    }
  };
}
function getTerminationSignal(error) {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return null;
    }
    const candidate = current;
    if (candidate.signal === "SIGINT" || candidate.signal === "SIGTERM") {
      return candidate.signal;
    }
    current = candidate.cause;
  }
  return null;
}

// src/commands/stop.ts
import * as fs21 from "fs";
import * as path18 from "path";
import { randomUUID as randomUUID3 } from "crypto";
import { execFileSync as execFileSync5 } from "child_process";
import chalk3 from "chalk";

// src/artifacts/viewer.ts
import * as fs17 from "fs";
import * as path14 from "path";
var MAX_LOG_BYTES = 50 * 1024;
function truncateLog(log, maxBytes) {
  if (log.length <= maxBytes) return { text: log, truncated: false };
  const cut = log.slice(0, maxBytes);
  const lastNl = cut.lastIndexOf("\n");
  return { text: lastNl > 0 ? cut.slice(0, lastNl) : cut, truncated: true };
}
function isErrorLine(line) {
  const t = line.trim();
  if (!t) return false;
  return /\bError:|ERR[_!]|FATAL\b|CRITICAL\b|panic:|Exception:|Traceback/i.test(t);
}
function buildLogLines(text) {
  if (!text.trim()) return "";
  return text.split("\n").map((line, i) => {
    const num = i + 1;
    const cls = isErrorLine(line) ? "log-line log-line-error" : "log-line";
    return `<span class="${cls}"><span class="log-ln">${num}</span>${escapeHtml(line)}</span>`;
  }).join("\n");
}
var MAX_LOG_ENTRIES = 2e3;
function buildTimestampedLogLines(entries) {
  if (entries.length === 0) return { html: "", truncated: false };
  const truncated = entries.length > MAX_LOG_ENTRIES;
  const capped = truncated ? entries.slice(0, MAX_LOG_ENTRIES) : entries;
  const html = capped.map((entry, i) => {
    const num = i + 1;
    const cls = isErrorLine(entry.text) ? "log-line log-line-error" : "log-line";
    const timed = Number.isFinite(entry.relativeTimeSec);
    const time = formatTime(timed ? Math.max(0, entry.relativeTimeSec) : Number.NaN);
    const interaction = timed ? ` data-time="${entry.relativeTimeSec}" onclick="seekTo(${entry.relativeTimeSec})"` : "";
    return `<span class="${cls}"${interaction}><span class="log-time">${time}</span><span class="log-ln">${num}</span>${escapeHtml(entry.text)}</span>`;
  }).join("\n");
  return { html, truncated };
}
function getActionIcon(action) {
  const cmd = action.split(" ")[0].toLowerCase();
  switch (cmd) {
    case "open":
    case "navigate":
      return "\u{1F9ED}";
    // compass
    case "click":
      return "\u{1F5B1}";
    // mouse
    case "fill":
    case "type":
      return "\u2328";
    // keyboard
    case "screenshot":
      return "\u{1F4F7}";
    // camera
    case "snapshot":
      return "\u{1F441}";
    // eye
    case "scroll":
      return "\u2195";
    // scroll arrows
    case "press":
      return "\u2318";
    // key
    default:
      return "\u25B6";
  }
}
function formatTime(sec) {
  if (!Number.isFinite(sec)) {
    return "untimed";
  }
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function titleCase(value) {
  return value.split(/[-_\s]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}
function buildEvidencePanels(evidence) {
  const panels = [];
  for (const origin of ["environment", "browser"]) {
    const originEvents = evidence.events.filter(
      (event) => event.origin === origin && !event.presentationHidden
    );
    if (originEvents.length === 0) {
      continue;
    }
    const originLabel = origin === "environment" ? "Environment" : "Browser";
    panels.push({
      key: origin,
      label: originLabel,
      summary: null,
      events: orderEvidenceEvents(originEvents)
    });
    const sources = evidence.sources.filter((source) => source.origin === origin).sort(
      (left, right) => left.group.localeCompare(right.group) || left.title.localeCompare(right.title)
    );
    for (const source of sources) {
      panels.push({
        key: `${origin}-${source.id}`,
        label: origin === "environment" ? `${titleCase(source.group)} \xB7 ${source.title}` : source.title,
        summary: source,
        events: orderEvidenceEvents(
          originEvents.filter((event) => event.sourceId === source.id)
        )
      });
    }
  }
  return panels;
}
function orderEvidenceEvents(events) {
  return [...events].sort((left, right) => {
    if (left.segment !== right.segment) {
      return left.segment === "history" ? -1 : 1;
    }
    if (left.relativeTimeSec === null) {
      return -1;
    }
    if (right.relativeTimeSec === null) {
      return 1;
    }
    return left.relativeTimeSec - right.relativeTimeSec;
  });
}
function buildEvidenceLogLines(events) {
  if (events.length === 0) {
    return '<p class="log-empty">No visible evidence for this source</p>';
  }
  return `<pre class="log-pre">${events.slice(0, MAX_LOG_ENTRIES).map((event, index) => {
    const timed = event.relativeTimeSec !== null && Number.isFinite(event.relativeTimeSec);
    const classes = [
      "log-line",
      isErrorLine(event.text) ? "log-line-error" : ""
    ].filter(Boolean).join(" ");
    const interaction = timed ? ` data-time="${event.relativeTimeSec}" onclick="seekTo(${event.relativeTimeSec})"` : "";
    const boundary = event.captureGap ? '<span class="log-boundary">capture gap</span>' : event.segment === "history" ? '<span class="log-boundary">history</span>' : "";
    return `<span class="${classes}"${interaction}><span class="log-time">${formatTime(timed ? event.relativeTimeSec : Number.NaN)}</span><span class="log-ln">${index + 1}</span>${boundary}${escapeHtml(event.text)}</span>`;
  }).join("\n")}</pre>${events.length > MAX_LOG_ENTRIES ? '<p class="log-truncated">Viewer display truncated. Canonical evidence.json retains the bounded source evidence.</p>' : ""}`;
}
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function serializeEntries(entries) {
  return JSON.stringify(entries).replace(/<\//g, "<\\/");
}
function generateViewer(data) {
  const date = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19);
  const timelineDurationSec = data.evidence?.timelineDurationSec ?? data.durationSec;
  const stepsHtml = data.entries.map((entry, i) => {
    const icon = getActionIcon(entry.action);
    const time = formatTime(entry.relativeTimeSec);
    const action = escapeHtml(entry.action);
    const timed = Number.isFinite(entry.relativeTimeSec);
    const interaction = timed ? ` data-time="${entry.relativeTimeSec}" onclick="seekTo(${entry.relativeTimeSec})"` : "";
    return `      <div class="step${timed ? "" : " untimed"}"${interaction} data-index="${i}">
        <span class="step-number">${i + 1}</span>
        <span class="icon">${icon}</span>
        <div class="step-content">
          <span class="action">${action}</span>
        </div>
        <span class="time">${time}</span>
      </div>`;
  }).join("\n");
  const descriptionHtml = data.description ? `<p class="description" id="description"><span class="description-text">${escapeHtml(data.description)}</span><button class="show-more" id="showMoreBtn" style="display:none" onclick="toggleDescription()">Show more</button></p>` : "";
  const consoleEvidenceAvailable = data.consoleEvidenceAvailable !== false;
  const consoleBadgeClass = !consoleEvidenceAvailable ? "unavailable" : data.consoleErrorCount === 0 ? "clean" : "has-errors";
  const consoleBadgeText = !consoleEvidenceAvailable ? "Console: unavailable" : data.consoleErrorCount === 0 ? "Console: clean" : `Console: ${data.consoleErrorCount} error(s)`;
  const serverBadgeClass = data.serverErrorCount === 0 ? "clean" : "has-errors";
  const serverBadgeText = data.serverErrorCount === 0 ? "Server: clean" : `Server: ${data.serverErrorCount} error(s)`;
  const tokenUsageHtml = data.tokenUsage ? `<div class="token-usage">
      <div class="token-usage-title">Token Usage (Estimated)</div>
      <div class="token-usage-values">
        <span>In: ~${data.tokenUsage.inputTokens.toLocaleString()}</span>
        <span>Out: ~${data.tokenUsage.outputTokens.toLocaleString()}</span>
        <span>Total: ~${data.tokenUsage.totalTokens.toLocaleString()}</span>
        ${data.tokenUsage.estimatedCost > 0 ? `<span>Cost: ~$${data.tokenUsage.estimatedCost.toFixed(4)}</span>` : ""}
      </div>
      ${data.tokenUsage.source === "estimated" ? '<div class="token-usage-note">Estimated from session activity</div>' : ""}
    </div>` : "";
  const hasVideo = !!data.videoFilename;
  const markersJson = JSON.stringify(
    data.entries.map((entry, i) => ({
      time: entry.relativeTimeSec,
      icon: getActionIcon(entry.action),
      action: entry.action,
      index: i
    })).filter((marker) => Number.isFinite(marker.time))
  );
  const scrubBarHtml = hasVideo ? `<div class="scrub-bar">
        <div class="scrub-track" id="scrubTrack">
          <div class="scrub-progress" id="scrubProgress"></div>
          <div class="scrub-playhead" id="scrubPlayhead"></div>
          ${data.entries.filter((entry) => Number.isFinite(entry.relativeTimeSec)).map((entry, i) => {
    const pct = timelineDurationSec > 0 ? entry.relativeTimeSec / timelineDurationSec * 100 : 0;
    const icon = getActionIcon(entry.action);
    return `<div class="scrub-marker" data-index="${i}" data-time="${entry.relativeTimeSec}" style="left:${pct}%"><span class="scrub-marker-icon">${icon}</span></div>`;
  }).join("\n          ")}
        </div>
        <div class="scrub-tooltip" id="scrubTooltip"></div>
      </div>` : "";
  const videoPanelHtml = hasVideo ? `<div class="video-wrapper">
        <div class="video-container">
          <video src="./${escapeHtml(data.videoFilename)}" controls></video>
          <div class="video-overlay"></div>
        </div>
        ${scrubBarHtml}
      </div>` : `<div class="no-video"><p>No video recorded</p><p class="no-video-hint">Screenshots are available in the timeline</p></div>`;
  const entriesJson = serializeEntries(data.entries);
  let consoleLogBodyHtml;
  if (data.consoleEntries && data.consoleEntries.length > 0) {
    const built = buildTimestampedLogLines(data.consoleEntries);
    consoleLogBodyHtml = `<pre class="log-pre">${built.html}</pre>${built.truncated ? '<p class="log-truncated">Log truncated at 2000 entries. See console-output.log for full output.</p>' : ""}`;
  } else {
    const consoleTrunc = truncateLog(data.consoleOutput ?? "", MAX_LOG_BYTES);
    const consoleLogLines = buildLogLines(consoleTrunc.text);
    consoleLogBodyHtml = consoleLogLines ? `<pre class="log-pre">${consoleLogLines}</pre>${consoleTrunc.truncated ? '<p class="log-truncated">Log truncated at 50 KB. See console-output.log for full output.</p>' : ""}` : '<p class="log-empty">No console output captured</p>';
  }
  let serverLogBodyHtml;
  if (data.serverEntries && data.serverEntries.length > 0) {
    const built = buildTimestampedLogLines(data.serverEntries);
    serverLogBodyHtml = `<pre class="log-pre">${built.html}</pre>${built.truncated ? '<p class="log-truncated">Log truncated at 2000 entries. See server.log for full output.</p>' : ""}`;
  } else {
    const serverTrunc = truncateLog(data.serverLog ?? "", MAX_LOG_BYTES);
    const serverLogLines = buildLogLines(serverTrunc.text);
    serverLogBodyHtml = serverLogLines ? `<pre class="log-pre">${serverLogLines}</pre>${serverTrunc.truncated ? '<p class="log-truncated">Log truncated at 50 KB. See server.log for full output.</p>' : ""}` : '<p class="log-empty">No server log captured</p>';
  }
  const consoleLineCount = data.consoleEntries && data.consoleEntries.length > 0 ? data.consoleEntries.length : (data.consoleOutput ?? "").split("\n").filter((l) => l.trim()).length;
  const serverLineCount = data.serverEntries && data.serverEntries.length > 0 ? data.serverEntries.length : (data.serverLog ?? "").split("\n").filter((l) => l.trim()).length;
  const evidencePanels = data.evidence ? buildEvidencePanels(data.evidence) : [];
  const evidenceTabsHtml = evidencePanels.map(
    (panel, index) => `<button class="panel-tab" data-tab="evidence-${index}" onclick="switchTab('evidence-${index}')">${escapeHtml(panel.label)} &middot; ${panel.events.length}</button>`
  ).join("\n        ");
  const evidenceContentsHtml = evidencePanels.map((panel, index) => {
    const sourceIds = new Set(panel.events.map((event) => event.sourceId));
    const incidents = data.evidence?.incidents.filter(
      (incident) => incident.sourceIds.some((sourceId) => sourceIds.has(sourceId))
    ) || [];
    const summary = panel.summary;
    const status = summary ? `${summary.hiddenLineCount} hidden \xB7 ${summary.truncationCount} truncated \xB7 ${summary.captureGapCount} capture gap(s)` : `${incidents.length} grouped incident(s)`;
    const incidentsHtml = incidents.length > 0 ? `<div class="incident-list">${incidents.map(
      (incident) => `<div class="incident ${incident.severity}"><strong>${incident.severity.toUpperCase()} \xD7 ${incident.count}</strong> ${escapeHtml(incident.message)}</div>`
    ).join("")}</div>` : "";
    return `<div id="tab-evidence-${index}" class="panel-content" style="display:none">
        <div class="log-tab-content">
          <div class="log-tab-status"><span>${escapeHtml(status)}</span></div>
          ${incidentsHtml}
          ${buildEvidenceLogLines(panel.events)}
        </div>
      </div>`;
  }).join("\n      ");
  const environmentTabIndex = evidencePanels.findIndex(
    (panel) => panel.key === "environment"
  );
  const browserTabIndex = evidencePanels.findIndex(
    (panel) => panel.key === "browser"
  );
  const canonicalTabs = evidencePanels.length > 0;
  const verdictStatus = data.verdict?.status || "INCOMPLETE";
  const verdictBadgeClass = verdictStatus === "PASS" ? "clean" : verdictStatus === "FAIL" ? "has-errors" : "unavailable";
  const mediaWarningHtml = data.evidence?.mediaTruncated ? `<div class="media-warning">Media ends ${Math.max(0, data.evidence.mediaDivergenceSec || 0).toFixed(1)}s before the canonical action timeline. Timeline events remain authoritative; seeks clamp to available media.</div>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ProofShot \u2014 Verification Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      min-height: 100vh;
    }

    .header {
      padding: 24px 32px;
      border-bottom: 1px solid #21262d;
      background: #161b22;
    }

    .header h1 {
      font-size: 20px;
      font-weight: 600;
      color: #f0f6fc;
      margin-bottom: 8px;
    }

    .header .description {
      font-size: 14px;
      color: #8b949e;
      margin-bottom: 6px;
    }

    .header .description.clamped .description-text {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .header .description .show-more {
      background: none;
      border: none;
      color: #58a6ff;
      font-size: 12px;
      cursor: pointer;
      padding: 0;
      margin-top: 4px;
      display: block;
    }

    .header .description .show-more:hover {
      text-decoration: underline;
    }

    .header .meta {
      font-size: 12px;
      color: #484f58;
    }

    /* Overlay toggle controls */
    .overlay-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      position: relative;
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
      font-size: 12px;
    }

    .overlay-toggle .tooltip {
      display: none;
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 6px;
      background: #1c2128;
      color: #c9d1d9;
      font-size: 11px;
      padding: 6px 10px;
      border-radius: 6px;
      white-space: nowrap;
      pointer-events: none;
      border: 1px solid #30363d;
      z-index: 10;
    }

    .overlay-toggle:hover .tooltip {
      display: block;
    }

    .overlay-toggle input[type="checkbox"] {
      display: none;
    }

    .toggle-track {
      position: relative;
      width: 34px;
      height: 18px;
      background: #30363d;
      border-radius: 9px;
      transition: background 0.2s;
      flex-shrink: 0;
    }

    .toggle-track::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      background: #8b949e;
      border-radius: 50%;
      transition: transform 0.2s, background 0.2s;
    }

    .overlay-toggle input:checked + .toggle-track {
      background: #1f6feb;
    }

    .overlay-toggle input:checked + .toggle-track::after {
      transform: translateX(16px);
      background: #fff;
    }

    .error-badges {
      display: flex;
      gap: 12px;
      margin-top: 10px;
    }

    .token-usage {
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid #30363d;
      border-radius: 8px;
      background: #0d1117;
      max-width: fit-content;
    }

    .token-usage-title {
      font-size: 12px;
      color: #f0f6fc;
      font-weight: 600;
      margin-bottom: 6px;
    }

    .token-usage-values {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 12px;
      color: #8b949e;
      font-variant-numeric: tabular-nums;
    }

    .token-usage-note {
      margin-top: 6px;
      font-size: 11px;
      color: #6e7681;
    }

    .error-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
      font-family: inherit;
      line-height: inherit;
    }

    .error-badge:hover {
      opacity: 0.85;
      transform: translateY(-1px);
    }

    .error-badge.clean {
      background: rgba(63, 185, 80, 0.12);
      color: #3fb950;
      border: 1px solid rgba(63, 185, 80, 0.25);
    }

    .error-badge.has-errors {
      background: rgba(248, 81, 73, 0.12);
      color: #f85149;
      border: 1px solid rgba(248, 81, 73, 0.25);
    }

    .error-badge.unavailable {
      background: rgba(210, 153, 34, 0.12);
      color: #d29922;
      border: 1px solid rgba(210, 153, 34, 0.25);
    }

    .error-badge .badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }

    .error-badge.clean .badge-dot {
      background: #3fb950;
    }

    .error-badge.has-errors .badge-dot {
      background: #f85149;
    }

    .error-badge.unavailable .badge-dot {
      background: #d29922;
    }

    .viewer {
      display: flex;
      height: calc(100vh - 180px);
      min-height: 400px;
    }

    .video-panel {
      flex: 0 0 62%;
      padding: 16px;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      background: #0d1117;
      overflow: hidden;
    }

    .video-wrapper {
      width: 100%;
      display: flex;
      flex-direction: column;
    }

    .video-container {
      position: relative;
      width: 100%;
    }

    .video-container video {
      width: 100%;
      border-radius: 8px 8px 0 0;
      background: #000;
      display: block;
    }

    .video-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: hidden;
      border-radius: 8px 8px 0 0;
    }

    /* Scrub bar */
    .scrub-bar {
      position: relative;
      width: 100%;
      padding: 8px 0 6px;
      background: #161b22;
      border-radius: 0 0 8px 8px;
      border-top: 1px solid #21262d;
    }

    .scrub-track {
      position: relative;
      height: 6px;
      background: #21262d;
      border-radius: 3px;
      margin: 0 16px;
      cursor: pointer;
    }

    .scrub-track:hover {
      height: 8px;
      margin-top: -1px;
    }

    .scrub-progress {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: #58a6ff;
      border-radius: 3px;
      pointer-events: none;
      transition: width 0.1s linear;
    }

    .scrub-playhead {
      position: absolute;
      top: 50%;
      width: 14px;
      height: 14px;
      background: #f0f6fc;
      border: 2px solid #58a6ff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 3;
      box-shadow: 0 0 4px rgba(0,0,0,0.4);
      transition: left 0.1s linear;
    }

    .scrub-marker {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 2;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .scrub-marker-icon {
      font-size: 14px;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #21262d;
      border: 1.5px solid #30363d;
      border-radius: 50%;
      transition: all 0.15s;
    }

    .scrub-marker:hover .scrub-marker-icon,
    .scrub-marker.active .scrub-marker-icon {
      background: #1f2a37;
      border-color: #58a6ff;
      transform: scale(1.25);
    }

    .scrub-tooltip {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 8px;
      padding: 6px 10px;
      background: #1c2128;
      border: 1px solid #30363d;
      border-radius: 6px;
      font-size: 12px;
      color: #c9d1d9;
      white-space: nowrap;
      pointer-events: none;
      z-index: 20;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }

    .scrub-tooltip .tooltip-icon {
      margin-right: 4px;
    }

    .scrub-tooltip .tooltip-time {
      color: #58a6ff;
      margin-left: 6px;
      font-variant-numeric: tabular-nums;
    }

    .no-video {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 300px;
      border: 1px dashed #30363d;
      border-radius: 8px;
      color: #484f58;
      font-size: 15px;
    }

    .no-video-hint {
      font-size: 12px;
      margin-top: 8px;
      color: #30363d;
    }

    .timeline-panel {
      flex: 0 0 38%;
      border-left: 1px solid #21262d;
      overflow-y: auto;
      background: #161b22;
    }

    /* Tab bar */
    .panel-tabs {
      display: flex;
      align-items: center;
      padding: 0 12px;
      border-bottom: 1px solid #21262d;
      position: sticky;
      top: 0;
      background: #161b22;
      z-index: 10;
      gap: 0;
      overflow-x: auto;
    }

    .panel-tab {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: #8b949e;
      font-size: 13px;
      font-weight: 600;
      padding: 10px 16px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: color 0.15s, border-color 0.15s;
      white-space: nowrap;
      font-family: inherit;
    }

    .panel-tab:hover { color: #c9d1d9; }
    .panel-tab.active { color: #f0f6fc; border-bottom-color: #58a6ff; }

    .panel-tab-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
    }

    /* Log tab content */
    .log-tab-content {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .log-tab-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid #21262d;
      font-size: 12px;
    }

    .log-pre {
      margin: 0;
      padding: 12px 16px;
      background: #0d1117;
      font-family: 'SF Mono', SFMono-Regular, 'Consolas', 'Liberation Mono', Menlo, monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #c9d1d9;
      overflow-x: auto;
      white-space: pre;
      flex: 1;
      overflow-y: auto;
    }

    .log-pre::-webkit-scrollbar { width: 6px; height: 6px; }
    .log-pre::-webkit-scrollbar-track { background: transparent; }
    .log-pre::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    .log-pre::-webkit-scrollbar-thumb:hover { background: #484f58; }

    .log-line { display: block; }
    .log-line[data-time] { cursor: pointer; transition: background 0.15s; padding: 0 4px; margin: 0 -4px; border-radius: 2px; }
    .log-line[data-time]:hover { background: rgba(88, 166, 255, 0.08); }
    .log-line.active { background: #1f2a37; border-left: 3px solid #58a6ff; padding-left: 1px; }
    .log-line.active .log-time { color: #58a6ff; }

    .log-time {
      display: inline-block;
      min-width: 36px;
      padding-right: 8px;
      text-align: right;
      color: #484f58;
      user-select: none;
      font-variant-numeric: tabular-nums;
      font-size: 11px;
    }

    .log-ln {
      display: inline-block;
      min-width: 40px;
      padding-right: 12px;
      text-align: right;
      color: #484f58;
      user-select: none;
      font-variant-numeric: tabular-nums;
    }

    .log-line-error { background: rgba(248, 81, 73, 0.1); color: #f85149; }
    .log-line-error .log-ln { color: rgba(248, 81, 73, 0.5); }
    .log-line-error .log-time { color: rgba(248, 81, 73, 0.5); }
    .log-boundary {
      display: inline-block;
      margin-right: 8px;
      padding: 0 5px;
      border: 1px solid #30363d;
      border-radius: 8px;
      color: #8b949e;
      font-size: 10px;
    }
    .incident-list { padding: 8px 16px; border-bottom: 1px solid #21262d; }
    .incident { padding: 5px 0; font-size: 12px; color: #d29922; }
    .incident.fatal { color: #f85149; }
    .media-warning {
      padding: 8px 16px;
      border-bottom: 1px solid #9e6a03;
      background: rgba(187, 128, 9, 0.12);
      color: #d29922;
      font-size: 12px;
    }

    .log-empty {
      padding: 32px 16px;
      text-align: center;
      color: #484f58;
      font-size: 13px;
      font-style: italic;
    }

    .log-truncated {
      padding: 8px 16px;
      font-size: 11px;
      color: #484f58;
      font-style: italic;
      border-top: 1px solid #21262d;
      background: #161b22;
    }

    .step {
      display: flex;
      align-items: center;
      padding: 10px 20px;
      cursor: pointer;
      border-bottom: 1px solid #21262d;
      transition: background 0.15s;
      gap: 10px;
    }

    .step:hover {
      background: #1c2128;
    }
    .step.untimed { cursor: default; }

    .step.active {
      background: #1f2a37;
      border-left: 3px solid #58a6ff;
      padding-left: 17px;
    }

    .step-number {
      font-size: 11px;
      color: #484f58;
      min-width: 20px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .icon {
      font-size: 16px;
      min-width: 24px;
      text-align: center;
    }

    .step-content {
      flex: 1;
      min-width: 0;
    }

    .action {
      font-size: 13px;
      font-family: 'SF Mono', SFMono-Regular, 'Consolas', 'Liberation Mono', Menlo, monospace;
      color: #c9d1d9;
      word-break: break-all;
    }

    .step.active .action {
      color: #f0f6fc;
    }

    .time {
      font-size: 12px;
      color: #484f58;
      font-variant-numeric: tabular-nums;
      min-width: 36px;
      text-align: right;
    }

    .step.active .time {
      color: #58a6ff;
    }


    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 200px;
      color: #484f58;
      font-size: 14px;
    }

    /* Overlay animations */
    .ripple {
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
      transform: translate(-50%, -50%);
      animation: ripple-expand 600ms ease-out forwards;
    }

    @keyframes ripple-expand {
      0%   { width: 12px; height: 12px; opacity: 0.7; }
      100% { width: 60px; height: 60px; opacity: 0; }
    }

    .ripple-click  { background: rgba(56, 132, 255, 0.5); }
    .ripple-fill   { background: rgba(255, 152, 56, 0.5); }

    .scroll-indicator {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-size: 32px;
      opacity: 0.6;
      pointer-events: none;
      animation: fade-out 800ms ease-out forwards;
    }

    @keyframes fade-out {
      0%   { opacity: 0.6; }
      100% { opacity: 0; }
    }

    .toast {
      position: absolute;
      bottom: 32px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 500;
      pointer-events: none;
      animation: toast-in 200ms ease-out;
      white-space: nowrap;
      letter-spacing: 0.2px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }

    @keyframes toast-in {
      0%   { opacity: 0; transform: translateX(-50%) translateY(8px); }
      100% { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* Scrollbar styling */
    .timeline-panel::-webkit-scrollbar { width: 6px; }
    .timeline-panel::-webkit-scrollbar-track { background: transparent; }
    .timeline-panel::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    .timeline-panel::-webkit-scrollbar-thumb:hover { background: #484f58; }

    @media (max-width: 768px) {
      .viewer {
        flex-direction: column;
        height: auto;
      }
      .video-panel, .timeline-panel {
        flex: none;
        width: 100%;
      }
      .timeline-panel {
        border-left: none;
        border-top: 1px solid #21262d;
        max-height: 50vh;
      }
      .error-badges {
        flex-wrap: wrap;
      }
      .log-pre {
        max-height: 50vh;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width:24px;height:24px;vertical-align:middle;margin-right:8px"><path d="M8,24 L8,12 C8,8 12,8 12,8 L24,8" fill="none" stroke="#6366F1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M40,8 L52,8 C56,8 56,12 56,12 L56,24" fill="none" stroke="#6366F1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8,40 L8,52 C8,56 12,56 12,56 L24,56" fill="none" stroke="#6366F1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M40,56 L52,56 C56,56 56,52 56,52 L56,40" fill="none" stroke="#6366F1" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20,34 L28,42 L44,22" fill="none" stroke="#22D3EE" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>ProofShot Verification</h1>
    ${descriptionHtml}
    <p class="meta">${escapeHtml(date)} &middot; ${timelineDurationSec}s</p>
    <div class="error-badges">
      <span class="error-badge ${verdictBadgeClass}"><span class="badge-dot"></span>Verdict: ${verdictStatus}</span>
      ${canonicalTabs ? `${environmentTabIndex >= 0 ? `<button class="error-badge ${serverBadgeClass}" onclick="switchTab('evidence-${environmentTabIndex}')"><span class="badge-dot"></span>Environment</button>` : ""}
      ${browserTabIndex >= 0 ? `<button class="error-badge ${consoleBadgeClass}" onclick="switchTab('evidence-${browserTabIndex}')"><span class="badge-dot"></span>${consoleBadgeText}</button>` : ""}` : `<button class="error-badge ${consoleBadgeClass}" onclick="switchTab('console')"><span class="badge-dot"></span>${consoleBadgeText}</button>
      <button class="error-badge ${serverBadgeClass}" onclick="switchTab('server')"><span class="badge-dot"></span>${serverBadgeText}</button>`}
    </div>
    ${tokenUsageHtml}
  </div>
  <div class="viewer">
    <div class="video-panel">
      ${videoPanelHtml}
    </div>
    <div class="timeline-panel">
      <div class="panel-tabs">
        <button class="panel-tab active" data-tab="timeline" onclick="switchTab('timeline')">Timeline &middot; ${data.entries.length}</button>
        ${canonicalTabs ? evidenceTabsHtml : `<button class="panel-tab" data-tab="console" onclick="switchTab('console')">Console${consoleLineCount > 0 ? ` &middot; ${consoleLineCount}` : ""}</button>
        <button class="panel-tab" data-tab="server" onclick="switchTab('server')">Server${serverLineCount > 0 ? ` &middot; ${serverLineCount}` : ""}</button>`}
        <div class="panel-tab-actions" id="tabActionsTimeline">
          <label class="overlay-toggle"><input type="checkbox" id="toggle-overlays" checked><span class="toggle-track"></span> Overlays<span class="tooltip">Show ripple animations and action labels on the video as each step plays.</span></label>
        </div>
      </div>
      <div id="tabTimeline" class="panel-content" data-panel="timeline">
${mediaWarningHtml}
${stepsHtml}
      </div>
      ${canonicalTabs ? evidenceContentsHtml : `<div id="tabConsole" class="panel-content" data-panel="console" style="display:none">
        <div class="log-tab-content">
          <div class="log-tab-status">
            <span class="error-badge ${consoleBadgeClass}" style="cursor:default"><span class="badge-dot"></span>${consoleBadgeText}</span>
          </div>
          ${consoleLogBodyHtml}
        </div>
      </div>
      <div id="tabServer" class="panel-content" data-panel="server" style="display:none">
        <div class="log-tab-content">
          <div class="log-tab-status">
            <span class="error-badge ${serverBadgeClass}" style="cursor:default"><span class="badge-dot"></span>${serverBadgeText}</span>
          </div>
          ${serverLogBodyHtml}
        </div>
      </div>`}
    </div>
  </div>
  <script>
    // --- Description expand/collapse ---
    function initDescription() {
      const desc = document.getElementById('description');
      const btn = document.getElementById('showMoreBtn');
      if (!desc || !btn) return;
      const textEl = desc.querySelector('.description-text');
      // Clamp initially, then check if text overflows
      desc.classList.add('clamped');
      requestAnimationFrame(() => {
        if (textEl.scrollHeight > textEl.clientHeight + 1) {
          btn.style.display = 'block';
        }
      });
    }
    function toggleDescription() {
      const desc = document.getElementById('description');
      const btn = document.getElementById('showMoreBtn');
      if (!desc || !btn) return;
      const isClamped = desc.classList.contains('clamped');
      desc.classList.toggle('clamped');
      btn.textContent = isClamped ? 'Show less' : 'Show more';
    }
    initDescription();

    // --- Tab switching ---
    let activeTab = 'timeline';

    function switchTab(tab) {
      if (tab === activeTab) return;
      activeTab = tab;
      document.querySelectorAll('.panel-tab').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });
      var targetId = tab === 'timeline'
        ? 'tabTimeline'
        : tab === 'console'
          ? 'tabConsole'
          : tab === 'server'
            ? 'tabServer'
            : 'tab-' + tab;
      document.querySelectorAll('.panel-content').forEach(function(panel) {
        panel.style.display = panel.id === targetId ? '' : 'none';
      });
      var actions = document.getElementById('tabActionsTimeline');
      if (actions) actions.style.display = tab === 'timeline' ? '' : 'none';
    }

    const video = document.querySelector('video');
    const steps = document.querySelectorAll('.step');
    const timelinePanel = document.querySelector('.timeline-panel');
    const overlay = document.querySelector('.video-overlay');
    const entries = ${entriesJson};
    let duration = ${timelineDurationSec};
    const markers = ${markersJson};

    // Scrub bar elements
    const scrubTrack = document.getElementById('scrubTrack');
    const scrubProgress = document.getElementById('scrubProgress');
    const scrubPlayhead = document.getElementById('scrubPlayhead');
    const scrubTooltip = document.getElementById('scrubTooltip');
    const scrubMarkers = document.querySelectorAll('.scrub-marker');

    // --- Toggle state ---
    const toggleOverlays = document.getElementById('toggle-overlays');

    function loadToggleState() {
      try {
        const saved = JSON.parse(localStorage.getItem('proofshot-overlays') || '{}');
        if (saved.overlays === false) toggleOverlays.checked = false;
      } catch {}
    }
    function saveToggleState() {
      try {
        localStorage.setItem('proofshot-overlays', JSON.stringify({
          overlays: toggleOverlays.checked,
        }));
      } catch {}
    }
    loadToggleState();

    toggleOverlays.addEventListener('change', () => {
      if (!toggleOverlays.checked) clearOverlays();
      saveToggleState();
    });

    function clearOverlays() {
      if (!overlay) return;
      overlay.querySelectorAll('.ripple, .scroll-indicator, .toast').forEach(el => el.remove());
    }

    // --- Action icon (mirrors server-side getActionIcon) ---
    function getActionIconJS(action) {
      const cmd = action.split(' ')[0].toLowerCase();
      switch (cmd) {
        case 'open': case 'navigate': return '\\u{1F9ED}';
        case 'click': return '\\u{1F5B1}';
        case 'fill': case 'type': return '\\u2328';
        case 'screenshot': return '\\u{1F4F7}';
        case 'snapshot': return '\\u{1F441}';
        case 'scroll': return '\\u2195';
        case 'press': case 'keyboard': return '\\u2318';
        default: return '\\u25B6';
      }
    }

    // --- Toast text generation ---
    function getToastText(entry) {
      const action = entry.action;
      const parts = action.split(' ');
      const cmd = parts[0].toLowerCase();
      const label = entry.element ? entry.element.label : '';
      const icon = getActionIconJS(action);

      switch (cmd) {
        case 'click':
          return icon + '  Click' + (label ? ': ' + label : '');
        case 'fill': {
          const valMatch = action.match(/"([^"]*)"/);
          const val = valMatch ? valMatch[1] : '';
          const target = label || '';
          return icon + '  Type: ' + val + (target ? ' into ' + target : '');
        }
        case 'type': {
          const valMatch2 = action.match(/"([^"]*)"/);
          const val2 = valMatch2 ? valMatch2[1] : '';
          const target2 = label || '';
          return icon + '  Type: ' + val2 + (target2 ? ' into ' + target2 : '');
        }
        case 'scroll': {
          const dir = parts[1] || '';
          return icon + '  Scroll ' + dir;
        }
        case 'open': {
          const url = parts.slice(1).join(' ');
          try {
            return icon + '  Navigate: ' + new URL(url).pathname;
          } catch {
            return icon + '  Navigate: ' + url;
          }
        }
        case 'press':
          return icon + '  Press: ' + parts.slice(1).join(' ');
        case 'screenshot':
          return icon + '  Screenshot';
        default:
          return icon + '  ' + action;
      }
    }

    // --- Scroll direction arrows ---
    function getScrollArrow(action) {
      const parts = action.split(' ');
      const dir = (parts[1] || '').toLowerCase();
      switch (dir) {
        case 'up': return '\\u2191';
        case 'down': return '\\u2193';
        case 'left': return '\\u2190';
        case 'right': return '\\u2192';
        default: return '\\u2195';
      }
    }

    // --- Overlay scheduling ---
    const overlayWindows = entries.map((entry, i) => {
      const cmd = entry.action.split(' ')[0].toLowerCase();
      const nextTime = i + 1 < entries.length ? entries[i + 1].relativeTimeSec : entry.relativeTimeSec + 3;
      const rippleEnd = entry.relativeTimeSec + 0.6;
      const toastEnd = Math.min(nextTime, entry.relativeTimeSec + 3);
      const scrollEnd = entry.relativeTimeSec + 0.8;

      return {
        entry,
        cmd,
        rippleStart: entry.relativeTimeSec,
        rippleEnd: cmd === 'scroll' ? scrollEnd : rippleEnd,
        toastStart: entry.relativeTimeSec,
        toastEnd,
      };
    });

    const activeRipples = new Map();
    const activeToasts = new Map();
    let rafId = null;

    function renderOverlays() {
      if (!video || !overlay) return;
      const t = video.currentTime;
      const videoEl = video;

      overlayWindows.forEach((win, idx) => {
        const enabled = toggleOverlays.checked;

        // --- Ripple / scroll indicator ---
        if (enabled) {
          if (t >= win.rippleStart && t < win.rippleEnd && !activeRipples.has(idx)) {
            const el = document.createElement('div');

            if (win.cmd === 'scroll') {
              el.className = 'scroll-indicator';
              el.textContent = getScrollArrow(win.entry.action);
              overlay.appendChild(el);
              activeRipples.set(idx, el);
            } else if ((win.cmd === 'click' || win.cmd === 'fill' || win.cmd === 'type') && win.entry.element) {
              const elem = win.entry.element;
              const scaleX = videoEl.clientWidth / elem.viewport.width;
              const scaleY = videoEl.clientHeight / elem.viewport.height;
              const cx = (elem.bbox.x + elem.bbox.width / 2) * scaleX;
              const cy = (elem.bbox.y + elem.bbox.height / 2) * scaleY;

              el.className = 'ripple ' + (win.cmd === 'click' ? 'ripple-click' : 'ripple-fill');
              el.style.left = cx + 'px';
              el.style.top = cy + 'px';
              overlay.appendChild(el);
              activeRipples.set(idx, el);
            }
          }
          if (t >= win.rippleEnd && activeRipples.has(idx)) {
            activeRipples.get(idx).remove();
            activeRipples.delete(idx);
          }
        } else if (activeRipples.has(idx)) {
          activeRipples.get(idx).remove();
          activeRipples.delete(idx);
        }

        // --- Toast ---
        if (enabled) {
          if (t >= win.toastStart && t < win.toastEnd && !activeToasts.has(idx)) {
            activeToasts.forEach((el) => el.remove());
            activeToasts.clear();

            const el = document.createElement('div');
            el.className = 'toast';
            el.textContent = getToastText(win.entry);
            overlay.appendChild(el);
            activeToasts.set(idx, el);
          }
          if (t >= win.toastEnd && activeToasts.has(idx)) {
            activeToasts.get(idx).remove();
            activeToasts.delete(idx);
          }
        } else if (activeToasts.has(idx)) {
          activeToasts.get(idx).remove();
          activeToasts.delete(idx);
        }
      });

      rafId = requestAnimationFrame(renderOverlays);
    }

    function startOverlayLoop() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(renderOverlays);
    }

    function stopOverlayLoop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    // --- Seek handler: clear overlays on seek so they re-trigger correctly ---
    function onSeeked() {
      activeRipples.forEach(el => el.remove());
      activeRipples.clear();
      activeToasts.forEach(el => el.remove());
      activeToasts.clear();
    }

    function seekTo(time) {
      if (video && Number.isFinite(time)) {
        var mediaEnd = Number.isFinite(video.duration) ? video.duration : time;
        video.currentTime = Math.max(0, Math.min(time, mediaEnd));
        video.play();
      }
    }

    function formatTimeFn(sec) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return m + ':' + String(s).padStart(2, '0');
    }

    // Update scrub bar position
    function updateScrubBar(t) {
      if (!scrubTrack || duration <= 0) return;
      const pct = Math.min((t / duration) * 100, 100);
      if (scrubProgress) scrubProgress.style.width = pct + '%';
      if (scrubPlayhead) scrubPlayhead.style.left = pct + '%';
    }

    // Highlight active marker on scrub bar
    function updateActiveMarker(t) {
      scrubMarkers.forEach(m => {
        const mTime = parseFloat(m.dataset.time);
        const idx = parseInt(m.dataset.index);
        const nextMarker = markers[idx + 1];
        const nextTime = nextMarker ? nextMarker.time : Infinity;
        m.classList.toggle('active', t >= mTime && t < nextTime);
      });
    }

    // Scrub bar: click track to seek
    if (scrubTrack && video) {
      let isDragging = false;

      function getTimeFromEvent(e) {
        const rect = scrubTrack.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        return pct * duration;
      }

      scrubTrack.addEventListener('mousedown', (e) => {
        if (e.target.closest('.scrub-marker')) return;
        isDragging = true;
        const t = getTimeFromEvent(e);
        video.currentTime = Math.min(t, video.duration);
        updateScrubBar(t);
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const t = getTimeFromEvent(e);
        video.currentTime = Math.min(t, video.duration);
        updateScrubBar(t);
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          video.play();
        }
      });
    }

    // Scrub bar: marker hover tooltips
    scrubMarkers.forEach(marker => {
      marker.addEventListener('mouseenter', (e) => {
        const idx = parseInt(marker.dataset.index);
        const m = markers[idx];
        if (!m || !scrubTooltip) return;
        const action = m.action.length > 40 ? m.action.slice(0, 40) + '\\u2026' : m.action;
        scrubTooltip.innerHTML = '<span class="tooltip-icon">' + m.icon + '</span>' + action + '<span class="tooltip-time">' + formatTimeFn(m.time) + '</span>';
        scrubTooltip.style.display = 'block';

        const trackRect = scrubTrack.getBoundingClientRect();
        const markerRect = marker.getBoundingClientRect();
        const tooltipLeft = markerRect.left - trackRect.left + markerRect.width / 2;
        scrubTooltip.style.left = tooltipLeft + 'px';
        scrubTooltip.style.transform = 'translateX(-50%)';
      });

      marker.addEventListener('mouseleave', () => {
        if (scrubTooltip) scrubTooltip.style.display = 'none';
      });

      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = parseFloat(marker.dataset.time);
        seekTo(t);
      });
    });

    // Log lines with timestamps for video sync
    const logLines = document.querySelectorAll('.log-line[data-time]');

    // Highlight active log line for a given video time
    function updateActiveLogLine(t) {
      logLines.forEach(line => {
        const lt = parseFloat(line.dataset.time);
        const nextLine = line.nextElementSibling;
        const hasNext = nextLine && nextLine.dataset && nextLine.dataset.time !== undefined;
        const nextTime = hasNext ? parseFloat(nextLine.dataset.time) : Infinity;
        line.classList.toggle('active', t >= lt && t < nextTime);
      });

      // Auto-scroll the active log line in the currently visible tab
      if (activeTab !== 'timeline') {
        var tabEl = Array.from(document.querySelectorAll('.panel-content')).find(function(panel) {
          return panel.style.display !== 'none';
        });
        if (tabEl) {
          var activeLine = tabEl.querySelector('.log-line.active');
          if (activeLine && timelinePanel) {
            var panelRect = timelinePanel.getBoundingClientRect();
            var lineRect = activeLine.getBoundingClientRect();
            if (lineRect.top < panelRect.top || lineRect.bottom > panelRect.bottom) {
              activeLine.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          }
        }
      }
    }

    // Highlight active step as video plays (only if video exists)
    if (video) {
      video.addEventListener('timeupdate', () => {
        const t = video.currentTime;
        let activeStep = null;

        steps.forEach(step => {
          const stepTime = parseFloat(step.dataset.time);
          const nextStep = step.nextElementSibling;
          const isLastStep = !nextStep || !nextStep.classList.contains('step');
          const nextTime = isLastStep ? Infinity : parseFloat(nextStep.dataset.time);
          const isActive = t >= stepTime && t < nextTime;
          step.classList.toggle('active', isActive);
          if (isActive) activeStep = step;
        });

        // Auto-scroll the active step into view (only when timeline tab is active)
        if (activeStep && activeTab === 'timeline') {
          const panelRect = timelinePanel.getBoundingClientRect();
          const stepRect = activeStep.getBoundingClientRect();
          if (stepRect.top < panelRect.top || stepRect.bottom > panelRect.bottom) {
            activeStep.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }

        // Sync log lines with video
        updateActiveLogLine(t);

        // Update scrub bar + markers
        updateScrubBar(t);
        updateActiveMarker(t);
      });

      // Preserve the canonical action timeline when media is shorter.
      video.addEventListener('loadedmetadata', () => {
        if (video.duration && isFinite(video.duration)) {
          duration = Math.max(duration, video.duration);
          scrubMarkers.forEach(m => {
            const mTime = parseFloat(m.dataset.time);
            m.style.left = (duration > 0 ? (mTime / duration) * 100 : 0) + '%';
          });
        }
      });

      // Start/stop rAF overlay loop with video play state
      video.addEventListener('play', startOverlayLoop);
      video.addEventListener('pause', stopOverlayLoop);
      video.addEventListener('ended', stopOverlayLoop);
      video.addEventListener('seeked', onSeeked);
    }

    // Keyboard navigation: left/right arrows jump between steps
    document.addEventListener('keydown', (e) => {
      if (activeTab !== 'timeline') return;
      if (!video || !markers.length) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const t = video.currentTime;
        let targetIdx = -1;

        if (e.key === 'ArrowRight') {
          // Find next marker after current time
          for (let i = 0; i < markers.length; i++) {
            if (markers[i].time > t + 0.5) { targetIdx = i; break; }
          }
          if (targetIdx === -1) targetIdx = markers.length - 1;
        } else {
          // Find previous marker before current time
          for (let i = markers.length - 1; i >= 0; i--) {
            if (markers[i].time < t - 0.5) { targetIdx = i; break; }
          }
          if (targetIdx === -1) targetIdx = 0;
        }

        seekTo(markers[targetIdx].time);
      }
    });
  </script>
</body>
</html>`;
}
function writeViewer(outputDir, data) {
  let entries = data.entries;
  if (!entries) {
    const logPath = path14.join(outputDir, "session-log.json");
    if (!fs17.existsSync(logPath)) return null;
    try {
      entries = JSON.parse(fs17.readFileSync(logPath, "utf-8"));
    } catch {
      return null;
    }
  }
  if (!entries || entries.length === 0) return null;
  const html = generateViewer({ ...data, entries });
  const viewerPath = path14.join(outputDir, "viewer.html");
  fs17.writeFileSync(viewerPath, html);
  return viewerPath;
}

// src/artifacts/evidence.ts
import * as fs18 from "fs";
import * as path15 from "path";
import { createHash as createHash3 } from "crypto";
import { execFileSync as execFileSync4 } from "child_process";
function writeCanonicalEvidence(options) {
  const events = collectEvents(options);
  applyPresentationFilters(events, options.environment?.sources || []);
  const incidents = buildIncidents(events);
  const screenshots = inspectScreenshots(options.sessionDir);
  const mediaDurationSec = probeMediaDuration(options.videoPath);
  const actionDuration = options.actions.map((entry) => entry.relativeTimeSec).filter(Number.isFinite).reduce((maximum, current) => Math.max(maximum, current), 0);
  const timelineDurationSec = Math.max(options.durationSec, actionDuration);
  const mediaDivergenceSec = mediaDurationSec === null ? null : Math.max(0, actionDuration - mediaDurationSec);
  const mediaTruncated = mediaDivergenceSec !== null && mediaDivergenceSec > 1;
  const sources = buildSourceSummaries(
    events,
    incidents
  );
  const evidence = {
    version: 1,
    sessionId: options.sessionId,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    timelineDurationSec,
    mediaDurationSec,
    mediaDivergenceSec,
    mediaTruncated,
    actions: options.actions,
    events,
    sources,
    incidents,
    screenshots
  };
  const verdict = buildVerdict(options, evidence);
  fs18.writeFileSync(
    path15.join(options.sessionDir, "evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n"
  );
  fs18.writeFileSync(
    path15.join(options.sessionDir, "verdict.json"),
    JSON.stringify(verdict, null, 2) + "\n"
  );
  return { evidence, verdict };
}
function collectEvents(options) {
  const environmentEvents = options.environment?.evidencePath && fs18.existsSync(options.environment.evidencePath) ? loadEvidenceEvents(options.environment.evidencePath).map(
    (event) => adjustEnvironmentEventTime(
      event,
      options.timelineOffsetSec ?? 0
    )
  ) : [];
  if (environmentEvents.length === 0) {
    environmentEvents.push(
      ...options.serverEntries.map(
        (entry) => toEvidenceEvent(entry, {
          origin: "environment",
          group: "backend",
          sourceId: "server",
          sourceTitle: "Server",
          stream: "stderr"
        })
      )
    );
  }
  const navigations = buildNavigations(options.actions);
  const browserEvents = options.consoleEntries.map((entry) => {
    const navigation = findNavigation(navigations, entry.relativeTimeSec);
    return toEvidenceEvent(entry, {
      origin: "browser",
      group: "browser",
      sourceId: navigation.id,
      sourceTitle: navigation.url,
      navigationId: navigation.id,
      pageUrl: navigation.url,
      stream: "console"
    });
  });
  return [...environmentEvents, ...browserEvents];
}
function adjustEnvironmentEventTime(event, timelineOffsetSec) {
  if (event.relativeTimeSec === null || timelineOffsetSec <= 0) {
    return event;
  }
  const relativeTimeSec = event.relativeTimeSec - timelineOffsetSec;
  return {
    ...event,
    relativeTimeSec: relativeTimeSec >= 0 ? parseFloat(relativeTimeSec.toFixed(3)) : null
  };
}
function toEvidenceEvent(entry, source) {
  return {
    version: 1,
    ...source,
    segment: "live",
    timestamp: null,
    relativeTimeSec: Number.isFinite(entry.relativeTimeSec) ? entry.relativeTimeSec : null,
    text: entry.text
  };
}
function buildNavigations(actions) {
  const navigations = actions.map((entry) => {
    const match = entry.action.match(/^(?:open|navigate)\s+(\S+)/i);
    return match && Number.isFinite(entry.relativeTimeSec) ? { url: match[1], startTimeSec: entry.relativeTimeSec } : null;
  }).filter(
    (navigation) => navigation !== null
  ).map((navigation, index) => ({
    id: `browser-nav-${index + 1}`,
    ...navigation
  }));
  return navigations.length > 0 ? navigations : [{ id: "browser-nav-1", url: "Browser", startTimeSec: 0 }];
}
function findNavigation(navigations, relativeTimeSec) {
  const timed = Number.isFinite(relativeTimeSec) ? relativeTimeSec : 0;
  return [...navigations].reverse().find((navigation) => navigation.startTimeSec <= timed) || navigations[0];
}
function buildIncidents(events) {
  const incidents = /* @__PURE__ */ new Map();
  for (const event of events) {
    const severity = classifyIncident(event.text);
    if (!severity) {
      continue;
    }
    const message = normalizeIncident(event.text);
    const key = `${event.group}\0${severity}\0${message}`;
    const incident = incidents.get(key) || {
      severity,
      group: event.group,
      message,
      count: 0,
      sourceIds: /* @__PURE__ */ new Set(),
      times: []
    };
    incident.count += 1;
    incident.sourceIds.add(event.sourceId);
    if (event.relativeTimeSec !== null) {
      incident.times.push(event.relativeTimeSec);
    }
    incidents.set(key, incident);
  }
  return [...incidents.values()].map((incident, index) => ({
    id: `incident-${index + 1}`,
    severity: incident.severity,
    group: incident.group,
    message: incident.message,
    count: incident.count,
    sourceIds: [...incident.sourceIds],
    firstTimeSec: incident.times.length > 0 ? Math.min(...incident.times) : null,
    lastTimeSec: incident.times.length > 0 ? Math.max(...incident.times) : null
  }));
}
function classifyIncident(text) {
  if (/\bFATAL\b|\bpanic:|uncaught exception|unhandled rejection/i.test(text)) {
    return "fatal";
  }
  if (/\bError:|ERR[_!]|Exception:|Traceback/i.test(text)) {
    return "error";
  }
  return null;
}
function normalizeIncident(text) {
  return text.replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/g, "<timestamp>").replace(/:\d+:\d+\b/g, ":<line>:<column>").replace(/\s+/g, " ").trim();
}
function buildSourceSummaries(events, incidents) {
  const sourceKeys = /* @__PURE__ */ new Map();
  for (const event of events) {
    const existing = sourceKeys.get(event.sourceId) || {
      title: event.sourceTitle,
      origin: event.origin,
      group: event.group,
      events: []
    };
    existing.events.push(event);
    sourceKeys.set(event.sourceId, existing);
  }
  return [...sourceKeys.entries()].map(([id, source]) => {
    const hiddenLineCount = source.events.filter(
      (event) => event.presentationHidden
    ).length;
    return {
      id,
      title: source.title,
      origin: source.origin,
      group: source.group,
      lineCount: source.events.length,
      hiddenLineCount,
      truncationCount: source.events.filter((event) => event.truncated).length,
      captureGapCount: source.events.filter((event) => event.captureGap).length,
      incidentCount: incidents.filter(
        (incident) => incident.sourceIds.includes(id)
      ).length
    };
  });
}
function applyPresentationFilters(events, configuredSources) {
  for (const event of events) {
    const config = configuredSources.find(
      (candidate) => candidate.id === event.sourceId
    );
    if (isHidden(event.text, config)) {
      event.presentationHidden = true;
    }
  }
}
function isHidden(text, config) {
  if (!config) {
    return false;
  }
  if (config.include && config.include.length > 0 && !config.include.some((pattern) => text.includes(pattern))) {
    return true;
  }
  return Boolean(config.exclude?.some((pattern) => text.includes(pattern)));
}
function inspectScreenshots(sessionDir) {
  return fs18.readdirSync(sessionDir).filter((file) => file.endsWith(".png")).sort().map((file) => {
    const contents = fs18.readFileSync(path15.join(sessionDir, file));
    const validPng = isValidPng(contents);
    return {
      file,
      sha256: createHash3("sha256").update(contents).digest("hex"),
      validPng,
      size: contents.length
    };
  });
}
function isValidPng(contents) {
  if (contents.length < 33 || !contents.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || contents.subarray(12, 16).toString("ascii") !== "IHDR") {
    return false;
  }
  return contents.includes(Buffer.from("IEND", "ascii"), contents.length - 16);
}
function buildVerdict(options, evidence) {
  const missingArtifacts = [];
  if (options.recordingWasActive && !fs18.existsSync(options.videoPath)) {
    missingArtifacts.push(path15.basename(options.videoPath));
  }
  const screenshotFiles = new Set(
    evidence.screenshots.map((screenshot) => screenshot.file)
  );
  for (const action of options.actions) {
    const match = action.action.match(/^screenshot\s+(.+)$/);
    if (match && !screenshotFiles.has(path15.basename(match[1]))) {
      missingArtifacts.push(path15.basename(match[1]));
    }
  }
  for (const screenshot of evidence.screenshots) {
    if (!screenshot.validPng || screenshot.size === 0) {
      missingArtifacts.push(screenshot.file);
    }
  }
  const hashes = /* @__PURE__ */ new Map();
  for (const screenshot of evidence.screenshots) {
    if (screenshot.sha256 && screenshot.validPng) {
      const files = hashes.get(screenshot.sha256) || [];
      files.push(screenshot.file);
      hashes.set(screenshot.sha256, files);
    }
  }
  const duplicateScreenshotHashes = [...hashes.values()].filter(
    (files) => files.length > 1
  );
  const expectedSelectorFailures = options.actions.filter(
    (action) => action.expectedSelector && action.outcome === "failed"
  ).map((action) => action.expectedSelector);
  const fatalIncidentCount = evidence.incidents.filter(
    (incident) => incident.severity === "fatal"
  ).length;
  const blockingReasons = options.consoleEvidenceAvailable ? [] : ["Browser console evidence was unavailable."];
  const failureReasons = [
    ...fatalIncidentCount > 0 ? [`${fatalIncidentCount} fatal incident(s) detected.`] : [],
    ...expectedSelectorFailures.length > 0 ? [`${expectedSelectorFailures.length} expected selector assertion(s) failed.`] : [],
    ...duplicateScreenshotHashes.length > 0 ? ["Duplicate key-frame screenshot hashes were detected."] : []
  ];
  const incompleteReasons = [
    ...missingArtifacts.length > 0 ? [`${missingArtifacts.length} required artifact(s) were missing or invalid.`] : [],
    ...evidence.mediaTruncated ? ["Recorded media ends before the canonical action timeline."] : [],
    ...evidence.sources.some((source) => source.truncationCount > 0) ? ["One or more evidence sources were truncated."] : []
  ];
  const status = blockingReasons.length > 0 ? "BLOCKED" : failureReasons.length > 0 ? "FAIL" : incompleteReasons.length > 0 ? "INCOMPLETE" : "PASS";
  return {
    version: 1,
    status,
    reasons: [...blockingReasons, ...failureReasons, ...incompleteReasons],
    fatalIncidentCount,
    missingArtifacts: [...new Set(missingArtifacts)],
    duplicateScreenshotHashes,
    expectedSelectorFailures,
    mediaTruncated: evidence.mediaTruncated
  };
}
function probeMediaDuration(videoPath) {
  if (!fs18.existsSync(videoPath)) {
    return null;
  }
  try {
    const output = execFileSync4(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        videoPath
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    const duration = Number(output);
    return Number.isFinite(duration) ? duration : null;
  } catch {
    return null;
  }
}

// src/utils/error-patterns.ts
var PATTERNS = [
  {
    name: "JavaScript / Node.js",
    patterns: [
      /\bError:/,
      // TypeError: x is not a function
      /\bERR[_!]/,
      // npm ERR!, ERR_MODULE_NOT_FOUND
      /\bEACCES\b|\bENOENT\b|\bEADDRINUSE\b/,
      // System errors
      /\bat\s+.+\(.+:\d+:\d+\)/,
      // Stack trace: at fn (file.js:10:5)
      /Unhandled.+rejection/i
      // Unhandled promise rejection
    ]
  },
  {
    name: "Python",
    patterns: [
      /Traceback \(most recent call last\)/,
      /^\s*File ".+", line \d+/,
      // Stack trace line
      /\w+Error:/,
      // ValueError:, KeyError:, etc.
      /\w+Exception:/
      // Django ImproperlyConfigured, etc.
    ]
  },
  {
    name: "Ruby / Rails",
    patterns: [
      /\w+Error \(.+\)/,
      // ActionController::RoutingError (...)
      /from .+:\d+:in `.+'/,
      // Stack trace
      /FATAL --/,
      // Rails logger FATAL level
      /Errno::\w+/
      // Errno::ENOENT
    ]
  },
  {
    name: "Go",
    patterns: [
      /^panic:/,
      // Go panic
      /^goroutine \d+/,
      // Goroutine stack dump
      /runtime error:/
    ]
  },
  {
    name: "Java / Kotlin",
    patterns: [
      /Exception in thread/,
      // Exception in thread "main"
      /\w+Exception:/,
      // NullPointerException:
      /\bat\s+[\w.$]+\(.+:\d+\)/,
      // at com.example.Main(Main.java:10)
      /Caused by:/
    ]
  },
  {
    name: "Rust",
    patterns: [
      /thread '.+' panicked at/,
      // thread 'main' panicked at
      /error\[E\d+\]/
      // Compiler error: error[E0308]
    ]
  },
  {
    name: "PHP",
    patterns: [
      /PHP\s+(Fatal|Parse|Warning)\s+error:/i,
      /Stack trace:/,
      /thrown in .+ on line \d+/
    ]
  },
  {
    name: "C# / .NET",
    patterns: [
      /Unhandled exception/,
      /\w+Exception:/,
      /at .+ in .+:line \d+/
      // Stack trace
    ]
  },
  {
    name: "Elixir / Phoenix",
    patterns: [
      /\*\* \(\w+\)/,
      // ** (EXIT), ** (RuntimeError)
      /\(exit\) an exception was raised/
    ]
  },
  {
    name: "Generic",
    patterns: [
      /\bFATAL\b/,
      // Common log level
      /\bCRITICAL\b/,
      // Common log level
      /\bSegmentation fault\b/,
      /\bcore dumped\b/,
      /\bout of memory\b/i
    ]
  }
];
function extractServerErrors(log) {
  if (!log.trim()) return [];
  const allPatterns = PATTERNS.flatMap((lp) => lp.patterns);
  return log.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return allPatterns.some((p) => p.test(trimmed));
  });
}

// src/commands/exec.ts
import * as fs19 from "fs";
import * as path16 from "path";
import { execSync as execSync4 } from "child_process";
var SESSION_LOG_FILENAME = "session-log.json";
function loadSessionLog(sessionDir) {
  const logPath = path16.join(sessionDir, SESSION_LOG_FILENAME);
  if (!fs19.existsSync(logPath)) return [];
  try {
    return JSON.parse(fs19.readFileSync(logPath, "utf-8"));
  } catch {
    return [];
  }
}
function resolveScreenshotPath(args, sessionDir) {
  if (args[0] !== "screenshot" || args.length < 2) return args;
  const screenshotPath = args[args.length - 1];
  if (path16.isAbsolute(screenshotPath)) return args;
  const resolved = path16.join(sessionDir, screenshotPath);
  return [...args.slice(0, -1), resolved];
}
function buildShellCommand(args, sessionName) {
  if (args[0] === "eval" && args.length > 1) {
    const jsCode = args.slice(1).join(" ");
    const escaped = jsCode.replace(/'/g, "'\\''");
    return buildAgentBrowserCommand(`eval '${escaped}'`, { session: sessionName });
  }
  const quotedArgs = args.map((arg) => {
    if (/[(){}[\]$`!#&|;<>*? "'\\]/.test(arg)) {
      const escaped = arg.replace(/'/g, "'\\''");
      return `'${escaped}'`;
    }
    return arg;
  });
  return buildAgentBrowserCommand(quotedArgs.join(" "), { session: sessionName });
}
function translateProofShotExecArgs(args) {
  if (args[0] === "assert-visible" && args.length > 1) {
    return {
      agentBrowserArgs: ["is", "visible", ...args.slice(1)],
      expectedSelector: args.slice(1).join(" ")
    };
  }
  return { agentBrowserArgs: args };
}
function parseElementRef(args) {
  for (const arg of args) {
    const match = arg.match(/@e\d+/);
    if (match) return match[0];
  }
  return null;
}
function captureElementData(ref, viewport, sessionName) {
  try {
    let bbox = null;
    let label = "";
    let elemId = "";
    try {
      elemId = ab(`get attr ${ref} id`, { session: sessionName });
    } catch {
    }
    if (elemId) {
      try {
        const raw = ab(`get box '#${elemId}'`, { session: sessionName });
        bbox = JSON.parse(raw);
      } catch {
      }
      try {
        const raw = ab(
          `eval "document.getElementById('${elemId}')?.labels?.[0]?.textContent||document.getElementById('${elemId}')?.placeholder||document.getElementById('${elemId}')?.getAttribute('aria-label')||''"`,
          { session: sessionName }
        );
        label = JSON.parse(raw) || "";
      } catch {
      }
    }
    if (!bbox) {
      try {
        label = ab(`get text ${ref}`, { session: sessionName });
      } catch {
      }
      if (!label) {
        try {
          label = ab(`get attr ${ref} placeholder`, { session: sessionName });
        } catch {
        }
      }
      if (!label) {
        try {
          label = ab(`get attr ${ref} aria-label`, { session: sessionName });
        } catch {
        }
      }
      if (!label) {
        try {
          label = ab(`get attr ${ref} name`, { session: sessionName });
        } catch {
        }
      }
      if (label) {
        try {
          const escaped = label.replace(/'/g, "\\'");
          const raw = ab(`get box 'text=${escaped}'`, { session: sessionName });
          bbox = JSON.parse(raw);
        } catch {
        }
      }
    }
    if (!bbox) return null;
    return {
      label: label || "",
      bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      viewport
    };
  } catch {
    return null;
  }
}
function isRefTargetedAction(args) {
  const cmd = args[0]?.toLowerCase();
  return (cmd === "click" || cmd === "fill" || cmd === "type") && parseElementRef(args) !== null;
}
async function execCommand(args) {
  const action = args.join(" ");
  const translated = translateProofShotExecArgs(args);
  let loggedEntry = null;
  let sessionLogPath = null;
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);
  const session = loadSession(controlDir);
  setAgentBrowserDefaults({
    configPath: session?.agentBrowserConfigPath || config.browser.configPath,
    socketDir: session?.agentBrowserSocketDir
  });
  if (session && !session.recordingActive) {
    console.error(
      'Error: Session has no active recording. Video capture is required.\nRun "proofshot stop" to end this session, then start a new one.'
    );
    process.exit(1);
  }
  if (session && !canAddressOwnedBrowserSession(session)) {
    console.error(
      "Error: Browser ownership no longer matches this ProofShot session.\nRefusing to address a possibly reused agent-browser session name."
    );
    process.exit(1);
    return;
  }
  let resolvedArgs = translated.agentBrowserArgs;
  if (session) {
    resolvedArgs = resolveScreenshotPath(
      translated.agentBrowserArgs,
      session.sessionDir
    );
  }
  let elementData;
  if (session && isRefTargetedAction(args)) {
    const ref = parseElementRef(args);
    const viewport = session.viewport || { width: 1280, height: 720 };
    const captured = captureElementData(ref, viewport, session.sessionName);
    if (captured) elementData = captured;
  }
  if (session) {
    const now = /* @__PURE__ */ new Date();
    const startTime = new Date(session.startedAt).getTime();
    const relativeTimeSec = parseFloat(((now.getTime() - startTime) / 1e3).toFixed(1));
    const entry = {
      action,
      relativeTimeSec,
      timestamp: now.toISOString(),
      expectedSelector: translated.expectedSelector
    };
    if (elementData) {
      entry.element = elementData;
    }
    const logPath = path16.join(session.sessionDir, SESSION_LOG_FILENAME);
    const entries = loadSessionLog(session.sessionDir);
    entries.push(entry);
    fs19.writeFileSync(logPath, JSON.stringify(entries, null, 2) + "\n");
    loggedEntry = entry;
    sessionLogPath = logPath;
  }
  const shellCmd = buildShellCommand(resolvedArgs, session?.sessionName);
  try {
    const result = execSync4(shellCmd, {
      encoding: "utf-8",
      timeout: 6e4,
      stdio: ["pipe", "pipe", "pipe"],
      env: getAgentBrowserEnvironment()
    });
    if (translated.expectedSelector && result.trim().toLowerCase() !== "true") {
      const assertionError = new Error(
        `Expected selector to be visible: ${translated.expectedSelector}`
      );
      assertionError.status = 1;
      throw assertionError;
    }
    if (result.trim()) {
      process.stdout.write(result);
      if (!result.endsWith("\n")) {
        process.stdout.write("\n");
      }
    }
    persistActionOutcome(loggedEntry, sessionLogPath, "passed");
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || "";
    const stdout = error?.stdout?.toString?.() || "";
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (!stdout && !stderr && error?.message) {
      process.stderr.write(`${error.message}
`);
    }
    persistActionOutcome(
      loggedEntry,
      sessionLogPath,
      "failed",
      stderr.trim() || stdout.trim() || error?.message
    );
    process.exit(error?.status || 1);
  }
  if (session && args[0] === "set" && args[1] === "viewport") {
    try {
      const vpJson = ab("eval 'JSON.stringify({width: window.innerWidth, height: window.innerHeight})'", {
        session: session.sessionName
      });
      const vp = JSON.parse(vpJson);
      session.viewport = { width: vp.width, height: vp.height };
      saveSession(session, controlDir);
      registerSession(session);
    } catch {
    }
  }
}
function persistActionOutcome(entry, logPath, outcome, error) {
  if (!entry || !logPath) {
    return;
  }
  entry.outcome = outcome;
  if (error) {
    entry.error = error;
  }
  const entries = loadSessionLog(path16.dirname(logPath));
  const matchingEntry = [...entries].reverse().find(
    (candidate) => candidate.timestamp === entry.timestamp && candidate.action === entry.action
  );
  if (matchingEntry) {
    matchingEntry.outcome = outcome;
    if (error) {
      matchingEntry.error = error;
    }
    fs19.writeFileSync(logPath, JSON.stringify(entries, null, 2) + "\n");
  }
}

// src/utils/token-usage.ts
import * as fs20 from "fs";
import * as path17 from "path";
import * as os5 from "os";
function estimateTokenUsage(sessionDir, startTimeMs, endTimeMs) {
  const claudeUsage = tryClaudeCodeLogs(startTimeMs, endTimeMs);
  if (claudeUsage) return claudeUsage;
  return estimateFromContent(sessionDir);
}
function tryClaudeCodeLogs(startTimeMs, endTimeMs) {
  const claudeDir = path17.join(os5.homedir(), ".claude", "sessions");
  if (!fs20.existsSync(claudeDir)) return null;
  try {
    const files = fs20.readdirSync(claudeDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const data = JSON.parse(fs20.readFileSync(path17.join(claudeDir, file), "utf-8"));
      const sessionStart = new Date(data.startedAt).getTime();
      if (sessionStart >= startTimeMs - 6e4 && sessionStart <= endTimeMs + 6e4) {
        if (data.totalInputTokens != null || data.totalOutputTokens != null || data.usage) {
          const inputTokens = data.totalInputTokens ?? data.usage?.inputTokens ?? 0;
          const outputTokens = data.totalOutputTokens ?? data.usage?.outputTokens ?? 0;
          return {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            estimatedCost: 0,
            model: data.model || "claude",
            source: "claude-logs"
          };
        }
      }
    }
  } catch {
  }
  return null;
}
function estimateFromContent(sessionDir) {
  const logPath = path17.join(sessionDir, "session-log.json");
  if (!fs20.existsSync(logPath)) return null;
  try {
    const entries = JSON.parse(fs20.readFileSync(logPath, "utf-8"));
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const actionCount = entries.length;
    const inputTokens = actionCount * 500;
    const outputTokens = actionCount * 300;
    const totalTokens = inputTokens + outputTokens;
    const estimatedCost = (inputTokens * 3 + outputTokens * 15) / 1e6;
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCost,
      model: "estimated",
      source: "estimated"
    };
  } catch {
    return null;
  }
}
function formatTokenUsage(usage) {
  const fmt = (n) => n.toLocaleString();
  let result = "";
  result += `- Input tokens: ~${fmt(usage.inputTokens)}
`;
  result += `- Output tokens: ~${fmt(usage.outputTokens)}
`;
  result += `- Total tokens: ~${fmt(usage.totalTokens)}
`;
  if (usage.estimatedCost > 0) {
    result += `- Estimated cost: ~$${usage.estimatedCost.toFixed(4)}
`;
  }
  if (usage.source === "estimated") {
    result += `- Source: estimated from ${usage.model === "estimated" ? "session activity" : usage.model}
`;
  }
  return result;
}

// src/commands/stop.ts
function parseTimestampedServerLog(raw, startTimeMs) {
  if (!raw.trim()) return { entries: [], cleanText: "" };
  const lines = raw.split("\n").filter((l) => l.trim());
  const entries = [];
  const cleanLines = [];
  for (const line of lines) {
    const tabIdx = line.indexOf("	");
    if (tabIdx > 0) {
      const epochStr = line.slice(0, tabIdx);
      const epochMs = parseInt(epochStr, 10);
      if (!isNaN(epochMs) && epochMs > 1e12) {
        const text = line.slice(tabIdx + 1);
        entries.push({
          text,
          relativeTimeSec: Math.max(0, parseFloat(((epochMs - startTimeMs) / 1e3).toFixed(1)))
        });
        cleanLines.push(text);
        continue;
      }
    }
    entries.push({ text: line, relativeTimeSec: -1 });
    cleanLines.push(line);
  }
  return { entries, cleanText: cleanLines.join("\n") };
}
async function stopCommand(options) {
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);
  const session = loadSession(controlDir);
  if (!session) {
    console.log(
      chalk3.dim("No active session found; all owned processes are already stopped.")
    );
    return;
  }
  setAgentBrowserDefaults({
    configPath: session.agentBrowserConfigPath || config.browser.configPath,
    socketDir: session.agentBrowserSocketDir
  });
  if (session.bundleComplete) {
    if (session.browserRetained && !options.noClose) {
      console.log(chalk3.dim("Closing retained browser..."));
      const browserSessionAddressable = canAddressOwnedBrowserSession(session);
      await stopOwnedBrowser(session);
      session.browserRetained = false;
      clearOwnedSession2(session, controlDir);
      if (browserSessionAddressable) {
        console.log(chalk3.green("\u2713") + " Retained browser closed; proof artifacts were already bundled.");
      } else {
        console.log(
          chalk3.yellow("\u26A0") + " Retained browser ownership was no longer current; skipped session-name close and cleared control state after exact recorded-tree cleanup."
        );
      }
    } else if (session.browserRetained) {
      console.log(
        chalk3.dim("Proof artifacts are already bundled; the owned browser remains intentionally open.")
      );
    } else {
      clearOwnedSession2(session, controlDir);
      console.log(chalk3.dim("Proof artifacts are already bundled and all owned processes are stopped."));
    }
    return;
  }
  session.lifecycleStatus = "stopping";
  session.cleanupError = null;
  persistOwnedSession2(session, controlDir);
  const retryingStoppedSession = !session.recordingActive;
  const recordingWasActive = session.recordingActive;
  const startTime = new Date(session.startedAt).getTime();
  const recordingStartTime = session.recordingStartedAt ? new Date(session.recordingStartedAt).getTime() : startTime;
  const recordingStartOffsetSec = Math.max(
    0,
    (recordingStartTime - startTime) / 1e3
  );
  const durationMs = Date.now() - startTime;
  const durationSec = Math.round(durationMs / 1e3);
  const browserSessionAvailable = canAddressOwnedBrowserSession(session);
  const priorConsoleEvidenceAvailable = session.consoleEvidenceAvailable === true;
  if (!browserSessionAvailable && priorConsoleEvidenceAvailable) {
    console.log(
      chalk3.dim("Browser already stopped; reusing console evidence collected before cleanup.")
    );
  } else if (!browserSessionAvailable) {
    console.log(
      chalk3.yellow("\u26A0") + " Browser ownership could not be verified; skipping console and recording commands.\n" + chalk3.dim("  Browser evidence may be incomplete; exact recorded-process cleanup will still run.")
    );
  }
  console.log(chalk3.dim("Collecting errors..."));
  let consoleErrors = "";
  let consoleOutput = "";
  let consoleEntries = [];
  const consoleErrorsPath = path18.join(session.sessionDir, "console-errors.log");
  const consoleOutputPath = path18.join(session.sessionDir, "console-output.log");
  const consoleEntriesPath = path18.join(session.sessionDir, "console-entries.json");
  if (browserSessionAvailable) {
    try {
      consoleErrors = getConsoleErrors(session.sessionName);
      consoleOutput = getConsoleOutput(session.sessionName);
      const consoleMessages = getConsoleOutputJson(session.sessionName);
      consoleEntries = consoleMessages.map((msg) => ({
        text: `[${msg.type}] ${msg.text}`,
        relativeTimeSec: Math.max(0, parseFloat(((msg.timestamp - startTime) / 1e3).toFixed(1)))
      }));
    } catch {
    }
    writeTextFileAtomically(consoleErrorsPath, consoleErrors);
    writeTextFileAtomically(consoleOutputPath, consoleOutput);
    writeTextFileAtomically(
      consoleEntriesPath,
      JSON.stringify(consoleEntries, null, 2) + "\n"
    );
    const capturedErrorLines = consoleErrors.split("\n").filter((line) => line.trim() && line.trim() !== "No errors");
    session.consoleEvidenceAvailable = true;
    session.consoleErrorCount = capturedErrorLines.length > 0 && consoleErrors.trim() !== "" ? capturedErrorLines.length : 0;
    persistOwnedSession2(session, controlDir);
  } else if (priorConsoleEvidenceAvailable) {
    if (fs21.existsSync(consoleErrorsPath)) {
      consoleErrors = fs21.readFileSync(consoleErrorsPath, "utf-8");
    }
    if (fs21.existsSync(consoleOutputPath)) {
      consoleOutput = fs21.readFileSync(consoleOutputPath, "utf-8");
    }
    if (fs21.existsSync(consoleEntriesPath)) {
      try {
        const savedEntries = JSON.parse(fs21.readFileSync(consoleEntriesPath, "utf-8"));
        if (Array.isArray(savedEntries)) consoleEntries = savedEntries;
      } catch {
      }
    }
  }
  console.log(chalk3.dim("Stopping recording..."));
  if (browserSessionAvailable) {
    stopRecording(session.sessionName);
  }
  session.recordingActive = false;
  persistOwnedSession2(session, controlDir);
  let cleanupError;
  if (!options.noClose) {
    console.log(chalk3.dim("Closing browser..."));
    try {
      await stopOwnedBrowser(session);
    } catch (error) {
      cleanupError = error;
    }
  }
  const finalizedEnvironment = session.environment;
  if (session.environment) {
    console.log(chalk3.dim("Stopping environment..."));
    try {
      await stopOwnedEnvironment(session.environment);
      session.environment = null;
      persistOwnedSession2(session, controlDir);
    } catch (error) {
      cleanupError ||= error;
    }
  }
  if (session.serverProcess) {
    console.log(chalk3.dim("Stopping dev server..."));
    try {
      await stopOwnedServer(session);
    } catch (error) {
      cleanupError ||= error;
    }
  }
  if (cleanupError) {
    session.lifecycleStatus = "recovery";
    session.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    persistOwnedSession2(session, controlDir);
    throw cleanupError;
  }
  let serverLog = "";
  let serverEntries = [];
  if (fs21.existsSync(session.serverErrorLog)) {
    const rawServerLog = fs21.readFileSync(session.serverErrorLog, "utf-8");
    const parsed = parseTimestampedServerLog(rawServerLog, startTime);
    serverLog = parsed.cleanText;
    serverEntries = parsed.entries;
  }
  const sessionDir = session.sessionDir;
  const screenshots = fs21.existsSync(sessionDir) ? fs21.readdirSync(sessionDir).filter((f) => f.endsWith(".png")) : [];
  const sessionLog = loadSessionLog(sessionDir);
  let trimOffsetSec = session.trimOffsetSec ?? recordingStartOffsetSec;
  if (!session.videoTrimComplete) {
    let videoTrimOffsetSec = 0;
    if (fs21.existsSync(session.videoPath)) {
      videoTrimOffsetSec = trimVideo(
        session.videoPath,
        screenshots,
        sessionDir,
        startTime,
        sessionLog,
        recordingStartOffsetSec
      );
    } else if (recordingWasActive) {
      console.log(
        chalk3.yellow("\u26A0") + " Recording was active but no video file was produced.\n" + chalk3.dim("  The screencast may have been interrupted. Screenshots and logs are still saved.")
      );
    }
    trimOffsetSec = recordingStartOffsetSec + videoTrimOffsetSec;
    session.videoTrimComplete = true;
    session.trimOffsetSec = trimOffsetSec;
    persistOwnedSession2(session, controlDir);
  }
  const consoleErrorLines = consoleErrors.split("\n").filter((l) => l.trim() && l.trim() !== "No errors");
  const observedConsoleErrorCount = consoleErrorLines.length > 0 && consoleErrors.trim() !== "" ? consoleErrorLines.length : 0;
  const consoleEvidenceAvailable = browserSessionAvailable || priorConsoleEvidenceAvailable;
  const consoleErrorCount = browserSessionAvailable ? observedConsoleErrorCount : session.consoleErrorCount ?? 0;
  if (browserSessionAvailable) {
    session.consoleEvidenceAvailable = true;
    session.consoleErrorCount = consoleErrorCount;
    persistOwnedSession2(session, controlDir);
  }
  const serverErrorLines = extractServerErrors(serverLog);
  const serverErrorCount = serverErrorLines.length;
  const tokenUsage = estimateTokenUsage(session.sessionDir, startTime, Date.now());
  const summaryPath = path18.join(sessionDir, "SUMMARY.md");
  const summary = generateProofSummary({
    projectDirectory: session.startDirectory || process.cwd(),
    description: session.description,
    serverCommand: session.serverCommand,
    port: session.port,
    headless: session.headless ?? config.headless ?? true,
    viewport: session.viewport || config.viewport || { width: 1280, height: 720 },
    videoPath: session.videoPath,
    screenshots,
    consoleErrors,
    consoleErrorCount,
    consoleEvidenceAvailable,
    serverLog,
    serverErrorCount,
    tokenUsage,
    durationSec,
    outputDir: sessionDir
  });
  if (!retryingStoppedSession || !fs21.existsSync(summaryPath)) {
    writeTextFileAtomically(summaryPath, summary);
  }
  let viewerEntries = sessionLog;
  if (trimOffsetSec > 0 && !session.sessionLogAdjusted) {
    viewerEntries = sessionLog.map((e) => ({
      ...e,
      relativeTimeSec: parseFloat((e.relativeTimeSec - trimOffsetSec).toFixed(1))
    }));
  }
  if (trimOffsetSec > 0 && !session.sessionLogAdjusted && viewerEntries.length > 0) {
    const logPath = path18.join(sessionDir, "session-log.json");
    writeTextFileAtomically(logPath, JSON.stringify(viewerEntries, null, 2) + "\n");
  }
  if (!session.sessionLogAdjusted) {
    session.sessionLogAdjusted = true;
    persistOwnedSession2(session, controlDir);
  }
  const adjustTime = (e) => trimOffsetSec > 0 ? { ...e, relativeTimeSec: parseFloat((e.relativeTimeSec - trimOffsetSec).toFixed(1)) } : e;
  const viewerConsoleEntries = consoleEntries.map(adjustTime);
  const viewerServerEntries = serverEntries.map(adjustTime);
  const canonicalDurationSec = Math.max(0, durationSec - trimOffsetSec);
  const { evidence, verdict } = writeCanonicalEvidence({
    sessionId: session.sessionName,
    sessionDir,
    durationSec: canonicalDurationSec,
    timelineOffsetSec: trimOffsetSec,
    videoPath: session.videoPath,
    recordingWasActive,
    consoleEvidenceAvailable,
    actions: viewerEntries,
    consoleEntries: viewerConsoleEntries,
    serverEntries: viewerServerEntries,
    environment: finalizedEnvironment
  });
  const viewerPath = writeViewer(sessionDir, {
    description: session.description,
    serverCommand: session.serverCommand,
    durationSec: canonicalDurationSec,
    videoFilename: fs21.existsSync(session.videoPath) ? path18.basename(session.videoPath) : null,
    consoleErrorCount,
    consoleEvidenceAvailable,
    serverErrorCount,
    consoleOutput,
    serverLog,
    consoleEntries: viewerConsoleEntries.length > 0 ? viewerConsoleEntries : void 0,
    serverEntries: viewerServerEntries.length > 0 ? viewerServerEntries : void 0,
    entries: viewerEntries.length > 0 ? viewerEntries : void 0,
    tokenUsage,
    evidence,
    verdict
  });
  const metadata = loadMetadata(sessionDir) || {
    repository: "",
    repositoryRoot: session.startDirectory,
    branch: "",
    commitSha: "",
    treeHash: "",
    sourceDirty: true,
    startedAt: session.startedAt,
    description: session.description
  };
  writeArtifactManifest({
    sessionId: session.sessionName,
    sessionDir,
    metadata,
    evidence,
    verdict
  });
  session.bundleComplete = true;
  session.browserRetained = Boolean(options.noClose);
  if (session.browserRetained) {
    session.lifecycleStatus = "active";
    persistOwnedSession2(session, controlDir);
  } else {
    clearOwnedSession2(session, controlDir);
  }
  console.log("");
  console.log(chalk3.green.bold("\u2705 ProofShot verification complete"));
  console.log("");
  if (fs21.existsSync(session.videoPath)) {
    console.log(`\u{1F4F9} Video:         ${chalk3.dim(session.videoPath)} (${durationSec}s)`);
  }
  console.log(`\u{1F4F8} Screenshots:   ${screenshots.length} captured`);
  console.log(`\u{1F4DD} Summary:       ${chalk3.dim(summaryPath)}`);
  console.log(`\u{1F9FE} Verdict:       ${verdict.status}`);
  if (viewerPath) {
    console.log(`\u{1F3AC} Viewer:        ${chalk3.dim(viewerPath)}`);
  } else {
    console.log(chalk3.dim('Tip: Use "proofshot exec" instead of "agent-browser" to get an interactive timeline viewer.'));
  }
  console.log("");
  console.log(
    `Console errors:   ${!consoleEvidenceAvailable ? chalk3.yellow("unavailable") : consoleErrorCount === 0 ? chalk3.green("0") : chalk3.red(String(consoleErrorCount))}`
  );
  console.log(
    `Server errors:    ${serverErrorCount === 0 ? chalk3.green("0") : chalk3.red(String(serverErrorCount))}`
  );
  console.log(`Duration:         ${durationSec} seconds`);
  console.log("");
  console.log(`Proof artifacts saved to ${chalk3.dim(sessionDir)}`);
  if (session.browserRetained) {
    console.log(chalk3.dim('Browser retained. Run "proofshot stop" later to close this exact session.'));
  }
  if (consoleErrorCount > 0) {
    console.log("");
    console.log(chalk3.red.bold("Console Errors:"));
    for (const line of consoleErrorLines.slice(0, 10)) {
      console.log(chalk3.red(`  ${line}`));
    }
    if (consoleErrorLines.length > 10) {
      console.log(chalk3.dim(`  ... and ${consoleErrorLines.length - 10} more (see SUMMARY.md)`));
    }
  }
  if (serverErrorCount > 0) {
    console.log("");
    console.log(chalk3.red.bold("Server Errors:"));
    for (const line of serverErrorLines.slice(0, 10)) {
      console.log(chalk3.red(`  ${line}`));
    }
    if (serverErrorLines.length > 10) {
      console.log(chalk3.dim(`  ... and ${serverErrorLines.length - 10} more (see SUMMARY.md)`));
    }
  }
}
function writeTextFileAtomically(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID3()}.tmp`;
  try {
    fs21.writeFileSync(temporaryPath, contents);
    fs21.renameSync(temporaryPath, filePath);
  } finally {
    if (fs21.existsSync(temporaryPath)) fs21.unlinkSync(temporaryPath);
  }
}
function persistOwnedSession2(session, controlDir) {
  saveSession(session, controlDir);
  registerSession(session);
}
function clearOwnedSession2(session, controlDir) {
  clearSession(controlDir);
  unregisterSession(session.sessionName);
}
function generateProofSummary(data) {
  const date = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19);
  const projectName = path18.basename(data.projectDirectory);
  let md = `# ProofShot Verification Report

**Date:** ${date}
**Project:** ${projectName}
**Dev Server:** ${data.serverCommand ? data.serverCommand : "external"} on localhost:${data.port}

`;
  if (data.description) {
    md += `## What Was Verified

${data.description}

`;
  }
  const relativeVideo = path18.basename(data.videoPath);
  md += `## Video Recording

Full session recording: [${relativeVideo}](./${relativeVideo}) (${data.durationSec}s)

`;
  if (data.screenshots.length > 0) {
    md += `## Screenshots

`;
    for (const ss of data.screenshots) {
      md += `![${ss}](./${ss})

`;
    }
  }
  md += `## Console Errors

`;
  if (!data.consoleEvidenceAvailable) {
    md += `Browser ownership could not be verified, so console evidence was unavailable.

`;
  } else if (data.consoleErrorCount === 0) {
    md += `No console errors detected.

`;
  } else {
    md += `${data.consoleErrorCount} error(s) detected:

\`\`\`
${data.consoleErrors}
\`\`\`

`;
  }
  md += `## Server Errors

`;
  if (data.serverErrorCount === 0) {
    md += `No server errors detected.

`;
  } else {
    md += `${data.serverErrorCount} error(s) detected:

\`\`\`
${data.serverLog.slice(0, 5e3)}
\`\`\`

`;
    if (data.serverLog.length > 5e3) {
      md += `_(truncated \u2014 see server.log for full output)_

`;
    }
  }
  if (data.tokenUsage) {
    md += `## Token Usage (Estimated)

`;
    md += formatTokenUsage(data.tokenUsage);
    md += "\n";
  }
  md += `## Environment
- Browser: Chromium (${data.headless ? "headless" : "headed"})
- Viewport: ${data.viewport.width}x${data.viewport.height}
- Duration: ${data.durationSec} seconds
`;
  return md;
}
function trimVideo(videoPath, screenshots, outputDir, sessionStartMs, sessionLog, mediaStartOffsetSec = 0) {
  let firstActionSec = null;
  let lastActionSec = null;
  if (sessionLog.length > 0) {
    firstActionSec = sessionLog[0].relativeTimeSec - mediaStartOffsetSec;
    lastActionSec = sessionLog[sessionLog.length - 1].relativeTimeSec - mediaStartOffsetSec;
  } else if (screenshots.length > 0) {
    const timestamps = screenshots.map((f) => {
      try {
        return fs21.statSync(path18.join(outputDir, f)).birthtimeMs;
      } catch {
        return null;
      }
    }).filter(
      (timestamp) => timestamp !== null && timestamp >= sessionStartMs + mediaStartOffsetSec * 1e3
    );
    if (timestamps.length === 0) return 0;
    firstActionSec = (Math.min(...timestamps) - sessionStartMs) / 1e3 - mediaStartOffsetSec;
    lastActionSec = (Math.max(...timestamps) - sessionStartMs) / 1e3 - mediaStartOffsetSec;
  }
  if (firstActionSec === null || lastActionSec === null) return 0;
  const BUFFER_BEFORE = 5;
  const BUFFER_AFTER = 3;
  const trimStartSec = Math.max(0, firstActionSec - BUFFER_BEFORE);
  const trimEndSec = lastActionSec + BUFFER_AFTER;
  if (trimEndSec - trimStartSec < 5) return 0;
  try {
    execFileSync5("ffmpeg", ["-version"], { stdio: "pipe" });
  } catch {
    console.log(chalk3.dim("Tip: Install ffmpeg to auto-trim dead time from videos."));
    return 0;
  }
  const dir = path18.dirname(videoPath);
  const ext = path18.extname(videoPath);
  const base = path18.basename(videoPath, ext);
  const rawPath = path18.join(dir, `${base}-raw${ext}`);
  try {
    fs21.renameSync(videoPath, rawPath);
    execFileSync5(
      "ffmpeg",
      [
        "-y",
        "-i",
        rawPath,
        "-ss",
        trimStartSec.toFixed(2),
        "-to",
        trimEndSec.toFixed(2),
        "-c",
        "copy",
        "-abort_on",
        "empty_output",
        videoPath
      ],
      { stdio: "pipe", timeout: 6e4 }
    );
    validateTrimmedVideo(videoPath);
    fs21.unlinkSync(rawPath);
    const trimmedDuration = Math.round(trimEndSec - trimStartSec);
    console.log(chalk3.dim(`Trimmed video to ${trimmedDuration}s (removed dead time)`));
    return trimStartSec;
  } catch {
    if (fs21.existsSync(videoPath)) {
      fs21.unlinkSync(videoPath);
    }
    if (fs21.existsSync(rawPath)) {
      fs21.renameSync(rawPath, videoPath);
    }
    console.log(chalk3.dim("Video trimming failed, keeping original"));
    return 0;
  }
}
function validateTrimmedVideo(videoPath) {
  if (!fs21.existsSync(videoPath) || fs21.statSync(videoPath).size === 0) {
    throw new Error("FFmpeg produced an empty video");
  }
  execFileSync5(
    "ffmpeg",
    ["-v", "error", "-i", videoPath, "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"],
    { stdio: "pipe", timeout: 6e4 }
  );
}

// src/commands/diff.ts
import * as fs22 from "fs";
import * as path19 from "path";
import chalk4 from "chalk";
async function diffCommand(options) {
  const config = loadConfig();
  const currentDir = path19.resolve(config.output);
  const baselineDir = path19.resolve(options.baseline);
  if (!fs22.existsSync(baselineDir)) {
    console.error(chalk4.red("\u2717") + ` Baseline directory not found: ${baselineDir}`);
    process.exit(1);
  }
  if (!fs22.existsSync(currentDir)) {
    console.error(
      chalk4.red("\u2717") + ` Current artifacts not found: ${currentDir}
` + chalk4.dim('Run "proofshot verify" first to generate screenshots.')
    );
    process.exit(1);
  }
  const baselineFiles = fs22.readdirSync(baselineDir).filter((f) => f.startsWith("page-") && f.endsWith(".png"));
  const currentFiles = fs22.readdirSync(currentDir).filter((f) => f.startsWith("page-") && f.endsWith(".png"));
  if (baselineFiles.length === 0) {
    console.error(chalk4.red("\u2717") + " No baseline screenshots found (looking for page-*.png)");
    process.exit(1);
  }
  const diffDir = path19.join(currentDir, "diffs");
  fs22.mkdirSync(diffDir, { recursive: true });
  console.log(chalk4.dim("Comparing screenshots...\n"));
  let hasChanges = false;
  for (const file of baselineFiles) {
    const baselinePath = path19.join(baselineDir, file);
    const currentPath = path19.join(currentDir, file);
    const diffPath = path19.join(diffDir, `diff-${file}`);
    if (!fs22.existsSync(currentPath)) {
      console.log(chalk4.yellow("\u26A0") + ` ${file}: no matching current screenshot (page removed?)`);
      continue;
    }
    const mismatch = diffScreenshots(baselinePath, currentPath, diffPath);
    if (mismatch === null) {
      console.log(chalk4.yellow("\u26A0") + ` ${file}: could not compare`);
    } else if (mismatch === 0) {
      console.log(chalk4.green("\u2713") + ` ${file}: identical`);
    } else {
      hasChanges = true;
      console.log(
        chalk4.red("\u2717") + ` ${file}: ${chalk4.bold(`${mismatch.toFixed(2)}%`)} changed \u2192 ${chalk4.dim(diffPath)}`
      );
    }
  }
  for (const file of currentFiles) {
    if (!baselineFiles.includes(file)) {
      console.log(chalk4.cyan("+") + ` ${file}: new page (no baseline)`);
      hasChanges = true;
    }
  }
  console.log("");
  if (hasChanges) {
    console.log(chalk4.yellow("Visual changes detected.") + ` Diff images saved to ${chalk4.dim(diffDir)}`);
  } else {
    console.log(chalk4.green("No visual changes detected."));
  }
}

// src/commands/clean.ts
import * as fs23 from "fs";
import * as path20 from "path";
import chalk5 from "chalk";
async function cleanCommand() {
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);
  const outputDir = path20.resolve(config.output);
  if (hasActiveSession(controlDir)) {
    console.error(
      chalk5.red("\u2717") + " Cannot clean while a ProofShot session owns browser or server processes.\n" + chalk5.dim('Run "proofshot stop" first so exact cleanup metadata is preserved.')
    );
    process.exit(1);
    return;
  }
  if (!fs23.existsSync(outputDir)) {
    console.log(chalk5.dim("Nothing to clean \u2014 no artifacts directory found."));
    return;
  }
  fs23.rmSync(outputDir, { recursive: true, force: true });
  console.log(chalk5.green("\u2713") + ` Removed ${chalk5.dim(outputDir)}`);
}

// src/commands/pr.ts
import * as fs26 from "fs";
import * as path23 from "path";
import { createHash as createHash4 } from "crypto";
import chalk6 from "chalk";

// src/utils/github.ts
import * as fs24 from "fs";
import * as path21 from "path";
import { execFileSync as execFileSync6, execSync as execSync5 } from "child_process";
var GITHUB_API_VERSION = "2022-11-28";
var DEFAULT_ARTIFACTS_BRANCH = "proofshot-artifacts";
function getGitHubToken() {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) return envToken.trim();
  try {
    return execSync5("gh auth token", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    throw new ProofShotError(
      "GitHub CLI (gh) is not installed or not authenticated.\nInstall: https://cli.github.com\nThen run: gh auth login",
      error
    );
  }
}
async function getRepoInfo(token) {
  let nwo;
  try {
    nwo = execSync5("gh repo view --json nameWithOwner -q .nameWithOwner", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    throw new ProofShotError(
      "Could not determine GitHub repository. Are you in a git repo with a GitHub remote?",
      error
    );
  }
  const [owner, repo] = nwo.split("/");
  const repoResponse = await githubApi(`repos/${owner}/${repo}`, token);
  return {
    owner,
    repo,
    id: repoResponse.id,
    defaultBranch: repoResponse.default_branch,
    isPrivate: repoResponse.private
  };
}
function getPRNumber(explicitPR) {
  if (explicitPR) {
    if (!/^\d+$/.test(explicitPR)) {
      throw new ProofShotError(`Invalid PR number: ${explicitPR}`);
    }
    const num = parseInt(explicitPR, 10);
    try {
      execSync5(`gh pr view ${num} --json number -q .number`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch {
      throw new ProofShotError(`PR #${num} not found or not accessible.`);
    }
    return num;
  }
  try {
    const numStr = execSync5("gh pr view --json number -q .number", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return parseInt(numStr, 10);
  } catch {
    throw new ProofShotError(
      "No PR found for the current branch.\nEither specify a PR number: proofshot pr 42\nOr create a PR first: gh pr create"
    );
  }
}
function getPRHeadProvenance(prNumber) {
  try {
    const raw = execFileSync6(
      "gh",
      [
        "pr",
        "view",
        String(prNumber),
        "--json",
        "headRefOid,headRefName,headRepository"
      ],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const parsed = JSON.parse(raw);
    return {
      repository: `github.com/${parsed.headRepository.nameWithOwner}`,
      branch: parsed.headRefName,
      headSha: parsed.headRefOid
    };
  } catch (error) {
    throw new ProofShotError(
      `Could not resolve the head provenance for PR #${prNumber}.`,
      error
    );
  }
}
function getContentType(filePath) {
  const ext = path21.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".webm":
      return "video/webm";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}
async function uploadAsset(filePath, token, repoId) {
  const fileName = path21.basename(filePath);
  const fileSize = fs24.statSync(filePath).size;
  const contentType = getContentType(filePath);
  const policyResponse = await fetch("https://github.com/upload/policies/assets", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `token ${token}`
    },
    body: JSON.stringify({
      name: fileName,
      size: fileSize,
      content_type: contentType,
      repository_id: repoId
    })
  });
  if (!policyResponse.ok) {
    const body = await policyResponse.text();
    if ([401, 403, 422].includes(policyResponse.status)) {
      throw new ProofShotError(
        `GitHub web attachment upload failed (${policyResponse.status}).
ProofShot's "github-web-attachments" provider uses GitHub's internal /upload/policies/assets endpoint, which may reject browser-based gh OAuth auth.
Try one of:
  - proofshot pr --upload-provider repo-contents
  - export GH_TOKEN=<token> and retry
  - proofshot pr --dry-run
GitHub response: ${body}`
      );
    }
    throw new ProofShotError(
      `GitHub upload policy request failed (${policyResponse.status}): ${body}`
    );
  }
  const policy = await policyResponse.json();
  const fileBuffer = fs24.readFileSync(filePath);
  const formData = new FormData();
  for (const [key, value] of Object.entries(policy.form)) {
    formData.append(key, value);
  }
  const blob = new Blob([fileBuffer], { type: contentType });
  formData.append("file", blob, fileName);
  const uploadResponse = await fetch(policy.upload_url, {
    method: "POST",
    body: formData
  });
  if (!uploadResponse.ok && uploadResponse.status !== 204 && uploadResponse.status !== 201) {
    throw new ProofShotError(
      `File upload failed (${uploadResponse.status}): ${await uploadResponse.text()}`
    );
  }
  return {
    url: policy.asset.href,
    name: fileName
  };
}
async function uploadAssets(options) {
  if (options.uploadProvider === "repo-contents") {
    return uploadAssetsToRepoContents(options);
  }
  return uploadAssetsToWebAttachments(options);
}
async function uploadAssetsToWebAttachments(options) {
  const results = /* @__PURE__ */ new Map();
  const { filePaths, token, repo, onProgress } = options;
  for (let i = 0; i < filePaths.length; i += 1) {
    const filePath = filePaths[i];
    const fileName = path21.basename(filePath);
    onProgress?.(i + 1, filePaths.length, fileName);
    try {
      const asset = await uploadAsset(filePath, token, repo.id);
      results.set(filePath, asset);
    } catch (error) {
      console.error(`  Failed to upload ${fileName}: ${error.message}`);
    }
  }
  return results;
}
async function uploadAssetsToRepoContents(options) {
  const results = /* @__PURE__ */ new Map();
  const artifactsBranch = options.artifactsBranch || DEFAULT_ARTIFACTS_BRANCH;
  await ensureArtifactsBranch(options.repo, artifactsBranch, options.token);
  for (let i = 0; i < options.filePaths.length; i += 1) {
    const filePath = options.filePaths[i];
    const fileName = path21.basename(filePath);
    options.onProgress?.(i + 1, options.filePaths.length, fileName);
    try {
      const content = fs24.readFileSync(filePath, "base64");
      const uploadPath = path21.posix.join(
        options.uploadRoot,
        path21.basename(path21.dirname(filePath)),
        fileName
      );
      await githubApi(
        `repos/${options.repo.owner}/${options.repo.repo}/contents/${encodePath(uploadPath)}`,
        options.token,
        {
          method: "PUT",
          body: JSON.stringify({
            message: `proofshot: add ${uploadPath}`,
            content,
            branch: artifactsBranch
          })
        }
      );
      results.set(filePath, {
        url: buildBlobUrl(options.repo, artifactsBranch, uploadPath),
        name: fileName
      });
    } catch (error) {
      console.error(`  Failed to upload ${fileName}: ${error.message}`);
    }
  }
  return results;
}
async function ensureArtifactsBranch(repo, branch, token) {
  try {
    await githubApi(
      `repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      token
    );
    return;
  } catch (error) {
    const message = error.message;
    if (!message.includes("(404)")) throw error;
  }
  const baseRef = await githubApi(
    `repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(repo.defaultBranch)}`,
    token
  );
  await githubApi(`repos/${repo.owner}/${repo.repo}/git/refs`, token, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      sha: baseRef.object.sha
    })
  });
}
function buildBlobUrl(repo, branch, filePath) {
  const encodedBranch = encodeURIComponent(branch);
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repo.owner}/${repo.repo}/blob/${encodedBranch}/${encodedPath}?raw=1`;
}
function encodePath(filePath) {
  return filePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
async function githubApi(apiPath, token, init = {}) {
  const response = await fetch(`https://api.github.com/${apiPath}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...init.body ? { "Content-Type": "application/json" } : {},
      ...init.headers || {}
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new ProofShotError(`GitHub API request failed (${response.status}): ${body}`);
  }
  if (response.status === 204) {
    return void 0;
  }
  return await response.json();
}
function postPRComment(prNumber, body) {
  try {
    execSync5(`gh pr comment ${prNumber} --body-file -`, {
      input: body,
      encoding: "utf-8",
      timeout: 12e4,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || "";
    throw new ProofShotError(`Failed to post PR comment: ${stderr}`, error);
  }
}

// src/artifacts/pr-format.ts
function formatPRComment(data) {
  let md = `## ProofShot Verification

`;
  if (data.description) {
    md += `> ${data.description}

`;
  }
  const status = data.errorCount === 0 ? "\u2705 No errors detected" : `\u26A0\uFE0F ${data.errorCount} error(s) detected`;
  md += `${status}

`;
  if (data.video) {
    md += `### Recording

`;
    if (data.video.renderMode === "embed") {
      md += `${data.video.url}

`;
    } else {
      md += `[Session recording](${data.video.url})

`;
    }
  }
  if (data.screenshots.size > 0) {
    md += `### Screenshots

`;
    if (data.screenshots.size <= 3) {
      for (const [filename, url] of data.screenshots) {
        const label = filename.replace(/\.png$/, "").replace(/^step-/, "");
        md += `**${label}**

`;
        md += `![${label}](${url})

`;
      }
    } else {
      md += `<details>
<summary>View ${data.screenshots.size} screenshots</summary>

`;
      for (const [filename, url] of data.screenshots) {
        const label = filename.replace(/\.png$/, "").replace(/^step-/, "");
        md += `**${label}**

![${label}](${url})

`;
      }
      md += `</details>

`;
    }
  }
  md += `---
`;
  md += `<sub>`;
  md += `Branch: \`${data.branch}\``;
  if (data.commitSha) {
    md += ` \xB7 Commit: \`${data.commitSha.slice(0, 7)}\``;
  }
  md += ` \xB7 ${data.sessionCount} session(s)`;
  md += `</sub>
`;
  md += `<sub>Generated by [ProofShot](https://github.com/AmElmo/proofshot)</sub>
`;
  return md;
}

// src/session/publication.ts
import * as fs25 from "fs";
import * as path22 from "path";
function selectPublication(options) {
  const sessions = discoverFinalizedSessions(options.outputDir);
  let candidates;
  if (options.sessionId) {
    candidates = sessions.filter(
      ({ sessionDir, manifest }) => manifest.sessionId === options.sessionId || path22.basename(sessionDir) === options.sessionId
    );
    if (candidates.length === 0) {
      throw new Error(
        `Finalized ProofShot session not found: ${options.sessionId}`
      );
    }
  } else {
    candidates = sessions.filter(
      ({ manifest }) => isCompatibleManifest(manifest, options)
    );
    if (candidates.length !== 1) {
      const choices = candidates.map(
        ({ manifest }) => `${manifest.sessionId} (${manifest.verdict}, ${manifest.commitSha.slice(0, 7)})`
      );
      throw new Error(
        candidates.length === 0 ? "No complete finalized session matches the target PR head. Use --session to inspect an explicit choice." : `Multiple complete sessions match the target PR head. Choose one with --session:
${choices.join("\n")}`
      );
    }
  }
  if (candidates.length > 1) {
    throw new Error(
      `Session ID is ambiguous: ${options.sessionId}. Use the exact session folder name.`
    );
  }
  const selected = candidates[0];
  assertCompatibleManifest(selected.manifest, options);
  validateManifestArtifacts(selected.sessionDir, selected.manifest);
  assertRequiredManifestArtifacts(selected.manifest);
  const allScreenshots = selected.manifest.artifacts.filter(
    (artifact) => artifact.kind === "screenshot"
  );
  const screenshots = options.screenshotIds?.length ? selectScreenshots(allScreenshots, options.screenshotIds) : allScreenshots;
  const videos = selected.manifest.artifacts.filter(
    (artifact) => artifact.kind === "video"
  );
  if (videos.length > 1) {
    throw new Error("Finalized session contains multiple video artifacts.");
  }
  return {
    ...selected,
    screenshots,
    video: videos[0] || null
  };
}
function discoverFinalizedSessions(outputDir) {
  if (!fs25.existsSync(outputDir)) {
    return [];
  }
  return fs25.readdirSync(outputDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => path22.join(outputDir, entry.name)).map((sessionDir) => ({
    sessionDir,
    manifest: loadArtifactManifest(sessionDir)
  })).filter(
    (entry) => entry.manifest !== null
  ).sort(
    (left, right) => right.manifest.finalizedAt.localeCompare(left.manifest.finalizedAt)
  );
}
function isCompatibleManifest(manifest, target) {
  return manifest.completion === "complete" && manifest.verdict !== "INCOMPLETE" && manifest.verdict !== "BLOCKED" && !manifest.sourceDirty && !manifest.sourceDrift && manifest.repository === target.repository && manifest.branch === target.branch && manifest.commitSha === target.headSha;
}
function assertCompatibleManifest(manifest, target) {
  const reasons = [];
  if (manifest.completion !== "complete") reasons.push("session is incomplete");
  if (manifest.verdict === "INCOMPLETE" || manifest.verdict === "BLOCKED") {
    reasons.push(`verdict is ${manifest.verdict}`);
  }
  if (manifest.sourceDirty || manifest.sourceDrift) {
    reasons.push("source drift was detected");
  }
  if (manifest.repository !== target.repository) {
    reasons.push("repository does not match");
  }
  if (manifest.branch !== target.branch) reasons.push("branch does not match");
  if (manifest.commitSha !== target.headSha) {
    reasons.push("commit does not match the target PR head");
  }
  if (reasons.length > 0) {
    throw new Error(
      `Session ${manifest.sessionId} cannot be published: ${reasons.join("; ")}.`
    );
  }
}
function assertRequiredManifestArtifacts(manifest) {
  for (const kind of ["evidence", "verdict"]) {
    if (!manifest.artifacts.some((artifact) => artifact.kind === kind)) {
      throw new Error(
        `Finalized session is missing its ${kind} artifact record.`
      );
    }
  }
}
function selectScreenshots(screenshots, requested) {
  const selected = [];
  for (const selector of requested) {
    const matches = screenshots.filter(
      (artifact) => artifact.id === selector || artifact.path === selector || path22.basename(artifact.path) === selector
    );
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0 ? `Screenshot artifact not found: ${selector}` : `Screenshot selector is ambiguous: ${selector}`
      );
    }
    if (selected.some((artifact) => artifact.id === matches[0].id)) {
      throw new Error(`Screenshot selected more than once: ${selector}`);
    }
    selected.push(matches[0]);
  }
  return selected;
}

// src/commands/pr.ts
async function prCommand(options) {
  const config = loadConfig();
  const outputDir = path23.resolve(config.output);
  const uploadProvider = normalizeUploadProvider(options.uploadProvider);
  const artifactsBranch = options.artifactsBranch || "proofshot-artifacts";
  const local = captureGitProvenance();
  if (!local.repository || !local.branch || !local.commitSha) {
    throw new Error(
      "ProofShot could not determine the current repository, branch, and commit."
    );
  }
  const prNumber = options.dryRun ? null : getPRNumber(options.prNumber);
  const target = prNumber ? getPRHeadProvenance(prNumber) : {
    repository: local.repository,
    branch: local.branch,
    headSha: local.commitSha
  };
  console.log(
    chalk6.dim(
      `Target: ${target.repository} ${target.branch}@${target.headSha.slice(0, 7)}`
    )
  );
  let selection;
  try {
    selection = selectPublication({
      outputDir,
      sessionId: options.session,
      screenshotIds: options.screenshot,
      ...target
    });
  } catch (error) {
    if (!options.legacySession) {
      throw error;
    }
    selection = selectLegacyPublication({
      outputDir,
      sessionId: options.session,
      screenshotIds: options.screenshot,
      ...target
    });
    console.log(
      chalk6.yellow(
        "\u26A0 Publishing an explicitly selected legacy session without a finalized provenance manifest."
      )
    );
  }
  const metadata = loadMetadata(selection.sessionDir);
  const description = metadata?.description || null;
  const screenshotPaths = selection.screenshots.map(
    (artifact) => path23.join(selection.sessionDir, artifact.path)
  );
  const videoPath = selection.video ? path23.join(selection.sessionDir, selection.video.path) : null;
  const errorCount = readIncidentCount(selection.sessionDir);
  const filesToUpload = [
    ...screenshotPaths,
    ...videoPath ? [videoPath] : []
  ];
  if (filesToUpload.length === 0) {
    throw new Error("The selected session has no publishable screenshots or video.");
  }
  if (options.dryRun) {
    const screenshotMap2 = /* @__PURE__ */ new Map();
    for (const ssPath of screenshotPaths) {
      const label = path23.basename(ssPath);
      screenshotMap2.set(label, `https://github.com/user-attachments/assets/<${label}>`);
    }
    const commentData2 = {
      description,
      sessionCount: 1,
      screenshots: screenshotMap2,
      video: videoPath ? {
        url: `https://github.com/user-attachments/assets/<${path23.basename(videoPath)}>`,
        renderMode: "embed"
      } : null,
      errorCount,
      branch: selection.manifest.branch,
      commitSha: selection.manifest.commitSha
    };
    console.log("");
    console.log(chalk6.yellow("--- Dry run (not posted) ---"));
    console.log(formatPRComment(commentData2));
    return;
  }
  if (prNumber === null) {
    throw new Error("A target PR is required for publication.");
  }
  console.log(chalk6.dim(`Target PR: #${prNumber}`));
  const token = getGitHubToken();
  const repoInfo = await getRepoInfo(token);
  const uploadRoot = buildUploadRoot(
    prNumber,
    selection.manifest
  );
  console.log(chalk6.dim(`Upload provider: ${uploadProvider}`));
  if (uploadProvider === "repo-contents") {
    console.log(chalk6.dim(`Artifacts branch: ${artifactsBranch}`));
  }
  console.log(chalk6.dim(`Uploading ${filesToUpload.length} artifact(s)...`));
  const uploaded = await uploadAssets({
    filePaths: filesToUpload,
    token,
    repo: repoInfo,
    uploadProvider,
    uploadRoot,
    artifactsBranch,
    onProgress: (current, total, fileName) => {
      console.log(chalk6.dim(`  [${current}/${total}] ${fileName}`));
    }
  });
  if (uploaded.size !== filesToUpload.length) {
    throw new Error(
      `Only ${uploaded.size}/${filesToUpload.length} artifacts uploaded. PR comment was not posted.`
    );
  }
  const screenshotMap = /* @__PURE__ */ new Map();
  for (const ssPath of screenshotPaths) {
    const asset = uploaded.get(ssPath);
    if (!asset) throw new Error(`Missing uploaded screenshot: ${ssPath}`);
    screenshotMap.set(path23.basename(ssPath), asset.url);
  }
  let video = null;
  if (videoPath) {
    const videoAsset = uploaded.get(videoPath);
    if (!videoAsset) throw new Error(`Missing uploaded video: ${videoPath}`);
    video = {
      url: videoAsset.url,
      renderMode: uploadProvider === "repo-contents" ? "link" : "embed"
    };
  }
  const commentData = {
    description,
    sessionCount: 1,
    screenshots: screenshotMap,
    video,
    errorCount,
    branch: selection.manifest.branch,
    commitSha: selection.manifest.commitSha
  };
  const commentBody = formatPRComment(commentData);
  console.log(chalk6.dim("Posting PR comment..."));
  postPRComment(prNumber, commentBody);
  console.log("");
  console.log(chalk6.green.bold(`\u2705 Posted ProofShot verification to PR #${prNumber}`));
  console.log(
    chalk6.dim(`  ${screenshotMap.size} screenshot(s), ${video ? "1 video" : "no video"}`)
  );
}
function buildUploadRoot(prNumber, manifest) {
  const sessionId = manifest.sessionId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
  const manifestHash = createHash4("sha256").update(JSON.stringify(manifest)).digest("hex").slice(0, 12);
  return path23.posix.join(
    "proofshot",
    `pr-${prNumber}`,
    sessionId,
    manifestHash
  );
}
function readIncidentCount(sessionDir) {
  try {
    const evidence = JSON.parse(
      fs26.readFileSync(path23.join(sessionDir, "evidence.json"), "utf-8")
    );
    return (evidence.incidents || []).reduce(
      (total, incident) => total + (incident.count || 0),
      0
    );
  } catch {
    return 0;
  }
}
function selectLegacyPublication(options) {
  if (!options.sessionId || path23.basename(options.sessionId) !== options.sessionId) {
    throw new Error(
      "Legacy publication requires an exact --session folder name."
    );
  }
  const sessionDir = path23.join(options.outputDir, options.sessionId);
  const stat = fs26.lstatSync(sessionDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Legacy session is not a safe directory.");
  }
  if (fs26.existsSync(path23.join(sessionDir, "artifact-manifest.json"))) {
    throw new Error(
      "A finalized manifest exists; --legacy-session cannot bypass its validation."
    );
  }
  const metadata = loadMetadata(sessionDir);
  if (!metadata || metadata.branch !== options.branch || metadata.commitSha !== options.headSha) {
    throw new Error(
      "Legacy session branch and commit must match the target PR head."
    );
  }
  const artifacts = fs26.readdirSync(sessionDir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && !entry.isSymbolicLink() && (entry.name.endsWith(".png") || entry.name === "session.webm" || entry.name === "session.mp4")
  ).map((entry, order) => {
    const contents = fs26.readFileSync(path23.join(sessionDir, entry.name));
    return {
      id: `${entry.name.endsWith(".png") ? "screenshot" : "video"}:${entry.name}`,
      kind: entry.name.endsWith(".png") ? "screenshot" : "video",
      path: entry.name,
      sha256: createHash4("sha256").update(contents).digest("hex"),
      size: contents.length,
      order
    };
  });
  const screenshots = artifacts.filter(
    (artifact) => artifact.kind === "screenshot"
  );
  const requestedScreenshots = options.screenshotIds?.length ? options.screenshotIds.map((selector) => {
    const matches = screenshots.filter(
      (artifact) => artifact.id === selector || artifact.path === selector || path23.basename(artifact.path) === selector
    );
    if (matches.length !== 1) {
      throw new Error(`Legacy screenshot selection failed: ${selector}`);
    }
    return matches[0];
  }) : screenshots;
  const videos = artifacts.filter((artifact) => artifact.kind === "video");
  if (videos.length > 1) {
    throw new Error("Legacy session contains multiple videos.");
  }
  const manifest = {
    version: 1,
    sessionId: options.sessionId,
    repository: options.repository,
    branch: metadata.branch,
    commitSha: metadata.commitSha,
    treeHash: metadata.treeHash || "",
    sourceDirty: true,
    sourceDrift: true,
    startedAt: metadata.startedAt,
    finalizedAt: metadata.startedAt,
    completion: "complete",
    verdict: "BLOCKED",
    artifacts
  };
  return {
    sessionDir,
    manifest,
    screenshots: requestedScreenshots,
    video: videos[0] || null
  };
}
function normalizeUploadProvider(provider) {
  if (!provider || provider === "repo-contents") {
    return "repo-contents";
  }
  if (provider === "github-web-attachments") {
    return "github-web-attachments";
  }
  console.error(
    chalk6.red("\u2717") + ` Invalid upload provider "${provider}". Use "repo-contents" or "github-web-attachments".`
  );
  process.exit(1);
}

// src/commands/doctor.ts
import chalk7 from "chalk";

// src/version.ts
var PROOFSHOT_VERSION = true ? "1.6.0" : readPackageVersion();

// src/commands/doctor.ts
function statusLabel(ok, text) {
  return ok ? `${chalk7.green("\u2713")} ${text}` : `${chalk7.yellow("\u26A0")} ${text}`;
}
function printLine(label, value) {
  console.log(`${label.padEnd(14)} ${value}`);
}
async function doctorCommand() {
  const configPath = findConfigPath();
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);
  const session = loadSession(controlDir);
  const registeredSessions = listRegisteredSessions();
  const agentBrowserPath = findExecutablePath("agent-browser");
  const ffmpegPath = findExecutablePath("ffmpeg");
  const agentBrowserVersion = readCommandVersion("agent-browser");
  const ffmpegVersion = readCommandVersion("ffmpeg");
  console.log(chalk7.bold("ProofShot Doctor"));
  console.log("");
  printLine("ProofShot", PROOFSHOT_VERSION);
  printLine("Config", configPath || chalk7.dim("not found"));
  printLine("Output", config.output);
  printLine("Control state", controlDir);
  printLine("Browser mode", config.headless ? "headless" : "headed");
  printLine("Viewport", `${config.viewport.width}x${config.viewport.height}`);
  console.log("");
  console.log(statusLabel(Boolean(agentBrowserPath), "agent-browser"));
  printLine("Path", agentBrowserPath || chalk7.dim("not found"));
  printLine("Version", agentBrowserVersion || chalk7.dim("not available"));
  console.log("");
  console.log(statusLabel(Boolean(ffmpegPath), "ffmpeg"));
  printLine("Path", ffmpegPath || chalk7.dim("not found"));
  printLine("Version", ffmpegVersion || chalk7.dim("not available"));
  console.log("");
  console.log(statusLabel(Boolean(session), "active session"));
  printLine("Sessions", String(registeredSessions.length));
  if (session) {
    printLine("Session dir", session.sessionDir);
    printLine("Recording", session.recordingActive ? "active" : "stopped");
    printLine("Port", String(session.port));
    if (session.targetUrl) printLine("Target", session.targetUrl);
  } else {
    printLine("Session dir", chalk7.dim("none"));
  }
}

// src/commands/session.ts
import chalk8 from "chalk";
async function sessionListCommand(options) {
  const entries = listRegisteredSessions().map(buildSessionListEntry);
  if (options.json) {
    console.log(JSON.stringify({ sessions: entries }, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log("No registered ProofShot sessions.");
    return;
  }
  console.log(chalk8.bold("ProofShot Sessions"));
  console.log("");
  for (const entry of entries) {
    console.log(`${entry.id}  ${formatStatus(entry.status)}`);
    console.log(chalk8.dim(`  Started: ${entry.startedAt}`));
    console.log(chalk8.dim(`  From:    ${entry.startDirectory || "unknown"}`));
    console.log(chalk8.dim(`  Output:  ${entry.outputDir}`));
    if (entry.cleanupError) {
      console.log(chalk8.yellow(`  Cleanup: ${entry.cleanupError}`));
    }
  }
}
async function sessionCleanCommand(options) {
  const sessions = selectSessionsToClean(options);
  if (sessions.length === 0) {
    console.log("No recoverable ProofShot sessions.");
    return;
  }
  let failures = 0;
  for (const session of sessions) {
    setAgentBrowserDefaults({
      configPath: session.agentBrowserConfigPath,
      socketDir: session.agentBrowserSocketDir
    });
    try {
      await cleanupFailedStart(session);
      clearMatchingControlState(session);
      unregisterSession(session.sessionName);
      console.log(`${chalk8.green("\u2713")} Cleaned ${session.sessionName}`);
    } catch (error) {
      failures += 1;
      session.lifecycleStatus = "recovery";
      session.cleanupError = error instanceof Error ? error.message : String(error);
      persistMatchingControlState(session);
      registerSession(session);
      console.error(`${chalk8.red("\u2717")} Kept ${session.sessionName}: ${session.cleanupError}`);
    }
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
}
function clearMatchingControlState(session) {
  const controlDir = session.controlDir ?? session.outputDir;
  const activeSession = loadControlSessionSafely(controlDir);
  if (activeSession?.sessionName === session.sessionName) {
    clearSession(controlDir);
  }
}
function persistMatchingControlState(session) {
  const controlDir = session.controlDir ?? session.outputDir;
  const activeSession = loadControlSessionSafely(controlDir);
  if (!hasActiveSession(controlDir) || activeSession?.sessionName === session.sessionName) {
    saveSession(session, controlDir);
  }
}
function loadControlSessionSafely(controlDir) {
  try {
    return loadSession(controlDir);
  } catch {
    return null;
  }
}
function selectSessionsToClean(options) {
  if (options.session) {
    const session = getRegisteredSession(options.session);
    if (!session) {
      throw new Error(`No registered ProofShot session named "${options.session}".`);
    }
    return [session];
  }
  const sessions = listRegisteredSessions();
  if (options.all) {
    return sessions;
  }
  return sessions.filter((session) => {
    const status = getSessionStatus(session);
    return status === "recovery" || status === "stale";
  });
}
function buildSessionListEntry(session) {
  return {
    id: session.sessionName,
    status: getSessionStatus(session),
    startedAt: session.startedAt,
    startDirectory: session.startDirectory || null,
    outputDir: session.outputDir,
    cleanupError: session.cleanupError || null
  };
}
function getSessionStatus(session) {
  if (session.lifecycleStatus === "recovery") {
    return "recovery";
  }
  if (session.lifecycleStatus === "starting") {
    return "starting";
  }
  if (session.browserProcess && ownedProcessTreeIsAlive(session.browserProcess) || session.serverProcess && ownedProcessTreeIsAlive(session.serverProcess)) {
    return "active";
  }
  return "stale";
}
function formatStatus(status) {
  switch (status) {
    case "active":
      return chalk8.green(status);
    case "starting":
      return chalk8.cyan(status);
    case "recovery":
      return chalk8.yellow(status);
    case "stale":
      return chalk8.dim(status);
    default: {
      const exhaustiveStatus = status;
      return exhaustiveStatus;
    }
  }
}

// src/cli.ts
function createCLI() {
  const program = new Command();
  program.name("proofshot").description("Visual verification for AI coding agents").version(PROOFSHOT_VERSION);
  program.command("install").description("Install ProofShot skills at user level for all detected AI coding tools").option("--only <tools>", "Only install for these tools (comma-separated: claude,codex,cursor,gemini,windsurf,opencode)").option("--skip <tools>", "Skip these tools (comma-separated)").option("--force", "Overwrite existing skill files even if unchanged").action(async (options) => {
    await installCommand(options);
  });
  program.command("start").description("Start a verification session: browser, recording, error capture").option("--description <text>", "What is being verified (included in the proof report)").option("--port <port>", "Override detected port", parseInt).option("--run <command>", "Start this command and capture its logs").option("--headed", "Show browser window for debugging").option("--output <dir>", "Custom output directory").option("--url <url>", "Open this URL instead of the root").option("--browser-executable <path>", "Use this Chrome/Chromium executable").option("--force", "Override a stale session without running stop first").action(async (options) => {
    await startCommand(options);
  });
  program.command("stop").description("Stop session: stop recording, collect errors, bundle proof artifacts").option("--no-close", "Don't close the browser (keep it open for further use)").action(async (options) => {
    await stopCommand({ noClose: options.close === false });
  });
  program.command("diff").description("Compare current screenshots against a baseline").requiredOption("--baseline <dir>", "Directory with baseline screenshots").action(async (options) => {
    await diffCommand(options);
  });
  program.command("clean").description("Remove artifact files").action(async () => {
    await cleanCommand();
  });
  program.command("doctor").description("Inspect the local ProofShot environment and active session state").action(async () => {
    await doctorCommand();
  });
  program.command("pr").description("Upload session artifacts and post a ProofShot comment on a GitHub PR").argument("[pr-number]", "PR number (auto-detects from current branch if omitted)").option("--dry-run", "Generate the comment markdown without posting").option("--session <id>", "Publish one finalized session").option(
    "--screenshot <artifact...>",
    "Publish only the named screenshot artifact(s)"
  ).option(
    "--legacy-session",
    "Allow one explicitly selected pre-manifest session"
  ).option(
    "--upload-provider <provider>",
    "Artifact upload backend: repo-contents or github-web-attachments",
    "repo-contents"
  ).option(
    "--artifacts-branch <branch>",
    "Git branch used by the repo-contents upload provider",
    "proofshot-artifacts"
  ).action(async (prNumber, options) => {
    await prCommand({ prNumber, ...options });
  });
  program.command("exec").description("Run an agent-browser command with logging (use instead of agent-browser directly)").argument("<args...>", "agent-browser command and arguments").allowUnknownOption().action(async (args) => {
    await execCommand(args);
  });
  const session = program.command("session").description("List and recover registered ProofShot sessions");
  session.command("list").description("List all registered ProofShot sessions").option("--json", "Output machine-readable JSON").action(async (options) => {
    await sessionListCommand(options);
  });
  session.command("clean").description("Retry exact cleanup for recoverable ProofShot sessions").option("--session <id>", "Clean one exact registered session").option("--all", "Clean every registered session").action(async (options) => {
    await sessionCleanCommand(options);
  });
  return program;
}
export {
  ProofShotError,
  ab,
  captureGitProvenance,
  createCLI,
  ensureDevServer,
  findSessionsForBranch,
  formatPRComment,
  generateViewer,
  installCommand,
  isPortOpen,
  loadArtifactManifest,
  loadConfig,
  loadMetadata,
  loadSession,
  saveSession,
  startOwnedEnvironment,
  stopOwnedEnvironment,
  validateManifestArtifacts,
  waitForPort,
  writeArtifactManifest,
  writeCanonicalEvidence,
  writeConfig,
  writeMetadata,
  writeViewer
};
//# sourceMappingURL=index.js.map