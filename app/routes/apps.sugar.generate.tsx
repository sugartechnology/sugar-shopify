import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { generateProductImage } from "../services/sugar-api.server";
import {
  generateFailureResponse,
  prepareGenerateFromRequest,
} from "../services/prepare-generate.server";

async function handleGenerate(request: Request) {
  const prepared = await prepareGenerateFromRequest(request);
  if (!prepared.ok) return prepared.response;
  const result = await generateProductImage(prepared.config, prepared.request);
  return json(result);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    return await handleGenerate(request);
  } catch (error) {
    return generateFailureResponse(error);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    return await handleGenerate(request);
  } catch (error) {
    return generateFailureResponse(error);
  }
};
