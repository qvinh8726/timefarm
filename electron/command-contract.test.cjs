const assert = require("node:assert/strict");
const test = require("node:test");
const { CommandSchema } = require("./command-contract.cjs");

function accountCommand(displayName) {
  return {
    type: "account.initialize",
    payload: {
      displayName,
      country: "vn",
      language: "vi",
      currency: "VND",
    },
  };
}

function projectCommand(overrides = {}) {
  return {
    type: "project.create",
    payload: {
      name: "😀".repeat(160),
      paymentModel: "per_session",
      color: "😀".repeat(64),
      icon: "😀".repeat(32),
      ...overrides,
    },
  };
}

test("IPC text limits count Unicode code points and use ECMAScript trimming", () => {
  const account = CommandSchema.parse(accountCommand("😀".repeat(100)));
  assert.equal(Array.from(account.payload.displayName).length, 100);
  assert.equal(account.payload.country, "VN");

  const project = CommandSchema.parse(projectCommand());
  assert.equal(Array.from(project.payload.name).length, 160);
  assert.equal(Array.from(project.payload.color).length, 64);
  assert.equal(Array.from(project.payload.icon).length, 32);

  for (const command of [
    accountCommand("😀".repeat(101)),
    accountCommand("\u00a0"),
    projectCommand({ name: "😀".repeat(161) }),
    projectCommand({ name: "\u00a0" }),
    projectCommand({ color: "😀".repeat(65) }),
    projectCommand({ color: "\u00a0" }),
    projectCommand({ icon: "😀".repeat(33) }),
    projectCommand({ icon: "\u00a0" }),
  ]) {
    assert.equal(CommandSchema.safeParse(command).success, false);
  }
});
