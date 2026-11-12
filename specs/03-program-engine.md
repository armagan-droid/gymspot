# 03 — Program Motoru (Durum Makinesi)

Saf TypeScript, `packages/engine/program`. Kamera ve UI'dan bağımsız. Zaman yalnızca `TICK` olaylarıyla (enjekte edilen `now`) ilerler.

## Seans sahipliği
- Seansın **sahibi üyenin telefonudur** (02, "Seans sahipliği"). Program durumu ve imleç (`blockIndex`, `setIndex`) telefonda tutulur; sunucu yedek/senkron kopyadır.
- **Telefon modu:** telefon hem sahip hem yürütücüdür. Program motoru ve tekrar motoru telefonda çalışır.
- **İstasyon modu:** telefon, bir bloğu istasyon tabletine **devreder**. Tablet o bloğu kendi program motoru örneğiyle yürütür ve olaylarını kendi kuyruğundan API'ye yollar. Telefon devredilen bloğu `delegated` olarak işaretler.

## Girdi / Çıktı
- Girdi: `Workout` (sıralı bloklar) ve olaylar:
  - Tekrar motorundan (04): `REP_STARTED`, `REP_COMPLETED { outcome: valid|faulty|incomplete, faults[], durationMs }`, `FAULT_DETECTED { faultId }`, `SAFETY_PAUSE { faultId }`, `TRACKING_LOST`, `TRACKING_RESTORED`, `READY_POSE_HELD`
    - `FAULT_DETECTED` yalnızca uyarı kurallarından (05: bekleme, art arda deneme, öncelik) geçmiş, **seslendirilecek** hatadır. Tüm tespitler `REP_COMPLETED.faults` içinde kaydedilir.
    - Aynı karede olaylar şu sırayla gelir: `FAULT_DETECTED` → `REP_COMPLETED` → `SAFETY_PAUSE`.
  - Kullanıcıdan: `USER_ACTION { kind }` — `START`, `READY` (hazırım), `PAUSE`, `RESUME`, `END_SET`, `CONTINUE_SET`, `SKIP_BLOCK`, `UNDO_SKIP`, `ABORT`
  - Devir: `HANDOFF_ACCEPTED { cursor }` (istasyon tableti), `HANDOFF_RETURNED` (telefon)
  - Elle kayıt: `MANUAL_SET { reps }` (kamerasız mod, 07)
  - Zaman: `TICK { now }`
- Çıktı: durum + yan etki komutları (`SPEAK`, `SHOW`, `NAVIGATE_TO_STATION`, `PERSIST_EVENT`, `SHOW_HANDOFF_QR`).

