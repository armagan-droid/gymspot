# Dağıtım kılavuzu (T5.4)

Hedef mimari (specs/02): tek bölge, konteyner, PostgreSQL. Bu kılavuzdaki adımlar `docker-compose.prod.yml` ile denendi. Duman testinde migrasyon, kural paketi yükleme, salon oluşturma, Caddy üzerinden giriş, istasyon ekleme ve günlük işler çalıştırıldı.

## Bileşenler

| Bileşen | İmaj | Görev |
|---|---|---|
| `web` | `deploy/Dockerfile.web` (Caddy) | PWA dosyaları, `/api` → API yönlendirmesi, otomatik HTTPS (kamera güvenli bağlam ister), güvenlik başlıkları |
| `api` | `deploy/Dockerfile.api` (Node 24) | REST API. Tek dosyalık paket; yalnız yerel derlenmiş Argon2 dışarıdadır |
| `db` | `postgres:18-alpine` veya yönetilen Postgres | Veri. Tüm tenant tablolarında `FORCE ROW LEVEL SECURITY` açıktır |

## Veritabanı rolleri (önemli)

- **`gymspot_owner`:** tabloların sahibi. Migrasyonlar ve operatör komutları bu kullanıcıyla çalışır.
- **`gymspot_api`:** API'nin giriş kullanıcısı. Hiçbir tabloda kendi yetkisi yoktur; yalnızca açıkça `SET ROLE gymspot_app` yaparak yetki kazanır (`WITH INHERIT FALSE, SET TRUE`). `gymspot_app` RLS'yi asla atlayamaz. Tenant bağlamı unutulmuş bir sorgu veri döndürmek yerine "permission denied" alır.
- Rolleri `deploy/db-init.sql` oluşturur. Compose'da veritabanı ilk kurulduğunda kendiliğinden çalışır. Yönetilen Postgres'te (PostgreSQL 16+) bir kez elle çalıştırın: `psql -c "SET gymspot.api_password = '…'" -f deploy/db-init.sql`.

## İlk kurulum

```sh
cp .env.example .env            # alan adı ve gizli anahtarları doldurun
docker compose -f docker-compose.prod.yml up -d --build

# operatör komutları sahip bağlantısıyla çalışır
docker compose -f docker-compose.prod.yml exec api sh -c 'DATABASE_URL=$OWNER_DATABASE_URL node dist/admin-cli.mjs migrate'
docker compose -f docker-compose.prod.yml exec api sh -c 'DATABASE_URL=$OWNER_DATABASE_URL node dist/admin-cli.mjs seed-exercises'
docker compose -f docker-compose.prod.yml exec -e OWNER_PASSWORD='…en az 12 karakter…' api \
  sh -c 'DATABASE_URL=$OWNER_DATABASE_URL node dist/admin-cli.mjs bootstrap-tenant --name "Pilot Salon" --owner-email sahip@salon.com'
```

`bootstrap-tenant` iki şey yazdırır:
- **Salon kimliği:** salon sahibine iletin.
- **Personel giriş bağlantısı** (`/admin/login?tenant=…`): bu bağlantı salonu tanıtır; sahip girişten sonra personeli C8'den ekler.

Parola komut satırında değil, `OWNER_PASSWORD` değişkeniyle verilir (kabuk geçmişinde kalmasın).

## Gizli anahtarlar

| Değişken | Not |
|---|---|
| `JWT_SECRET` | Değişirse tüm oturumlar düşer |
| `QR_MASTER_SECRET` | Tenant QR anahtarları bundan türetilir; değişirse telefon yetki sertifikaları ve tabletlerdeki önbellekli anahtarlar geçersizleşir |
| `CALIBRATION_ENCRYPTION_KEY` | Tam 32 bayt (base64url). **Kaybedilirse kalibrasyon kayıtları okunamaz**; ayrı ve güvenli bir yerde yedekleyin |

## Günlük işler

Saklama sürelerini (seanslar: salon ayarı, varsayılan 24 ay; kalibrasyon: 12 ay) uygulayan işi günde bir kez çalıştırın, örneğin cron ile:

```sh
0 3 * * * cd /opt/gymspot && docker compose -f docker-compose.prod.yml exec -T api sh -c 'DATABASE_URL=$OWNER_DATABASE_URL node dist/admin-cli.mjs daily-jobs'
```

## Yedekleme

- Postgres: günlük `pg_dump` (yönetilen hizmette otomatik yedek). Seans verisi kişisel veridir; yedekler de saklama süresine tabidir.
- `calibration-data` volume'u: şifreli kayıtlar. Anahtar olmadan işe yaramaz.

## Gözlemlenebilirlik

- API JSON loglarında her istek `reqId` taşır (yanıtta `x-request-id`). Gövdeler ve `Authorization` başlığı loglanmaz.
- `client_error` kayıtları istemci hatalarıdır (temizlenmiş).
- İstasyon tabletleri 60 sn'de bir heartbeat gönderir. C2'de 3 dakikadır sinyal vermeyen istasyon çevrimdışı görünür.

## Güncelleme

```sh
git pull && docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api sh -c 'DATABASE_URL=$OWNER_DATABASE_URL node dist/admin-cli.mjs migrate'
```

PWA bir sonraki açılışta kendini günceller.

## Açık konular

- **MediaPipe dosyaları:** WASM ve model şimdilik CDN'den (jsDelivr, Google Storage) yükleniyor. CSP bu iki kaynağa izin veriyor. Kendi sunucumuzdan verme kararı T2.2 ölçümlerine bağlı (specs/02).
- **Magic link e-posta/SMS sağlayıcısı:** henüz bağlanmadı. Üretimde `NODE_ENV=production` iken sağlayıcı olmadan bağlantı gönderilemez (API hata verir).
- **Hata izleme sağlayıcısı** (Sentry vb.): seçilince yalnızca gönderici değişir.
