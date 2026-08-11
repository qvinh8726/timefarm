const fs = require("node:fs");
const path = require("node:path");

const workflowDirectory = path.join(__dirname, "..", ".github", "workflows");
const workflowFiles = fs
  .readdirSync(workflowDirectory)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
const failures = [];

for (const workflowFile of workflowFiles) {
  const source = fs.readFileSync(
    path.join(workflowDirectory, workflowFile),
    "utf8",
  );
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/);
    if (!match) continue;
    const reference = match[1];
    const revision = reference.split("@").at(-1);
    if (!revision || !/^[0-9a-f]{40}$/.test(revision))
      failures.push(`${workflowFile}:${index + 1} (${reference})`);
  }
}

if (failures.length) {
  console.error("GitHub Actions must be pinned to full commit SHAs:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Workflow pin check passed: ${workflowFiles.length} workflow files use immutable action revisions.`,
  );
}
