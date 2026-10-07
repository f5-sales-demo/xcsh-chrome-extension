import { expect, test } from "bun:test";
import { verifyImmutableRelease } from "../scripts/verify-immutable-release.mjs";
test("immutable release gate rejects disabled state and validates repository identity", async () => {
  await expect(
    verifyImmutableRelease("f5-sales-demo/fixture", async () => ({
      enabled: false,
    })),
  ).rejects.toThrow("enabled");
  let called = false;
  await expect(
    verifyImmutableRelease("invalid/repo/identity", async () => {
      called = true;
      return { enabled: true };
    }),
  ).rejects.toThrow("repository");
  expect(called).toBe(false);
  await expect(
    verifyImmutableRelease("f5-sales-demo/fixture", async (endpoint) => {
      expect(endpoint).toBe("repos/f5-sales-demo/fixture/immutable-releases");
      return { enabled: true };
    }),
  ).resolves.toBeUndefined();
});
