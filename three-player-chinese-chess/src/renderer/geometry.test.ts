import { describe, expect, it } from "vitest";
import { defaultGeometry, hitTestBoardPoint, pointIdPosition, rotateAround } from "./geometry";

describe("view rotation hit testing", () => {
  it("maps rotated screen coordinates back to the logical board point", () => {
    const logicalPosition = pointIdPosition("O5");
    const rotatedPosition = rotateAround(logicalPosition, defaultGeometry.center, 120);

    expect(hitTestBoardPoint(rotatedPosition.x, rotatedPosition.y, { viewRotation: 120 })).toBe("O5");
  });
});
