import { execSync } from "node:child_process";

const port = Number(process.env.PORT ?? 4000);

function pidsOnPort() {
  const out = execSync(
    `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
    { encoding: "utf8" },
  );
  return [...new Set(out.split(/\s+/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))];
}

let pids = [];
try {
  pids = pidsOnPort();
} catch {
  pids = [];
}

for (const pid of pids) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    console.log(`Stopped PID ${pid} on port ${port} so Prisma can replace the query engine.`);
  } catch {
    // process already exited
  }
}

if (pids.length) {
  execSync("powershell -NoProfile -Command \"Start-Sleep -Seconds 2\"");
}
