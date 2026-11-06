# 03 — Program Motoru (Durum Makinesi)

Saf TypeScript, `packages/engine/program`. Kamera ve UI'dan bağımsız. Zaman yalnızca `TICK` olaylarıyla (enjekte edilen `now`) ilerler.

## Seans sahipliği
- Seansın **sahibi üyenin telefonudur** (02, "Seans sahipliği"). Program durumu ve imleç (`blockIndex`, `setIndex`) telefonda tutulur; sunucu yedek/senkron kopyadır.
- **Telefon modu:** telefon hem sahip hem yürütücüdür. Program motoru ve tekrar motoru telefonda çalışır.
- **İstasyon modu:** telefon, bir bloğu istasyon tabletine **devreder**. Tablet o bloğu kendi program motoru örneğiyle yürütür ve olaylarını kendi kuyruğundan API'ye yollar. Telefon devredilen bloğu `delegated` olarak işaretler.

## Girdi / Çıktı
- Girdi: `Workout` (sıralı bloklar) ve olaylar:
  - Tekrar motorundan (04): `REP_STARTED`, `REP_COMPLETED { outcome: valid|faulty|incomplete, faults[], durationMs }`, `FAULT_DETECTED { faultId }`, `TRACKING_LOST`, `TRACKING_RESTORED`, `READY_POSE_HELD`
  - Kullanıcıdan: `USER_ACTION { kind }` — `START`, `READY` (hazırım), `PAUSE`, `RESUME`, `END_SET`, `CONTINUE_SET`, `SKIP_BLOCK`, `UNDO_SKIP`, `ABORT`
  - Devir: `HANDOFF_ACCEPTED { cursor }` (istasyon tableti), `HANDOFF_RETURNED` (telefon)
  - Zaman: `TICK { now }`
- Çıktı: durum + yan etki komutları (`SPEAK`, `SHOW`, `NAVIGATE_TO_STATION`, `PERSIST_EVENT`, `SHOW_HANDOFF_QR`).

## Veri
```ts
Workout { id, name, blocks: Block[] }
Block {
  exerciseId: string
  exerciseVersion: number  // seans başında sabitlenir, kayda yazılır
  sets: number
  reps?: number            // tekrar hedefi
  durationSec?: number     // süreli hareketler (hold, MVP dışı)
  restSec: number
  stationHint?: string     // opsiyonel istasyon etiketi
  mode: "strict" | "lenient"
}
SessionCursor { sessionId, blockIndex, setIndex }
```

## Durumlar
```
IDLE → CHECKIN → READY → SET_ACTIVE → SET_CONFIRM? → REST → (READY | BLOCK_DONE)
BLOCK_DONE → (NEXT_BLOCK_READY | SESSION_DONE)
NEXT_BLOCK_READY → (aynı cihaz/istasyon: READY) | (farklı istasyon: TRANSFER → CHECKIN)
SESSION_DONE → IDLE
```
`PAUSED` ve `ABORTED` her durumdan girilebilir. `PAUSED`, girildiği durumu `resumeTo` olarak saklar. `RESUME` ile oraya dönülür. `resumeTo = SET_ACTIVE` ise dönüşte 3 sn geri sayım yapılır ve set sayacı korunur.

