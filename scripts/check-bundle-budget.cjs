const fs = require("node:fs");
const path = require("node:path");

const assetDirectory = path.join(process.cwd(), "dist", "assets");
const files = fs
  .readdirSync(assetDirectory)
  .filter((file) => file.endsWith(".js"))
  .map((file) => ({
    file,
    bytes: fs.statSync(path.join(assetDirectory, file)).size,
  }));
const largest = Math.max(0, ...files.map((item) => item.bytes));
const total = files.reduce((sum, item) => sum + item.bytes, 0);
const largestBudget = 360 * 1024;
const totalBudget = 620 * 1024;

if (largest > largestBudget || total > totalBudget) {
  console.error(
    `Renderer bundle budget exceeded: largest=${largest}B/${largestBudget}B total=${total}B/${totalBudget}B`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Renderer bundle budget passed: ${files.length} chunks, largest ${largest}B, total ${total}B.`,
  );
}