## Bugünün antrenmanı
Üyenin aktif programının gün sırası `day_index`'tir. Bugünün günü, bu programdaki son `done` seansın gününden sonraki gündür; son günden sonra başa dönülür. Hiç tamamlanmış seans yoksa ilk gün seçilir. Seçimi API önerir (`nextDayIndex`); üye başka bir gün seçebilir.

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
Sahip (telefon):  IDLE → (READY | TRANSFER)
Yürütücü (tablet): CHECKIN → READY            (yalnız devredilen blok)
READY → COUNTDOWN → SET_ACTIVE ⇄ SET_CONFIRM → (REST → READY) | BLOCK_DONE
BLOCK_DONE → NEXT_BLOCK_READY → READY | TRANSFER | SESSION_DONE
Yürütücüde BLOCK_DONE → IDLE ("Telefonundan devam et")
```
- `PAUSED` ve `ABORTED`, terminal olmayan her durumdan girilebilir (yürütücünün `IDLE`'ı hariç). `PAUSED`, girildiği durumu `resumeTo` olarak saklar ve `RESUME` ile oraya dönülür. `resumeTo` `SET_ACTIVE` veya `SET_CONFIRM` ise dönüş `COUNTDOWN` üzerinden olur ve set sayacı korunur. `resumeTo = REST` ise kalan dinlenme süresi korunur.
- `BLOCK_DONE` ve `NEXT_BLOCK_READY` geçici durumlardır: aynı girdi içinde geçilir.
- Terminal durumlar: `SESSION_DONE`, `ABORTED`, `ABANDONED`. Diyagramdaki "→ IDLE", cihazın yeni seans için yeni bir motor örneği başlatmasıdır.
- `TICK` dışındaki girdiler son `TICK` zamanında (`now`) işlenir.
- Komutlar: `SPEAK`/`SHOW` metin değil i18n anahtarı taşır (ör. `cue.squat.knee_valgus`, `prompt.set_done`).

## Geçiş kuralları
1. **Başlangıç:** Sahipte `IDLE` + `START` seansı başlatır (seans kaydı `active`) ve ilk bloğa geçer (`NEXT_BLOCK_READY` kuralı). Yürütücü `CHECKIN`'de başlar ve `HANDOFF_ACCEPTED { cursor }` ile imleçteki bloğun `READY` durumuna geçer.
2. **READY → COUNTDOWN:** `START` veya `READY_POSE_HELD` (kural paketindeki `readyPose`). 3 sn sonra `SET_ACTIVE`. Geri sayım sesli yapılır: girişte `countdown.3`, kalan süre 2 ve 1 saniyeye inince `countdown.2` ve `countdown.1`, sonra `set.go`. `COUNTDOWN`'da tekrar olayları ve uyarılar yok sayılır.
3. **SET_ACTIVE:** `REP_COMPLETED` olayında sayaç 04'teki outcome tablosuna göre artar: strict modda yalnız `valid`, lenient modda `valid` + `faulty`. Tüm outcome'lar (`incomplete` dahil) `PERSIST_EVENT` ile kaydedilir. `FAULT_DETECTED` yalnız `SET_ACTIVE`'de seslendirilir (`SPEAK`/`SHOW cue.<exerciseId>.<faultId>`).
4. **Set sonu:** sayaç hedefe ulaşınca veya `END_SET` ile set biter. Set kaydı yazılır ve set özeti gösterilir (05). Son setse `BLOCK_DONE`, değilse `REST`. Süreli blokta (`durationSec`) set süre dolunca biter.
5. **Hareketsizlik:** `SET_ACTIVE`'de son `REP_STARTED`/`REP_COMPLETED`'den (yoksa set başlangıcından) 10 sn geçerse `SET_CONFIRM` ("Set bitti mi?"). `CONTINUE_SET` → `SET_ACTIVE` ve sayaç sıfırlanır. `END_SET` → set biter. `SET_CONFIRM`'de tekrar olayı gelirse işlenir ve `SET_ACTIVE`'e dönülür. 20. saniyede (toplam) set otomatik kapanır, yapılan tekrar kaydedilir ve set `below_target` olarak işaretlenir.
6. **REST:** `restSec` geri sayımı. `READY` ile erken çıkılabilir. Süre dolunca sesli bildirim, sonra `READY`.
7. **NEXT_BLOCK_READY:** sonraki blok yoksa `SESSION_DONE` (seans kaydı `done`). Sonraki bloğun `stationHint`'i tanımlı ve mevcut bloğunkinden farklıysa `TRANSFER`, değilse `READY`.
8. **TRANSFER (yalnız sahip):** `SHOW_HANDOFF_QR { cursor }` ve `NAVIGATE_TO_STATION { stationHint }` üretilir. Üye üç şekilde devam eder:
   - Tablet QR'ı okur ve bloğu yürütür. Üye dönünce telefonda `HANDOFF_RETURNED`: blok `delegated` işaretlenir ve imleç sonraki bloğa geçer (kural 7).
   - `START`: blok telefonda yürütülür (`READY`).
   - `SKIP_BLOCK`.
   TRANSFER'e girişten 30 dk sonra `PAUSED`, 2 saat sonra `ABANDONED` (seans kaydı `abandoned`) olur. `resumeTo = TRANSFER` iken gelen `HANDOFF_RETURNED` örtük olarak devam ettirir.
9. **Atla:** `SKIP_BLOCK` yalnız `READY`, `REST` ve `TRANSFER`'de geçerlidir. Blok, hiç set yapılmadıysa `skipped`, yapıldıysa `partial` olur, ardından kural 7 uygulanır. **Geri al:** `UNDO_SKIP` yalnız atlamanın hemen ardından, sonraki blokta henüz set başlamamışken (`READY` veya `TRANSFER`) geçerlidir ve atlanan bloğa kaldığı setten döner. Başka durumlarda geçersizdir. Bu yüzden atlanan bloğun kaydı, geri alma imkânı kapanınca yazılır: sonraki setin geri sayımı başladığında, başka bir atlamada veya seans bittiğinde.
10. **Takip kaybı:** `TRACKING_LOST`'tan sonra 5 sn içinde `TRACKING_RESTORED` gelmezse ve durum `SET_ACTIVE` veya `READY` ise `PAUSED` olur. Duraklarken "Seni göremiyorum, kadraja geri gel" söylenir ve gösterilir (`tracking.lost`). Takip geri gelince otomatik devam edilir (`RESUME` gibi: `SET_ACTIVE`'e 3-2-1 geri sayımla, set sayacı korunur). Elle duraklatmada otomatik devam yoktur (güvenlik duraklatması: kural 11); takip geri gelince ekran "Devam" önerir.
11. **Güvenlik duraklatması:** `SET_ACTIVE`'de `SAFETY_PAUSE` gelirse "Dur, formunu kontrol et" söylenir ve `PAUSED` olur (`resumeTo = SET_ACTIVE`, hatanın kimliği durumda saklanır). Diğer durumlarda yok sayılır. Duraklamadayken `READY_POSE_HELD` gelirse (üye doğru başlangıç duruşuna döndü, form düzeldi) otomatik devam edilir: "Form düzeldi" söylenir ve gösterilir (`safety.resumed`), geri sayım bu ifadeyle başlar ("üç" yerine), "iki, bir" ile sürer; set sayacı korunur. "Devam" ile elle de dönülebilir.
12. **ABORT:** `ABORTED`. Devam eden sette en az bir deneme varsa set kaydı (`below_target`) yazılır, blok `partial` olur. Seans kaydı `aborted` olur.
13. **Yürütücüde blok sonu:** blok kaydı (`done`) yazılır, `SHOW handoff.return_to_phone` gösterilir, durum `IDLE` olur.
14. **Elle kayıt:** `READY`'de `MANUAL_SET { reps }` kamera seti yerine geçer. Set kaydı `source = manual`, `validReps = reps` ile yazılır ve tekrar kaydı üretilmez (06). `below_target` değeri `reps < hedef` olur; süreli blokta `false` olur. Sonrası kural 4'teki gibidir (REST veya BLOCK_DONE). Başka durumlarda geçersizdir.
15. Geçersiz girdi durumu değiştirmez ve komut üretmez.

## Kayıtlar (PERSIST_EVENT)
- **Seans:** sahip yazar. Başlangıçta `active`, bitişte `done`, `aborted` veya `abandoned`.
- **Blok, set, tekrar:** bloğu yürüten cihaz yazar. Devredilen bloğun kayıtlarını yalnız tablet yazar; telefon bu blok için kayıt üretmez.
- Kimlikler (UUID) motor tarafından üretilir. Üretici dışarıdan enjekte edilir, böylece testler deterministiktir.

## Devir (handoff) protokolü
1. Telefon handoff QR'ı üretir: kısa ömürlü imzalı token (07) + `SessionCursor` + devredilen bloğun tanımı. Tablet bloğu QR'daki tanımla yürütür; ağa ihtiyaç duymaz.
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
- AC-3.7: Devir: telefon motoru ve tablet motoru ayrı örneklerle simüle edilir. Blok tablette tamamlanır, telefon imleci doğru bloğa ilerler (ağ yokken de). Devredilen bloğun kayıtlarını yalnız tablet üretir.
- AC-3.9: `MANUAL_SET` READY'de manuel set kaydı üretir (tekrar kaydı yok, şemaya uygun), dinlenme ve blok akışı kamerasız setteki gibi ilerler; başka durumlarda yok sayılır.
- AC-3.8: Atla/geri al: geri alınan atlama hiç kayıt üretmez; geri alma imkânı kapanınca `skipped`/`partial` kaydı tek kez yazılır.