## Geçiş kuralları
1. **CHECKIN → READY:** üye doğrulandı, program yüklendi, bugünün antrenmanı ve imleç belirlendi.
2. **READY → SET_ACTIVE:** `USER_ACTION START` veya `READY_POSE_HELD` (kural paketindeki `readyPose`). Ardından 3 sn geri sayım.
3. **SET_ACTIVE:** `REP_COMPLETED` olayında sayaç 04'teki outcome tablosuna göre artar. Tüm outcome'lar (`incomplete` dahil) `PERSIST_EVENT` ile kaydedilir.
4. **SET_ACTIVE → REST:** sayaç hedefe ulaşınca veya `END_SET` ile set biter. Son setse `BLOCK_DONE`.
5. **Hareketsizlik:** SET_ACTIVE'de son `REP_STARTED`/`REP_COMPLETED`'den (yoksa set başlangıcından) 10 sn geçerse `SET_CONFIRM` ("Set bitti mi?"). `CONTINUE_SET` → SET_ACTIVE, `END_SET` → set biter. 20. saniyede (toplam) set otomatik kapanır, yapılan tekrar kaydedilir ve set `below_target` olarak işaretlenir.
6. **REST:** `restSec` geri sayımı. `READY` ile erken çıkılabilir. Süre dolunca sesli bildirim, sonra READY.
7. **BLOCK_DONE:** tüm setler bitti. Sonraki blok yoksa SESSION_DONE.
8. **Farklı istasyon (TRANSFER):** ekran "Sıradaki: {stationHint}" gösterir. Telefon `SHOW_HANDOFF_QR` üretir. Yeni istasyonda QR okutulunca tablet `HANDOFF_ACCEPTED` alır ve devam eder. 30 dk içinde devam edilmezse seans `PAUSED`, 2 saat sonra otomatik kapanır (`status=abandoned`).
9. **Atla:** `SKIP_BLOCK` bloğu `skipped` kaydeder ve sonrakine geçer. **Geri al:** `UNDO_SKIP`, yalnız atlamadan sonraki blokta henüz set başlamamışken (READY veya TRANSFER) geçerlidir ve atlanan bloğa döner. Başka durumlarda geçersizdir.
10. **Takip kaybı:** SET_ACTIVE veya READY'de `TRACKING_LOST` sonrası 5 sn içinde `TRACKING_RESTORED` gelmezse `PAUSED`. Geri gelince ekran "Devam" önerir (`RESUME`).

## Devir (handoff) protokolü
1. Telefon handoff QR'ı üretir: kısa ömürlü imzalı token (07) + `SessionCursor`. QR yalnızca kimlik ve imleç taşır, program içeriği tablette önbellekten veya API'den alınır.
2. Tablet token'ı doğrular (çevrimdışıysa imzayı yerelde doğrular, 07), bloğu yürütür. Blok bitince "Telefonundan devam et" gösterir.
3. Telefon sonraki check-in'de veya kullanıcı "devam" dediğinde imleci devredilen bloğun **sonrasına** ilerletir. Blok sonuçları sunucu senkronu ile telefona gelir. Gelmezse geçmişte "senkron bekleniyor" görünür.
4. Aynı blok için iki cihazdan sonuç gelirse sunucu `event_id` ile birleştirir. Çakışmada (aynı set iki kez) ilk gelen kazanır ve `audit_log`'a yazılır.

## Kabul kriterleri
- AC-3.1: Her geçiş tablosu birim testle kapsanır (tüm geçerli/geçersiz geçişler; `UNDO_SKIP` geçersiz durumlar dahil).
- AC-3.2: 3×10 squat + 3×8 şınav programı sentetik olay akışıyla baştan sona `SESSION_DONE`'a ulaşır, beklenen komut sırası üretilir.
- AC-3.3: Strict modda `faulty` sayaç artırmaz; lenient modda artırır ve `faulty=true` kaydı üretir. `incomplete` hiçbir modda saymaz ama kaydedilir.
- AC-3.4: Hareketsizlik kuralı (10/20 sn) ve takip kaybı (5 sn) sahte saatle test edilir.
- AC-3.5: Durum, `serialize/deserialize` ile kaydedilip geri yüklenebilir (sayfa yenilenmesi seansı kaybettirmez).
- AC-3.6: `PAUSED` → `RESUME` her kaynak durum için doğru `resumeTo`'ya döner; set sayacı korunur.
- AC-3.7: Devir: telefon motoru ve tablet motoru ayrı örneklerle simüle edilir. Blok tablette tamamlanır, telefon imleci doğru bloğa ilerler (ağ yokken de).
