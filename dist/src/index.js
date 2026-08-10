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
proofshot exec screenshot step-NAME.png                       # Capture key moments
\`\`\`

Take screenshots at important moments \u2014 these become the visual proof.
Verify what you expect to see by reading the snapshot output.

### Step 3: Stop and bundle the proof

\`\`\`bash
proofshot stop
\`\`\`

This stops recording, collects console + server errors, and generates
a SUMMARY.md with video, screenshots, and error report.

### Step 4 (optional): Post proof to the PR

\`\`\`bash
proofshot pr              # Auto-detect PR from current branch
proofshot pr 42           # Target a specific PR number
\`\`\`

This uploads screenshots and video to GitHub and posts a formatted comment on the PR with inline media. Requires \`gh\` CLI to be authenticated.
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
  return new Promise((resolve10) => {
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
        resolve10([]);
        return;
      }
      if (key === "\r" || key === "\n") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        stdin.pause();
        process.stdout.write("\r\x1B[K\n");
        resolve10(tools.filter((_, i) => selected[i]));
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
import * as path9 from "path";
import chalk2 from "chalk";
import { execSync as execSync4 } from "child_process";

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
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      output: path3.resolve(
        configDir,
        typeof parsed.output === "string" ? parsed.output : DEFAULT_CONFIG.output
      ),
      devServer: { ...DEFAULT_CONFIG.devServer, ...parsed.devServer },
      viewport: { ...DEFAULT_CONFIG.viewport, ...parsed.viewport },
      browser: resolvedBrowser
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
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
      return parseLinuxProcStat(fs4.readFileSync(`/proc/${pid}/stat`, "utf-8"));
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
      return parseUnixProcessIdentity(pid, output);
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
  return Boolean(current && identitiesMatch(current, identity));
}
function identitiesMatch(left, right) {
  return left.pid === right.pid && left.processGroupId === right.processGroupId && left.sessionId === right.sessionId && left.startTime === right.startTime;
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
  if (current && !identitiesMatch(current, identity)) return false;
  if (process.platform === "darwin") {
    return processGroupIsAlive(identity.processGroupId);
  }
  return listProcessGroupsInSession(identity.sessionId).length > 0;
}
function signalOwnedTree(identity, signal) {
  if (process.platform === "win32") return false;
  const current = captureProcessIdentity(identity.pid);
  if (current && !identitiesMatch(current, identity)) return false;
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
    await new Promise((resolve10) => setTimeout(resolve10, pollIntervalMs));
  }
  if (ownedProcessTreeIsAlive(identity)) {
    signalOwnedTree(identity, "SIGKILL");
    const killDeadline = Date.now() + 500;
    while (Date.now() < killDeadline && ownedProcessTreeIsAlive(identity)) {
      await new Promise((resolve10) => setTimeout(resolve10, pollIntervalMs));
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
function shellQuote(value) {
  const escaped = value.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}
function buildAgentBrowserCommand(command, options = {}) {
  const mergedOptions = {
    ...defaultAgentBrowserOptions,
    ...options
  };
  const configFlag = mergedOptions.configPath ? ` --config ${shellQuote(mergedOptions.configPath)}` : "";
  const sessionFlag = mergedOptions.session ? ` --session ${shellQuote(mergedOptions.session)}` : "";
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
  return new Promise((resolve10) => {
    const socket = new net.Socket();
    socket.setTimeout(1e3);
    socket.on("connect", () => {
      socket.destroy();
      resolve10(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve10(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve10(false);
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
    await new Promise((resolve10) => setTimeout(resolve10, 10));
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
  await new Promise((resolve10) => setTimeout(resolve10, 1e3));
  return result;
}

// src/browser/session.ts
function buildOpenBrowserCommand(url, headless = true, browserConfig) {
  const flags = [];
  if (!headless) flags.push("--headed");
  if (browserConfig?.ignoreHttpsErrors) flags.push("--ignore-https-errors");
  if (browserConfig?.executablePath) flags.push(`--executable-path "${browserConfig.executablePath.replace(/"/g, '\\"')}"`);
  const suffix = flags.length > 0 ? ` ${flags.join(" ")}` : "";
  return `open ${url}${suffix}`;
}
function openBrowser(url, viewport, headless = true, sessionName, browserConfig) {
  ab(buildOpenBrowserCommand(url, headless, browserConfig), { timeoutMs: 6e4, session: sessionName });
  ab(`set viewport ${viewport.width} ${viewport.height}`, { session: sessionName });
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
  const commandNames = platform === "darwin" ? ["google-chrome", "chromium"] : platform === "win32" ? ["chrome", "msedge"] : ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"];
  for (const command of commandNames) {
    const executable = executableLookup(command, platform);
    if (executable && isExecutable(executable)) return executable;
  }
  const homes = /* @__PURE__ */ new Set();
  if (env.HOME) homes.add(path4.resolve(env.HOME));
  const accountHome = options.accountHome ?? accountHomeDirectory();
  if (accountHome) homes.add(path4.resolve(accountHome));
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
    for (const home of homes) candidates.push(...cachedBrowserCandidates(home));
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
    await new Promise((resolve10) => setTimeout(resolve10, pollIntervalMs));
  } while (Date.now() < deadline);
  return captureAgentBrowserProcessIdentity(socketDir, sessionName);
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
  } catch {
    return null;
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
  if (identity && processIdentityMatches(identity)) {
    closeBrowser(session.sessionName);
  }
  await terminateOwnedProcessTree(identity);
  if (identity && ownedProcessTreeIsAlive(identity)) {
    throw new Error(`Owned browser process session ${identity.sessionId} did not stop.`);
  }
}
async function stopOwnedServer(session) {
  await terminateOwnedProcessTree(session.serverProcess);
  if (session.serverProcess && ownedProcessTreeIsAlive(session.serverProcess)) {
    throw new Error(`Owned server process session ${session.serverProcess.sessionId} did not stop.`);
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
    await stopOwnedServer(session);
  } catch (error) {
    cleanupError ||= error;
  }
  if (cleanupError) throw cleanupError;
}

