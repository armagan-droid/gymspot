# 06 — Veri Modeli ve Çok Kiracılık

PostgreSQL. **Her tenant tablosunda `tenant_id` bulunur**, alt tablolar dahil (join ile türetilmez). Satır düzeyi güvenlik (RLS) ile `tenant_id = current_setting('app.tenant_id')` zorunlu. Platform tabloları (`tenants`, `platform_admins`) hariç.

## Varlıklar
```
-- platform
tenants(id, name, plan, status, created_at)
platform_admins(id, email, password_hash, status)

-- tenant yapısı
branches(id, tenant_id, name, address, timezone)
users(id, tenant_id, email, password_hash, role[owner|manager|trainer], status)      -- personel
members(id, tenant_id, branch_id, display_name, email?, phone?, external_ref,
        consent_at, consent_version, consent_withdrawn_at?, status)
trainer_members(tenant_id, trainer_user_id, member_id)                               -- "atanmış üyeler"
stations(id, tenant_id, branch_id, name, exercise_ids[], device_status, last_heartbeat_at)
devices(id, tenant_id, station_id?, kind[tablet|phone], token_hash, last_seen_at)

-- kimlik
member_login_tokens(id, tenant_id, member_id, token_hash, expires_at, used_at)       -- magic link
auth_refresh_tokens(id, tenant_id, subject_kind[user|member|device], subject_id, token_hash, expires_at, revoked_at)
qr_tokens(id, tenant_id, member_id, session_id?, jti, expires_at, used_at)           -- check-in/devir
login_attempts(tenant_id, email, failed_count, window_started_at, locked_until)       -- personel giriş kilidi
device_pairing_codes(id, tenant_id, station_id, code_hash, expires_at, used_at, created_by)

-- program
exercises(id, version, definition_json, status, tenant_id NULL=global)  -- PK (id, version)
program_templates(id, tenant_id, name, created_by)
program_template_blocks(id, tenant_id, template_id, day_index, position, exercise_id, sets, reps,
                        duration_sec, rest_sec, mode, station_hint)
member_programs(id, tenant_id, member_id, template_id?, assigned_by, start_date, end_date)

-- seans (id'ler istemci üretimli UUID)
sessions(id, tenant_id, member_id, member_program_id, workout_day_index, started_at, ended_at,
         status[active|paused|done|abandoned|aborted])
session_blocks(id, tenant_id, session_id, position, exercise_id, exercise_version, planned_sets,
               executed_by_device_id, station_id?, status[done|skipped|partial|delegated])
sets(id, tenant_id, session_block_id, set_index, planned_reps, valid_reps, faulty_reps, incomplete_reps,
     source[camera|manual], view[front|side|ambiguous]?, below_target bool, started_at, ended_at)
rep_events(id, tenant_id, set_id, rep_index, outcome[valid|faulty|incomplete], duration_ms, faults text[])
fault_summaries(tenant_id, set_id, fault_id, count)                                  -- türetilmiş

-- kalibrasyon (07) — üretim seans verisinden ayrı
calibration_consents(id, tenant_id, participant_ref, consent_version, consented_at, withdrawn_at?, recorded_by)
calibration_recordings(id, tenant_id, consent_id, exercise_id, exercise_version, labels_json,
                       storage_ref, created_at)       -- landmark dizisi ayrı şifreli depoda

audit_log(id, tenant_id, actor, action, target, at)
```

