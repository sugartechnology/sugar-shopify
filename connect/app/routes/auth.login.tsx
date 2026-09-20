import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { LoginErrorType, type LoginError } from "@shopify/shopify-app-remix/server";
import { login } from "../shopify.server";

type LoginErrors = { shop?: string };

function loginErrorMessage(loginErrors: LoginError | void): LoginErrors {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Mağaza adresini girin" };
  }
  if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Geçerli bir .myshopify.com adresi girin" };
  }
  return {};
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors: LoginErrors = loginErrorMessage(await login(request));
  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors: LoginErrors = loginErrorMessage(await login(request));
  return { errors };
};

export default function AuthLogin() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const errors = actionData?.errors || loaderData.errors;

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 420, margin: "72px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Shopify bağla</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Şirketin Shopify mağaza adresini girin. Shopify giriş ve izin ekranı açılır.
      </p>
      <Form method="post">
        <label htmlFor="shop" style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
          Mağaza
        </label>
        <input
          id="shop"
          name="shop"
          type="text"
          value={shop}
          onChange={(event) => setShop(event.target.value)}
          placeholder="ornek.myshopify.com"
          autoComplete="off"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            marginBottom: 8,
            fontSize: 16,
          }}
        />
        {errors?.shop ? (
          <p style={{ color: "#b42318", margin: "0 0 16px" }}>{errors.shop}</p>
        ) : (
          <p style={{ color: "#777", fontSize: 13, margin: "0 0 16px" }}>
            Örnek: sugartechtest.myshopify.com
          </p>
        )}
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          Shopify ile devam et
        </button>
      </Form>
    </main>
  );
}
