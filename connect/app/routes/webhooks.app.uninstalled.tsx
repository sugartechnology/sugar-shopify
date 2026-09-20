import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { notifyUninstalled } from "../services/crm.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  if (topic === "APP_UNINSTALLED") {
    await prisma.session.deleteMany({ where: { shop } });
    await notifyUninstalled(shop);
  }
  return new Response();
};