// src/session/registry.ts
import * as fs10 from "fs";
import * as os4 from "os";
import * as path7 from "path";
import { randomUUID as randomUUID2 } from "crypto";
var SESSION_REGISTRY_DIRECTORY = "sessions";
function getSessionRegistryDir(env = process.env, homeDir = os4.homedir()) {
  const stateHome = env.XDG_STATE_HOME || path7.join(homeDir, ".local", "state");
  return path7.join(stateHome, "proofshot", SESSION_REGISTRY_DIRECTORY);
}
function registerSession(session, registryDir = getSessionRegistryDir()) {
  validateSessionName(session.sessionName);
  prepareRegistryDirectory(registryDir);
  const registryPath = getRegistryPath(session.sessionName, registryDir);
  const temporaryPath = `${registryPath}.${process.pid}.${randomUUID2()}.tmp`;
  try {
    fs10.writeFileSync(temporaryPath, JSON.stringify(session, null, 2) + "\n", {
      mode: 384
    });
    fs10.renameSync(temporaryPath, registryPath);
  } finally {
    if (fs10.existsSync(temporaryPath)) {
      fs10.unlinkSync(temporaryPath);
    }
  }
}
function unregisterSession(sessionName, registryDir = getSessionRegistryDir()) {
  validateSessionName(sessionName);
  const registryPath = getRegistryPath(sessionName, registryDir);
  if (fs10.existsSync(registryPath)) {
    fs10.unlinkSync(registryPath);
  }
}
function listRegisteredSessions(registryDir = getSessionRegistryDir()) {
  if (!fs10.existsSync(registryDir)) {
    return [];
  }
  assertOwnedDirectory2(registryDir);
  return fs10.readdirSync(registryDir).filter((fileName) => fileName.endsWith(".json")).map((fileName) => readRegisteredSession(path7.join(registryDir, fileName))).filter((session) => session !== null).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}
