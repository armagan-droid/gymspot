# 10 — Uygulama Sırası (Claude Code için görev listesi)

Her adım tek spec'e dayanır ve testlerle biter. Sıra bağımlılığa göre. **Faz 1 ile T2.2 spike'ı paralel yürür**: spike projenin en büyük teknik riskini (FPS, `worldLandmarks` doğruluğu, iOS) erken ölçer ve sonucu 04'teki metrik koordinatlarını etkileyebilir.

## Faz 0 — Temel
- [x] T0.1 pnpm monorepo, TypeScript, ESLint, Vitest, CI iskeleti (`CLAUDE.md` komutlarını doldur)
- [x] T0.2 `packages/shared`: Zod şemaları (rule pack, workout, olaylar, `Frame`) + `exercises/*.json` CI doğrulaması — 04 (AC-4.1), 03, 06

## Faz 1 — Çekirdek motor (kamerasız) — **en yüksek öncelik**
- [x] T1.1 İfade ayrıştırıcı (04 grameri, güvenli, `eval` yok) — AC-4.2. Ayrıca kural paketi doğrulamasına bağlanır: `check`/`readyPose` ifadelerindeki tanımsız metrikler reddedilir (AC-4.1'in ifade kısmı; T0.2 yalnız ifade biçimini — konum öneki, `for <n>ms` — denetler)
- [x] T1.2 Fixture altyapısı: landmark dizisi formatı, oynatıcı, **sentetik sinyal üretici** (gürültülü açı eğrileri, aynalama) — 04 (sentetik; gerçek kayıtlı AC-4.3 fixture'ları T2.5'te)
- [x] T1.3 Metrik hesaplayıcı (kapalı liste, image/world koordinatları, `near_/far_` çözümü) + yumuşatma (One Euro) + görünüm tespiti — 04
- [x] T1.4 Tekrar durum makinesi: bölgeler, histerezis, dönüş noktası, outcome — AC-4.4, AC-4.5, AC-4.7
- [x] T1.5 Hata değerlendirici (`at_turn`/`at_start`/`during_rep`+`holdMs`, görünüm ve visibility filtresi) + cooldown/öncelik/güvenlik duraklatması — 04 (AC-4.6), 05 (AC-5.1, 5.2, 5.4, 5.6)
- [x] T1.6 Program durum makinesi + devir protokolü — 03, AC-3.1…3.7

## Faz 2 — Poz ve istemci
- [x] T2.1 `apps/web` iskeleti (PWA, i18n, rotalar)
- [ ] T2.2 **Spike (Faz 1 ile paralel):** _(ölçüm aracı hazır: `/spike`, bkz. 02 "T2.2 Spike"; cihaz ölçümleri bekleniyor)_ MediaPipe Pose tarayıcıda; telefon/tablette FPS, gecikme, model varyantı, `worldLandmarks` açı tutarlılığı (ön/yan), iOS PWA kamera, Wake Lock, ses açılışı. Sonucu `specs/02-architecture.md`'ye yaz, gerekirse 04'ü güncelle
- [ ] T2.3 Kamera izni, kurulum sihirbazı (A3, görünüm tespiti), kişi seçimi/takibi — AC-8.5
- [ ] T2.4 Aktif set ekranı (A5) engine'e bağlı, ses kaynağı sırası (dosya → Web Speech → ekran) — 05, AC-5.5
- [ ] T2.5 Kalibrasyon kayıt ekranı (C10, yalnız landmark) → ilk gerçek fixture'lar (AC-4.3) — 07

## Faz 3 — Backend
- [ ] T3.1 `apps/api` iskeleti, Postgres migrasyonları, RLS — 06 (AC-6.1, 6.3)
- [ ] T3.2 Auth: personel parola, üye magic link, cihaz eşleştirme, imzalı QR + imza yetkisi — 07 (AC-7.3, 7.6)
- [ ] T3.3 Program/şablon/üye/antrenör ataması API'leri — 06 (AC-6.4)
- [ ] T3.4 Seans olay alımı (idempotent, istemci UUID) + istemcide çevrimdışı kuyruk + devir birleştirme — AC-6.2, 03
- [ ] T3.5 Kalibrasyon kayıt yükleme (ayrı şifreli depo, rıza kontrolü) — AC-7.5

## Faz 4 — Ürün ekranları
- [ ] T4.1 İstasyon akışı A1–A9 uçtan uca (telefon modu + istasyon devri)
- [ ] T4.2 Üye alanı B1–B6 (magic link, rıza, rıza geri çekme) — AC-7.4
- [ ] T4.3 Yönetim paneli C1–C6, C8

## Faz 5 — Pilot hazırlığı
- [ ] T5.1 Gizlilik e2e testi (AC-7.1), tenant izolasyon testleri (AC-6.1), silme akışı (AC-7.2)
- [ ] T5.2 Gözlemlenebilirlik, heartbeat, hata izleme (PII/landmark kırpma)
- [ ] T5.3 Pilot kalibrasyon araçları: etiketli kayıtlardan eşik ayarı, sayım doğruluğu ve yanlış alarm raporu (09 tanımları)
- [ ] T5.4 Dağıtım ve salon kurulum kılavuzu (tablet kiosk modu, stand/açı, bilgilendirme metni)

## Claude Code'a görev verme şablonu
> "specs/<NN-...>.md içindeki <AC-x.y> kabul kriterlerini karşılayan <T..> görevini yap. Önce testleri yaz, sonra uygula. Spec dışı davranış ekleme; eksik/çelişen nokta varsa dur ve belirt."
