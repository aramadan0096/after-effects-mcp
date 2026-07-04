import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const SRC = ["src/scripts/ae-commands.jsx", "src/scripts/mcp-bridge-auto.jsx"];
const ES6_TOKENS = [/\blet\s/, /\bconst\s/, /=>/, /`/, /\.forEach\(/, /\.map\(/, /class\s+\w+/];

describe("ExtendScript stays ES3", () => {
  for (const f of SRC) {
    it(`${f} has no ES6 tokens`, () => {
      const text = readFileSync(f, "utf8");
      for (const re of ES6_TOKENS) expect(text).not.toMatch(re);
    });
  }
  it("ae-commands.jsx defines aeExecuteCommand", () => {
    expect(readFileSync("src/scripts/ae-commands.jsx", "utf8")).toMatch(/function aeExecuteCommand\s*\(/);
  });
});
