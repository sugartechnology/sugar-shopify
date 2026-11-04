/**
 * Turkish labels for catalog audit problems. Kept out of sku-audit.server so
 * the admin page component can use them (server modules never reach the client).
 */
export type AuditProblem = "twins" | "colour" | "size" | "part";

export const AUDIT_PROBLEM_TEXT: Record<AuditProblem, string> = {
  twins: "iki ürün var, hangisi bilinmiyor",
  colour: "bu renkte yok (başka renkte var)",
  size: "bu ölçü yok (parçanın başka ölçüleri var)",
  part: "bu renkte bu parçadan hiç ürün yok",
};
