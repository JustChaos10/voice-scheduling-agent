const { execSync } = require("node:child_process");
const os = require("node:os");

function unique(items) {
  return [...new Set(items)];
}

function getPidsOnPortWindows(port) {
  try {
    const output = execSync(`netstat -ano | findstr LISTENING | findstr :${port}`, {
      stdio: ["ignore", "pipe", "pipe"]
    }).toString();

    const pids = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/).at(-1))
      .filter((pid) => pid && /^\d+$/.test(pid));

    return unique(pids);
  } catch {
    return [];
  }
}

function getPidsOnPortUnix(port) {
  try {
    const output = execSync(`lsof -ti tcp:${port}`, {
      stdio: ["ignore", "pipe", "pipe"]
    }).toString();

    return unique(
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((pid) => /^\d+$/.test(pid))
    );
  } catch {
    return [];
  }
}

function killPidWindows(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function killPidUnix(pid) {
  try {
    execSync(`kill -9 ${pid}`, { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function freePort(port) {
  const isWindows = os.platform() === "win32";
  const pids = isWindows ? getPidsOnPortWindows(port) : getPidsOnPortUnix(port);

  if (!pids.length) {
    console.log(`[free-ports] Port ${port} is already free`);
    return;
  }

  for (const pid of pids) {
    const ok = isWindows ? killPidWindows(pid) : killPidUnix(pid);
    if (ok) {
      console.log(`[free-ports] Killed PID ${pid} on port ${port}`);
    } else {
      console.log(`[free-ports] Failed to kill PID ${pid} on port ${port}`);
    }
  }
}

const rawPorts = process.argv.slice(2);
const ports = unique(
  rawPorts
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0)
);

if (!ports.length) {
  console.log("[free-ports] No ports provided");
  process.exit(0);
}

for (const port of ports) {
  freePort(port);
}

