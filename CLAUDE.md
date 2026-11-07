# GymSpot — Proje Kuralları (Claude Code için)

Spor salonları için **B2B SaaS**: üyeyi programına göre yönlendiren, tekrarı sayan ve hareket formunu anlık düzelttiren istasyon koçu. Telefon ve tablette çalışan web uygulaması (PWA).

## Çalışma yöntemi: Spec-Driven Development
- Önce `/specs` okunur, sonra kod yazılır. Spec'te olmayan davranış **eklenmez**; gerekiyorsa önce spec güncellenir.
- Her görev tek bir spec'e bağlıdır. Görev bitince o spec'in **kabul kriterleri** testlerle karşılanmış olmalı.
- Önce test, sonra uygulama. Çekirdek motorlar (`packages/engine`) saf fonksiyondur ve kamera olmadan test edilir.
- Spec ile kod çelişirse spec doğru kabul edilir, çelişki raporlanır.

## Spec dizini
- `specs/00-vision.md` — problem, kullanıcılar, kapsam
- `specs/01-glossary.md` — ortak terimler
- `specs/02-architecture.md` — mimari ve teknoloji
- `specs/03-program-engine.md` — program/seans durum makinesi
- `specs/04-exercise-rules.md` — hareket kural paketi şeması
- `specs/05-feedback.md` — uyarı sistemi
- `specs/06-data-model.md` — veri modeli ve çok kiracılık
- `specs/07-privacy-security.md` — gizlilik ve güvenlik
- `specs/08-ui-screens.md` — ekranlar (telefon + tablet)
- `specs/09-mvp-scope.md` — MVP kapsamı ve kabul kriterleri
- `specs/10-roadmap.md` — uygulama sırası (Claude Code görev listesi)
- `exercises/*.json` — hareket kural paketleri (veri, kod değil)

## Teknoloji (karar: 02-architecture.md)
TypeScript her yerde. pnpm monorepo: `apps/web` (React + Vite PWA), `apps/api` (Fastify), `packages/engine` (saf TS), `packages/shared` (tipler/şema). PostgreSQL. Poz tahmini: MediaPipe Pose (tarayıcıda, cihaz üzerinde).

## Değişmez kurallar
1. **Video asla sunucuya gönderilmez, diske yazılmaz.** Sadece eklem koordinatları bellekte işlenir; sunucuya yalnızca olaylar (tekrar, set, hata türü) gider. Tek istisna: personelin açtığı, ayrı rızalı **kalibrasyon modu** yalnızca landmark kaydeder, görüntü asla (07).
2. Tüm veri `tenant_id` ile izole edilir; her sorgu tenant filtresi taşır.
3. Hareket kuralları JSON'dur; yeni hareket eklemek kod değişikliği gerektirmemelidir (ses dosyası yoksa Web Speech yedeği devreye girer, 05).
6. Seansın sahibi üyenin telefonudur; istasyon tableti yalnızca devredilen bloğu yürütür (03).
4. Geri bildirim kısa olur; aynı uyarı bekleme süresi dolmadan tekrarlanmaz.
5. Sağlık iddiası yok: "tıbbi tavsiye değildir" ibaresi zorunlu.

## Komutlar
Node ≥ 22, pnpm sürümü `package.json` → `packageManager` alanında sabit. `pnpm` PATH'te yoksa her komut `corepack pnpm …` ile çalışır.
- Kurulum: `pnpm install`
- Veritabanı (API testleri için gerekli): `docker compose up -d db` → `postgres://postgres:postgres@localhost:54329`
- Migrasyon: `pnpm --filter @gymspot/api migrate` (geri almak için `migrate down`)
- Test: `pnpm test` (izleme: `pnpm test:watch`)
- Geliştirme: `pnpm dev` → http://localhost:5173 (API :3000, Vite `/api` proxy'si). İlk seferde: `ops -- migrate`, `ops -- seed-exercises`, `ops -- bootstrap-tenant` (aşağıda). Telefon/tablet için LAN HTTPS: `pnpm --filter @gymspot/web dev -- --mode https`
- Tip kontrolü: `pnpm typecheck`
- Lint: `pnpm lint`
- Derleme: `pnpm build` (web PWA → `apps/web/dist`)
- Operatör komutları: `pnpm --filter @gymspot/api ops -- migrate | seed-exercises | bootstrap-tenant --name N --owner-email E | daily-jobs` (sahip yetkili `DATABASE_URL`; parola `OWNER_PASSWORD` ile)
- Dağıtım ve salon kurulumu: `docs/deploy.md`, `docs/salon-kurulum.md`; kullanım kılavuzu: `docs/kullanim-kilavuzu.md`
- Kalibrasyon raporu (09 pilot ölçütleri): `pnpm --filter @gymspot/api calibration:report -- --files <dizin>` veya `-- --db` (`CALIBRATION_ENCRYPTION_KEY` gerekir), isteğe bağlı `--exercise squat --sweep rep.target.enter=95,100,105`
- Hepsi (CI ile aynı): `pnpm check` + `pnpm build`

## Araç notları
- TypeScript 6.0'a sabit: typescript-eslint henüz TS 7'yi desteklemiyor (`<6.1`). TS 7'ye geçiş typescript-eslint desteği gelince yapılır.
- `packages/engine` ve `packages/shared` tsconfig'i DOM ve Node tiplerini içermez; motor sınırı (02) derleyiciyle zorlanır.
- İç paketler derlenmez, `exports` doğrudan `src/index.ts`'i gösterir.
- Testler: kökteki `vitest.config.ts` üç proje çalıştırır: `packages` (node), `apps/web` (jsdom, kendi `vite.config.ts`'i), `apps/api` (her çalıştırmada sıfırdan migrate edilmiş geçici bir veritabanı; Postgres yoksa testler açıkça başarısız olur).
- API ortam değişkenleri: `DATABASE_URL`, `JWT_SECRET`, `QR_MASTER_SECRET`, `CALIBRATION_ENCRYPTION_KEY` (32 bayt base64url) (üretimde zorunlu; geliştirmede süreç başına rastgele), `APP_BASE_URL`, `AUTH_RATE_LIMIT`. Saat (`now`) ve magic link göndericisi `AppConfig` ile enjekte edilir; testler sahte saat kullanır.
- pnpm 12 onaylanmamış kurulum betiklerini hata sayar; izin verilenler `pnpm-workspace.yaml` → `allowBuilds` içinde (şimdilik yalnız `esbuild`).
- Program motorunun `SPEAK`/`SHOW` anahtarları `PROGRAM_MESSAGE_KEYS`'te; web testi her anahtarın TR/EN çevirisini zorunlu kılar.

## Dil
Kod ve tanımlayıcılar İngilizce; kullanıcıya görünen metinler i18n ile (varsayılan Türkçe, ikinci dil İngilizce).
