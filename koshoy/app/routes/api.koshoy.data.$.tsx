import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { handleKoshoyDataRequest, koshoyDataApiDeps } from "../koshoy/data-api.server";

/** Store team data API: /api/koshoy/data and everything under it (docs/veri-api.md). */
export const loader = ({ request }: LoaderFunctionArgs) =>
  handleKoshoyDataRequest(request, koshoyDataApiDeps());

export const action = ({ request }: ActionFunctionArgs) =>
  handleKoshoyDataRequest(request, koshoyDataApiDeps());