## Kurallar
- **İdempotency:** `sessions`, `session_blocks`, `sets` ve `rep_events` satırlarının `id`'si istemcinin ürettiği UUID'dir (= `event_id`). Yazım `INSERT … ON CONFLICT (id) DO NOTHING`. Tek istisna `sessions`: aynı `id` ile gelen kayıt durumu **ileri** taşıyorsa günceller (`active` → `paused` → `done`/`aborted`/`abandoned`; terminal durum değişmez). Diğer kayıtlar yazıldıktan sonra değişmez; motor onları yalnız kesinleşince üretir (03). Set sayaçları güncellenirken son yazan değil, `rep_events`'ten yeniden hesaplanan değer esas alınır.
- Her seans bloğu kural paketinin **sürümünü** (`exercise_version`) kaydeder. Eşikler değişse de geçmiş yorumlanabilir.
- **Landmark veya video verisi seans tablolarında saklanmaz.** Tek istisna, açık rızalı kalibrasyon kayıtlarıdır (07). Bunlar ana veritabanında değil, ayrı erişim yetkili şifreli nesne deposunda tutulur, burada yalnızca referans vardır.
- Elle kayıt (rıza yok veya kamera izni yok) setleri `source = manual` ile yazılır; `rep_events` üretmez.
- Üye silme talebi: üye ve bağlı seans verisi anonimleştirilir/silinir (07).
- Saat dilimi şube bazlıdır; tüm zaman damgaları UTC saklanır.
- **Uygulama rolü:** API her isteği bir transaction içinde `app.tenant_id` ayarlayıp `gymspot_app` rolüne geçerek çalıştırır. Bu rol RLS'yi atlayamaz; tablolarda `FORCE ROW LEVEL SECURITY` açıktır. Üretimde API'nin bağlantı kullanıcısı bu role üye olmalı, süper kullanıcı olmamalıdır. Migrasyonlar ayrı bir sahip kullanıcıyla çalışır.
- `fault_summaries`, `rep_events`'ten türetilen bir görünümdür (`security_invoker`), bu yüzden RLS'ye tabidir ve hiç senkron dışı kalamaz.

## Roller ve yetki
| İşlem | Üye | Antrenör | Yönetici | Sahip |
|---|---|---|---|---|
| Kendi seansını görme | ✓ | | | |
| Üye programı atama | | atanmış üyeler | ✓ | ✓ |
| Üye seansları | | atanmış üyeler (`trainer_members`) | ✓ | ✓ |
| İstasyon/cihaz yönetimi | | | ✓ | ✓ |
| Kalibrasyon kaydı başlatma | | | ✓ | ✓ |
| Kullanıcı yönetimi, faturalama | | | | ✓ |

**API erişim kuralları (MVP):**
- Başka tenant'ın kaydı, var olsa bile **404** döner (AC-6.1).
- Antrenörün atanmamış bir üyeye (ve onun programlarına/seanslarına) erişimi de **404** döner; 403 kaydın varlığını sızdırırdı.
- Program şablonlarını personelin tamamı (antrenör dahil) yönetebilir. Şablon bloklarındaki `exercise_id` görünür bir kural paketine (global veya tenant'ın kendi paketi) ait olmalıdır.
- Üye yalnız kendi profilini, rızasını, programını ve seanslarını görür (`/me`).
- Üye programı şablona referans verir, blokların kopyası tutulmaz (MVP). Bu yüzden bir üyeye atanmış şablon silinemez (`409 template_in_use`), şablondaki düzenlemeler atanmış üyelere yansır.
- Aktif program: başlangıç tarihi bugün veya önce olan, bitişi olmayan ya da bugün veya sonra olan programlardan en son başlayanı.

Platform yöneticisi tenant verisine yalnızca destek amaçlı, `audit_log`'a yazılan açık bir "destek erişimi" ile ulaşır (MVP'de salt okunur).

## Kabul kriterleri
- AC-6.1: Bir tenant'ın kullanıcısı başka tenant verisine (doğrudan ID ile bile) erişemez; otomatik test (tenant A ile B'nin verisine istek → 404). RLS, uygulama filtresi olmadan da tek başına bunu sağlar (doğrudan SQL testi).
- AC-6.2: Aynı `id`'li seans/set/tekrar kaydı iki kez gönderilince kayıt çoğalmaz ve sayaçlar değişmez.
- AC-6.3: Migrasyonlar sıfırdan kurulup geri alınabilir.
- AC-6.4: Antrenör, `trainer_members`'ta olmayan üyenin seansını göremez (test).
