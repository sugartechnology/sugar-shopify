import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { handleKoshoyDataRequest, koshoyDataApiDeps } from "../koshoy/data-api.server";

/** Store team: GET /api/koshoy/funnel?from=YYYY-MM-DD&to=YYYY-MM-DD (docs/veri-api.md). */
export const loader = ({ request }: LoaderFunctionArgs) =>
  handleKoshoyDataRequest(request, koshoyDataApiDeps());

export const action = ({ request }: ActionFunctionArgs) =>
  handleKoshoyDataRequest(request, koshoyDataApiDeps());
