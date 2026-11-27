#!/usr/bin/env bash
# Read-only health / resource report for the EC2 server. Changes nothing; prints no secret values.
# Run on the server:  bash ~/hr/scripts/server-check.sh
set -u
cd "$(dirname "$0")/.." || exit 1

echo "== host"
uptime
echo "cpus: $(nproc)"
free -m | head -2
df -h / | tail -1

echo; echo "== pm2"
pm2 jlist 2>/dev/null | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  for (const p of JSON.parse(s || "[]")) console.log(p.name, "| status", p.pm2_env.status, "| mem", Math.round(p.monit.memory / 1048576) + " MB",
    "| cpu", p.monit.cpu + "%", "| restarts", p.pm2_env.restart_time, "| up", Math.round((Date.now() - p.pm2_env.pm_uptime) / 3600000) + " h",
    "| max_memory_restart", p.pm2_env.max_memory_restart ? Math.round(p.pm2_env.max_memory_restart / 1048576) + " MB" : "none");
});'
pm2 ls 2>/dev/null | grep -qi logrotate && echo "pm2-logrotate: installed" || echo "pm2-logrotate: NOT installed (logs grow forever)"

echo; echo "== log sizes"
du -sh ~/.pm2/logs 2>/dev/null
ls -la ~/.pm2/logs 2>/dev/null | tail -n +2
ls -la ~/hr-cron-*.log 2>/dev/null

echo; echo "== cron"
crontab -l 2>/dev/null || echo "(no crontab)"

echo; echo "== app health"
curl -s -m 5 http://127.0.0.1:${PORT:-3000}/api/health; echo
SECRET=$(grep -E '^CRON_SECRET=' .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
[ -n "$SECRET" ] && curl -s -m 10 -H "Authorization: Bearer $SECRET" http://127.0.0.1:${PORT:-3000}/api/health; echo

echo; echo "== server → Supabase round trip"
node -e '
const fs = require("fs");
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n").filter(l => /^[A-Z_]+=/.test(l))
  .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const med = a => a.sort((x, y) => x - y)[a.length >> 1];
(async () => {
  const u = env.NEXT_PUBLIC_SUPABASE_URL, k = env.SUPABASE_SERVICE_ROLE_KEY, anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const rest = [], auth = [];
  for (let i = 0; i < 7; i++) {
    let s = Date.now(); await fetch(u + "/rest/v1/organizations?select=id&limit=1", { method: "HEAD", headers: { apikey: k, Authorization: "Bearer " + k } }); rest.push(Date.now() - s);
    s = Date.now(); await (await fetch(u + "/auth/v1/user", { headers: { apikey: anon, Authorization: "Bearer x.y.z" } })).text(); auth.push(Date.now() - s);
  }
  console.log("database (REST) round trip: median", med(rest), "ms");
  console.log("Supabase Auth round trip:   median", med(auth), "ms");
})();'
