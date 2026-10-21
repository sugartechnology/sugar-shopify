/**
 * Field of view for room photos without EXIF.
 *
 * Without EXIF (and without fovDegrees from the storefront) the analysis
 * assumes 45° across the photo width (camera.fovSource "default"), which
 * makes most phone photos look too small. Here the angle is guessed again:
 *
 *   B. The angle at which the camera stands 1.4 m above the floor (a photo
 *      taken by hand), kept only inside [50°, 80°].
 *   A. Otherwise (no usable floor, or B outside the range): a phone main
 *      camera, 26 mm in 35 mm terms, from the photo's own size.
 *
 * Depth (z) does not depend on the angle, so nothing is analysed again: x
 * and y scale with fx_old / fx_new and the planes are converted exactly
 * (same formula as the CRM's equationForFx). Source and measurements:
 * _ciktilar/oda-analizi-3d-koshoy/raporlar/2026-10-21-exifsiz-olcek.md
 */

export const HAND_HEIGHT_M = 1.4;
export const HAND_FOV_MIN_DEGREES = 50;
export const HAND_FOV_MAX_DEGREES = 80;
export const PHONE_MAIN_35MM = 26;

import type { RoomCamera, RoomPlanes, Vector4 } from "./room.server";

/** Which guess replaced the 45° default; stays in the database. */
export type FovGuess = "hand_height" | "phone_26mm";

const degrees = (radians: number) => (radians * 180) / Math.PI;
const radians = (degreesValue: number) => (degreesValue * Math.PI) / 180;

/** Focal length in pixels for a horizontal angle across `width`. */
export function fxForFov(width: number, fovXDegrees: number): number {
  return width / 2 / Math.tan(radians(fovXDegrees) / 2);
}

function fovForFx(size: number, fx: number): number {
  return degrees(2 * Math.atan(size / 2 / fx));
}

/**
 * Plane [a, b, c, d] seen with focal length `fx` instead of `fxAnalysis`.
 * x and y grow by s = fxAnalysis / fx, so a and b shrink by s; the result
 * is normalised again (d = distance from the camera, metres).
 */
export function planeForFx(equation: Vector4, fxAnalysis: number, fx: number): Vector4 {
  const s = fxAnalysis / fx;
  const [a, b, c, d] = equation;
  const length = Math.hypot(a / s, b / s, c);
  return [a / s / length, b / s / length, c / length, d / length];
}

/** Same rule as the 3D view: floor at least 30 cm under the camera, normal pointing up (y down axes). */
export function usableFloor(equation: Vector4): boolean {
  return equation[3] >= 0.3 && equation[1] < 0;
}

/**
 * B: the angle that puts the camera HAND_HEIGHT_M above the floor. From
 * planeForFx, the new d is d / sqrt((a² + b²) / s² + c²); setting it to
 * h gives s² = (a² + b²) / ((d / h)² - c²). null when there is no solution.
 */
export function fovFromHandHeight(floor: Vector4, fxAnalysis: number, width: number): number | null {
  const [a, b, c, d] = floor;
  const rest = (d / HAND_HEIGHT_M) ** 2 - c * c;
  if (rest <= 0) return null;
  const s = Math.sqrt((a * a + b * b) / rest);
  return fovForFx(width, fxAnalysis / s);
}

/** A: decor-ai's own rule for a 35 mm focal length (from the diagonal). */
export function fovFromPhone(width: number, height: number): number {
  const fx = (Math.hypot(width, height) * PHONE_MAIN_35MM) / Math.hypot(36, 24);
  return fovForFx(width, fx);
}

/** Camera and planes of a 45°-default analysis, re-seen at the guessed angle. */
export function guessNoExifFov(room: {
  width: number;
  height: number;
  camera: RoomCamera;
  planes: RoomPlanes;
}): { camera: RoomCamera; planes: RoomPlanes; guess: FovGuess } {
  const { width, height, camera, planes } = room;
  const floor = planes.floor?.equation;
  const fromHand = floor && usableFloor(floor) ? fovFromHandHeight(floor, camera.fx, width) : null;
  const inRange =
    fromHand !== null && fromHand >= HAND_FOV_MIN_DEGREES && fromHand <= HAND_FOV_MAX_DEGREES;
  const fovX = inRange ? fromHand : fovFromPhone(width, height);
  const fx = fxForFov(width, fovX);

  const converted: RoomPlanes = {};
  for (const name of ["floor", "wall"] as const) {
    const plane = planes[name];
    if (!plane) continue;
    const equation = planeForFx(plane.equation, camera.fx, fx);
    converted[name] = { normal: [equation[0], equation[1], equation[2]], equation };
  }
  return {
    camera: { ...camera, fovXDegrees: fovX, fovYDegrees: fovForFx(height, fx), fx, fy: fx },
    planes: converted,
    guess: inRange ? "hand_height" : "phone_26mm",
  };
}
