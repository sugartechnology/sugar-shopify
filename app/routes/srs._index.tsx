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

export default function SrsIndex() {
  return (
    <Page>
      <TitleBar title="Sugar Room Studio" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Sugar Room Studio
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
                  <Link url="/srs/settings">Ayarlar</Link> sayfasından Sugar
                  API bilgilerini kaydedin. Geliştirmede mock mod yeterlidir.
                </List.Item>
                <List.Item>
                  Theme Editor → sol alt **App embeds** (puzzle ikonu) →
                  <strong>Sugar Room Studio</strong> embed&apos;ini açın. Add block
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
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Shop Assistant
              </Text>
              <Text as="p" variant="bodyMd">
                Room Studio gibi sayfaya bir buton eklenir. Müşteri butona
                basınca alışveriş sohbeti popup açılır.
              </Text>
              <List type="number">
                <List.Item>
                  <Link url="/srs/shop-assistant">Shop Assistant</Link>{" "}
                  ayarlarından asistanı açın ve katalog filtresini kaydedin.
                </List.Item>
                <List.Item>
                  Theme Editor → bir section → <strong>Add block</strong> →
                  <strong> Sugar Shop Assistant</strong>. Buton o section&apos;da
                  görünür.
                </List.Item>
                <List.Item>
                  Block ayarında Görünüm = <strong>Modal (popup)</strong> kalsın.
                  Buton metnini değiştirebilirsiniz.
                </List.Item>
                <List.Item>
                  Vitrinde butona basın; sohbet popup&apos;ı açılır. İhtiyaç +
                  bütçe yazın, ürün kartları ve sepet önerisi gelir.
                </List.Item>
              </List>
            </BlockStack>
          </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
