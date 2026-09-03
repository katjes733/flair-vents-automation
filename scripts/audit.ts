// Wraps `bun audit`, suppressing only the specific advisories listed in
// audit-allowlist.json (each with a written reason + assessment date) rather
// than requiring the --ignore list to be hand-maintained inside the
// "verify" script / CI workflow. Add or remove entries there — nothing else
// needs to change to adjust what's suppressed.
import { join } from "path";

interface AllowlistEntry {
  id: string;
  package: string;
  reason: string;
  assessedDate: string;
}

const allowlistPath = join(import.meta.dir, "..", "audit-allowlist.json");
const allowlist: AllowlistEntry[] = await Bun.file(allowlistPath).json();

if (allowlist.length > 0) {
  console.log(`Ignoring ${allowlist.length} accepted audit finding(s):`);
  for (const entry of allowlist) {
    console.log(`  - ${entry.id} (${entry.package}), assessed ${entry.assessedDate}`);
  }
}

// `bun audit --ignore=` only reliably suppresses multiple advisories when
// passed as repeated flags — a single comma-joined value silently fails to
// ignore anything past the first id.
const args = ["audit", ...allowlist.map((e) => `--ignore=${e.id}`)];

const proc = Bun.spawn(["bun", ...args], {
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await proc.exited);
