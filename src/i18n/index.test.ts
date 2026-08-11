import { describe, expect, it } from "vitest";
import { localeFor, resources, translate } from "./index";

describe("translation resources", () => {
  it("keeps Vietnamese and English resource sections aligned", () => {
    expect(Object.keys(resources.vi).sort()).toEqual(
      Object.keys(resources.en).sort(),
    );
    for (const section of Object.keys(resources.vi) as Array<
      keyof typeof resources.vi
    >) {
      expect(Object.keys(resources.vi[section]).sort()).toEqual(
        Object.keys(resources.en[section]).sort(),
      );
    }
  });

  it("interpolates resource values without exposing implementation details to callers", () => {
    expect(
      translate("vi", "onboarding", "accountMode", {
        email: "minh@example.com",
      }),
    ).toBe("Bạn đang thiết lập hồ sơ cho minh@example.com.");
    expect(
      translate("en", "onboarding", "timezoneHint", {
        timezone: "America/New_York",
      }),
    ).toContain("America/New_York");
  });

  it("maps application languages to Intl locales", () => {
    expect(localeFor("vi")).toBe("vi-VN");
    expect(localeFor("en")).toBe("en-US");
  });
});
