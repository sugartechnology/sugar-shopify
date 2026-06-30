import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  BlockStack,
  Card,
  Layout,
  Link,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function AppIndex() {
  return (
    <Page>
      <TitleBar title="Sugar PDP" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Sugar PDP eklentisi
              </Text>
              <Text as="p" variant="bodyMd">
                Bu uygulama ürün sayfasına (PDP) bir buton ve popup ekler.
                Müşteri referans görsel yükler; Sugar servisi üretilen görseli
                sepete line item property olarak taşır.
              </Text>
              <List type="number">
                <List.Item>
                  Terminalde <code>npm run dev</code> ile uygulamayı başlatın
                  (Shopify CLI tunnel + app proxy gerekli).
                </List.Item>
                <List.Item>
                  <Link url="/app/settings">Ayarlar</Link> sayfasından Sugar
                  API bilgilerini kaydedin. Geliştirmede mock mod yeterlidir.
                </List.Item>
                <List.Item>
                  Theme Editor → sol alt **App embeds** (puzzle ikonu) →
                  <strong>Sugar PDP AI</strong> embed&apos;ini açın. Add block
                  gerekmez.
                </List.Item>
                <List.Item>
                  Block ayarlarından <strong>Tema preset</strong> (Dawn/Normod)
                  seçin veya buton CSS class&apos;larını manuel girin.
                </List.Item>
                <List.Item>
                  Ek ürün collection tanımlamazsanız akış otomatik kısalır:
                  fotoğraf yükle → AI üret → sonuç.
                </List.Item>
                <List.Item>
                  PDP&apos;de AI butonuna basarak galeri/kamera upload ve mock
                  sonucu test edin.
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