function getRegisteredSession(sessionName, registryDir = getSessionRegistryDir()) {
  validateSessionName(sessionName);
  return readRegisteredSession(getRegistryPath(sessionName, registryDir));
}
function prepareRegistryDirectory(registryDir) {
  fs10.mkdirSync(registryDir, { recursive: true, mode: 448 });
  assertOwnedDirectory2(registryDir);
}
function assertOwnedDirectory2(directory) {
  const stat = fs10.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`ProofShot session registry is not a real directory: ${directory}`);
  }
  const uid = process.getuid?.();
  if (uid !== void 0 && stat.uid !== uid) {
    throw new Error(
      `ProofShot session registry is owned by uid ${stat.uid}, expected ${uid}: ${directory}`
    );
  }
  fs10.accessSync(directory, fs10.constants.R_OK | fs10.constants.W_OK | fs10.constants.X_OK);
  if (uid !== void 0) {
    fs10.chmodSync(directory, 448);
  }
}
function getRegistryPath(sessionName, registryDir) {
  return path7.join(registryDir, `${sessionName}.json`);
}
function validateSessionName(sessionName) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) {
    throw new Error(`Invalid ProofShot session name: ${sessionName}`);
  }
}
function readRegisteredSession(registryPath) {
  try {
    const stat = fs10.lstatSync(registryPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return null;
    }
    const parsed = JSON.parse(fs10.readFileSync(registryPath, "utf-8"));
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
import * as fs11 from "fs";
import * as path8 from "path";
var METADATA_FILENAME = "metadata.json";
function writeMetadata(sessionDir, metadata) {
  const metadataPath = path8.join(sessionDir, METADATA_FILENAME);
  fs11.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
}
function loadMetadata(sessionDir) {
  const metadataPath = path8.join(sessionDir, METADATA_FILENAME);
  if (!fs11.existsSync(metadataPath)) return null;
  try {
    return JSON.parse(fs11.readFileSync(metadataPath, "utf-8"));
  } catch {
    return null;
  }
}
function findSessionsForBranch(outputDir, branch) {
  if (!fs11.existsSync(outputDir)) return [];
  const entries = fs11.readdirSync(outputDir, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionDir = path8.join(outputDir, entry.name);
    const metadata = loadMetadata(sessionDir);
    if (metadata && metadata.branch === branch) {
      matches.push({ dir: sessionDir, startedAt: metadata.startedAt });
    }
  }
  matches.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return matches.map((m) => m.dir);
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
  const outputDir = path9.resolve(config.output);
  const timestamp = generateTimestamp();
  const sessionDirName = generateSessionDirName(timestamp, options.description || null);
  const sessionDir = path9.join(outputDir, sessionDirName);
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
  const videoPath = path9.join(sessionDir, "session.webm");
  const serverErrorLog = path9.join(sessionDir, "server.log");
  let branch = "";
  let commitSha = "";
  try {
    branch = execSync4("git branch --show-current", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch {
  }
  try {
    commitSha = execSync4("git rev-parse HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch {
  }
  writeMetadata(sessionDir, {
    branch,
    commitSha,
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    description: options.description || null
  });
  const baseUrl = `http://localhost:${config.devServer.port}`;
  const openUrl = options.url || baseUrl;
  const session = {
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    startDirectory: process.cwd(),
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
    viewport: { width: config.viewport.width, height: config.viewport.height }
  };
  persistOwnedSession(session, controlDir);
  const signalHandlers = installStartSignalHandlers(session, controlDir);
  let failureContext = "start the session";
  try {
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
    } else {
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
        recordingStarted = true;
        console.log(chalk2.green("\u2713") + " Recording started");
        break;
      } catch (error) {
        lastError = error;
        if (attempt < RECORDING_RETRIES) {
          console.log(
            chalk2.yellow("\u26A0") + ` Recording failed (attempt ${attempt}/${RECORDING_RETRIES}), retrying in ${RETRY_DELAY_MS / 1e3}s...`
          );
          await new Promise((resolve10) => setTimeout(resolve10, RETRY_DELAY_MS));
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
import * as fs15 from "fs";
import * as path13 from "path";
import { randomUUID as randomUUID3 } from "crypto";
import { execFileSync as execFileSync2 } from "child_process";
import chalk3 from "chalk";

// src/artifacts/viewer.ts
import * as fs12 from "fs";
import * as path10 from "path";
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
    const time = formatTime(Math.max(0, entry.relativeTimeSec));
    return `<span class="${cls}" data-time="${entry.relativeTimeSec}" onclick="seekTo(${entry.relativeTimeSec})"><span class="log-time">${time}</span><span class="log-ln">${num}</span>${escapeHtml(entry.text)}</span>`;
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
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function serializeEntries(entries) {
  return JSON.stringify(entries).replace(/<\//g, "<\\/");
}
function generateViewer(data) {
  const date = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19);
  const stepsHtml = data.entries.map((entry, i) => {
    const icon = getActionIcon(entry.action);
    const time = formatTime(entry.relativeTimeSec);
    const action = escapeHtml(entry.action);
    return `      <div class="step" data-time="${entry.relativeTimeSec}" data-index="${i}" onclick="seekTo(${entry.relativeTimeSec})">
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
    }))
  );
  const scrubBarHtml = hasVideo ? `<div class="scrub-bar">
        <div class="scrub-track" id="scrubTrack">
          <div class="scrub-progress" id="scrubProgress"></div>
          <div class="scrub-playhead" id="scrubPlayhead"></div>
          ${data.entries.map((entry, i) => {
    const pct = data.durationSec > 0 ? entry.relativeTimeSec / data.durationSec * 100 : 0;
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
    <p class="meta">${escapeHtml(date)} &middot; ${data.durationSec}s</p>
    <div class="error-badges">
      <button class="error-badge ${consoleBadgeClass}" onclick="switchTab('console')"><span class="badge-dot"></span>${consoleBadgeText}</button>
      <button class="error-badge ${serverBadgeClass}" onclick="switchTab('server')"><span class="badge-dot"></span>${serverBadgeText}</button>
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
        <button class="panel-tab" data-tab="console" onclick="switchTab('console')">Console${consoleLineCount > 0 ? ` &middot; ${consoleLineCount}` : ""}</button>
        <button class="panel-tab" data-tab="server" onclick="switchTab('server')">Server${serverLineCount > 0 ? ` &middot; ${serverLineCount}` : ""}</button>
        <div class="panel-tab-actions" id="tabActionsTimeline">
          <label class="overlay-toggle"><input type="checkbox" id="toggle-overlays" checked><span class="toggle-track"></span> Overlays<span class="tooltip">Show ripple animations and action labels on the video as each step plays.</span></label>
        </div>
      </div>
      <div id="tabTimeline">
${stepsHtml}
      </div>
      <div id="tabConsole" style="display:none">
        <div class="log-tab-content">
          <div class="log-tab-status">
            <span class="error-badge ${consoleBadgeClass}" style="cursor:default"><span class="badge-dot"></span>${consoleBadgeText}</span>
          </div>
          ${consoleLogBodyHtml}
        </div>
      </div>
      <div id="tabServer" style="display:none">
        <div class="log-tab-content">
          <div class="log-tab-status">
            <span class="error-badge ${serverBadgeClass}" style="cursor:default"><span class="badge-dot"></span>${serverBadgeText}</span>
          </div>
          ${serverLogBodyHtml}
        </div>
      </div>
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
      document.getElementById('tabTimeline').style.display = tab === 'timeline' ? '' : 'none';
      document.getElementById('tabConsole').style.display = tab === 'console' ? '' : 'none';
      document.getElementById('tabServer').style.display = tab === 'server' ? '' : 'none';
      var actions = document.getElementById('tabActionsTimeline');
      if (actions) actions.style.display = tab === 'timeline' ? '' : 'none';
    }

    const video = document.querySelector('video');
    const steps = document.querySelectorAll('.step');
    const timelinePanel = document.querySelector('.timeline-panel');
    const overlay = document.querySelector('.video-overlay');
    const entries = ${entriesJson};
    let duration = ${data.durationSec};
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
      if (video) {
        video.currentTime = time;
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
        video.currentTime = t;
        updateScrubBar(t);
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const t = getTimeFromEvent(e);
        video.currentTime = t;
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
      if (activeTab === 'console' || activeTab === 'server') {
        var tabId = activeTab === 'console' ? 'tabConsole' : 'tabServer';
        var tabEl = document.getElementById(tabId);
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

      // Sync scrub bar duration with actual video duration
      video.addEventListener('loadedmetadata', () => {
        if (video.duration && isFinite(video.duration)) {
          duration = video.duration;
          // Reposition markers to match actual video duration
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
    const logPath = path10.join(outputDir, "session-log.json");
    if (!fs12.existsSync(logPath)) return null;
    try {
      entries = JSON.parse(fs12.readFileSync(logPath, "utf-8"));
    } catch {
      return null;
    }
  }
  if (!entries || entries.length === 0) return null;
  const html = generateViewer({ ...data, entries });
  const viewerPath = path10.join(outputDir, "viewer.html");
  fs12.writeFileSync(viewerPath, html);
  return viewerPath;
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
import * as fs13 from "fs";
import * as path11 from "path";
import { execSync as execSync5 } from "child_process";
var SESSION_LOG_FILENAME = "session-log.json";
function loadSessionLog(sessionDir) {
  const logPath = path11.join(sessionDir, SESSION_LOG_FILENAME);
  if (!fs13.existsSync(logPath)) return [];
  try {
    return JSON.parse(fs13.readFileSync(logPath, "utf-8"));
  } catch {
    return [];
  }
}
function resolveScreenshotPath(args, sessionDir) {
  if (args[0] !== "screenshot" || args.length < 2) return args;
  const screenshotPath = args[args.length - 1];
  if (path11.isAbsolute(screenshotPath)) return args;
  const resolved = path11.join(sessionDir, screenshotPath);
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
  let resolvedArgs = args;
  if (session) {
    resolvedArgs = resolveScreenshotPath(args, session.sessionDir);
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
      timestamp: now.toISOString()
    };
    if (elementData) {
      entry.element = elementData;
    }
    const logPath = path11.join(session.sessionDir, SESSION_LOG_FILENAME);
    const entries = loadSessionLog(session.sessionDir);
    entries.push(entry);
    fs13.writeFileSync(logPath, JSON.stringify(entries, null, 2) + "\n");
  }
  const shellCmd = buildShellCommand(resolvedArgs, session?.sessionName);
  try {
    const result = execSync5(shellCmd, {
      encoding: "utf-8",
      timeout: 6e4,
      stdio: ["pipe", "pipe", "pipe"],
      env: getAgentBrowserEnvironment()
    });
    if (result.trim()) {
      process.stdout.write(result);
      if (!result.endsWith("\n")) {
        process.stdout.write("\n");
      }
    }
  } catch (error) {
    const stderr = error?.stderr?.toString?.() || "";
    const stdout = error?.stdout?.toString?.() || "";
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
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

// src/utils/token-usage.ts
import * as fs14 from "fs";
import * as path12 from "path";
import * as os5 from "os";
function estimateTokenUsage(sessionDir, startTimeMs, endTimeMs) {
  const claudeUsage = tryClaudeCodeLogs(startTimeMs, endTimeMs);
  if (claudeUsage) return claudeUsage;
  return estimateFromContent(sessionDir);
}
function tryClaudeCodeLogs(startTimeMs, endTimeMs) {
  const claudeDir = path12.join(os5.homedir(), ".claude", "sessions");
  if (!fs14.existsSync(claudeDir)) return null;
  try {
    const files = fs14.readdirSync(claudeDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const data = JSON.parse(fs14.readFileSync(path12.join(claudeDir, file), "utf-8"));
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
  const logPath = path12.join(sessionDir, "session-log.json");
  if (!fs14.existsSync(logPath)) return null;
  try {
    const entries = JSON.parse(fs14.readFileSync(logPath, "utf-8"));
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
  const consoleErrorsPath = path13.join(session.sessionDir, "console-errors.log");
  const consoleOutputPath = path13.join(session.sessionDir, "console-output.log");
  const consoleEntriesPath = path13.join(session.sessionDir, "console-entries.json");
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
    if (fs15.existsSync(consoleErrorsPath)) {
      consoleErrors = fs15.readFileSync(consoleErrorsPath, "utf-8");
    }
    if (fs15.existsSync(consoleOutputPath)) {
      consoleOutput = fs15.readFileSync(consoleOutputPath, "utf-8");
    }
    if (fs15.existsSync(consoleEntriesPath)) {
      try {
        const savedEntries = JSON.parse(fs15.readFileSync(consoleEntriesPath, "utf-8"));
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
  if (fs15.existsSync(session.serverErrorLog)) {
    const rawServerLog = fs15.readFileSync(session.serverErrorLog, "utf-8");
    const parsed = parseTimestampedServerLog(rawServerLog, startTime);
    serverLog = parsed.cleanText;
    serverEntries = parsed.entries;
  }
  const sessionDir = session.sessionDir;
  const screenshots = fs15.existsSync(sessionDir) ? fs15.readdirSync(sessionDir).filter((f) => f.endsWith(".png")) : [];
  const sessionLog = loadSessionLog(sessionDir);
  let trimOffsetSec = session.trimOffsetSec ?? 0;
  if (!session.videoTrimComplete) {
    if (fs15.existsSync(session.videoPath)) {
      trimOffsetSec = trimVideo(session.videoPath, screenshots, sessionDir, startTime, sessionLog);
    } else if (recordingWasActive) {
      console.log(
        chalk3.yellow("\u26A0") + " Recording was active but no video file was produced.\n" + chalk3.dim("  The screencast may have been interrupted. Screenshots and logs are still saved.")
      );
    }
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
  const summaryPath = path13.join(sessionDir, "SUMMARY.md");
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
  if (!retryingStoppedSession || !fs15.existsSync(summaryPath)) {
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
    const logPath = path13.join(sessionDir, "session-log.json");
    writeTextFileAtomically(logPath, JSON.stringify(viewerEntries, null, 2) + "\n");
  }
  if (!session.sessionLogAdjusted) {
    session.sessionLogAdjusted = true;
    persistOwnedSession2(session, controlDir);
  }
  const adjustTime = (e) => trimOffsetSec > 0 ? { ...e, relativeTimeSec: parseFloat((e.relativeTimeSec - trimOffsetSec).toFixed(1)) } : e;
  const viewerConsoleEntries = consoleEntries.map(adjustTime);
  const viewerServerEntries = serverEntries.map(adjustTime);
  const viewerPath = writeViewer(sessionDir, {
    description: session.description,
    serverCommand: session.serverCommand,
    durationSec,
    videoFilename: fs15.existsSync(session.videoPath) ? path13.basename(session.videoPath) : null,
    consoleErrorCount,
    consoleEvidenceAvailable,
    serverErrorCount,
    consoleOutput,
    serverLog,
    consoleEntries: viewerConsoleEntries.length > 0 ? viewerConsoleEntries : void 0,
    serverEntries: viewerServerEntries.length > 0 ? viewerServerEntries : void 0,
    entries: viewerEntries.length > 0 ? viewerEntries : void 0,
    tokenUsage
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
  if (fs15.existsSync(session.videoPath)) {
    console.log(`\u{1F4F9} Video:         ${chalk3.dim(session.videoPath)} (${durationSec}s)`);
  }
  console.log(`\u{1F4F8} Screenshots:   ${screenshots.length} captured`);
  console.log(`\u{1F4DD} Summary:       ${chalk3.dim(summaryPath)}`);
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
    fs15.writeFileSync(temporaryPath, contents);
    fs15.renameSync(temporaryPath, filePath);
  } finally {
    if (fs15.existsSync(temporaryPath)) fs15.unlinkSync(temporaryPath);
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
  const projectName = path13.basename(data.projectDirectory);
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
  const relativeVideo = path13.basename(data.videoPath);
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
function trimVideo(videoPath, screenshots, outputDir, recordingStartMs, sessionLog) {
  let firstActionSec = null;
  let lastActionSec = null;
  if (sessionLog.length > 0) {
    firstActionSec = sessionLog[0].relativeTimeSec;
    lastActionSec = sessionLog[sessionLog.length - 1].relativeTimeSec;
  } else if (screenshots.length > 0) {
    const timestamps = screenshots.map((f) => {
      try {
        return fs15.statSync(path13.join(outputDir, f)).birthtimeMs;
      } catch {
        return null;
      }
    }).filter((t) => t !== null && t >= recordingStartMs);
    if (timestamps.length === 0) return 0;
    firstActionSec = (Math.min(...timestamps) - recordingStartMs) / 1e3;
    lastActionSec = (Math.max(...timestamps) - recordingStartMs) / 1e3;
  }
  if (firstActionSec === null || lastActionSec === null) return 0;
  const BUFFER_BEFORE = 5;
  const BUFFER_AFTER = 3;
  const trimStartSec = Math.max(0, firstActionSec - BUFFER_BEFORE);
  const trimEndSec = lastActionSec + BUFFER_AFTER;
  if (trimEndSec - trimStartSec < 5) return 0;
  try {
    execFileSync2("ffmpeg", ["-version"], { stdio: "pipe" });
  } catch {
    console.log(chalk3.dim("Tip: Install ffmpeg to auto-trim dead time from videos."));
    return 0;
  }
  const dir = path13.dirname(videoPath);
  const ext = path13.extname(videoPath);
  const base = path13.basename(videoPath, ext);
  const rawPath = path13.join(dir, `${base}-raw${ext}`);
  try {
    fs15.renameSync(videoPath, rawPath);
    execFileSync2(
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
    fs15.unlinkSync(rawPath);
    const trimmedDuration = Math.round(trimEndSec - trimStartSec);
    console.log(chalk3.dim(`Trimmed video to ${trimmedDuration}s (removed dead time)`));
    return trimStartSec;
  } catch {
    if (fs15.existsSync(videoPath)) {
      fs15.unlinkSync(videoPath);
    }
    if (fs15.existsSync(rawPath)) {
      fs15.renameSync(rawPath, videoPath);
    }
    console.log(chalk3.dim("Video trimming failed, keeping original"));
    return 0;
  }
}
function validateTrimmedVideo(videoPath) {
  if (!fs15.existsSync(videoPath) || fs15.statSync(videoPath).size === 0) {
    throw new Error("FFmpeg produced an empty video");
  }
  execFileSync2(
    "ffmpeg",
    ["-v", "error", "-i", videoPath, "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"],
    { stdio: "pipe", timeout: 6e4 }
  );
}

// src/commands/diff.ts
import * as fs16 from "fs";
import * as path14 from "path";
import chalk4 from "chalk";
async function diffCommand(options) {
  const config = loadConfig();
  const currentDir = path14.resolve(config.output);
  const baselineDir = path14.resolve(options.baseline);
  if (!fs16.existsSync(baselineDir)) {
    console.error(chalk4.red("\u2717") + ` Baseline directory not found: ${baselineDir}`);
    process.exit(1);
  }
  if (!fs16.existsSync(currentDir)) {
    console.error(
      chalk4.red("\u2717") + ` Current artifacts not found: ${currentDir}
` + chalk4.dim('Run "proofshot verify" first to generate screenshots.')
    );
    process.exit(1);
  }
  const baselineFiles = fs16.readdirSync(baselineDir).filter((f) => f.startsWith("page-") && f.endsWith(".png"));
  const currentFiles = fs16.readdirSync(currentDir).filter((f) => f.startsWith("page-") && f.endsWith(".png"));
  if (baselineFiles.length === 0) {
    console.error(chalk4.red("\u2717") + " No baseline screenshots found (looking for page-*.png)");
    process.exit(1);
  }
  const diffDir = path14.join(currentDir, "diffs");
  fs16.mkdirSync(diffDir, { recursive: true });
  console.log(chalk4.dim("Comparing screenshots...\n"));
  let hasChanges = false;
  for (const file of baselineFiles) {
    const baselinePath = path14.join(baselineDir, file);
    const currentPath = path14.join(currentDir, file);
    const diffPath = path14.join(diffDir, `diff-${file}`);
    if (!fs16.existsSync(currentPath)) {
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
import * as fs17 from "fs";
import * as path15 from "path";
import chalk5 from "chalk";
async function cleanCommand() {
  const config = loadConfig();
  const controlDir = resolveSessionControlDir(config.output);
  const outputDir = path15.resolve(config.output);
  if (hasActiveSession(controlDir)) {
    console.error(
      chalk5.red("\u2717") + " Cannot clean while a ProofShot session owns browser or server processes.\n" + chalk5.dim('Run "proofshot stop" first so exact cleanup metadata is preserved.')
    );
    process.exit(1);
    return;
  }
  if (!fs17.existsSync(outputDir)) {
    console.log(chalk5.dim("Nothing to clean \u2014 no artifacts directory found."));
    return;
  }
  fs17.rmSync(outputDir, { recursive: true, force: true });
  console.log(chalk5.green("\u2713") + ` Removed ${chalk5.dim(outputDir)}`);
}

// src/commands/pr.ts
import * as fs19 from "fs";
import * as path17 from "path";
import { execSync as execSync7 } from "child_process";
import chalk6 from "chalk";

// src/utils/github.ts
import * as fs18 from "fs";
import * as path16 from "path";
import { execSync as execSync6 } from "child_process";
var GITHUB_API_VERSION = "2022-11-28";
var DEFAULT_ARTIFACTS_BRANCH = "proofshot-artifacts";
function getGitHubToken() {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) return envToken.trim();
  try {
    return execSync6("gh auth token", {
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
    nwo = execSync6("gh repo view --json nameWithOwner -q .nameWithOwner", {
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
      execSync6(`gh pr view ${num} --json number -q .number`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch {
      throw new ProofShotError(`PR #${num} not found or not accessible.`);
    }
    return num;
  }
  try {
    const numStr = execSync6("gh pr view --json number -q .number", {
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
function getContentType(filePath) {
  const ext = path16.extname(filePath).toLowerCase();
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
  const fileName = path16.basename(filePath);
  const fileSize = fs18.statSync(filePath).size;
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
  const fileBuffer = fs18.readFileSync(filePath);
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
    const fileName = path16.basename(filePath);
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
    const fileName = path16.basename(filePath);
    options.onProgress?.(i + 1, options.filePaths.length, fileName);
    try {
      const content = fs18.readFileSync(filePath, "base64");
      const uploadPath = path16.posix.join(
        options.uploadRoot,
        path16.basename(path16.dirname(filePath)),
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
    execSync6(`gh pr comment ${prNumber} --body-file -`, {
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

// src/commands/pr.ts
async function prCommand(options) {
  const config = loadConfig();
  const outputDir = path17.resolve(config.output);
  const uploadProvider = normalizeUploadProvider(options.uploadProvider);
  const artifactsBranch = options.artifactsBranch || "proofshot-artifacts";
  let branch;
  try {
    branch = execSync7("git branch --show-current", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch {
    console.error(chalk6.red("\u2717") + " Not in a git repository.");
    process.exit(1);
  }
  if (!branch) {
    console.error(chalk6.red("\u2717") + " Detached HEAD \u2014 cannot determine branch.");
    process.exit(1);
  }
  console.log(chalk6.dim(`Branch: ${branch}`));
  const sessionDirs = findSessionsForBranch(outputDir, branch);
  if (sessionDirs.length === 0) {
    console.error(
      chalk6.red("\u2717") + ` No ProofShot sessions found for branch "${branch}".
` + chalk6.dim('Run "proofshot start" and "proofshot stop" first.')
    );
    process.exit(1);
  }
  console.log(chalk6.dim(`Found ${sessionDirs.length} session(s) for this branch`));
  const screenshotPaths = [];
  let videoPath = null;
  let errorCount = 0;
  let latestCommitSha = "";
  let description = null;
  for (const sessionDir of sessionDirs) {
    const metadata = loadMetadata(sessionDir);
    if (metadata) {
      if (!description && metadata.description) description = metadata.description;
      if (metadata.commitSha) latestCommitSha = metadata.commitSha;
    }
    const files = fs19.readdirSync(sessionDir);
    for (const f of files) {
      if (f.endsWith(".png")) {
        screenshotPaths.push(path17.join(sessionDir, f));
      }
    }
    if (!videoPath) {
      for (const f of files) {
        if (f === "session.webm" || f === "session.mp4") {
          videoPath = path17.join(sessionDir, f);
          break;
        }
      }
    }
    const summaryPath = path17.join(sessionDir, "SUMMARY.md");
    if (fs19.existsSync(summaryPath)) {
      const summary = fs19.readFileSync(summaryPath, "utf-8");
      const errorMatch = summary.match(/(\d+)\s+error/gi);
      if (errorMatch) {
        for (const m of errorMatch) {
          const num = parseInt(m, 10);
          if (!isNaN(num)) errorCount += num;
        }
      }
    }
  }
  if (videoPath && videoPath.endsWith(".webm")) {
    const mp4Path = videoPath.replace(/\.webm$/, ".mp4");
    if (fs19.existsSync(mp4Path)) {
      videoPath = mp4Path;
    } else {
      try {
        execSync7("ffmpeg -version", { stdio: "pipe" });
        console.log(chalk6.dim("Converting video to .mp4..."));
        execSync7(
          `ffmpeg -i "${videoPath}" -c:v libx264 -preset fast -crf 23 -an "${mp4Path}"`,
          { stdio: "pipe", timeout: 12e4 }
        );
        videoPath = mp4Path;
        console.log(chalk6.green("\u2713") + " Video converted to .mp4");
      } catch {
        console.log(chalk6.dim("ffmpeg not available \u2014 uploading .webm directly"));
      }
    }
  }
  if (options.dryRun) {
    const screenshotMap2 = /* @__PURE__ */ new Map();
    for (const ssPath of screenshotPaths) {
      const label = screenshotLabel(ssPath);
      screenshotMap2.set(label, `https://github.com/user-attachments/assets/<${label}>`);
    }
    const commentData2 = {
      description,
      sessionCount: sessionDirs.length,
      screenshots: screenshotMap2,
      video: videoPath ? {
        url: `https://github.com/user-attachments/assets/<${path17.basename(videoPath)}>`,
        renderMode: "embed"
      } : null,
      errorCount,
      branch,
      commitSha: latestCommitSha
    };
    console.log("");
    console.log(chalk6.yellow("--- Dry run (not posted) ---"));
    console.log(formatPRComment(commentData2));
    return;
  }
  const prNumber = getPRNumber(options.prNumber);
  console.log(chalk6.dim(`Target PR: #${prNumber}`));
  const token = getGitHubToken();
  const repoInfo = await getRepoInfo(token);
  const filesToUpload = [...screenshotPaths];
  if (videoPath) filesToUpload.push(videoPath);
  const uploadRoot = buildUploadRoot(branch, prNumber, latestCommitSha);
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
  const screenshotMap = /* @__PURE__ */ new Map();
  let failedUploads = 0;
  for (const ssPath of screenshotPaths) {
    const asset = uploaded.get(ssPath);
    if (asset) {
      screenshotMap.set(screenshotLabel(ssPath), asset.url);
    } else {
      failedUploads++;
    }
  }
  let video = null;
  if (videoPath) {
    const videoAsset = uploaded.get(videoPath);
    if (videoAsset) {
      video = {
        url: videoAsset.url,
        renderMode: uploadProvider === "repo-contents" ? "link" : "embed"
      };
    } else failedUploads++;
  }
  if (failedUploads > 0) {
    console.log(chalk6.yellow(`\u26A0 ${failedUploads} artifact(s) failed to upload`));
  }
  if (filesToUpload.length > 0 && uploaded.size === 0) {
    console.error(
      chalk6.red("\u2717") + " All artifact uploads failed. PR comment was not posted.\n" + chalk6.dim(
        uploadProvider === "github-web-attachments" ? 'Retry with "proofshot pr --upload-provider repo-contents" or use "proofshot pr --dry-run".' : 'Retry with "proofshot pr --dry-run" to inspect the generated markdown.'
      )
    );
    process.exit(1);
  }
  const commentData = {
    description,
    sessionCount: sessionDirs.length,
    screenshots: screenshotMap,
    video,
    errorCount,
    branch,
    commitSha: latestCommitSha
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
function screenshotLabel(ssPath) {
  const sessionDir = path17.basename(path17.dirname(ssPath));
  const fileName = path17.basename(ssPath);
  return `${sessionDir}/${fileName}`;
}
function buildUploadRoot(branch, prNumber, commitSha) {
  const sanitizedBranch = branch.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "branch";
  const sha = commitSha ? commitSha.slice(0, 7) : "unknown-sha";
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  return path17.posix.join("proofshot", `pr-${prNumber}`, sanitizedBranch, `${timestamp}-${sha}`);
}
function normalizeUploadProvider(provider) {
  if (!provider || provider === "repo-contents" || provider === "github-web-attachments") {
    return provider || "repo-contents";
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
    try {
      await cleanupFailedStart(session);
      clearSession(session.outputDir);
      unregisterSession(session.sessionName);
      console.log(`${chalk8.green("\u2713")} Cleaned ${session.sessionName}`);
    } catch (error) {
      failures += 1;
      session.lifecycleStatus = "recovery";
      session.cleanupError = error instanceof Error ? error.message : String(error);
      saveSession(session, session.outputDir);
      registerSession(session);
      console.error(`${chalk8.red("\u2717")} Kept ${session.sessionName}: ${session.cleanupError}`);
    }
  }
  if (failures > 0) {
    process.exitCode = 1;
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
  program.command("pr").description("Upload session artifacts and post a ProofShot comment on a GitHub PR").argument("[pr-number]", "PR number (auto-detects from current branch if omitted)").option("--dry-run", "Generate the comment markdown without posting").option(
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
  createCLI,
  ensureDevServer,
  findSessionsForBranch,
  formatPRComment,
  generateViewer,
  installCommand,
  isPortOpen,
  loadConfig,
  loadMetadata,
  loadSession,
  saveSession,
  waitForPort,
  writeConfig,
  writeMetadata,
  writeViewer
};
//# sourceMappingURL=index.js.map