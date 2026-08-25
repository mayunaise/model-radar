import { describe, expect, test } from "vitest";
import { readBuilt } from "../helpers/build-site";

describe("capability matrix page", () => {
  test("does not publish the temporarily disabled capability matrix", async () => {
    await expect(readBuilt("capabilities/index.html")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
