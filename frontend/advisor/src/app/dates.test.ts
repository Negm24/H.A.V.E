import { expect, it } from "vitest";
import { cairoDayTimestamp } from "./dates";

it("includes whole Cairo days in winter and summer", () => {
  expect(cairoDayTimestamp("2027-01-15")).toBe("2027-01-14T22:00:00.000Z");
  expect(cairoDayTimestamp("2027-06-01", true)).toBe(
    "2027-06-01T20:59:59.999Z",
  );
});

it("handles the missing midnight at Cairo daylight-saving start", () => {
  expect(cairoDayTimestamp("2027-04-30")).toBe("2027-04-29T22:00:00.000Z");
  expect(cairoDayTimestamp("2027-04-29", true)).toBe(
    "2027-04-29T21:59:59.999Z",
  );
});
